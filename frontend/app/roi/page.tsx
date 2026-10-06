'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Calculator, TrendingUp, Clock, DollarSign } from 'lucide-react';
import { CerniqMark } from '@/components/brand/CerniqLogo';

const CERNIQ_MONTHLY = 299;

export default function ROICalculatorPage() {
  const [hoursPerQuarter, setHoursPerQuarter] = useState(60);
  const [hourlyRate, setHourlyRate] = useState(75);
  const [reportsPerYear, setReportsPerYear] = useState(4);

  const calc = useMemo(() => {
    const currentCostPerReport = hoursPerQuarter * hourlyRate;
    const currentAnnualCost = currentCostPerReport * reportsPerYear;
    const cerniqAnnualCost = CERNIQ_MONTHLY * 12;
    const annualSavings = Math.max(0, currentAnnualCost - cerniqAnnualCost);
    const roiPct = currentAnnualCost > 0
      ? Math.round((annualSavings / cerniqAnnualCost) * 100)
      : 0;
    const savingsPct = currentAnnualCost > 0
      ? Math.round((annualSavings / currentAnnualCost) * 100)
      : 0;
    const hoursRecovered = (hoursPerQuarter - 1) * reportsPerYear; // ~1 hour with CERNIQ
    return {
      currentCostPerReport,
      currentAnnualCost,
      cerniqAnnualCost,
      annualSavings,
      roiPct,
      savingsPct,
      hoursRecovered,
    };
  }, [hoursPerQuarter, hourlyRate, reportsPerYear]);

  const fmt = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  return (
    <div className="min-h-screen overflow-x-clip text-slate-950">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Nav */}
        <div className="mb-6 flex items-center gap-3 rounded-full border border-slate-200/80 bg-white/80 px-4 py-3 backdrop-blur-xl sm:px-6">
          <Link href="/" className="text-slate-500 transition hover:text-slate-950">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <CerniqMark size="sm" />
          <div>
            <div className="font-display text-sm uppercase tracking-[0.4em] text-slate-950">Cerniq</div>
            <div className="text-[10px] uppercase tracking-[0.36em] text-cyan-700/60">ROI Calculator</div>
          </div>
        </div>

        <main className="space-y-6 pb-20">
          {/* Header */}
          <section className="cerniq-shell p-4 sm:p-6 lg:p-8">
            <div className="cerniq-panel p-6 sm:p-8 lg:p-10">
              <div className="cerniq-data-wave opacity-55" />
              <div className="relative z-10 mx-auto max-w-4xl">
                <span className="cerniq-kicker mb-8 w-fit">Calculadora de ahorro / Savings calculator</span>
                <h1 className="font-display text-3xl leading-tight text-slate-950 sm:text-5xl">
                  Calculate your ALM reporting savings with CERNIQ
                </h1>
                <p className="mt-5 max-w-3xl text-base leading-8 text-slate-700">
                  Enter your current reporting effort to see how much time and money CERNIQ saves your institution each year.
                </p>
                <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-500">
                  Ingrese su esfuerzo actual de reportes para ver cuanto tiempo y dinero CERNIQ le ahorra cada ano.
                </p>
              </div>
            </div>
          </section>

          {/* Calculator */}
          <section className="grid gap-6 lg:grid-cols-[1fr_1fr]">
            {/* Inputs */}
            <div className="cerniq-panel p-6 sm:p-8">
              <div className="flex items-center gap-3 mb-6">
                <Calculator className="h-5 w-5 text-cyan-700" />
                <p className="cerniq-section-label">Your current process</p>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="mb-2 block text-xs uppercase tracking-[0.24em] text-slate-500">
                    Analyst hours per quarterly report
                  </label>
                  <input
                    type="range"
                    min={5}
                    max={200}
                    step={5}
                    value={hoursPerQuarter}
                    onChange={(e) => setHoursPerQuarter(Number(e.target.value))}
                    className="w-full accent-cyan-600"
                  />
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-xs text-slate-400">5 hrs</span>
                    <span className="font-display text-2xl text-slate-950">{hoursPerQuarter} hours</span>
                    <span className="text-xs text-slate-400">200 hrs</span>
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-xs uppercase tracking-[0.24em] text-slate-500">
                    Fully-loaded hourly rate ($/hr)
                  </label>
                  <input
                    type="range"
                    min={25}
                    max={200}
                    step={5}
                    value={hourlyRate}
                    onChange={(e) => setHourlyRate(Number(e.target.value))}
                    className="w-full accent-cyan-600"
                  />
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-xs text-slate-400">$25/hr</span>
                    <span className="font-display text-2xl text-slate-950">${hourlyRate}/hr</span>
                    <span className="text-xs text-slate-400">$200/hr</span>
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-xs uppercase tracking-[0.24em] text-slate-500">
                    Reports generated per year
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {[1, 2, 4, 12].map((n) => (
                      <button
                        key={n}
                        onClick={() => setReportsPerYear(n)}
                        className={`rounded-xl border px-4 py-3 text-sm font-semibold transition ${
                          reportsPerYear === n
                            ? 'border-cyan-300 bg-cyan-50 text-cyan-700 shadow-sm'
                            : 'border-slate-200 bg-white/80 text-slate-600 hover:border-cyan-200'
                        }`}
                      >
                        {n}/yr
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50/80 p-5">
                <p className="text-xs font-bold uppercase tracking-[0.24em] text-slate-400 mb-3">Current cost breakdown</p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Cost per report</span>
                    <span className="font-semibold text-slate-950">{fmt(calc.currentCostPerReport)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-600">Reports per year</span>
                    <span className="font-semibold text-slate-950">{reportsPerYear}</span>
                  </div>
                  <div className="border-t border-slate-200 pt-2 flex justify-between">
                    <span className="font-semibold text-slate-700">Annual cost (current)</span>
                    <span className="font-display text-lg text-slate-950">{fmt(calc.currentAnnualCost)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Results */}
            <div className="space-y-6">
              {/* Savings hero */}
              <div className="cerniq-panel p-6 sm:p-8">
                <div className="flex items-center gap-3 mb-6">
                  <TrendingUp className="h-5 w-5 text-cyan-700" />
                  <p className="cerniq-section-label">Your savings with CERNIQ</p>
                </div>

                <div className="text-center mb-6">
                  <p className="text-xs uppercase tracking-[0.24em] text-slate-400 mb-2">Annual savings</p>
                  <p className="font-display text-5xl text-slate-950 sm:text-6xl">{fmt(calc.annualSavings)}</p>
                  {calc.savingsPct > 0 && (
                    <p className="mt-2 inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-700">
                      {calc.savingsPct}% cost reduction
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 text-center">
                    <DollarSign className="h-5 w-5 text-cyan-700 mx-auto mb-2" />
                    <p className="text-xs text-slate-400 mb-1">CERNIQ annual cost</p>
                    <p className="font-display text-xl text-slate-950">{fmt(calc.cerniqAnnualCost)}</p>
                    <p className="text-[10px] text-slate-400 mt-1">${CERNIQ_MONTHLY}/mo platform</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 text-center">
                    <Clock className="h-5 w-5 text-cyan-700 mx-auto mb-2" />
                    <p className="text-xs text-slate-400 mb-1">Hours recovered/year</p>
                    <p className="font-display text-xl text-slate-950">{calc.hoursRecovered}</p>
                    <p className="text-[10px] text-slate-400 mt-1">~1 hr/report with CERNIQ</p>
                  </div>
                </div>

                {calc.roiPct > 0 && (
                  <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50/80 p-5 text-center">
                    <p className="text-xs font-bold uppercase tracking-[0.24em] text-emerald-700">Return on investment</p>
                    <p className="mt-1 font-display text-3xl text-emerald-700">{calc.roiPct}% ROI</p>
                  </div>
                )}
              </div>

              {/* Comparison table */}
              <div className="cerniq-panel p-6 sm:p-8">
                <p className="cerniq-section-label mb-4">Side-by-side comparison</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="py-3 pr-4 text-xs font-semibold uppercase tracking-wider text-slate-500" />
                        <th className="py-3 pr-4 text-xs font-semibold uppercase tracking-wider text-slate-500">Current</th>
                        <th className="py-3 text-xs font-semibold uppercase tracking-wider text-cyan-700">CERNIQ</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-slate-100">
                        <td className="py-3 pr-4 font-medium text-slate-700">Annual cost</td>
                        <td className="py-3 pr-4 text-slate-500">{fmt(calc.currentAnnualCost)}</td>
                        <td className="py-3 font-semibold text-cyan-700">{fmt(calc.cerniqAnnualCost)}</td>
                      </tr>
                      <tr className="border-b border-slate-100">
                        <td className="py-3 pr-4 font-medium text-slate-700">Time per report</td>
                        <td className="py-3 pr-4 text-slate-500">{hoursPerQuarter} hours</td>
                        <td className="py-3 font-semibold text-cyan-700">&lt; 1 hour</td>
                      </tr>
                      <tr className="border-b border-slate-100">
                        <td className="py-3 pr-4 font-medium text-slate-700">Turnaround</td>
                        <td className="py-3 pr-4 text-slate-500">2-3 weeks</td>
                        <td className="py-3 font-semibold text-cyan-700">Same day</td>
                      </tr>
                      <tr className="border-b border-slate-100">
                        <td className="py-3 pr-4 font-medium text-slate-700">Bilingual</td>
                        <td className="py-3 pr-4 text-slate-500">Manual translation</td>
                        <td className="py-3 font-semibold text-cyan-700">Automatic EN/ES</td>
                      </tr>
                      <tr>
                        <td className="py-3 pr-4 font-medium text-slate-700">Error rate</td>
                        <td className="py-3 pr-4 text-slate-500">Variable</td>
                        <td className="py-3 font-semibold text-cyan-700">Validated</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* CTA */}
              <div className="cerniq-panel cerniq-card-hover p-6 sm:p-8 text-center">
                <h3 className="font-display text-2xl text-slate-950">Ready to see it in action?</h3>
                <p className="mt-2 text-sm text-slate-500">
                  Start with a $750 pilot report or try the live demo
                </p>
                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
                  <Link
                    href="/demo"
                    className="cerniq-button-primary"
                  >
                    Try the live demo
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link
                    href="/get-started"
                    className="cerniq-button-secondary"
                  >
                    Start pilot
                  </Link>
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
