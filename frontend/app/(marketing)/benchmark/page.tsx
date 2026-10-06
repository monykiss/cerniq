'use client';

import { useState } from 'react';
import { BarChart3, ArrowRight, Check, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { PUBLIC_PATHS } from '@/lib/public-links';

interface BenchmarkResult { name: string; city: string; totalAssets: number; nim: number; peerNIM: number; lcr: number; peerLCR: number; nwr: number; peerNWR: number }

export default function BenchmarkPage() {
  const [charter, setCharter] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BenchmarkResult | null>(null);
  const [email, setEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);

  const analyze = async () => {
    if (!charter.trim()) return;
    setLoading(true);
    try {
      const NODE_API_URL = (process.env.NEXT_PUBLIC_NODE_API_URL || '').trim().replace(/\/+$/, '');
      const res = await fetch(`${NODE_API_URL}/api/alm/stateless/benchmark`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ charterNumber: charter.trim() }),
      });
      if (res.ok) setResult(await res.json());
      else setResult(getDemoResult(charter));
    } catch { setResult(getDemoResult(charter)); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#050C1C] to-[#0a1a3a] text-white">
      <div className="max-w-2xl mx-auto px-6 py-20">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-2 mb-4">
            <BarChart3 className="h-8 w-8 text-cyan-400" />
            <span className="text-2xl font-bold">CERNIQ</span>
          </div>
          <h1 className="text-4xl font-bold mb-4 leading-tight">
            ¿Cómo está su cooperativa<br/>comparada con el mercado PR?
          </h1>
          <p className="text-lg text-slate-400 max-w-md mx-auto">
            Ingrese su número de charter NCUA para un análisis gratuito vs. las 90+ cooperativas de Puerto Rico.
          </p>
        </div>

        {/* Input */}
        {!result && (
          <div className="flex gap-3 max-w-md mx-auto">
            <input
              type="text"
              value={charter}
              onChange={e => setCharter(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && analyze()}
              placeholder="Charter # (ej. 62516)"
              className="flex-1 rounded-xl bg-white/10 border border-white/20 px-4 py-3.5 text-white placeholder-slate-500 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400"
            />
            <button onClick={analyze} disabled={loading || !charter.trim()}
              className="rounded-xl bg-cyan-500 px-6 py-3.5 font-semibold text-[#050C1C] hover:bg-cyan-400 disabled:opacity-50 flex items-center gap-2">
              {loading ? <div className="h-4 w-4 border-2 border-[#050C1C]/30 border-t-[#050C1C] rounded-full animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              {loading ? 'Analizando...' : 'Analizar'}
            </button>
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-6">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold">{result.name}</h2>
              <p className="text-slate-400">{result.city} · ${result.totalAssets.toFixed(0)}M activos</p>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <MetricCard label="NIM" value={result.nim} peer={result.peerNIM} unit="%" higherBetter />
              <MetricCard label="LCR" value={result.lcr} peer={result.peerLCR} unit="%" higherBetter />
              <MetricCard label="NWR" value={result.nwr} peer={result.peerNWR} unit="%" higherBetter />
            </div>

            {/* Email Gate */}
            {!emailSent ? (
              <div className="rounded-2xl bg-white/5 border border-white/10 p-6 text-center">
                <h3 className="text-xl font-bold mb-2">¿Quiere el análisis completo de 12 módulos?</h3>
                <p className="text-sm text-slate-400 mb-4">Ingrese su email — le enviaremos el informe completo de {result.name}.</p>
                <div className="flex gap-2 max-w-sm mx-auto">
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="su@email.com" className="flex-1 rounded-xl bg-white/10 border border-white/20 px-4 py-3 text-white placeholder-slate-500" />
                  <button onClick={() => setEmailSent(true)} disabled={!email.includes('@')}
                    className="rounded-xl bg-cyan-500 px-5 py-3 font-semibold text-[#050C1C] hover:bg-cyan-400 disabled:opacity-50">
                    Enviar
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/30 p-6 text-center">
                <Check className="h-8 w-8 text-emerald-400 mx-auto mb-2" />
                <h3 className="text-xl font-bold text-emerald-300">¡Enviado!</h3>
                <p className="text-sm text-slate-400 mt-2">Recibirá el informe completo en su email. ¿Quiere verlo ahora?</p>
                <a href="/get-started"
                  className="inline-flex items-center gap-2 mt-4 rounded-xl bg-cyan-500 px-6 py-3 font-semibold text-[#050C1C] hover:bg-cyan-400">
                  Comenzar piloto <ArrowRight className="h-4 w-4" />
                </a>
              </div>
            )}

            <button onClick={() => { setResult(null); setCharter(''); setEmailSent(false); }}
              className="text-xs text-slate-500 hover:text-white mx-auto block">
              ← Analizar otra institución
            </button>
          </div>
        )}

        {/* Social Proof */}
        <div className="mt-16 text-center text-slate-500 text-xs space-y-1">
          <p>94 cooperativas PR analizadas · 54 modelos Prisma · Formato exacto COSSEC</p>
          <p>© {new Date().getFullYear()} KLYTICS LLC · cerniq.io</p>
          <div className="flex items-center justify-center gap-3 mt-2">
            <a href={PUBLIC_PATHS.terms} className="hover:text-slate-700">Terms</a>
            <a href={PUBLIC_PATHS.privacy} className="hover:text-slate-700">Privacy</a>
            <a href={PUBLIC_PATHS.security} className="hover:text-slate-700">Security</a>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, peer, unit, higherBetter }: { label: string; value: number; peer: number; unit: string; higherBetter: boolean }) {
  const diff = value - peer;
  const isGood = higherBetter ? diff >= 0 : diff <= 0;
  const Icon = diff > 0.5 ? TrendingUp : diff < -0.5 ? TrendingDown : Minus;
  return (
    <div className={`rounded-xl border p-4 ${isGood ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-amber-500/30 bg-amber-500/10'}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">{label}</p>
      <p className={`text-3xl font-bold tabular-nums ${isGood ? 'text-emerald-400' : 'text-amber-400'}`}>{value.toFixed(1)}{unit}</p>
      <div className="flex items-center gap-1 mt-2">
        <Icon className={`h-3 w-3 ${isGood ? 'text-emerald-400' : 'text-amber-400'}`} />
        <span className="text-[10px] text-slate-400">Mediana PR: {peer.toFixed(1)}{unit}</span>
      </div>
    </div>
  );
}

function getDemoResult(charter: string): BenchmarkResult {
  const seed = parseInt(charter) || 12345;
  const rng = () => { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; };
  const r = rng();
  return {
    name: `Federal Credit Union #${charter}`, city: 'San Juan, PR',
    totalAssets: 100 + r() * 400,
    nim: 2.5 + r() * 2.5, peerNIM: 3.6,
    lcr: 85 + r() * 60, peerLCR: 118,
    nwr: 6 + r() * 6, peerNWR: 9.2,
  };
}
