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
import { type FormState, fail } from '@/lib/formState';
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

// These actions use the `useActionState` signature `(prevState, formData)` so the
// enable/exit controls can show an immediate pending state and surface a clear
// failure message instead of throwing to an error boundary. On success they
// still set/clear the SAME signed httpOnly cookie, write the SAME audit event,
// revalidate and redirect ONCE — the security model and server-side redaction
// are unchanged. The fallible work is wrapped so a failure returns a retry
// message; the redirect stays outside the try so its control-flow signal is
// never swallowed.

/** Enable Presentation Safe View. OWNER only; inert if the kill switch is off. */
export async function enablePresentationSafeView(
  _prev: FormState,
  formData: FormData
): Promise<FormState> {
  const user = await requireUser();
  try {
    assertOwnerCanToggle(user.role);

    // Fail closed if the feature is switched off for this deployment.
    if (!presentationKillSwitchEnabled()) {
      return fail('Presentation Safe View is not enabled for this workspace.');
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
  } catch {
    return fail('Could not start Presentation Safe View. Please try again.');
  }

  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

/** Disable Presentation Safe View (explicit Exit). OWNER only. */
export async function disablePresentationSafeView(
  prevState: FormState,
  formData: FormData
): Promise<FormState> {
  // Required by the useActionState signature; Exit needs no input of its own.
  void prevState;
  void formData;
  const user = await requireUser();
  try {
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
  } catch {
    return fail('Could not exit Presentation Safe View. Please try again.');
  }

  revalidatePath('/', 'layout');
  redirect('/dashboard');
}
