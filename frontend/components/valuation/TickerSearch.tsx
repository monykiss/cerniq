'use client';

import { useState } from 'react';
import { Search, TrendingUp, Loader2 } from 'lucide-react';

interface TickerSearchProps {
    onSearch: (ticker: string) => void;
    isLoading?: boolean;
}

const POPULAR_TICKERS = [
    { symbol: 'LRCX', name: 'Lam Research' },
    { symbol: 'AMAT', name: 'Applied Materials' },
    { symbol: 'KLAC', name: 'KLA Corporation' },
    { symbol: 'ASML', name: 'ASML Holding' },
    { symbol: 'NVDA', name: 'NVIDIA' },
    { symbol: 'TSM', name: 'Taiwan Semiconductor' },
];

export default function TickerSearch({ onSearch, isLoading }: TickerSearchProps) {
    const [ticker, setTicker] = useState('');
    const [showSuggestions, setShowSuggestions] = useState(false);

    const filteredTickers = POPULAR_TICKERS.filter(
        (t) =>
            t.symbol.toLowerCase().includes(ticker.toLowerCase()) ||
            t.name.toLowerCase().includes(ticker.toLowerCase())
    );

    const handleSearch = () => {
        if (ticker.trim()) {
            onSearch(ticker.trim().toUpperCase());
            setShowSuggestions(false);
        }
    };

    const handleSelect = (symbol: string) => {
        setTicker(symbol);
        onSearch(symbol);
        setShowSuggestions(false);
    };

    return (
        <div className="relative">
            <div className="flex gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        value={ticker}
                        onChange={(e) => {
                            setTicker(e.target.value);
                            setShowSuggestions(true);
                        }}
                        onFocus={() => setShowSuggestions(true)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                        placeholder="Enter ticker symbol (e.g., LRCX, AMAT, KLAC)"
                        className="w-full rounded-[1.2rem] border border-slate-200 bg-white py-4 pr-4 pl-12 text-slate-950 placeholder:text-slate-400 transition focus:border-cyan-300 focus:outline-none focus:ring-4 focus:ring-cyan-100"
                        disabled={isLoading}
                    />
                </div>
                <button
                    onClick={handleSearch}
                    disabled={isLoading || !ticker.trim()}
                    className="cerniq-button-primary px-8 py-4 disabled:cursor-not-allowed disabled:opacity-60"
                >
                    {isLoading ? (
                        <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Analyzing...
                        </>
                    ) : (
                        <>
                            <TrendingUp className="w-5 h-5" />
                            Analyze
                        </>
                    )}
                </button>
            </div>

            {/* Suggestions Dropdown */}
            {showSuggestions && ticker && filteredTickers.length > 0 && !isLoading && (
                <div className="absolute z-10 mt-2 w-full overflow-hidden rounded-[1.2rem] border border-slate-200 bg-white/98 shadow-xl shadow-slate-200/70">
                    {filteredTickers.map((t) => (
                        <button
                            key={t.symbol}
                            onClick={() => handleSelect(t.symbol)}
                            className="group flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-cyan-50"
                        >
                            <div>
                                <div className="font-semibold text-slate-950">{t.symbol}</div>
                                <div className="text-sm text-slate-500">{t.name}</div>
                            </div>
                            <TrendingUp className="h-4 w-4 text-slate-400 transition group-hover:text-cyan-700" />
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
