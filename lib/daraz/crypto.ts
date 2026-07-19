// Server-only authenticated encryption for customer PII. AES-256-GCM with a key
// from the environment (DARAZ_PII_KEY). Stored PII is never readable plaintext;
// decryption is server-only and never logged or sent to the client.
//
// A separate keyed blind-index (HMAC-SHA256) lets us match a phone/email without
// storing searchable plaintext — the hash is one-way and reveals nothing.
//
// This module must never run in the browser. It has no default key: if the key
// is missing it throws rather than storing weakly-protected data.

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';

/** 32-byte key from env (base64 or hex). Throws if absent/wrong length. */
function key(): Buffer {
  const raw = process.env.DARAZ_PII_KEY;
  if (!raw) {
    throw new Error('DARAZ_PII_KEY is not set — customer PII cannot be stored securely.');
  }
  const buf = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error('DARAZ_PII_KEY must decode to 32 bytes (AES-256).');
  }
  return buf;
}

/** Whether an encryption key is configured (for feature-gating the write path). */
export function piiKeyConfigured(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

/**
 * Encrypt a plaintext value. Returns `v1:iv:tag:ciphertext` (all base64). Null/
 * empty in → null out (nothing to protect).
 */
export function encryptPii(plaintext: string | null | undefined): string | null {
  if (plaintext == null || plaintext === '') return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

/**
 * Decrypt a value produced by encryptPii. Throws on tampering (GCM auth failure).
 * Server-only — callers must never log or return the result to the client except
 * through an authorised, audited reveal action.
 */
export function decryptPii(stored: string | null | undefined): string | null {
  if (stored == null || stored === '') return null;
  const parts = String(stored).split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Malformed encrypted value.');
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const pt = Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]);
  return pt.toString('utf8');
}

/**
 * Deterministic, keyed blind index for equality search (phone/email). One-way:
 * the value cannot be recovered from the hash. Normalises before hashing so
 * "0300 123" and "0300123" match. Uses the same env key material via HMAC.
 */
export function blindIndex(value: string | null | undefined): string | null {
  if (value == null || value === '') return null;
  const normalized = String(value).toLowerCase().replace(/\s+/g, '');
  return createHmac('sha256', key()).update(normalized).digest('hex');
}
