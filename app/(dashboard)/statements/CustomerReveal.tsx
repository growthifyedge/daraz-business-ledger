'use client';

import { useState } from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { revealCustomer, type RevealedCustomer } from './actions';

/**
 * Masked-by-default customer cell. Clicking "Reveal" calls the server action,
 * which decrypts server-side and writes an audit entry (without storing the
 * revealed value). The plaintext exists only transiently in this component.
 */
export function CustomerReveal({ orderItemId }: { orderItemId: string }) {
  const [data, setData] = useState<RevealedCustomer | null>(null);
  const [loading, setLoading] = useState(false);

  if (data?.ok) {
    return (
      <div className="space-y-0.5 text-xs">
        <button
          onClick={() => setData(null)}
          className="mb-1 inline-flex items-center gap-1 text-slate-400 hover:text-slate-600"
        >
          <EyeOff className="h-3 w-3" /> Hide
        </button>
        {row('Name', data.customerName)}
        {row('Phone', data.phone)}
        {row('Email', data.customerEmail)}
        {row('NIC', data.nationalRegistrationNumber)}
        {row('Ship to', data.shippingName)}
        {row('Address', joinAddr(data.shippingAddress, data.shippingCity))}
        {row('Tracking', data.trackingCode)}
      </div>
    );
  }

  return (
    <div className="text-xs">
      <span className="text-slate-400">•••• hidden</span>
      <button
        onClick={async () => {
          setLoading(true);
          try {
            setData(await revealCustomer(orderItemId));
          } finally {
            setLoading(false);
          }
        }}
        disabled={loading}
        className="ml-2 inline-flex items-center gap-1 text-brand-600 hover:text-brand-700 disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />} Reveal
      </button>
      {data && !data.ok && <p className="mt-1 text-rose-600">{data.error}</p>}
    </div>
  );
}

function row(label: string, value: string | null | undefined) {
  if (!value) return null;
  return (
    <div className="flex gap-1">
      <span className="text-slate-400">{label}:</span>
      <span className="text-slate-700">{value}</span>
    </div>
  );
}
function joinAddr(a?: string | null, b?: string | null) {
  return [a, b].filter(Boolean).join(', ') || null;
}
