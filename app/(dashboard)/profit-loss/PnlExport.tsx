'use client';

import { ExportButtons } from '@/components/ExportButtons';

interface PnlRow {
  item: string;
  amount: number | string;
  [key: string]: unknown;
}

/**
 * Client wrapper around <ExportButtons> for the P&L breakdown.
 * ExportButtons is a client component and expects plain-object rows, so the
 * server page passes the already-flattened statement rows down to here.
 *
 * In Presentation Safe View the server passes already-redacted string amounts
 * and `money={false}`, so no exact figure ever reaches this client component.
 */
export function PnlExport({
  rows,
  title,
  subtitle,
  money = true,
}: {
  rows: PnlRow[];
  title: string;
  subtitle?: string;
  money?: boolean;
}) {
  return (
    <ExportButtons
      title={title}
      subtitle={subtitle}
      filename="profit-loss"
      columns={[
        { key: 'item', label: 'Item' },
        { key: 'amount', label: 'Amount', money },
      ]}
      rows={rows}
    />
  );
}
