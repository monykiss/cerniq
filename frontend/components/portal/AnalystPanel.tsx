'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Bot, User, Sparkles, X, Loader2, Bookmark, Zap } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { getPublicApiUrl } from '@/lib/api-base';
import { getAccessToken } from '@/lib/api';

// ─── Types ─────────────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolsUsed?: string[];
}

interface RateLimitInfo {
  used: number;
  max: number;
  remaining: number;
}

interface AnalystPanelProps {
  institutionId: string;
  institutionName?: string;
  onClose?: () => void;
}

// ─── Quick questions ───────────────────────────────────────────

const QUICK_QUESTIONS_ES = [
  { label: 'Tasas +200bps', text: 'Si las tasas suben 200 puntos base, cual seria el impacto en mi NII?' },
  { label: 'Examen COSSEC', text: 'Cuales indicadores estan en incumplimiento y que debo corregir?' },
  { label: 'Riesgo principal', text: 'Cual es mi mayor riesgo ALM en este momento?' },
  { label: 'Comparar sector', text: 'Como me comparo con el promedio del sector cooperativo?' },
];

const QUICK_QUESTIONS_EN = [
  { label: 'Rates +200bps', text: 'If rates rise 200 basis points, what would be the impact on my NII?' },
  { label: 'COSSEC Exam', text: 'Which indicators are non-compliant and what should I fix?' },
  { label: 'Top Risk', text: 'What is my biggest ALM risk right now?' },
  { label: 'Peer Comparison', text: 'How do I compare to the cooperative sector average?' },
];

// ─── Component ─────────────────────────────────────────────────

export default function AnalystPanel({
  institutionId,
  institutionName,
  onClose,
}: AnalystPanelProps) {
  const { locale } = useTranslation();
  const t = useCallback((en: string, es: string) => (locale === 'en' ? en : es), [locale]);

  const storageKey = `cerniq_analyst_${institutionId}`;

  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const stored = localStorage.getItem(storageKey);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [inputText, setInputText] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [rateLimit, setRateLimit] = useState<RateLimitInfo | null>(null);
  const [activeTools, setActiveTools] = useState<string[]>([]);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const quickQuestions = locale === 'es' ? QUICK_QUESTIONS_ES : QUICK_QUESTIONS_EN;

  // Persist conversation to localStorage (skip while streaming to avoid partial writes)
  useEffect(() => {
    if (streaming) return;
    try {
      if (messages.length > 0) {
        // Keep last 50 messages to prevent localStorage bloat
        const toStore = messages.slice(-50);
        localStorage.setItem(storageKey, JSON.stringify(toStore));
      } else {
        localStorage.removeItem(storageKey);
      }
    } catch {
      // localStorage full or unavailable — degrade silently
    }
  }, [messages, streaming, storageKey]);

  // Auto-scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeTools]);

  // Load initial rate limit
  useEffect(() => {
    const token = getAccessToken() || null;
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    fetch(getPublicApiUrl(`/api/analyst/${institutionId}/rate-limit`), {
      credentials: 'include',
      headers,
    })
      .then((r) => r.json())
      .then((data) => setRateLimit(data))
      .catch(() => {});
  }, [institutionId]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || streaming) return;
      if (rateLimit && rateLimit.remaining <= 0) return;

      const userMsg: ChatMessage = { role: 'user', content: text.trim() };
      setMessages((prev) => [...prev, userMsg]);
      setInputText('');
      setStreaming(true);
      setActiveTools([]);

      const token = getAccessToken() || null;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      // Abort any previous stream
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        // Use SSE streaming endpoint for token-by-token delivery
        const sseUrl = new URL(getPublicApiUrl(`/api/analyst/${institutionId}/stream`));
        sseUrl.searchParams.set('message', text.trim());
        if (token) sseUrl.searchParams.set('token', token);

        const eventSource = new EventSource(sseUrl.toString());
        let fullText = '';
        const toolsUsed: string[] = [];
        let rateLimited = false;

        await new Promise<void>((resolve, reject) => {
          controller.signal.addEventListener('abort', () => {
            eventSource.close();
            resolve();
          });

          eventSource.onmessage = (ev) => {
            try {
              const data = JSON.parse(ev.data);

              switch (data.type) {
                case 'token':
                  fullText += data.text ?? '';
                  setMessages((prev) => {
                    const last = prev[prev.length - 1];
                    if (last?.role === 'assistant' && last === prev[prev.length - 1]) {
                      return [...prev.slice(0, -1), { ...last, content: fullText, toolsUsed: [...toolsUsed] }];
                    }
                    return [...prev, { role: 'assistant', content: fullText, toolsUsed: [...toolsUsed] }];
                  });
                  break;

                case 'tool_use':
                  toolsUsed.push(data.name);
                  setActiveTools([...toolsUsed]);
                  break;

                case 'done':
                  if (data.queriesUsed != null) {
                    setRateLimit({ used: data.queriesUsed, max: data.queriesMax ?? 20, remaining: (data.queriesMax ?? 20) - data.queriesUsed });
                  }
                  eventSource.close();
                  resolve();
                  break;

                case 'rate_limited':
                  rateLimited = true;
                  setMessages((prev) => [
                    ...prev,
                    { role: 'system', content: data.message ?? t('Daily limit reached.', 'Limite diario alcanzado.') },
                  ]);
                  if (data.queriesUsed != null) {
                    setRateLimit({ used: data.queriesUsed, max: data.queriesMax ?? 20, remaining: 0 });
                  }
                  eventSource.close();
                  resolve();
                  break;

                case 'error':
                  eventSource.close();
                  reject(new Error(data.message ?? 'Stream error'));
                  break;
              }
            } catch {
              // Malformed SSE data — ignore
            }
          };

          eventSource.onerror = () => {
            eventSource.close();
            // If we got no text and no rate limit, fall back to JSON endpoint
            if (!fullText && !rateLimited) {
              reject(new Error('SSE connection failed'));
            } else {
              resolve();
            }
          };
        });

        // If SSE sent no text (empty response), ensure we have at least a placeholder
        if (!fullText && !rateLimited) {
          setMessages((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: t(
                'I have your institution data loaded. Ask me about rates, compliance, or risk.',
                'Tengo los datos de su institucion. Pregunteme sobre tasas, cumplimiento, o riesgo.',
              ),
            },
          ]);
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setMessages((prev) => [
          ...prev,
          {
            role: 'system',
            content: t(
              'Connection error. Please try again.',
              'Error de conexion. Intente de nuevo.',
            ),
          },
        ]);
      } finally {
        setStreaming(false);
        setActiveTools([]);
      }
    },
    [institutionId, streaming, rateLimit, t],
  );

  const saveInsight = useCallback(
    async (messageContent: string) => {
      const token = getAccessToken() || null;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      await fetch(getPublicApiUrl(`/api/analyst/${institutionId}/insights`), {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          message: messageContent,
          savedBy: 'portal-user',
          tags: ['analyst-chat'],
        }),
      });
    },
    [institutionId],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(inputText);
    }
  };

  const rateLimitExhausted = rateLimit && rateLimit.remaining <= 0;

  return (
    <div className="flex flex-col h-full bg-white rounded-xl border border-slate-200 shadow-[0_18px_38px_rgba(63,93,132,0.08)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 bg-gradient-to-r from-[#1B3A6B] to-[#234B82] text-white shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 backdrop-blur-sm">
            <Sparkles className="h-4 w-4 text-amber-300" />
          </div>
          <div>
            <h3 className="text-sm font-semibold tracking-tight">CERNIQ Analyst</h3>
            <p className="text-[10px] text-white/60 font-medium">
              {institutionName ?? t('Risk Intelligence', 'Inteligencia de Riesgo')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {rateLimit && (
            <span className="text-[10px] font-mono text-white/50">
              {rateLimit.remaining}/{rateLimit.max}
            </span>
          )}
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] font-medium text-emerald-300/90 uppercase tracking-wider">
              {t('Live', 'En vivo')}
            </span>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="ml-2 rounded-lg p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white"
              aria-label={t('Close', 'Cerrar')}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-slate-50/50">
        {/* Welcome */}
        {messages.length === 0 && (
          <>
            <div className="flex gap-3">
              <div className="shrink-0 flex h-8 w-8 items-center justify-center rounded-lg bg-[#1B3A6B] text-white">
                <Bot className="h-4 w-4" />
              </div>
              <div className="max-w-[85%] rounded-2xl rounded-tl-md bg-white border border-slate-200 px-4 py-3 shadow-sm">
                <p className="text-sm leading-relaxed text-slate-700">
                  {t(
                    "I have access to your institution's COSSEC ratios, NII sensitivity, peer benchmarks, and regulatory thresholds. Ask me anything — I cite the exact regulation.",
                    'Tengo acceso a los ratios COSSEC de su institucion, sensibilidad NII, promedios del sector, y umbrales regulatorios. Pregunteme lo que sea — cito la regulacion exacta.',
                  )}
                </p>
              </div>
            </div>
            {/* Quick questions */}
            <div className="flex flex-wrap gap-2 pl-11">
              {quickQuestions.map((q) => (
                <button
                  key={q.label}
                  onClick={() => void sendMessage(q.text)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700"
                >
                  {q.label}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Messages */}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
          >
            <div
              className={`shrink-0 flex h-8 w-8 items-center justify-center rounded-lg ${
                msg.role === 'user'
                  ? 'bg-amber-500 text-white'
                  : msg.role === 'system'
                    ? 'bg-rose-100 text-rose-500'
                    : 'bg-[#1B3A6B] text-white'
              }`}
            >
              {msg.role === 'user' ? (
                <User className="h-4 w-4" />
              ) : msg.role === 'system' ? (
                <Zap className="h-4 w-4" />
              ) : (
                <Bot className="h-4 w-4" />
              )}
            </div>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-sm ${
                msg.role === 'user'
                  ? 'rounded-tr-md bg-[#1B3A6B] text-white'
                  : msg.role === 'system'
                    ? 'rounded-tl-md bg-rose-50 border border-rose-200 text-rose-700'
                    : 'rounded-tl-md bg-white border border-slate-200 text-slate-700'
              }`}
            >
              {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {msg.toolsUsed.map((tool) => (
                    <span
                      key={tool}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-cyan-100 text-cyan-700 border border-cyan-200"
                    >
                      <Zap className="h-2.5 w-2.5" />
                      {tool.replace('get_', '')}
                    </span>
                  ))}
                </div>
              )}
              <div className="text-sm leading-relaxed whitespace-pre-wrap">
                {msg.content}
              </div>
              {msg.role === 'assistant' && (
                <button
                  onClick={() => void saveInsight(msg.content)}
                  className="mt-2 flex items-center gap-1 text-[10px] text-slate-400 hover:text-cyan-600 transition"
                  title={t('Save insight', 'Guardar insight')}
                >
                  <Bookmark className="h-3 w-3" />
                  {t('Save', 'Guardar')}
                </button>
              )}
            </div>
          </div>
        ))}

        {/* Streaming indicator */}
        {streaming && (
          <div className="flex gap-3">
            <div className="shrink-0 flex h-8 w-8 items-center justify-center rounded-lg bg-[#1B3A6B] text-white">
              <Bot className="h-4 w-4" />
            </div>
            <div className="rounded-2xl rounded-tl-md bg-white border border-slate-200 px-4 py-3 shadow-sm">
              {activeTools.length > 0 ? (
                <div className="flex items-center gap-2 text-xs text-cyan-600">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>{t('Analyzing', 'Analizando')} {activeTools.join(', ')}...</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>{t('Thinking...', 'Pensando...')}</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-slate-200 bg-white px-4 py-3 shrink-0">
        {rateLimitExhausted ? (
          <div className="text-center text-xs text-amber-600 py-2">
            {t(
              'Daily query limit reached (20/20). Resets at midnight PR time.',
              'Limite diario alcanzado (20/20). Se restablece a medianoche hora de PR.',
            )}
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t(
                'Ask about rates, compliance, risk...',
                'Pregunte sobre tasas, cumplimiento, riesgo...',
              )}
              rows={1}
              className="flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-100 placeholder:text-slate-400"
              disabled={streaming}
            />
            <button
              onClick={() => void sendMessage(inputText)}
              disabled={!inputText.trim() || streaming}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#1B3A6B] text-white transition hover:bg-[#15305a] disabled:opacity-40"
              aria-label={t('Send', 'Enviar')}
            >
              {streaming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
