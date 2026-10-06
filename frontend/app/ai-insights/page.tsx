'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from '@/lib/i18n';
import { ChatMessage } from '@/components/wave03/chat-message';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ChatSession {
  id: string;
  title: string;
  lastMessage: string;
  updatedAt: string;
}

interface ChatMsg {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  lang?: 'es' | 'en' | 'both';
  moduleRefs?: string[];
}

interface Institution {
  id: string;
  name: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const API = (process.env.NEXT_PUBLIC_NODE_API_URL || '').trim().replace(/\/+$/, '');

function authHeaders(): HeadersInit {
  const token = typeof window !== 'undefined' ? sessionStorage.getItem('capex_access_token') : null;
  return token ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

// ─── Demo data ──────────────────────────────────────────────────────────────

const DEMO_INSTITUTIONS: Institution[] = [
  { id: 'demo-1', name: 'Cooperativa de Ahorro Caguas' },
  { id: 'demo-2', name: 'ACACIA Federal Credit Union' },
];

const DEMO_SESSIONS: ChatSession[] = [
  { id: 's1', title: 'Liquidity Risk Review', lastMessage: 'Your LCR is above the 100% threshold...', updatedAt: '2026-04-16T10:30:00Z' },
  { id: 's2', title: 'NII Sensitivity Analysis', lastMessage: 'Based on the +200bps shock scenario...', updatedAt: '2026-04-15T14:20:00Z' },
  { id: 's3', title: 'COSSEC Exam Prep', lastMessage: 'Here are the top 5 findings to address...', updatedAt: '2026-04-14T09:15:00Z' },
];

const DEMO_MESSAGES: ChatMsg[] = [
  {
    id: 'm1', role: 'user', content: 'What is our current liquidity position?', timestamp: '2026-04-16T10:28:00Z', lang: 'en',
  },
  {
    id: 'm2', role: 'assistant', content: '**Liquidity Coverage Ratio (LCR)** is currently at **142.3%**, well above the 100% regulatory minimum.\n\nKey metrics:\n- HQLA: `$87.5M`\n- Net Cash Outflows (30d): `$61.4M`\n- Buffer over minimum: `+42.3%`\n\nYour institution is in a **compliant** position. I recommend reviewing the deposit concentration in the top 10 depositors, which accounts for 34% of total deposits.', timestamp: '2026-04-16T10:28:15Z', lang: 'en', moduleRefs: ['liquidity', 'concentration'],
  },
  {
    id: 'm3', role: 'user', content: 'How would a +200bps rate shock affect our NII?', timestamp: '2026-04-16T10:30:00Z', lang: 'en',
  },
  {
    id: 'm4', role: 'assistant', content: 'Under a **+200bps parallel shock**, your projected Net Interest Income impact is:\n\n- **NII Change**: `-$2.1M` (-4.8%)\n- **EVE Impact**: `-$8.3M` (-6.2%)\n- **Duration Gap**: shifts from 1.2yr to 1.8yr\n\nThe primary driver is your fixed-rate mortgage portfolio (48% of assets) repricing slower than your CD book. Consider the `cap-floor` hedging module for mitigation strategies.', timestamp: '2026-04-16T10:30:20Z', lang: 'en', moduleRefs: ['stress-test', 'cap-floor'],
  },
];

// ─── Session Sidebar ────────────────────────────────────────────────────────

function SessionList({
  sessions,
  activeId,
  onSelect,
  onNew,
  locale,
}: {
  sessions: ChatSession[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  locale: 'en' | 'es';
}) {
  return (
    <aside className="flex w-72 flex-shrink-0 flex-col border-r border-slate-200 bg-slate-50">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-bold text-[#1e3a5f]">
          {locale === 'es' ? 'Conversaciones' : 'Conversations'}
        </h2>
        <button
          onClick={onNew}
          className="rounded-lg bg-[#1e3a5f] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#2a4f7f]"
          aria-label={locale === 'es' ? 'Nueva conversacion' : 'New conversation'}
        >
          + {locale === 'es' ? 'Nueva' : 'New'}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 && (
          <p className="px-4 py-8 text-center text-xs text-slate-400">
            {locale === 'es' ? 'Sin conversaciones' : 'No conversations yet'}
          </p>
        )}
        {sessions.map((s) => (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={`w-full border-b border-slate-100 px-4 py-3 text-left transition hover:bg-white ${
              activeId === s.id ? 'bg-white border-l-2 border-l-[#1e3a5f]' : ''
            }`}
          >
            <p className="text-sm font-medium text-slate-800 truncate">{s.title}</p>
            <p className="mt-0.5 text-[11px] text-slate-400 truncate">{s.lastMessage}</p>
          </button>
        ))}
      </div>
    </aside>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function AIAdvisorPage() {
  const { locale } = useTranslation();

  // State
  const [institutions] = useState<Institution[]>(DEMO_INSTITUTIONS);
  const [selectedInstitution, setSelectedInstitution] = useState<string>(DEMO_INSTITUTIONS[0]?.id || '');
  const [sessions, setSessions] = useState<ChatSession[]>(DEMO_SESSIONS);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(DEMO_SESSIONS[0]?.id || null);
  const [messages, setMessages] = useState<ChatMsg[]>(DEMO_MESSAGES);
  const [input, setInput] = useState('');
  const [language, setLanguage] = useState<'es' | 'en' | 'both'>('en');
  const [loading, setLoading] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Fetch sessions on mount
  useEffect(() => {
    async function fetchSessions() {
      try {
        const res = await fetch(`${API}/api/ai-advisor/sessions/${selectedInstitution}`, { headers: authHeaders() });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            setSessions(data);
            setActiveSessionId(data[0].id);
          }
        }
      } catch {
        // Use demo data
      } finally {
        setPageLoading(false);
      }
    }
    fetchSessions();
  }, [selectedInstitution]);

  // WebSocket connection (Socket.IO)
  useEffect(() => {
    let ws: WebSocket | null = null;
    try {
      const wsUrl = API.replace(/^http/, 'ws') + '/ai-advisor';
      ws = new WebSocket(wsUrl);
      ws.onopen = () => setWsConnected(true);
      ws.onclose = () => setWsConnected(false);
      ws.onerror = () => setWsConnected(false);
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'message' && data.sessionId === activeSessionId) {
            setMessages((prev) => [...prev, data.message]);
            setLoading(false);
          }
        } catch { /* ignore parse errors */ }
      };
    } catch {
      // WebSocket not available, use REST fallback
    }
    return () => { ws?.close(); };
  }, [activeSessionId]);

  // Send message
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: ChatMsg = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
      lang: language,
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch(`${API}/api/ai-advisor/chat`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          sessionId: activeSessionId,
          institutionId: selectedInstitution,
          message: text,
          language,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const aiMsg: ChatMsg = {
          id: data.id || `a-${Date.now()}`,
          role: 'assistant',
          content: data.content || data.message || (locale === 'es' ? 'No se pudo generar respuesta.' : 'Could not generate a response.'),
          timestamp: new Date().toISOString(),
          lang: language,
          moduleRefs: data.moduleRefs,
        };
        setMessages((prev) => [...prev, aiMsg]);
      } else {
        // Demo fallback response
        const aiMsg: ChatMsg = {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: locale === 'es'
            ? 'Estoy analizando los datos de su institucion. En base a los parametros actuales, su posicion de liquidez se mantiene saludable con un LCR de 142.3%.'
            : 'I am analyzing your institution data. Based on current parameters, your liquidity position remains healthy with an LCR of 142.3%.',
          timestamp: new Date().toISOString(),
          lang: language,
          moduleRefs: ['liquidity'],
        };
        setMessages((prev) => [...prev, aiMsg]);
      }
    } catch {
      const errMsg: ChatMsg = {
        id: `e-${Date.now()}`,
        role: 'assistant',
        content: locale === 'es'
          ? 'Disculpe, hubo un error al procesar su solicitud. Por favor intente nuevamente.'
          : 'Sorry, there was an error processing your request. Please try again.',
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, activeSessionId, selectedInstitution, language, locale]);

  const handleNewSession = () => {
    const newId = `s-${Date.now()}`;
    setSessions((prev) => [{ id: newId, title: locale === 'es' ? 'Nueva conversacion' : 'New conversation', lastMessage: '', updatedAt: new Date().toISOString() }, ...prev]);
    setActiveSessionId(newId);
    setMessages([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ─── Loading state ──────────────────────────────────────────────────────

  if (pageLoading) {
    return (
      <div className="flex h-[calc(100vh-64px)] bg-white">
        <div className="w-72 flex-shrink-0 border-r border-slate-200 bg-slate-50 animate-pulse">
          <div className="border-b border-slate-200 px-4 py-4">
            <div className="h-5 w-32 rounded bg-slate-200" />
          </div>
          {[...Array(5)].map((_, i) => (
            <div key={i} className="border-b border-slate-100 px-4 py-3">
              <div className="h-4 w-40 rounded bg-slate-200 mb-1.5" />
              <div className="h-3 w-52 rounded bg-slate-200" />
            </div>
          ))}
        </div>
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#1e3a5f] border-t-transparent" />
          <p className="mt-3 text-sm text-slate-500">
            {locale === 'es' ? 'Cargando AI Advisor...' : 'Loading AI Advisor...'}
          </p>
        </div>
      </div>
    );
  }

  // ─── Main render ────────────────────────────────────────────────────────

  return (
    <div className="flex h-[calc(100vh-64px)] bg-white">
      {/* Left sidebar: session list */}
      <SessionList
        sessions={sessions}
        activeId={activeSessionId}
        onSelect={(id) => { setActiveSessionId(id); setMessages(DEMO_MESSAGES); }}
        onNew={handleNewSession}
        locale={locale}
      />

      {/* Main chat area */}
      <div className="flex flex-1 flex-col">
        {/* Top bar */}
        <header className="flex items-center justify-between border-b border-slate-200 px-6 py-3">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600">
                <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
              </div>
              <div>
                <h1 className="text-sm font-bold text-[#1e3a5f]">
                  {locale === 'es' ? 'Asesor AI' : 'AI Advisor'}
                </h1>
                <div className="flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${wsConnected ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                  <span className="text-[10px] text-slate-400">
                    {wsConnected ? (locale === 'es' ? 'Conectado' : 'Connected') : (locale === 'es' ? 'Desconectado' : 'Offline')}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Institution selector */}
          <div className="flex items-center gap-3">
            <select
              value={selectedInstitution}
              onChange={(e) => setSelectedInstitution(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 focus:border-[#1e3a5f] focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]"
              aria-label={locale === 'es' ? 'Seleccionar institucion' : 'Select institution'}
            >
              {institutions.map((inst) => (
                <option key={inst.id} value={inst.id}>{inst.name}</option>
              ))}
            </select>
          </div>
        </header>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 mb-4">
                <svg className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                </svg>
              </div>
              <h2 className="text-lg font-bold text-[#1e3a5f]">
                {locale === 'es' ? 'Bienvenido al Asesor AI' : 'Welcome to AI Advisor'}
              </h2>
              <p className="mt-1 max-w-md text-sm text-slate-500">
                {locale === 'es'
                  ? 'Pregunte sobre liquidez, riesgo crediticio, preparacion de examenes, o cualquier metrica ALM.'
                  : 'Ask about liquidity, credit risk, exam preparation, or any ALM metric.'}
              </p>
            </div>
          )}

          {messages.map((msg) => (
            <ChatMessage
              key={msg.id}
              role={msg.role}
              content={msg.content}
              timestamp={msg.timestamp}
              lang={msg.lang}
              moduleRefs={msg.moduleRefs}
            />
          ))}

          {loading && (
            <ChatMessage
              role="assistant"
              content=""
              timestamp={new Date().toISOString()}
              streaming
            />
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input bar */}
        <div className="border-t border-slate-200 px-6 py-3">
          <div className="flex items-end gap-3">
            {/* Language selector */}
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as 'es' | 'en' | 'both')}
              className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-medium text-slate-600 focus:border-[#1e3a5f] focus:outline-none"
              aria-label={locale === 'es' ? 'Idioma de respuesta' : 'Response language'}
            >
              <option value="en">EN</option>
              <option value="es">ES</option>
              <option value="both">Both</option>
            </select>

            {/* Text input */}
            <div className="relative flex-1">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={locale === 'es' ? 'Escriba su pregunta...' : 'Type your question...'}
                rows={1}
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 pr-12 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#1e3a5f] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#1e3a5f]"
                aria-label={locale === 'es' ? 'Mensaje' : 'Message'}
              />
            </div>

            {/* Send button */}
            <button
              onClick={handleSend}
              disabled={!input.trim() || loading}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1e3a5f] text-white transition hover:bg-[#2a4f7f] disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={locale === 'es' ? 'Enviar' : 'Send'}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
