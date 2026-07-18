// ============================================================================
// Daraz returns importer — DRY-RUN ONLY. WRITE MODE IS DISABLED.
// ============================================================================
//
// This script INSPECTS an external input file and prints a dry-run summary.
// It CANNOT write to the database. There is no `--commit` path, and it contains
// no embedded source data — the real Daraz return records are private and live
// outside this repository.
//
// Usage:
//   node scripts/import-returns.mjs <path-to-input.json>
//
// Input file shape (an array of line-item objects, or { data: [...] }):
//   {
//     "data": [
//       {
//         "returnItemId":  "…",   // Daraz Return Item ID (line-level identity)
//         "returnOrderId": "…",   // Daraz Return Order ID (repeats per line)
//         "orderNumber":   "…",
//         "orderItemId":   "…",
//         "orderDate":     "YYYY-MM-DD HH:mm:ss",
//         "returnDate":    "YYYY-MM-DD HH:mm:ss",
//         "sellerSku":     "…",
//         "qty":           1,
//         "paid":          0,
//         "refund":        0,
//         "chargedTo":     "SELLER" | "PLATFORM" | "PENDING",
//         "reason":        "…",
//         "darazStatus":   "…",
//         "logistic":      "…"
//       }
//     ]
//   }
//
// UNRESOLVED — must be decided by the owner before any import is enabled:
//   1. Product mapping. Daraz seller SKUs have no reliable link to ledger SKUs,
//      and some are ambiguous between similarly-named products.
//   2. Store attribution. The source has no store column; GrowthifyEdge is an
//      active store, so a blanket assignment would be wrong.
//   3. Lifecycle states. refundStatus and inventoryStatus must be set per record
//      from evidence, never by a blanket assumption.
//
// This tool assigns no product, store, or disposition. Enabling writes is a
// deliberate future code change, not a flag.
// ============================================================================

import fs from 'fs';

const argPath = process.argv[2];
const COMMIT_REQUESTED = process.argv.includes('--commit');

if (COMMIT_REQUESTED) {
  console.error('\n  WRITE MODE IS DISABLED.\n');
  console.error('  --commit is not available. Product/store mappings and per-record');
  console.error('  lifecycle states are not yet approved by the owner (see header).\n');
  process.exit(1);
}

if (!argPath) {
  console.error('\n  Usage: node scripts/import-returns.mjs <path-to-input.json>\n');
  console.error('  The input file is private and is NOT committed to this repository.');
  console.error('  See the header for the expected JSON shape.\n');
  process.exit(1);
}

let raw;
try {
  raw = fs.readFileSync(argPath, 'utf8');
} catch {
  console.error(`\n  Could not read input file: ${argPath}\n`);
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(raw);
} catch {
  console.error('\n  Input file is not valid JSON.\n');
  process.exit(1);
}

const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.data) ? parsed.data : null;
if (!rows) {
  console.error('\n  Expected a JSON array, or an object with a "data" array.\n');
  process.exit(1);
}

console.log('\n  DRY RUN — write mode disabled. Nothing will be written.');
console.log(`  Input: ${argPath}`);
console.log(`  Records read: ${rows.length}\n`);

// Lightweight, read-only validation echo. No database connection is opened.
let total = 0,
  seller = 0,
  platform = 0,
  problems = 0;
const seen = new Set();

console.log('  #   returnDate   sellerSku                     qty   refund  chargedTo  identity');
console.log('  ' + '-'.repeat(92));
rows.forEach((r, i) => {
  const refund = Number(r.refund) || 0;
  total += refund;
  if (r.chargedTo === 'SELLER') seller += refund;
  else if (r.chargedTo === 'PLATFORM') platform += refund;

  const hasIdentity =
    !!r.returnItemId || (!!r.returnOrderId && !!r.orderItemId);
  const key = r.returnItemId || `${r.returnOrderId}|${r.orderItemId}`;
  const dup = seen.has(key);
  seen.add(key);
  if (!hasIdentity || dup) problems++;

  const identity = !hasIdentity
    ? 'MISSING IDENTITY'
    : dup
      ? 'DUPLICATE'
      : 'ok';
  const sku = String(r.sellerSku ?? '').padEnd(28).slice(0, 28);
  const date = String(r.returnDate ?? '').slice(0, 10).padEnd(10);
  console.log(
    `  ${String(i + 1).padStart(2)}  ${date}   ${sku} ${String(r.qty ?? '').padStart(3)} ${String(refund).padStart(7)}   ${String(r.chargedTo ?? '').padEnd(9)}  ${identity}`
  );
});

console.log('\n  — Summary —');
console.log(`  Line items    : ${rows.length}`);
console.log(`  Total refunds : Rs ${total}`);
console.log(`    Charged to seller  : Rs ${seller}`);
console.log(`    Charged to platform: Rs ${platform}`);
console.log(`    Undecided          : Rs ${total - seller - platform}`);
console.log(`  Identity/duplicate problems: ${problems}`);

console.log('\n  Blocked on owner decisions before writes can ever be enabled:');
console.log('    1. Daraz SKU -> ledger product mapping');
console.log('    2. Store attribution per return');
console.log('    3. refundStatus + inventoryStatus per record');
console.log('\n  Write mode stays disabled.\n');
