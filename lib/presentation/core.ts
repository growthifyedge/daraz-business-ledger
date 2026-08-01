// Presentation Safe View — pure, framework-free core.
//
// This module holds ONLY pure logic: types, constants, the kill switch, token
// signing/verification, the blocked-route predicate, and the toggle/enforcement
// guards. It deliberately does NOT import `next/headers`, `next/navigation`, the
// database, or any business logic, so it is safe to import from:
//   - server components / server actions (via ./context)
//   - route handlers
//   - Edge middleware
//   - unit tests (no Next runtime needed)
//
// Nothing here reads or writes business data. Enabling the mode is a cookie +
// audit event only — no schema, no records, no calculations are touched.

import { SignJWT, jwtVerify } from 'jose';
import type { Role } from '@/lib/auth';

export type PresentationProfile = 'OPERATIONS' | 'FINANCE';

export interface PresentationContext {
  /** True only when the kill switch is on AND a valid, unexpired token is present. */
  active: boolean;
  profile: PresentationProfile | null;
  /** Display-only name of the owner who enabled it. Never a confidential value. */
  enabledByName?: string;
  enabledAt?: string; // ISO
  expiresAt?: string; // ISO
}

/** Separate cookie from the auth session (`daraz_session`). Signed + httpOnly. */
export const PRESENTATION_COOKIE = 'daraz_present';

/** 4 hours, then the cookie/token expire and explicit re-entry is required. */
export const PRESENTATION_MAX_AGE = 60 * 60 * 4; // seconds

export const PRESENTATION_PROFILES: readonly PresentationProfile[] = ['OPERATIONS', 'FINANCE'];

export const PRESENTATION_PROFILE_LABEL: Record<PresentationProfile, string> = {
  OPERATIONS: 'Operations',
  FINANCE: 'Finance',
};

/**
 * Owner-only pages fully blocked while Presentation Safe View is active. These
 * expose raw confidential data by their very nature (full DB export, raw audit
 * snapshots, raw Daraz uploads), so they are removed entirely — not redacted.
 */
export const PRESENTATION_BLOCKED_PAGES = ['/backup', '/audit-log', '/import'] as const;

export const INACTIVE_PRESENTATION: PresentationContext = { active: false, profile: null };

/** Raised by the toggle/enforcement guards. Carries no confidential data. */
export class PresentationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PresentationError';
  }
}

/**
 * The global kill switch. The whole feature is inert unless the deployment sets
 * `PRESENTATION_SAFE_VIEW_ENABLED=true`. Default (unset/anything else) is OFF, so
 * production behaves exactly as before until deliberately enabled. Flipping this
 * off is the instant, code-free rollback path.
 */
export function presentationKillSwitchEnabled(): boolean {
  return process.env.PRESENTATION_SAFE_VIEW_ENABLED === 'true';
}

function isProfile(v: unknown): v is PresentationProfile {
  return v === 'OPERATIONS' || v === 'FINANCE';
}

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error('AUTH_SECRET is not set. Add it to your environment.');
  }
  return new TextEncoder().encode(secret);
}

export interface PresentationTokenInput {
  profile: PresentationProfile;
  enabledByName: string;
  enabledById?: string;
}

/**
 * Sign a presentation token. The payload carries only the profile and the
 * display name/id of the enabling owner — never any customer, supplier or
 * financial value.
 */
export async function signPresentationToken(input: PresentationTokenInput): Promise<string> {
  return new SignJWT({
    psv: true,
    profile: input.profile,
    enabledByName: input.enabledByName,
    enabledById: input.enabledById,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${PRESENTATION_MAX_AGE}s`)
    .sign(getSecret());
}

/**
 * Verify a raw token into a context. Honours the kill switch first, so a valid
 * cookie is inert when the feature is switched off for the deployment. Any
 * problem — missing, malformed, tampered, or expired — resolves to INACTIVE.
 * This is the single choke point shared by middleware and the server resolver.
 */
export async function verifyPresentationToken(
  token: string | undefined
): Promise<PresentationContext> {
  if (!presentationKillSwitchEnabled()) return INACTIVE_PRESENTATION;
  if (!token) return INACTIVE_PRESENTATION;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.psv !== true || !isProfile(payload.profile)) {
      return INACTIVE_PRESENTATION;
    }
    const iat = typeof payload.iat === 'number' ? payload.iat : undefined;
    const exp = typeof payload.exp === 'number' ? payload.exp : undefined;
    return {
      active: true,
      profile: payload.profile,
      enabledByName:
        typeof payload.enabledByName === 'string' ? payload.enabledByName : undefined,
      enabledAt: iat ? new Date(iat * 1000).toISOString() : undefined,
      expiresAt: exp ? new Date(exp * 1000).toISOString() : undefined,
    };
  } catch {
    // Invalid signature, tampering, or expiry (jwtVerify enforces `exp`).
    return INACTIVE_PRESENTATION;
  }
}

/** True when a page path is one of the fully-blocked owner-only areas. */
export function isPresentationBlockedPage(pathname: string): boolean {
  return PRESENTATION_BLOCKED_PAGES.some(
    (p) => pathname === p || pathname.startsWith(p + '/')
  );
}

/** Only the OWNER may enable or disable the mode. Throws for anyone else. */
export function assertOwnerCanToggle(role: Role): void {
  if (role !== 'OWNER') {
    throw new PresentationError('Only the owner can change Presentation Safe View.');
  }
}

/**
 * The single user-facing message shown whenever a write is refused because the
 * mode is active. Kept as one exported constant so every mutation path — server
 * actions, API routes, upload/import handlers — speaks with one voice, and so the
 * tests can assert the exact wording.
 */
export const PRESENTATION_READONLY_MESSAGE =
  'Unavailable while Presentation Safe View is active.';

/**
 * Global read-only guard for any WRITE path (create/edit/delete/upload/import).
 * While the mode is active the whole ERP is read-only: this throws so a mutation
 * fails closed. Pure (takes an already-resolved context) so it is unit-testable
 * and usable from server actions, route handlers and the shared server guard.
 */
export function assertWritable(context: PresentationContext): void {
  if (context.active) {
    throw new PresentationError(PRESENTATION_READONLY_MESSAGE);
  }
}

/**
 * Enforcement guard for route handlers / server actions: throw when a blocked
 * module is reached while the mode is active. Independent of middleware — never
 * rely on middleware alone for the block.
 */
export function assertModuleAllowed(context: PresentationContext, moduleName: string): void {
  if (context.active) {
    throw new PresentationError(
      `${moduleName} is unavailable while Presentation Safe View is active.`
    );
  }
}
