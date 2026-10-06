'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useInstitutionId } from '@/lib/hooks/useInstitutionId';
import { useTranslation } from '@/lib/i18n';
import { copilotQuery } from '@/lib/agents-api';
import { ErrorBanner } from '@/components/ui/cerniq';
import type { CFOCopilotOutput, CFOCopilotFollowup } from '@/types/agents';
import { Send, Bot, User, SlidersHorizontal, ChevronDown } from 'lucide-react';
import ScenarioInput, { type ScenarioParams } from '@/components/alm/scenario-input';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  toolsCalled?: string[];
  followups?: CFOCopilotFollowup[];
  timestamp: number;
}

const QUICK_QUESTIONS: { en: string; es: string }[] = [
  { en: 'What happens at +200bps?', es: '¿Qué pasa a +200bps?' },
  { en: 'What is our LCR vs peers?', es: '¿Cuál es nuestro LCR vs pares?' },
  { en: 'Run Monte Carlo with 10K paths', es: 'Ejecutar Monte Carlo con 10K caminos' },
  { en: 'Are we exam-ready?', es: '¿Estamos listos para examen?' },
];

export default function CopilotPage() {
  // Phase-2 layered resolver (see /alm/decisions for rationale).
  const selectedId = useInstitutionId();
  const { locale } = useTranslation();
  const isEs = locale === 'es';

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [scenarioOpen, setScenarioOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!selectedId || !text.trim() || sending) return;
      const userMsg: Message = { role: 'user', content: text.trim(), timestamp: Date.now() };
      setMessages((prev) => [...prev, userMsg]);
      setInput('');
      setSending(true);
      setError(null);

      try {
        const resp: CFOCopilotOutput = await copilotQuery(selectedId, {
          query: text.trim(),
          sessionId,
          language: isEs ? 'es' : 'en',
        });
        setSessionId(resp.sessionId);
        const assistantMsg: Message = {
          role: 'assistant',
          content: resp.message,
          toolsCalled: resp.toolsCalled,
          followups: resp.followups,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Query failed');
      } finally {
        setSending(false);
      }
    },
    [selectedId, sessionId, isEs, sending],
  );

  // J2: structured scenario → bilingual natural-language query
  // Composes a deterministic prompt from the slider state so the LLM
  // gets precise inputs (no ambiguity about bp vs %, no paraphrase
  // drift) while the conversational thread stays readable.
  const runScenario = useCallback(
    (p: ScenarioParams) => {
      const sign = p.rateShockBps >= 0 ? '+' : '';
      const msgEn =
        `Run scenario "${p.scenarioType}": rate shock ${sign}${p.rateShockBps}bps, ` +
        `deposit runoff ${p.depositRunoffPct}%, prepayment ×${p.prepaymentMultiplier.toFixed(2)}, ` +
        `credit-loss override ${p.creditLossOverridePct}%. Report NII/EVE impact, LCR/NSFR deltas, and CAMEL pressure.`;
      const msgEs =
        `Ejecutar escenario "${p.scenarioType}": choque de tasa ${sign}${p.rateShockBps}pb, ` +
        `fuga de depósitos ${p.depositRunoffPct}%, prepago ×${p.prepaymentMultiplier.toFixed(2)}, ` +
        `override pérdida crediticia ${p.creditLossOverridePct}%. Reporte impacto NII/EVE, deltas LCR/NSFR, y presión CAMEL.`;
      setScenarioOpen(false);
      void sendMessage(isEs ? msgEs : msgEn);
    },
    [sendMessage, isEs],
  );

  if (!selectedId) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
        {isEs ? 'Seleccione una institución' : 'Select an institution'}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]" role="main" aria-label="CFO Copilot">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3" role="log" aria-live="polite">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
            <Bot className="w-8 h-8" />
            <p className="text-sm font-medium">
              {isEs ? 'CFO Copilot' : 'CFO Copilot'}
            </p>
            <p className="text-[11px] text-center max-w-xs">
              {isEs
                ? 'Pregunte sobre su balance, riesgos, escenarios o preparación de examen.'
                : 'Ask about your balance sheet, risks, scenarios, or exam readiness.'}
            </p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {QUICK_QUESTIONS.map((q, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(isEs ? q.es : q.en)}
                  className="px-2.5 py-1 rounded-full text-[10px] font-medium border border-cyan-200
                    bg-cyan-50 text-cyan-700 hover:bg-cyan-100 transition-colors"
                >
                  {isEs ? q.es : q.en}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : ''}`}>
            {msg.role === 'assistant' && (
              <Bot className="w-5 h-5 text-cyan-600 shrink-0 mt-0.5" />
            )}
            <div
              className={`max-w-[80%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-cyan-600 text-white'
                  : 'bg-white border border-slate-200 text-slate-700'
              }`}
            >
              <p className="whitespace-pre-wrap">{msg.content}</p>
              {msg.toolsCalled && msg.toolsCalled.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5 pt-1.5 border-t border-slate-100">
                  {msg.toolsCalled.map((t) => (
                    <span
                      key={t}
                      className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-slate-100 text-slate-500"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
              {msg.followups && msg.followups.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {msg.followups.map((f, fi) => (
                    <button
                      key={fi}
                      onClick={() => sendMessage(isEs ? f.es : f.en)}
                      className="px-2 py-0.5 rounded-full text-[9px] font-medium border border-cyan-200
                        bg-cyan-50 text-cyan-700 hover:bg-cyan-100 transition-colors"
                    >
                      {isEs ? f.es : f.en}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {msg.role === 'user' && (
              <User className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />
            )}
          </div>
        ))}

        {sending && (
          <div className="flex gap-2">
            <Bot className="w-5 h-5 text-cyan-600 shrink-0 mt-0.5" />
            <div className="bg-white border border-slate-200 rounded-lg px-3 py-2">
              <span className="text-[10px] text-slate-400 animate-pulse">
                {isEs ? 'Analizando...' : 'Analyzing...'}
              </span>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="px-4">
          <ErrorBanner error={error} />
          <button
            onClick={() => setError(null)}
            className="text-xs text-cyan-600 hover:underline mt-1"
          >
            {isEs ? 'Descartar' : 'Dismiss'}
          </button>
        </div>
      )}

      {/* J2: Scenario composer (collapsible) */}
      <div className="border-t border-slate-200 bg-slate-50">
        <button
          type="button"
          onClick={() => setScenarioOpen((o) => !o)}
          className="flex w-full items-center justify-between px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-700"
          aria-expanded={scenarioOpen}
          aria-controls="copilot-scenario-input"
        >
          <span className="flex items-center gap-1.5">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {isEs ? 'Compositor de Escenario' : 'Scenario Composer'}
          </span>
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${scenarioOpen ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </button>
        {scenarioOpen && (
          <div id="copilot-scenario-input" className="border-t border-slate-200 bg-white px-4 py-3">
            <ScenarioInput
              onRun={runScenario}
              locale={isEs ? 'es' : 'en'}
            />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-slate-200 px-4 py-3 bg-white">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendMessage(input);
          }}
          className="flex items-center gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isEs ? 'Pregúntele al CFO Copilot...' : 'Ask CFO Copilot...'}
            disabled={sending}
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm
              placeholder:text-slate-300 focus:outline-none focus:border-cyan-400
              disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="p-2 rounded-lg bg-cyan-600 text-white hover:bg-cyan-700
              disabled:opacity-50 transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
