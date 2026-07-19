// Idempotency fingerprints. Two layers:
//   1. Batch fingerprint = sha256(ordersFileHash + incomeFileHash) — re-uploading
//      the identical pair of files is a no-op (matches an existing DarazImportBatch).
//   2. Per-line key = orderItemId (unique) — the same order item can never be
//      imported twice even across different batches.
//
// Uses node:crypto (server-side only); the import feature runs in server actions.

import { createHash } from 'node:crypto';

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Stable batch fingerprint from the two file content hashes (order-independent). */
export function batchFingerprint(ordersFileHash: string, incomeFileHash: string): string {
  const parts = [ordersFileHash, incomeFileHash].sort();
  return sha256Hex(parts.join(':'));
}
