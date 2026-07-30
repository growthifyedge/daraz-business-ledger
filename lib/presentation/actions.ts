'use server';

// Presentation Safe View — OWNER-only enable/disable server actions.
//
// Enabling/disabling sets or clears the signed cookie and writes a single audit
// EVENT (no confidential values). It performs no other database work and never
// touches business records, calculations, stock, COGS, P&L, imports or reports.

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import {
  setPresentationCookie,
  clearPresentationCookie,
  getPresentationContext,
} from './context';
import {
  assertOwnerCanToggle,
  presentationKillSwitchEnabled,
  PRESENTATION_PROFILE_LABEL,
  type PresentationProfile,
} from './core';

function parseProfile(v: FormDataEntryValue | null): PresentationProfile {
  return v === 'FINANCE' ? 'FINANCE' : 'OPERATIONS';
}

/** Enable Presentation Safe View. OWNER only; inert if the kill switch is off. */
export async function enablePresentationSafeView(formData: FormData): Promise<void> {
  const user = await requireUser();
  assertOwnerCanToggle(user.role);

  // Fail closed if the feature is switched off for this deployment.
  if (!presentationKillSwitchEnabled()) {
    redirect('/dashboard?psv=unavailable');
  }

  const profile = parseProfile(formData.get('profile'));
  await setPresentationCookie({
    profile,
    enabledByName: user.name,
    enabledById: user.id,
  });

  // Audit the EVENT only — who, when, which profile. No business data.
  await logAudit({
    user,
    action: 'UPDATE',
    module: 'PresentationSafeView',
    recordId: 'presentation-safe-view',
    newValue: { state: 'ENABLED', profile: PRESENTATION_PROFILE_LABEL[profile] },
  });

  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

/** Disable Presentation Safe View (explicit Exit). OWNER only. */
export async function disablePresentationSafeView(): Promise<void> {
  const user = await requireUser();
  assertOwnerCanToggle(user.role);

  const ctx = await getPresentationContext();
  await clearPresentationCookie();

  await logAudit({
    user,
    action: 'UPDATE',
    module: 'PresentationSafeView',
    recordId: 'presentation-safe-view',
    oldValue: ctx.active && ctx.profile
      ? { state: 'ENABLED', profile: PRESENTATION_PROFILE_LABEL[ctx.profile] }
      : undefined,
    newValue: { state: 'DISABLED' },
  });

  revalidatePath('/', 'layout');
  redirect('/dashboard');
}
