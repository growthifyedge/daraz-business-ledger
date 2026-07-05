import { requireOwner } from '@/lib/auth';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui';
import { Download, ShieldCheck, Info } from 'lucide-react';

export const metadata = { title: 'Backup & Export' };
export const dynamic = 'force-dynamic';

export default async function BackupPage() {
  // Owner-only (middleware also guards owner areas; this is defence in depth).
  await requireOwner();

  return (
    <div>
      <PageHeader
        title="Backup & Export"
        description="Download a full copy of all your business data."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Full data backup"
            subtitle="Every record, in a single JSON file"
          />
          <CardBody className="space-y-4">
            <p className="text-sm text-slate-600">
              This exports all stores, products, inventory movements, purchases, sales,
              expenses, accessories, settlements, investments, payouts and audit logs
              into one downloadable JSON file. Keep it somewhere safe as an off-site
              backup.
            </p>

            <a
              href="/api/backup"
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-600 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700"
            >
              <Download className="h-4 w-4" />
              Download backup (.json)
            </a>

            <div className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <span>
                Passwords are never included in the export. For per-report CSV/PDF
                exports (filtered by date and store), use the{' '}
                <span className="font-medium text-slate-600">Reports</span> section.
              </span>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Owner only" />
          <CardBody>
            <div className="flex items-start gap-2 text-sm text-slate-600">
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
              <p>
                This area is restricted to the owner. Each backup download is recorded
                in the Audit Log.
              </p>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
