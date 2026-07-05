'use client';

import { ExportButtons } from '@/components/ExportButtons';

interface PnlRow {
  item: string;
  amount: number;
  [key: string]: unknown;
}

/**
 * Client wrapper around <ExportButtons> for the P&L breakdown.
 * ExportButtons is a client component and expects plain-object rows, so the
 * server page passes the already-flattened statement rows down to here.
 */
export function PnlExport({
  rows,
  title,
  subtitle,
}: {
  rows: PnlRow[];
  title: string;
  subtitle?: string;
}) {
  return (
    <ExportButtons
      title={title}
      subtitle={subtitle}
      filename="profit-loss"
      columns={[
        { key: 'item', label: 'Item' },
        { key: 'amount', label: 'Amount', money: true },
      ]}
      rows={rows}
    />
  );
}
