'use client';

import Link from 'next/link';
import { ArrowLeft, Zap, Shield, Brain, Cpu, Layers, TrendingUp, Globe, DollarSign } from 'lucide-react';
import { CerniqMark } from '@/components/brand/CerniqLogo';

const RELEASES = [
  {
    version: '2.4',
    date: 'March 22, 2026',
    tag: 'Latest',
    tagColor: 'bg-emerald-100 text-emerald-700',
    items: [
      { icon: Cpu, text: '13 Quant Frontier pages — Black-Litterman, CVaR, HRP, CreditMetrics, KMV-Merton, PCA, FRTB-IMA, Fed Futures, Copula Credit, Wrong-Way Risk, IR Cap/Floor, RBC2, Macro Factors' },
      { icon: Shield, text: 'Compliance Coverage Matrix — 20 requirements × COSSEC/NCUA/Basel III' },
      { icon: TrendingUp, text: 'Behavioral Duration (Hutchison-Pennacchi NMD) — corrects EVE overestimation' },
      { icon: Globe, text: 'Demo data refreshed with a fictional Puerto Rico bank profile' },
      { icon: Layers, text: 'ALM Module Index — browsable grid of ALM modules across 9 domains' },
      { icon: DollarSign, text: 'Competitive comparison table vs Moody\'s Analytics and QRM/Empyrean on pricing page' },
    ],
  },
  {
    version: '2.3',
    date: 'March 21, 2026',
    items: [
      { icon: Cpu, text: 'V9 Quant Frontier — 14 advanced backend services (Black-Litterman, CVaR, HRP, CreditMetrics, KMV-Merton, PCA, FRTB-ES, Fed Futures, Copula, WWR, Cap/Floor, RBC2)' },
      { icon: Shield, text: 'V10 Reliability — circuit breaker, graceful degradation, auto-narrative engine, DAG pipeline orchestrator' },
      { icon: Brain, text: 'Climate Risk (hurricane AAL), NIM Attribution (7-factor), HMM Regime Detection (Viterbi 4-state)' },
      { icon: Zap, text: 'Enterprise dashboard redesign — dense 3-panel command center with 8 KPIs' },
    ],
  },
  {
    version: '2.2',
    date: 'March 20, 2026',
    items: [
      { icon: Cpu, text: 'Phase I-V Quant Powerhouse — Nelson-Siegel, Vasicek MC, BDT OAS, CECL 3-method, FTP attribution, Monte Carlo VaR' },
      { icon: Shield, text: 'Phase VI COSSEC Exam Suite — CAMEL auto-scorer, 12 schedules, board report generator' },
      { icon: Brain, text: 'AI Chat Analyst — Claude-powered conversational ALM with institution data injection' },
      { icon: TrendingUp, text: 'Phase IV — AI Advisor v2, Stress Pack, IRR Policy, Repricing Gap, Peer Analytics, Forward Sim' },
    ],
  },
  {
    version: '2.1',
    date: 'March 15, 2026',
    items: [
      { icon: Globe, text: 'English-primary pivot with EN/ES language toggle on all pages' },
      { icon: Shield, text: 'NCUA CAMEL framework adapter, Public API v1 with Swagger documentation' },
      { icon: DollarSign, text: 'SpendCheck AP Report PDF — 6-page bilingual expense analysis' },
      { icon: Zap, text: 'Interactive demo /demo — 6-step guided tour, zero API calls required' },
    ],
  },
  {
    version: '2.0',
    date: 'March 11, 2026',
    items: [
      { icon: Shield, text: 'Enterprise hardening across security, RBAC, audit, billing and ops' },
      { icon: DollarSign, text: 'Stripe checkout with 4 tiers, 7 webhook event handlers, magic link auth' },
      { icon: Brain, text: 'AI Risk Advisor (Claude-powered), Custom Scenario Builder, Regulatory Calendar' },
      { icon: TrendingUp, text: 'COSSEC 12-ratio engine, PR cooperativa sector benchmarks, 14-page PDF reports' },
    ],
  },
  {
    version: '1.0',
    date: 'February 2026',
    items: [
      { icon: Layers, text: 'Initial platform launch — dashboard, portfolios, ALM sensitivity, liquidity, stress testing' },
      { icon: Shield, text: 'Authentication (GitHub + Google OAuth), API key management, CORS security' },
      { icon: DollarSign, text: 'Pricing page and onboarding flow' },
    ],
  },
];

export default function ChangelogPage() {
  return (
    <div className="min-h-screen bg-white">
      <nav className="border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-slate-400 hover:text-slate-700"><ArrowLeft className="h-5 w-5" /></Link>
          <CerniqMark size="sm" />
          <div>
            <div className="font-display text-sm uppercase tracking-[0.4em] text-slate-950">CERNIQ</div>
            <div className="text-[10px] uppercase tracking-[0.36em] text-cyan-700/60">Changelog</div>
          </div>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-6 py-12 space-y-10">
        <div>
          <h1 className="text-3xl font-bold text-slate-950">What&apos;s New</h1>
          <p className="mt-2 text-slate-600">Platform updates, new modules, and quant model releases.</p>
          <div className="mt-4 flex items-center gap-3 text-sm">
            <span className="font-bold text-slate-950 tabular-nums">v{RELEASES[0].version}</span>
            <span className="text-slate-400">|</span>
            <span className="text-slate-500">69 commits</span>
            <span className="text-slate-400">|</span>
            <span className="text-slate-500">126 pages</span>
            <span className="text-slate-400">|</span>
            <span className="text-slate-500">142 endpoints</span>
          </div>
        </div>

        {RELEASES.map((release) => (
          <section key={release.version} className="relative">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-xl font-bold text-slate-950 tabular-nums">v{release.version}</span>
              {release.tag && (
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${release.tagColor}`}>{release.tag}</span>
              )}
              <span className="text-xs text-slate-400">{release.date}</span>
            </div>
            <div className="space-y-2 pl-2 border-l-2 border-slate-100">
              {release.items.map((item, i) => (
                <div key={i} className="flex items-start gap-3 pl-4 py-1">
                  <item.icon className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
                  <p className="text-sm text-slate-700 leading-relaxed">{item.text}</p>
                </div>
              ))}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
