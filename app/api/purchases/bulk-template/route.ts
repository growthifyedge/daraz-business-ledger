// GET /api/purchases/bulk-template — downloads the Bulk Purchase Upload Excel
// template (same columns as the CSV template). Signed-in users only. Contains
// no business data — just the header row and one example row.
import ExcelJS from 'exceljs';
import { getSession } from '@/lib/auth';
import { BULK_PURCHASE_HEADERS, BULK_PURCHASE_EXAMPLE_ROW } from '@/lib/purchaseBulk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getSession();
  if (!user) return new Response('Sign in required.', { status: 401 });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Purchases');
  ws.addRow([...BULK_PURCHASE_HEADERS]);
  ws.getRow(1).font = { bold: true };
  ws.addRow([...BULK_PURCHASE_EXAMPLE_ROW]);

  const buf = await wb.xlsx.writeBuffer();
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="bulk-purchase-template.xlsx"',
      'Cache-Control': 'no-store',
    },
  });
}
