// Presentation Safe View — server-side context resolver + cookie writer.
//
// This is the ONLY presentation module that touches `next/headers`. It is used
// from server components, server actions and route handlers. Middleware uses the
// pure `verifyPresentationToken` from ./core instead (it cannot call cookies()).

import { cookies } from 'next/headers';
import {
  PRESENTATION_COOKIE,
  PRESENTATION_MAX_AGE,
  presentationKillSwitchEnabled,
  signPresentationToken,
  verifyPresentationToken,
  INACTIVE_PRESENTATION,
  type PresentationContext,
  type PresentationTokenInput,
} from './core';

/** Resolve the current request's presentation context. Inactive when the kill
 *  switch is off or no valid token is present. */
export async function getPresentationContext(): Promise<PresentationContext> {
  if (!presentationKillSwitchEnabled()) return INACTIVE_PRESENTATION;
  const store = await cookies();
  const token = store.get(PRESENTATION_COOKIE)?.value;
  return verifyPresentationToken(token);
}

/** Convenience boolean for route handlers / actions that only need the flag. */
export async function isPresentationActive(): Promise<boolean> {
  return (await getPresentationContext()).active;
}

/** Set the signed, httpOnly presentation cookie (4-hour expiry). */
export async function setPresentationCookie(input: PresentationTokenInput): Promise<void> {
  const token = await signPresentationToken(input);
  const store = await cookies();
  store.set(PRESENTATION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: PRESENTATION_MAX_AGE,
  });
}

/** Clear the presentation cookie (explicit Exit / disable). */
export async function clearPresentationCookie(): Promise<void> {
  const store = await cookies();
  store.delete(PRESENTATION_COOKIE);
}
