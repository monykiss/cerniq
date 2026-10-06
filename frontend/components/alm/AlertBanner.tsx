'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, X, ChevronRight, Bell } from 'lucide-react';
import { useALM } from './ALMProvider';

interface Alert {
  id: string;
  type: 'breach' | 'warning' | 'info';
  title: string;
  message: string;
  href: string;
  timestamp: string;
}

export default function AlertBanner() {
  const { selectedId } = useALM();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!selectedId) return;
    (async () => {
      try {
        const NODE = (process.env.NEXT_PUBLIC_NODE_API_URL || '').trim().replace(/\/+$/, '');
        const res = await fetch(`${NODE}/api/alm/${selectedId}/alerts`);
        if (res.ok) {
          const data = await res.json();
          setAlerts(Array.isArray(data) ? data.slice(0, 3) : []);
        }
      } catch {
        // No alerts available — silent fail
      }
    })();
  }, [selectedId]);

  const visible = alerts.filter(a => !dismissed.has(a.id));
  if (visible.length === 0) return null;

  const colors = {
    breach: 'border-rose-300 bg-rose-50 text-rose-800',
    warning: 'border-amber-300 bg-amber-50 text-amber-800',
    info: 'border-cyan-300 bg-cyan-50 text-cyan-800',
  };

  return (
    <div className="space-y-2 mb-4">
      {visible.map(alert => (
        <div key={alert.id} className={`flex items-center gap-3 rounded-xl border px-4 py-2.5 text-xs ${colors[alert.type]}`}>
          {alert.type === 'breach' ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <Bell className="h-4 w-4 shrink-0" />}
          <div className="flex-1 min-w-0">
            <span className="font-bold">{alert.title}</span>
            <span className="ml-1.5 opacity-80">{alert.message}</span>
          </div>
          <Link href={alert.href} className="shrink-0 flex items-center gap-0.5 font-semibold opacity-70 hover:opacity-100">
            View <ChevronRight className="h-3 w-3" />
          </Link>
          <button onClick={() => setDismissed(prev => new Set([...prev, alert.id]))} className="shrink-0 opacity-50 hover:opacity-100">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
