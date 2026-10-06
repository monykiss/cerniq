'use client';

import { Activity, DollarSign, TrendingUp, BarChart3 } from 'lucide-react';

interface MetricsGridProps {
    cyclesDetected: number;
    midCycleRevenue: number;
    midCycleEps: number;
    midCycleMargin: number;
    midCyclePe: number;
    fairValueBase: number;
}

export default function MetricsGrid({
    cyclesDetected,
    midCycleRevenue,
    midCycleEps,
    midCycleMargin,
    midCyclePe,
    fairValueBase,
}: MetricsGridProps) {
    const formatLargeNumber = (num: number) => {
        if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
        if (num >= 1e6) return `$${(num / 1e6).toFixed(0)}M`;
        return `$${num.toFixed(2)}`;
    };

    const metrics = [
        {
            label: 'Cycles Detected',
            value: cyclesDetected.toString(),
            icon: Activity,
            color: 'bg-cyan-600 text-white',
            bgColor: 'bg-cyan-50 border-cyan-100',
        },
        {
            label: 'Mid-Cycle Revenue',
            value: formatLargeNumber(midCycleRevenue),
            icon: DollarSign,
            color: 'bg-emerald-600 text-white',
            bgColor: 'bg-emerald-50 border-emerald-100',
        },
        {
            label: 'Mid-Cycle EPS',
            value: `$${midCycleEps.toFixed(2)}`,
            icon: TrendingUp,
            color: 'bg-blue-600 text-white',
            bgColor: 'bg-sky-50 border-sky-100',
        },
        {
            label: 'Mid-Cycle Margin',
            value: `${midCycleMargin.toFixed(1)}%`,
            icon: BarChart3,
            color: 'bg-amber-500 text-slate-950',
            bgColor: 'bg-amber-50 border-amber-100',
        },
        {
            label: 'Applied P/E Multiple',
            value: `${midCyclePe.toFixed(1)}x`,
            icon: Activity,
            color: 'bg-slate-900 text-white',
            bgColor: 'bg-slate-50 border-slate-200',
        },
        {
            label: 'Fair Value (Base)',
            value: `$${fairValueBase.toFixed(2)}`,
            icon: DollarSign,
            color: 'bg-cyan-500 text-slate-950',
            bgColor: 'bg-cyan-50 border-cyan-100',
        },
    ];

    return (
        <div className="cerniq-panel p-8">
            <h3 className="text-2xl font-bold text-slate-950 mb-6">Valuation Metrics</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {metrics.map((metric, index) => {
                    const Icon = metric.icon;
                    return (
                        <div
                            key={index}
                            className={`${metric.bgColor} rounded-xl p-5 border transition group`}
                        >
                            <div className="flex items-center gap-3 mb-3">
                                <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${metric.color}`}>
                                    <Icon className="w-5 h-5" />
                                </div>
                                <span className="text-slate-500 text-sm font-medium">{metric.label}</span>
                            </div>
                            <div className="text-3xl font-bold text-slate-950 transition group-hover:scale-105">
                                {metric.value}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="mt-6 rounded-xl border border-cyan-200 bg-cyan-50/80 p-4">
                <p className="text-sm text-slate-700">
                    <span className="font-semibold text-cyan-700">Methodology:</span> Fair value is calculated using mid-cycle normalized earnings with regime-specific P/E multiples. The range represents a ±15% confidence interval.
                </p>
            </div>
        </div>
    );
}
