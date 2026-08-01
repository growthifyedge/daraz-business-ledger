'use client';

import { useCallback, useRef, useState } from 'react';

// A tiny in-memory lifecycle for a simulated demo action: idle → pending →
// success. It performs NO network request, calls NO server action, and writes
// nothing anywhere — it only advances a local status after a short delay so the
// demo shows a realistic "working" moment before its polished success state.
// Used by the Record Purchase and Daraz Import demo flows.

export type DemoStatus = 'idle' | 'pending' | 'success';

export function useDemoSimulation(delayMs = 900) {
  const [status, setStatus] = useState<DemoStatus>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(() => {
    // Ignore repeat triggers while a simulation is already in flight.
    setStatus((s) => {
      if (s === 'pending') return s;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setStatus('success'), delayMs);
      return 'pending';
    });
  }, [delayMs]);

  const reset = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setStatus('idle');
  }, []);

  return { status, run, reset };
}
