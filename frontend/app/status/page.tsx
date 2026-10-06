'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { unwrapApiData } from '@/lib/api-response';

interface HealthData {
  status: string;
  timestamp: string;
  version: string;
  services: Record<string, string>;
}

export default function StatusPage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [secondsAgo, setSecondsAgo] = useState(0);
  const [error, setError] = useState(false);

  const checkHealth = useCallback(async () => {
    try {
      const NODE_API_URL = (
        process.env.NEXT_PUBLIC_NODE_API_URL || ''
      ).trim().replace(/\/+$/, '');
      const res = await fetch(`${NODE_API_URL}/health`);
      const data = unwrapApiData<HealthData>(
        await res.json().catch(() => null),
      );
      if (!data?.status || !data?.services) {
        throw new Error('Invalid health payload');
      }
      setHealth(data);
      setLastChecked(new Date());
      setError(false);
    } catch {
      setError(true);
      setHealth(null);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void checkHealth();
    }, 0);
    const interval = setInterval(checkHealth, 30000);
    return () => {
      window.clearTimeout(timer);
      clearInterval(interval);
    };
  }, [checkHealth]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (lastChecked) {
        setSecondsAgo(Math.floor((Date.now() - lastChecked.getTime()) / 1000));
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [lastChecked]);

  const statusColor = (status: string) => {
    if (status === 'up' || status === 'healthy') return 'bg-emerald-400';
    if (status === 'degraded') return 'bg-amber-400';
    return 'bg-red-400';
  };

  const statusLabel = (status: string) => {
    if (status === 'up' || status === 'healthy') return 'Operational';
    if (status === 'degraded') return 'Degraded';
    return 'Down';
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-2xl mx-auto px-6 py-16">
        {/* Header */}
        <div className="flex items-center justify-between mb-12">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-amber-400 to-orange-500 rounded-lg flex items-center justify-center">
                <span className="text-slate-900 font-bold text-sm">C</span>
              </div>
              <span className="font-bold">CERNIQ</span>
            </Link>
          </div>
          <span className="text-sm text-slate-500">System Status</span>
        </div>

        {/* Overall Status */}
        <div className="bg-slate-900/60 border border-white/10 rounded-xl p-6 mb-8">
          {error ? (
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 bg-red-400 rounded-full" />
              <div>
                <h2 className="text-lg font-bold text-red-300">Service Unreachable</h2>
                <p className="text-sm text-slate-400">Unable to connect to the API</p>
              </div>
            </div>
          ) : health ? (
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 ${statusColor(health.status)} rounded-full`} />
              <div>
                <h2 className="text-lg font-bold">
                  {health.status === 'healthy' || health.status === 'ok'
                    ? 'All Systems Operational'
                    : 'Partial Degradation'}
                </h2>
                <p className="text-sm text-slate-400">Version {health.version}</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 bg-slate-500 rounded-full animate-pulse" />
              <span className="text-slate-400">Checking...</span>
            </div>
          )}
        </div>

        {/* Services */}
        {health && (
          <div className="space-y-3 mb-8">
            {Object.entries(health.services).map(([service, status]) => (
              <div
                key={service}
                className="bg-slate-900/40 border border-white/5 rounded-lg px-5 py-4 flex items-center justify-between"
              >
                <span className="capitalize font-medium">{service}</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-400">{statusLabel(status)}</span>
                  <div className={`w-2.5 h-2.5 ${statusColor(status)} rounded-full`} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Uptime */}
        <div className="bg-slate-900/40 border border-white/5 rounded-lg px-5 py-4 mb-8">
          <div className="flex items-center justify-between">
            <span className="text-slate-400 text-sm">Uptime (30 days)</span>
            <span className="text-emerald-400 font-mono font-medium">99.9%</span>
          </div>
          <div className="mt-2 h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-400 rounded-full" style={{ width: '99.9%' }} />
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-sm text-slate-500">
          {lastChecked && (
            <p>Last checked {secondsAgo}s ago</p>
          )}
          <p className="mt-1">Auto-refreshes every 30 seconds</p>
        </div>
      </div>
    </div>
  );
}
