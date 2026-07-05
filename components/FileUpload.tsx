'use client';

import { useState } from 'react';
import { Upload, FileText, X, Loader2, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * File upload field for invoices / receipts.
 * Stores the resulting public URL in a hidden input named `name`, so it is
 * submitted with the surrounding <form> and its server action.
 */
export function FileUpload({
  name,
  defaultUrl,
  label = 'Invoice / Receipt',
}: {
  name: string;
  defaultUrl?: string | null;
  label?: string;
}) {
  const [url, setUrl] = useState<string | null>(defaultUrl ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setUrl(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-slate-600">{label}</label>
      <input type="hidden" name={name} value={url ?? ''} />

      {url ? (
        <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-sm text-brand-600 hover:underline"
          >
            <FileText className="h-4 w-4" />
            View uploaded file
            <ExternalLink className="h-3 w-3" />
          </a>
          <button
            type="button"
            onClick={() => setUrl(null)}
            className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <label
          className={cn(
            'flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-3 text-sm text-slate-500 transition hover:border-brand-400 hover:text-brand-600',
            loading && 'pointer-events-none opacity-70'
          )}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Upload className="h-4 w-4" />
          )}
          {loading ? 'Uploading…' : 'Upload image or PDF'}
          <input
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
        </label>
      )}
      {error && <p className="text-xs text-rose-500">{error}</p>}
    </div>
  );
}
