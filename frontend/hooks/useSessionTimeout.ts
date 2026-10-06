import { useEffect, useRef, useCallback } from 'react';

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const WARNING_BEFORE_MS = 5 * 60 * 1000; // warn 5 min before

interface SessionTimeoutOptions {
  timeoutMs?: number;
  warningMs?: number;
  onTimeout: () => void;
  onWarning?: () => void;
  enabled?: boolean;
}

/**
 * Enterprise session timeout hook.
 * Tracks user activity (mouse, keyboard, touch, scroll).
 * Shows warning before timeout, then calls onTimeout.
 * Required for COSSEC compliance — financial data must not remain
 * accessible on unattended workstations.
 */
export function useSessionTimeout({
  timeoutMs = DEFAULT_TIMEOUT_MS,
  warningMs = WARNING_BEFORE_MS,
  onTimeout,
  onWarning,
  enabled = true,
}: SessionTimeoutOptions) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = useRef(0);

  const resetTimers = useCallback(() => {
    lastActivityRef.current = Date.now();

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (warningRef.current) clearTimeout(warningRef.current);

    if (!enabled) return;

    // Set warning timer
    if (onWarning && warningMs < timeoutMs) {
      warningRef.current = setTimeout(() => {
        onWarning();
      }, timeoutMs - warningMs);
    }

    // Set timeout timer
    timeoutRef.current = setTimeout(() => {
      onTimeout();
    }, timeoutMs);
  }, [timeoutMs, warningMs, onTimeout, onWarning, enabled]);

  useEffect(() => {
    if (!enabled) return;

    const events = ['mousedown', 'keydown', 'touchstart', 'scroll', 'mousemove'];

    // Throttle activity detection to avoid performance impact
    let throttled = false;
    const handleActivity = () => {
      if (throttled) return;
      throttled = true;
      setTimeout(() => { throttled = false; }, 5000); // 5s throttle
      resetTimers();
    };

    events.forEach(event => window.addEventListener(event, handleActivity, { passive: true }));
    resetTimers(); // Start initial timer

    return () => {
      events.forEach(event => window.removeEventListener(event, handleActivity));
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (warningRef.current) clearTimeout(warningRef.current);
    };
  }, [enabled, resetTimers]);

  return {
    resetTimers,
    lastActivity: lastActivityRef,
  };
}
