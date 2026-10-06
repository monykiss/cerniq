'use client';

import { Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Area, ComposedChart } from 'recharts';

interface CycleDataPoint {
    date: string;
    revenue: number;
    isPeak?: boolean;
    isTrough?: boolean;
}

interface CycleChartProps {
    data: CycleDataPoint[];
    midCycleRevenue?: number;
}

function formatRevenue(value: number) {
    if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
    if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M`;
    return `$${value}`;
}

interface CycleTooltipProps {
    active?: boolean;
    payload?: Array<{
        payload: CycleDataPoint;
    }>;
}

function CycleTooltip({ active, payload }: CycleTooltipProps) {
    if (active && payload && payload.length) {
        const point = payload[0].payload;
        return (
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xl">
                <p className="mb-2 font-semibold text-slate-950">{point.date}</p>
                <p className="text-slate-600">
                    Revenue: <span className="font-bold text-slate-950">{formatRevenue(point.revenue)}</span>
                </p>
                {point.isPeak ? <p className="mt-2 text-sm text-emerald-700">● Peak</p> : null}
                {point.isTrough ? <p className="mt-2 text-sm text-rose-700">● Trough</p> : null}
            </div>
        );
    }
    return null;
}

interface CycleDotProps {
    cx?: number;
    cy?: number;
    payload?: CycleDataPoint;
}

export default function CycleChart({ data, midCycleRevenue }: CycleChartProps) {
    return (
        <div className="cerniq-panel p-8">
            <div className="mb-6">
                <h3 className="text-2xl font-bold text-slate-950 mb-2">Revenue Cycle Analysis</h3>
                <p className="text-slate-500">Quarterly revenue with detected peaks and troughs</p>
            </div>

            <div className="h-96">
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                        <defs>
                            <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.26} />
                                <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                            </linearGradient>
                        </defs>

                        <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" opacity={0.7} />

                        <XAxis
                            dataKey="date"
                            stroke="#64748b"
                            tick={{ fill: '#64748b', fontSize: 12 }}
                            angle={-45}
                            textAnchor="end"
                            height={80}
                        />

                        <YAxis
                            stroke="#64748b"
                            tick={{ fill: '#64748b', fontSize: 12 }}
                            tickFormatter={formatRevenue}
                        />

                        <Tooltip content={<CycleTooltip />} />

                        {midCycleRevenue && (
                            <ReferenceLine
                                y={midCycleRevenue}
                                stroke="#f59e0b"
                                strokeDasharray="5 5"
                                strokeWidth={2}
                                label={{
                                    value: `Mid-Cycle: ${formatRevenue(midCycleRevenue)}`,
                                    fill: '#b45309',
                                    fontSize: 12,
                                    position: 'right',
                                }}
                            />
                        )}

                        <Area
                            type="monotone"
                            dataKey="revenue"
                            stroke="none"
                            fill="url(#revenueGradient)"
                        />

                        <Line
                            type="monotone"
                            dataKey="revenue"
                            stroke="#0891b2"
                            strokeWidth={3}
                            dot={(props: CycleDotProps) => {
                                const { cx = 0, cy = 0, payload } = props;
                                if (payload?.isPeak) {
                                    return (
                                        <circle cx={cx} cy={cy} r={6} fill="#059669" stroke="#fff" strokeWidth={2} />
                                    );
                                }
                                if (payload?.isTrough) {
                                    return (
                                        <circle cx={cx} cy={cy} r={6} fill="#e11d48" stroke="#fff" strokeWidth={2} />
                                    );
                                }
                                return <circle cx={cx} cy={cy} r={3} fill="#0891b2" />;
                            }}
                            activeDot={{ r: 8 }}
                        />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>

            <div className="mt-6 flex items-center justify-center gap-6 text-sm">
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-green-500"></div>
                    <span className="text-slate-600">Peak</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-red-500"></div>
                    <span className="text-slate-600">Trough</span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="w-8 h-0.5 bg-yellow-500"></div>
                    <span className="text-slate-600">Mid-Cycle</span>
                </div>
            </div>
        </div>
    );
}
