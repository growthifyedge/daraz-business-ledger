// Presentation Safe View — server-side enforcement helpers.
//
// Independent, defence-in-depth guards used by the blocked owner-only pages,
// route handlers and server actions. These do NOT rely on middleware; the block
// must hold even if middleware is bypassed.

import { redirect } from 'next/navigation';
import { fail, type FormState } from '@/lib/formState';
import { getPresentationContext } from './context';
import { assertModuleAllowed, assertWritable, PRESENTATION_READONLY_MESSAGE } from './core';

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

/**
 * Global read-only WRITE guard for any mutation path. Throws the standard
 * read-only error while the mode is active, so a create/edit/delete/upload fails
 * closed server-side — independent of middleware and of any disabled button.
 * Use in void actions (delete/void/restore) and route handlers.
 */
export async function assertPresentationReadOnly(): Promise<void> {
  assertWritable(await getPresentationContext());
}

/**
 * Convenience for `useActionState` form actions: returns a ready `FormState`
 * carrying the standard read-only error when the mode is active, or `null` when
 * inactive (so the caller proceeds exactly as before). Lets a form action block
 * a write with a single early `return`, showing the message in the form instead
 * of throwing to an error boundary.
 */
export async function presentationWriteBlock(): Promise<FormState | null> {
  const ctx = await getPresentationContext();
  return ctx.active ? fail(PRESENTATION_READONLY_MESSAGE) : null;
}
