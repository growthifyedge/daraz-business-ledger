'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { Button } from '@/components/Button';

// Route-level error boundary for the dashboard segment.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[dashboard] route error', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-100 text-rose-600">
        <AlertTriangle className="h-7 w-7" />
      </div>
      <h1 className="text-lg font-semibold text-slate-900">Something went wrong</h1>
      <p className="mt-1 max-w-md text-sm text-slate-500">
        This page couldn&apos;t be loaded. Your data is safe — you can retry, and if
        it keeps happening, note what you were doing.
      </p>
      {error.digest && (
        <p className="mt-2 font-mono text-xs text-slate-400">Ref: {error.digest}</p>
      )}
      <div className="mt-5">
        <Button onClick={reset}>
          <RotateCw className="h-4 w-4" /> Try again
        </Button>
      </div>
    </div>
  );
}
