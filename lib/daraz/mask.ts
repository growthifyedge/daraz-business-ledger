// Customer-data masking. Phone numbers and national-registration numbers are
// masked BY DEFAULT everywhere in the UI; full values are revealed only by an
// explicit, audit-logged owner action. Names/emails are shown to owner/admin.
//
// These are display helpers — they never mutate stored data.

/** Mask all but the last `keep` characters of a value. `03001234852` → `••••••852`. */
export function maskTail(value: string | null | undefined, keep = 3): string {
  if (!value) return '';
  const s = String(value).trim();
  if (s.length <= keep) return '•'.repeat(s.length);
  return '•'.repeat(s.length - keep) + s.slice(-keep);
}

/** Mask a phone number, preserving only the last 3 digits. */
export function maskPhone(value: string | null | undefined): string {
  return maskTail(value, 3);
}

/** Mask a national registration / CNIC number, preserving only the last 3. */
export function maskNationalId(value: string | null | undefined): string {
  return maskTail(value, 3);
}

/** Mask an email: keep first char + domain. `ahmed@x.com` → `a•••@x.com`. */
export function maskEmail(value: string | null | undefined): string {
  if (!value) return '';
  const s = String(value).trim();
  const at = s.indexOf('@');
  if (at <= 0) return maskTail(s, 2);
  const local = s.slice(0, at);
  const domain = s.slice(at);
  const head = local[0];
  return `${head}${'•'.repeat(Math.max(1, local.length - 1))}${domain}`;
}

/**
 * The masked view of a customer record — what non-revealing UI shows by default.
 * Phone and national ID are always masked here; a reveal must go through an
 * audited server action, not this function.
 */
export interface MaskedCustomer {
  name: string | null;
  emailMasked: string;
  phoneMasked: string;
  nationalIdMasked: string;
}

export function maskCustomer(c: {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  nationalRegistrationNumber?: string | null;
}): MaskedCustomer {
  return {
    name: c.name ?? null,
    emailMasked: maskEmail(c.email),
    phoneMasked: maskPhone(c.phone),
    nationalIdMasked: maskNationalId(c.nationalRegistrationNumber),
  };
}
