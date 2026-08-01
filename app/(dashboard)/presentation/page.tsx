// Presentation Safe View — owner-only READINESS page.
//
// A minimal, presentation-focused status + checklist surface the owner opens
// before a demo. It shows whether Safe View is ON/OFF, the active profile, the
// expiry, the global read-only status, which modules are redacted vs blocked,
// and a short pre-demo checklist. It renders no confidential business data and
// performs no writes.

import { requireOwner } from '@/lib/auth';
import { CheckCircle2, XCircle, ShieldCheck, Lock } from 'lucide-react';
import { PageHeader, Card, CardBody, CardHeader, Badge, StatCard } from '@/components/ui';
import { getPresentationContext } from '@/lib/presentation/context';
import { presentationKillSwitchEnabled, PRESENTATION_PROFILE_LABEL } from '@/lib/presentation/core';
import { formatDateTime } from '@/lib/utils';

export const metadata = { title: 'Presentation Safe View readiness' };
export const dynamic = 'force-dynamic';

// Modules shown in active mode as a safe, read-only redacted view (no exact
// money, no identities, no file URLs, no write controls).
const REDACTED_MODULES = [
  'Dashboard',
  'Stores',
  'Products & Inventory',
  'Purchases',
  'Manual Sales',
  'Returns & Refunds',
  'Expenses',
  'Accessories',
  'Daraz Payouts',
  'Daraz Statements',
  'Profit & Loss',
  'Reports',
];

// Areas removed entirely while active (raw data by their nature).
const BLOCKED_MODULES = [
  'Daraz Import',
  'Audit Log',
  'Backup & Export',
  'Product detail drill-down',
  'File uploads & receipt links',
];

const CHECKLIST = [
  'Confirm Presentation Safe View is ON (green banner visible).',
  'Confirm the correct profile (Operations or Finance) for this audience.',
  'Confirm no sensitive tabs, files, or exports are already open.',
  'Record figures only after visual verification on screen.',
  'Exit Presentation Safe View as soon as the demo ends.',
];

export default async function PresentationReadinessPage() {
  await requireOwner();
  const ctx = await getPresentationContext();
  const killSwitch = presentationKillSwitchEnabled();
  const active = ctx.active;
  const profileLabel = ctx.profile ? PRESENTATION_PROFILE_LABEL[ctx.profile] : '—';

  return (
    <div>
      <PageHeader
        title="Presentation Safe View — readiness"
        description="Owner-only pre-demo status and checklist. Confidential values are never shown here."
      />

      {!killSwitch && (
        <Card className="mb-4 border-amber-200 bg-amber-50/70">
          <CardBody className="text-sm text-amber-800">
            The feature is switched off for this deployment
            (<code>PRESENTATION_SAFE_VIEW_ENABLED</code> is not <code>true</code>), so it cannot be
            enabled. This page is informational until the deployment enables the kill switch.
          </CardBody>
        </Card>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Safe View"
          value={active ? 'ON' : 'OFF'}
          tone={active ? 'positive' : 'default'}
        />
        <StatCard label="Active profile" value={active ? profileLabel : '—'} />
        <StatCard
          label="Write access"
          value={active ? 'Read-only' : 'Normal'}
          tone={active ? 'warning' : 'default'}
        />
        <StatCard
          label="Session expires"
          value={active && ctx.expiresAt ? formatDateTime(ctx.expiresAt) : '—'}
          hint={active && ctx.enabledByName ? `Enabled by ${ctx.enabledByName}` : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-1.5">
                <Lock className="h-4 w-4 text-slate-400" /> Read-only enforcement
              </span>
            }
            subtitle="While active, every create / edit / delete / upload / import is refused server-side."
          />
          <CardBody className="flex flex-col gap-2 text-sm text-slate-600">
            <p className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              Mutations fail closed with: “Unavailable while Presentation Safe View is active.”
            </p>
            <p className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              Files, raw Daraz imports, the Audit Log and Backup &amp; Export are unavailable.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-slate-400" /> Pre-demo checklist
              </span>
            }
            subtitle="Run through this before every demonstration."
          />
          <CardBody>
            <ol className="flex flex-col gap-2 text-sm text-slate-600">
              {CHECKLIST.map((item, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-700">
                    {i + 1}
                  </span>
                  {item}
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Redacted modules"
            subtitle="Shown as a safe, read-only view — counts and status only, no exact money, identities or files."
          />
          <CardBody className="flex flex-wrap gap-1.5">
            {REDACTED_MODULES.map((m) => (
              <Badge key={m} tone="green">
                <CheckCircle2 className="mr-1 h-3 w-3" /> {m}
              </Badge>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Blocked modules"
            subtitle="Removed entirely while active — raw confidential data by their nature."
          />
          <CardBody className="flex flex-wrap gap-1.5">
            {BLOCKED_MODULES.map((m) => (
              <Badge key={m} tone="red">
                <XCircle className="mr-1 h-3 w-3" /> {m}
              </Badge>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
