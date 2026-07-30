// Presentation Safe View — server-side enforcement helpers.
//
// Independent, defence-in-depth guards used by the blocked owner-only pages,
// route handlers and server actions. These do NOT rely on middleware; the block
// must hold even if middleware is bypassed.

import { redirect } from 'next/navigation';
import { getPresentationContext } from './context';
import { assertModuleAllowed } from './core';

/**
 * Page guard: while the mode is active, send the blocked owner-only pages to the
 * dashboard. Middleware does the same for UX, but pages call this so the block is
 * enforced even if a request reaches the page directly.
 */
export async function redirectIfPresentationActive(): Promise<void> {
  const ctx = await getPresentationContext();
  if (ctx.active) redirect('/dashboard?psv=blocked');
}

/**
 * Route-handler / server-action guard: throws (does not redirect) when the mode
 * is active, so JSON APIs and actions fail closed rather than serving raw data.
 */
export async function assertModuleOutsidePresentation(moduleName: string): Promise<void> {
  const ctx = await getPresentationContext();
  assertModuleAllowed(ctx, moduleName);
}
