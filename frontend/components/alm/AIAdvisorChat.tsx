'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api';
import { Send, Bot, User, Sparkles, X, Loader2 } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface AIAdvisorChatProps {
  institutionId: string;
  onClose?: () => void;
}

const QUICK_QUESTIONS_ES = [
  { label: 'Tasas +100bps', text: '\u00bfQue pasa si suben tasas +100 puntos base?' },
  { label: 'Examen COSSEC', text: '\u00bfEstoy listo para el examen COSSEC?' },
  { label: 'Riesgo liquidez', text: '\u00bfCual es mi mayor riesgo de liquidez?' },
  { label: 'Mejorar NIM', text: '\u00bfComo puedo mejorar mi margen de interes neto?' },
  { label: 'Comparar sector', text: '\u00bfComo me comparo con otras cooperativas del sector?' },
];

const QUICK_QUESTIONS_EN = [
  { label: 'Rates +100bps', text: 'What happens if rates rise +100 basis points?' },
  { label: 'COSSEC Exam', text: 'Am I ready for the COSSEC exam?' },
  { label: 'Liquidity Risk', text: 'What is my biggest liquidity risk?' },
  { label: 'Improve NIM', text: 'How can I improve my net interest margin?' },
  { label: 'Peer Comparison', text: 'How do I compare to other cooperativas in the sector?' },
];

export default function AIAdvisorChat({ institutionId, onClose }: AIAdvisorChatProps) {
  const { locale } = useTranslation();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const quickQuestions = locale === 'es' ? QUICK_QUESTIONS_ES : QUICK_QUESTIONS_EN;

  const scrollToBottom = useCallback(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;

      const userMessage: Message = { role: 'user', content: text.trim() };
      const updatedMessages = [...messages, userMessage];
      setMessages(updatedMessages);
      setInputText('');
      setIsLoading(true);

      try {
        const result = await apiClient.askAdvisor(
          institutionId,
          text.trim(),
          messages,
          locale,
        );
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: result.response },
        ]);
      } catch {
        const errorMsg =
          locale === 'es'
            ? 'Error al conectar con el asesor IA. Verifica tu conexion.'
            : 'Failed to connect to the AI advisor. Check your connection.';
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: errorMsg },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [institutionId, isLoading, locale, messages],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputText);
    }
  };

  const welcomeText =
    locale === 'es'
      ? 'Soy tu asesor de riesgo IA. Tengo acceso a los datos actuales de tu institucion. Preguntame sobre tasas de interes, liquidez, examen COSSEC, o cualquier aspecto de ALM.'
      : "I'm your AI risk advisor. I have access to your institution's current data. Ask me about interest rates, liquidity, COSSEC exam readiness, or any aspect of ALM.";

  return (
    <div className="flex flex-col h-full bg-white rounded-xl border border-slate-200 shadow-[0_18px_38px_rgba(63,93,132,0.08)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 bg-gradient-to-r from-[#1B3A6B] to-[#234B82] text-white shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 backdrop-blur-sm">
            <Sparkles className="h-4 w-4 text-amber-300" />
          </div>
          <div>
            <h3 className="text-sm font-semibold tracking-tight">CERNIQ AI Risk Advisor</h3>
            <p className="text-[10px] text-white/60 font-medium">
              {locale === 'es' ? 'Impulsado por Claude' : 'Powered by Claude'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px] font-medium text-emerald-300/90 uppercase tracking-wider">
              {locale === 'es' ? 'Datos en vivo' : 'Live Data'}
            </span>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="ml-2 rounded-lg p-1.5 text-white/60 transition hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-slate-50/50">
        {/* Welcome message */}
        {messages.length === 0 && (
          <div className="flex gap-3">
            <div className="shrink-0 flex h-8 w-8 items-center justify-center rounded-lg bg-[#1B3A6B] text-white">
              <Bot className="h-4 w-4" />
            </div>
            <div className="max-w-[85%] rounded-2xl rounded-tl-md bg-white border border-slate-200 px-4 py-3 shadow-sm">
              <p className="text-sm leading-relaxed text-slate-700">{welcomeText}</p>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
          >
            {/* Avatar */}
            <div
              className={`shrink-0 flex h-8 w-8 items-center justify-center rounded-lg ${
                msg.role === 'user'
                  ? 'bg-amber-500 text-white'
                  : 'bg-[#1B3A6B] text-white'
              }`}
            >
              {msg.role === 'user' ? (
                <User className="h-4 w-4" />
              ) : (
                <Bot className="h-4 w-4" />
              )}
            </div>

            {/* Bubble */}
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-sm ${
                msg.role === 'user'
                  ? 'rounded-tr-md bg-amber-50 border border-amber-200 text-slate-900'
                  : 'rounded-tl-md bg-white border border-slate-200 text-slate-700'
              }`}
            >
              <div className="text-sm leading-relaxed whitespace-pre-wrap">
                {msg.content}
              </div>
            </div>
          </div>
        ))}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex gap-3">
            <div className="shrink-0 flex h-8 w-8 items-center justify-center rounded-lg bg-[#1B3A6B] text-white">
              <Bot className="h-4 w-4" />
            </div>
            <div className="rounded-2xl rounded-tl-md bg-white border border-slate-200 px-4 py-3 shadow-sm">
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                {locale === 'es' ? 'Analizando datos...' : 'Analyzing data...'}
              </div>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Quick Questions */}
      {messages.length === 0 && (
        <div className="px-4 py-3 border-t border-slate-100 bg-white">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
            {locale === 'es' ? 'Preguntas sugeridas' : 'Suggested questions'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {quickQuestions.map((q) => (
              <button
                key={q.label}
                onClick={() => sendMessage(q.text)}
                disabled={isLoading}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-medium text-slate-600 transition hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700 disabled:opacity-50"
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              locale === 'es'
                ? 'Pregunta sobre riesgo, tasas, liquidez...'
                : 'Ask about risk, rates, liquidity...'
            }
            rows={1}
            className="flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-cyan-300 focus:bg-white focus:ring-2 focus:ring-cyan-100"
            style={{ minHeight: '42px', maxHeight: '120px' }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = Math.min(target.scrollHeight, 120) + 'px';
            }}
          />
          <button
            onClick={() => sendMessage(inputText)}
            disabled={!inputText.trim() || isLoading}
            className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-[#1B3A6B] text-white transition hover:bg-[#234B82] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
