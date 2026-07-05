'use client';

import { FileDown, FileText } from 'lucide-react';
import { Button } from './Button';
import { CURRENCY } from '@/lib/config';

export interface ExportColumn {
  key: string;
  label: string;
  money?: boolean;
}

/**
 * Client-side export of a dataset to CSV (opens in Excel) or PDF.
 * PDF uses jsPDF + autotable, loaded dynamically so it never blocks first paint.
 */
export function ExportButtons({
  columns,
  rows,
  filename,
  title,
  subtitle,
}: {
  columns: ExportColumn[];
  rows: Record<string, unknown>[];
  filename: string;
  title: string;
  subtitle?: string;
}) {
  function exportCSV() {
    const header = columns.map((c) => escapeCSV(c.label)).join(',');
    const body = rows
      .map((r) =>
        columns.map((c) => escapeCSV(String(r[c.key] ?? ''))).join(',')
      )
      .join('\n');
    const csv = `${header}\n${body}`;
    const blob = new Blob(['﻿' + csv], {
      type: 'text/csv;charset=utf-8;',
    });
    downloadBlob(blob, `${filename}.csv`);
  }

  async function exportPDF() {
    const { jsPDF } = await import('jspdf');
    const autoTable = (await import('jspdf-autotable')).default;
    const doc = new jsPDF({ orientation: 'landscape' });

    doc.setFontSize(15);
    doc.text(title, 14, 16);
    if (subtitle) {
      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text(subtitle, 14, 22);
    }

    autoTable(doc, {
      startY: subtitle ? 26 : 20,
      head: [columns.map((c) => c.label)],
      body: rows.map((r) =>
        columns.map((c) => {
          const v = r[c.key];
          if (c.money) return `${CURRENCY.symbol} ${Number(v ?? 0).toLocaleString()}`;
          return String(v ?? '');
        })
      ),
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [37, 99, 235] },
      alternateRowStyles: { fillColor: [246, 248, 251] },
    });

    doc.save(`${filename}.pdf`);
  }

  const disabled = rows.length === 0;

  return (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" onClick={exportCSV} disabled={disabled}>
        <FileDown className="h-4 w-4" /> CSV
      </Button>
      <Button variant="outline" size="sm" onClick={exportPDF} disabled={disabled}>
        <FileText className="h-4 w-4" /> PDF
      </Button>
    </div>
  );
}

function escapeCSV(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
