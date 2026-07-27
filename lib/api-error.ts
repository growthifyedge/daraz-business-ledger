// Pure helpers for turning a fetch() outcome into an accurate, user-facing error
// message. Kept DB-free and framework-free so it is unit-testable and safe to
// import into a client component.
//
// Why this exists: the import UI previously collapsed EVERY non-happy path into a
// generic "Network error during reprocess." That hid the real failure — most
// importantly a serverless function timeout, which returns a NON-JSON platform
// page (HTTP 504). res.json() then throws and the catch fired, so the operator
// saw "Network error" for what was actually a server-side timeout. These helpers
// distinguish: (a) the server responded (even non-JSON) → show status + reason;
// (b) the request never reached the server → a true network error.

/** Shape of the JSON body our API routes return on a handled failure. */
interface ApiErrorBody {
  ok?: boolean;
  error?: string;
}

/**
 * Build the message to show when the server RESPONDED but the call did not
 * succeed (either res.ok was false, or the JSON body had ok:false, or the body
 * was not JSON at all). `label` is the action name ("Reprocess", "Import",
 * "Preview"). `bodyText` is the raw response text (may be JSON or an HTML/plain
 * platform error page). Never returns the misleading "Network error".
 */
export function apiFailureMessage(
  label: string,
  status: number,
  statusText: string,
  bodyText: string
): string {
  // Prefer the structured error our own handlers emit.
  let parsed: ApiErrorBody | null = null;
  try {
    parsed = JSON.parse(bodyText) as ApiErrorBody;
  } catch {
    parsed = null;
  }
  if (parsed && typeof parsed.error === 'string' && parsed.error.trim()) {
    return parsed.error.trim();
  }

  // Non-JSON body ⇒ a platform/proxy page, not our handler. Map the common ones.
  if (status === 504 || status === 408 || /timed out|timeout/i.test(bodyText)) {
    return `${label} timed out on the server (HTTP ${status || 504}). Nothing was changed — the update is transactional and rolled back. Please try again.`;
  }
  if (status === 413) {
    return `${label} failed: the upload is too large for the server (HTTP 413). Nothing was changed.`;
  }
  if (status === 401 || status === 403) {
    return `${label} failed: you are not authorised (HTTP ${status}). Sign in as the owner and try again.`;
  }
  const reason = statusText ? ` ${statusText}` : '';
  const snippet = bodyText.trim().replace(/\s+/g, ' ').slice(0, 160);
  const tail = snippet ? ` ${snippet}` : '';
  return `${label} failed (HTTP ${status}${reason}). Nothing was changed.${tail}`;
}

/**
 * Build the message for when fetch() itself REJECTED — the request never got a
 * response (offline, DNS, connection reset, CORS). Only this case is a true
 * "network error".
 */
export function networkErrorMessage(label: string, err: unknown): string {
  const detail = err instanceof Error && err.message ? `: ${err.message}` : '';
  return `Network error during ${label.toLowerCase()}${detail}. The request did not reach the server; nothing was changed.`;
}
