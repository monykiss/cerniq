'use client';

import { TrendingUp, TrendingDown, Minus, Target, PieChart } from 'lucide-react';

interface ValuationCardProps {
    ticker: string;
    fairValueLow: number;
    fairValueHigh: number;
    currentPrice: number;
    upsideDownside: number;
    cyclePosition: string;
}

export default function ValuationCard({
    ticker,
    fairValueLow,
    fairValueHigh,
    currentPrice,
    upsideDownside,
    cyclePosition,
}: ValuationCardProps) {
    // Determine valuation status
    const isUndervalued = upsideDownside > 10;
    const isOvervalued = upsideDownside < -10;

    const statusColor = isUndervalued
        ? 'bg-emerald-600 text-white'
        : isOvervalued
            ? 'bg-rose-600 text-white'
            : 'bg-amber-500 text-slate-950';

    const statusBg = isUndervalued
        ? 'cerniq-chip cerniq-chip-positive'
        : isOvervalued
            ? 'cerniq-chip cerniq-chip-negative'
            : 'cerniq-chip cerniq-chip-warning';

    const statusText = isUndervalued
        ? 'Undervalued'
        : isOvervalued
            ? 'Overvalued'
            : 'Fairly Valued';

    const StatusIcon = isUndervalued ? TrendingUp : isOvervalued ? TrendingDown : Minus;

    // Calculate gauge position (0-100%)
    const minRange = Math.min(fairValueLow * 0.7, currentPrice * 0.7);
    const maxRange = Math.max(fairValueHigh * 1.3, currentPrice * 1.3);
    const gaugePosition = ((currentPrice - minRange) / (maxRange - minRange)) * 100;
    const fairLowPos = ((fairValueLow - minRange) / (maxRange - minRange)) * 100;
    const fairHighPos = ((fairValueHigh - minRange) / (maxRange - minRange)) * 100;

    return (
        <div className="cerniq-panel p-8">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h3 className="text-2xl font-bold text-slate-950 mb-1">{ticker} Valuation</h3>
                    <p className="text-slate-500 text-sm">Cyclical Analysis</p>
                </div>
                <div className={`${statusBg}`}>
                    <StatusIcon className="w-5 h-5" />
                    <span className="font-semibold">{statusText}</span>
                </div>
            </div>

            {/* Fair Value Range */}
            <div className="mb-8">
                <div className="flex items-baseline justify-between mb-3">
                    <span className="text-slate-500">Fair Value Range</span>
                    <span className="text-3xl font-bold text-slate-950">
                        ${fairValueLow.toFixed(2)} - ${fairValueHigh.toFixed(2)}
                    </span>
                </div>

                {/* Visual Gauge */}
                <div className="relative h-3 bg-slate-100 rounded-full overflow-hidden">
                    {/* Fair value range bar */}
                    <div
                        className="absolute h-full bg-gradient-to-r from-cyan-300 to-blue-500"
                        style={{
                            left: `${fairLowPos}%`,
                            width: `${fairHighPos - fairLowPos}%`,
                        }}
                    />
                    {/* Current price indicator */}
                    <div
                        className="absolute top-1/2 transform -translate-y-1/2 w-1 h-6 bg-slate-950 shadow-lg"
                        style={{ left: `${gaugePosition}%` }}
                    />
                </div>

                <div className="flex justify-between mt-2 text-xs text-slate-500">
                    <span>${minRange.toFixed(0)}</span>
                    <span>${maxRange.toFixed(0)}</span>
                </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="rounded-xl border border-slate-200 bg-white/86 p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <Target className="w-4 h-4 text-cyan-700" />
                        <span className="text-slate-500 text-sm">Current Price</span>
                    </div>
                    <div className="text-2xl font-bold text-slate-950">${currentPrice.toFixed(2)}</div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white/86 p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <div className={`rounded-full px-2 py-1 text-xs font-semibold ${statusColor}`}>
                            <StatusIcon className="h-4 w-4" />
                        </div>
                        <span className="text-slate-500 text-sm">Upside/Downside</span>
                    </div>
                    <div className="text-2xl font-bold text-slate-950">
                        {upsideDownside > 0 ? '+' : ''}{upsideDownside.toFixed(1)}%
                    </div>
                </div>
            </div>

            {/* Cycle Position */}
            <div className="rounded-xl border border-cyan-200 bg-cyan-50/80 p-4">
                <div className="flex items-center gap-2 mb-2">
                    <PieChart className="w-4 h-4 text-cyan-700" />
                    <span className="text-slate-500 text-sm">Cycle Position</span>
                </div>
                <div className="text-lg font-semibold text-slate-950">{cyclePosition}</div>
            </div>
        </div>
    );
}
