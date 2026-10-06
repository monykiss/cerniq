'use client';

import React from 'react';

export interface ChatMessageProps {
  /** 'user' or 'assistant' */
  role: 'user' | 'assistant';
  /** Message content (supports basic markdown-like formatting) */
  content: string;
  /** ISO timestamp */
  timestamp: string;
  /** Language of the message */
  lang?: 'es' | 'en' | 'both';
  /** ALM module slugs referenced in the message */
  moduleRefs?: string[];
  /** Whether this message is currently streaming */
  streaming?: boolean;
}

const MODULE_COLORS: Record<string, string> = {
  liquidity: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'credit-risk': 'bg-rose-50 text-rose-700 border-rose-200',
  'stress-test': 'bg-amber-50 text-amber-700 border-amber-200',
  capital: 'bg-blue-50 text-blue-700 border-blue-200',
  compliance: 'bg-violet-50 text-violet-700 border-violet-200',
};

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

/** Renders basic markdown-style formatting: **bold**, `code`, and line breaks */
function renderContent(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    // Process inline formatting
    const parts: React.ReactNode[] = [];
    let remaining = line;
    let key = 0;

    while (remaining.length > 0) {
      // Bold: **text**
      const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
      // Code: `text`
      const codeMatch = remaining.match(/`(.+?)`/);

      let firstMatch: { type: 'bold' | 'code'; index: number; full: string; inner: string } | null = null;

      if (boldMatch && boldMatch.index !== undefined) {
        firstMatch = { type: 'bold', index: boldMatch.index, full: boldMatch[0], inner: boldMatch[1] };
      }
      if (codeMatch && codeMatch.index !== undefined) {
        if (!firstMatch || codeMatch.index < firstMatch.index) {
          firstMatch = { type: 'code', index: codeMatch.index, full: codeMatch[0], inner: codeMatch[1] };
        }
      }

      if (!firstMatch) {
        parts.push(<span key={key++}>{remaining}</span>);
        break;
      }

      // Text before the match
      if (firstMatch.index > 0) {
        parts.push(<span key={key++}>{remaining.slice(0, firstMatch.index)}</span>);
      }

      if (firstMatch.type === 'bold') {
        parts.push(<strong key={key++} className="font-semibold">{firstMatch.inner}</strong>);
      } else {
        parts.push(
          <code key={key++} className="rounded bg-slate-100 px-1.5 py-0.5 text-[0.85em] font-mono text-slate-700">
            {firstMatch.inner}
          </code>
        );
      }

      remaining = remaining.slice(firstMatch.index + firstMatch.full.length);
    }

    return (
      <React.Fragment key={i}>
        {parts}
        {i < lines.length - 1 && <br />}
      </React.Fragment>
    );
  });
}

/**
 * Reusable chat message bubble with markdown rendering, avatar, timestamp,
 * and language indicator. Used by the AI Advisor Chat interface.
 */
export function ChatMessage({ role, content, timestamp, lang, moduleRefs, streaming }: ChatMessageProps) {
  const isUser = role === 'user';

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {/* Avatar */}
      <div
        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          isUser
            ? 'bg-[#1e3a5f] text-white'
            : 'bg-gradient-to-br from-cyan-500 to-blue-600 text-white'
        }`}
        aria-hidden="true"
      >
        {isUser ? 'U' : 'AI'}
      </div>

      {/* Bubble */}
      <div className={`max-w-[75%] space-y-1.5 ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
            isUser
              ? 'rounded-br-md bg-[#1e3a5f] text-white'
              : 'rounded-bl-md border border-slate-200 bg-white text-slate-800'
          }`}
        >
          {streaming ? (
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
            </span>
          ) : (
            renderContent(content)
          )}
        </div>

        {/* Module reference badges */}
        {moduleRefs && moduleRefs.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1">
            {moduleRefs.map((slug) => (
              <a
                key={slug}
                href={`/alm/${slug}`}
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium transition hover:opacity-80 ${
                  MODULE_COLORS[slug] || 'bg-slate-50 text-slate-600 border-slate-200'
                }`}
              >
                {slug.replace(/-/g, ' ')}
              </a>
            ))}
          </div>
        )}

        {/* Timestamp + language indicator */}
        <div className={`flex items-center gap-2 px-1 ${isUser ? 'justify-end' : 'justify-start'}`}>
          <span className="text-[10px] text-slate-400">{formatTime(timestamp)}</span>
          {lang && (
            <span className="rounded bg-slate-100 px-1.5 py-px text-[9px] font-medium uppercase tracking-wider text-slate-500">
              {lang}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
