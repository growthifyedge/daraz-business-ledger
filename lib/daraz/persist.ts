// Server-only. Turns the two uploaded files into a store-scoped dry-run and, on
// commit, writes ONE atomic transaction. Phase 4: NO customer/PII is ever read,
// stored, encrypted, logged, audited or committed — the Orders file is a
// sanitized, identifier-only dataset. Every batch / order line / income line is
// tagged with the selected store. Posts NO Sale / StockMovement / stock / COGS /
// P&L. Order lines are idempotent by Order Line ID (re-upload updates in place).

import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import type { SessionUser } from '@/lib/auth';
import { parseIncomeCsv, buildIncomeLines, parseDarazDate, type IncomeLine } from './parse';
import {
  normaliseRawOrderRows,
  combineOrderRecords,
  type SanitizedOrderRecord,
  type RawOrderRecord,
} from './sanitize';
import { computeDryRun, dupKey, planIncomeLineWrites, type DryRunResult, type LedgerProduct } from './dryrun';
import { sha256Hex, batchFingerprint } from './fingerprint';
import { readOrdersWorkbook, UploadError } from './xlsx';

export interface OrdersFile {
  buf: Buffer;
  name: string;
}

export interface ParsedUpload {
  storeId: string;
  orders: SanitizedOrderRecord[]; // combined across all Orders files, one per Order Line ID
  orderStats: {
    byStatus: { shipping: number; delivered: number; returned: number; other: number };
    mergedDuplicates: number;
    fileCount: number;
  };
  incomeLines: IncomeLine[];
  ordersHash: string; // combined hash of all Orders files
  incomeHash: string;
  fingerprint: string;
  incomeFeeRowCount: number;
  ordersFileName: string; // joined names of all Orders files
  incomeFileName: string;
}

/**
 * Parse one or MANY raw Orders files (Shipping/Delivered/Returned) + the Income
 * CSV into typed records and a store-scoped idempotency fingerprint. Each Orders
 * file is parsed in memory with non-permitted/PII columns discarded, then all
 * order rows are combined by Order Line ID (newest status wins). No raw/PII value
 * is retained; the transient updateTime is dropped by the combine.
 */
export async function parseUpload(
  orderFiles: OrdersFile[],
  incomeText: string,
  incomeFileName: string,
  storeId: string
): Promise<ParsedUpload> {
  const rawRecords: RawOrderRecord[] = [];
  const orderHashes: string[] = [];
  for (const f of orderFiles) {
    try {
      rawRecords.push(...normaliseRawOrderRows(await readOrdersWorkbook(f.buf)));
    } catch (e) {
      // Prefix the header-only diagnostic with the offending file name.
      if (e instanceof UploadError) throw new UploadError(`"${f.name}" — ${e.message}`);
      throw e;
    }
    orderHashes.push(sha256Hex(f.buf));
  }
  const combined = combineOrderRecords(rawRecords);

  const incomeFeeRows = parseIncomeCsv(incomeText);
  const incomeLines = buildIncomeLines(incomeFeeRows);
  // Order-independent combined hash across all Orders files.
  const ordersHash = sha256Hex([...orderHashes].sort().join(':'));
  const incomeHash = sha256Hex(incomeText);
  return {
    storeId,
    orders: combined.records,
    orderStats: {
      byStatus: combined.byStatus,
      mergedDuplicates: combined.mergedDuplicates,
      fileCount: orderFiles.length,
    },
    incomeLines,
    ordersHash,
    incomeHash,
    fingerprint: batchFingerprint(ordersHash, incomeHash, storeId),
    incomeFeeRowCount: incomeFeeRows.length,
    ordersFileName: orderFiles.map((f) => f.name).join(', '),
    incomeFileName,
  };
}

export interface PreviewOutput {
  result: DryRunResult;
  meta: {
    storeId: string;
    ordersFileName: string;
    incomeFileName: string;
    fingerprint: string;
    ordersRows: number;
    incomeFeeRows: number;
    alreadyCommitted: boolean;
  };
}

/** Read ledger context from the DB and compute the store-scoped dry-run. Never writes. */
export async function buildPreview(parsed: ParsedUpload): Promise<PreviewOutput> {
  const [products, mappings, existingLines, existingOrderLines, existingBatch] = await Promise.all([
    prisma.product.findMany({
      where: { deletedAt: null },
      select: { id: true, sku: true, name: true, currentStock: true, purchaseCost: true },
    }),
    // All mappings (with store); the dry-run resolves only those for parsed.storeId.
    prisma.darazSkuMapping.findMany({ select: { storeId: true, sellerSku: true, productId: true } }),
    prisma.darazIncomeLine.findMany({ select: { orderItemId: true, statementNumber: true } }),
    prisma.darazOrderItem.findMany({ select: { orderItemId: true } }),
    prisma.darazImportBatch.findUnique({
      where: { fingerprint: parsed.fingerprint },
      select: { id: true, status: true },
    }),
  ]);

  const alreadyImported = new Set(existingLines.map((l) => dupKey(l.orderItemId, l.statementNumber)));
  const existingOrderLineIds = new Set(existingOrderLines.map((o) => o.orderItemId));

  const result = computeDryRun({
    storeId: parsed.storeId,
    incomeLines: parsed.incomeLines,
    orders: parsed.orders,
    // storeId on a mapping may be null on legacy rows; coerce for the resolver.
    skuMappings: mappings.map((m) => ({ storeId: m.storeId ?? '', sellerSku: m.sellerSku, productId: m.productId })),
    products: products as LedgerProduct[],
    alreadyImported,
    existingOrderLineIds,
    orderRowsMerged: parsed.orderStats.mergedDuplicates,
    batchAlreadyImported: !!existingBatch,
  });

  return {
    result,
    meta: {
      storeId: parsed.storeId,
      ordersFileName: parsed.ordersFileName,
      incomeFileName: parsed.incomeFileName,
      fingerprint: parsed.fingerprint,
      ordersRows: parsed.orders.length,
      incomeFeeRows: parsed.incomeFeeRowCount,
      alreadyCommitted: existingBatch?.status === 'COMMITTED',
    },
  };
}

export interface CommitResult {
  ok: boolean;
  alreadyImported: boolean;
  error?: string;
  summary?: {
    batchId: string;
    storeId: string;
    orderItems: number;
    orderLinesInserted: number;
    orderLinesUpdated: number;
    incomeLines: number;
    incomeLinesUpdated: number;
    fees: number;
    distinctOrderItemIds: number;
    statementCount: number;
    netPayout: number;
    reconDiff: number;
  };
}

/**
 * Commit the import as a single atomic transaction, scoped to the selected
 * store. Idempotent at the batch level (store+files fingerprint), the income
 * line level (composite unique — already-imported lines are skipped), and the
 * order line level (Order Line ID — re-uploads UPDATE in place via ON CONFLICT,
 * so a Shipping line that became Delivered updates the same row). Writes NO
 * customer data of any kind. Posts NO Sale / StockMovement / stock / COGS / P&L.
 */
export async function commitImport(
  parsed: ParsedUpload,
  user: SessionUser | null
): Promise<CommitResult> {
  if (!parsed.storeId) {
    return { ok: false, alreadyImported: false, error: 'Select a store before importing.' };
  }
  const store = await prisma.store.findFirst({
    where: { id: parsed.storeId, deletedAt: null },
    select: { id: true },
  });
  if (!store) {
    return { ok: false, alreadyImported: false, error: 'The selected store no longer exists.' };
  }

  const { result } = await buildPreview(parsed);
  const t = result.totals;

  // Reconciliation + integrity guards — any failure aborts before writing.
  if (t.reconDiff !== 0 || t.categorySumCheck !== 0) {
    return { ok: false, alreadyImported: false, error: `Reconciliation difference detected (${t.reconDiff}); import rolled back.` };
  }
  if (t.unmatched > 0) {
    return { ok: false, alreadyImported: false, error: `${t.unmatched} income Order Item ID(s) have no matching order; import rolled back.` };
  }

  // Resolve SKU → product for THIS store only (store-isolated).
  const skuToProduct = new Map(
    (
      await prisma.darazSkuMapping.findMany({
        where: { storeId: parsed.storeId },
        select: { sellerSku: true, productId: true },
      })
    ).map((m) => [m.sellerSku, m.productId])
  );

  const batchId = randomUUID();

  // --- Order lines: one row per Order Line ID, sanitized fields only + store ---
  const seenLine = new Set<string>();
  const orderRows = parsed.orders
    .filter((o) => (seenLine.has(o.orderItemId) ? false : (seenLine.add(o.orderItemId), true)))
    .map((o) => ({
      id: randomUUID(),
      orderItemId: o.orderItemId,
      orderNumber: o.orderNumber,
      sellerSku: o.sellerSku || null,
      itemName: o.productName || null,
      quantity: o.quantity,
      status: o.status || null,
      createTime: parseDarazDate(o.orderDate),
      storeId: parsed.storeId,
      productId: o.sellerSku ? (skuToProduct.get(o.sellerSku) ?? null) : null,
      importBatchId: batchId,
    }));

  // --- Income lines: insert NEW (orderItemId, statementNumber) lines; UPDATE
  //     existing ones in place (Daraz revised figures — fees replaced atomically).
  const existingKeys = new Set(
    (await prisma.darazIncomeLine.findMany({ select: { orderItemId: true, statementNumber: true } })).map(
      (l) => dupKey(l.orderItemId, l.statementNumber)
    )
  );
  const { inserts: newIncome, updates: revisedIncome } = planIncomeLineWrites(
    existingKeys,
    parsed.incomeLines
  );
  // The batch's net reflects only newly inserted lines; revisions correct their
  // own existing lines in place (and keep their original batch linkage).
  const expectedNet = round2(newIncome.reduce((s, il) => s + il.netAmount, 0));

  const incomeLineRows = newIncome.map((il) => ({
    id: randomUUID(),
    orderItemId: il.orderItemId,
    statementNumber: il.statementNumber,
    orderNumber: il.orderNumber || null,
    sellerSku: il.sellerSku || null,
    productName: il.productName || null,
    statementPeriod: il.statementPeriod || null,
    transactionDate: parseDarazDate(il.transactionDates[0]),
    orderCreationDate: parseDarazDate(il.orderCreationDate),
    orderStatus: il.orderStatus || null,
    releaseStatus: il.releaseStatus || null,
    productPriceRevenue: il.productPriceRevenue,
    buyerShippingCredit: il.buyerShippingCredit,
    totalCredits: il.totalCredits,
    totalDeductions: il.totalDeductions,
    netAmount: il.netAmount,
    reconciled: round2(il.totalCredits + il.totalDeductions) === il.netAmount,
    storeId: parsed.storeId,
    importBatchId: batchId,
  }));
  const feeRows = newIncome.flatMap((il, i) =>
    il.fees.map((f) => ({
      incomeLineId: incomeLineRows[i].id,
      label: f.label,
      category: f.category,
      amount: f.amount,
      vatAmount: f.vatAmount,
      isRefund: f.isRefund,
      isReversal: f.isReversal,
    }))
  );

  try {
    const outcome = await prisma.$transaction(
      async (tx) => {
        // Batch-level idempotency: identical store+files → recognised, no writes.
        const existing = await tx.darazImportBatch.findUnique({
          where: { fingerprint: parsed.fingerprint },
          select: { id: true },
        });
        if (existing) return { batchId: existing.id, created: false, updated: 0, incomeUpdated: 0 };

        await tx.darazImportBatch.create({
          data: {
            id: batchId,
            fingerprint: parsed.fingerprint,
            ordersFileName: parsed.ordersFileName,
            ordersFileHash: parsed.ordersHash,
            incomeFileName: parsed.incomeFileName,
            incomeFileHash: parsed.incomeHash,
            status: 'COMMITTED',
            storeId: parsed.storeId,
            totalOrderItems: orderRows.length,
            totalIncomeLines: incomeLineRows.length,
            distinctOrderItemIds: t.distinctOrderItemIds,
            matchedLines: t.matched,
            unmatchedLines: t.unmatched,
            duplicateLines: t.duplicates,
            unresolvedSkus: t.unresolvedSkus,
            statementCount: t.statementCount,
            totalCredits: round2(newIncome.reduce((s, il) => s + il.totalCredits, 0)),
            totalDeductions: round2(newIncome.reduce((s, il) => s + il.totalDeductions, 0)),
            netPayout: expectedNet,
            reconDiff: t.reconDiff,
            createdById: user?.id ?? null,
            createdBy: user?.name ?? user?.email ?? null,
          },
        });

        // Order lines: bulk INSERT … ON CONFLICT (Order Line ID) DO UPDATE — a
        // re-uploaded line updates in place (status transitions), never duplicates.
        let updated = 0;
        if (orderRows.length) {
          const existingIds = new Set(
            (
              await tx.darazOrderItem.findMany({
                where: { orderItemId: { in: orderRows.map((r) => r.orderItemId) } },
                select: { orderItemId: true },
              })
            ).map((r) => r.orderItemId)
          );
          updated = orderRows.filter((r) => existingIds.has(r.orderItemId)).length;

          const values = orderRows.map(
            (r) =>
              Prisma.sql`(${r.id}, ${r.orderItemId}, ${r.orderNumber}, ${r.sellerSku}, ${r.itemName}, ${r.quantity}, ${r.status}, ${r.createTime}, ${r.storeId}, ${r.productId}, ${r.importBatchId})`
          );
          await tx.$executeRaw`
            INSERT INTO "DarazOrderItem"
              ("id","orderItemId","orderNumber","sellerSku","itemName","quantity","status","createTime","storeId","productId","importBatchId")
            VALUES ${Prisma.join(values)}
            ON CONFLICT ("orderItemId") DO UPDATE SET
              "orderNumber"   = EXCLUDED."orderNumber",
              "sellerSku"     = EXCLUDED."sellerSku",
              "itemName"      = EXCLUDED."itemName",
              "quantity"      = EXCLUDED."quantity",
              "status"        = EXCLUDED."status",
              "createTime"    = EXCLUDED."createTime",
              "storeId"       = EXCLUDED."storeId",
              "productId"     = EXCLUDED."productId",
              "importBatchId" = EXCLUDED."importBatchId"`;
        }

        if (incomeLineRows.length) await tx.darazIncomeLine.createMany({ data: incomeLineRows });
        if (feeRows.length) await tx.darazIncomeFee.createMany({ data: feeRows });

        // Revised statement lines: update figures in place and REPLACE their fee
        // rows atomically (delete old, insert new) — never silently ignored.
        for (const il of revisedIncome) {
          const line = await tx.darazIncomeLine.update({
            where: { orderItemId_statementNumber: { orderItemId: il.orderItemId, statementNumber: il.statementNumber } },
            data: {
              orderNumber: il.orderNumber || null,
              sellerSku: il.sellerSku || null,
              productName: il.productName || null,
              statementPeriod: il.statementPeriod || null,
              transactionDate: parseDarazDate(il.transactionDates[0]),
              orderCreationDate: parseDarazDate(il.orderCreationDate),
              orderStatus: il.orderStatus || null,
              releaseStatus: il.releaseStatus || null,
              productPriceRevenue: il.productPriceRevenue,
              buyerShippingCredit: il.buyerShippingCredit,
              totalCredits: il.totalCredits,
              totalDeductions: il.totalDeductions,
              netAmount: il.netAmount,
              reconciled: round2(il.totalCredits + il.totalDeductions) === il.netAmount,
            },
            select: { id: true },
          });
          await tx.darazIncomeFee.deleteMany({ where: { incomeLineId: line.id } });
          if (il.fees.length) {
            await tx.darazIncomeFee.createMany({
              data: il.fees.map((f) => ({
                incomeLineId: line.id,
                label: f.label,
                category: f.category,
                amount: f.amount,
                vatAmount: f.vatAmount,
                isRefund: f.isRefund,
                isReversal: f.isReversal,
              })),
            });
          }
        }

        // Post-write reconciliation: net of income lines written for THIS batch
        // must equal the net of the newly inserted lines exactly.
        const agg = await tx.darazIncomeLine.aggregate({
          where: { importBatchId: batchId },
          _sum: { netAmount: true },
        });
        const persistedNet = round2(agg._sum.netAmount ?? 0);
        if (persistedNet !== expectedNet) {
          throw new Error(`Persisted net ${persistedNet} != expected ${expectedNet} — rolling back.`);
        }
        return { batchId, created: true, updated, incomeUpdated: revisedIncome.length };
      },
      { timeout: 120_000, maxWait: 20_000 }
    );

    if (!outcome.created) {
      return { ok: true, alreadyImported: true, summary: undefined };
    }

    const summary = {
      batchId: outcome.batchId,
      storeId: parsed.storeId,
      orderItems: orderRows.length,
      orderLinesInserted: orderRows.length - outcome.updated,
      orderLinesUpdated: outcome.updated,
      incomeLines: incomeLineRows.length,
      incomeLinesUpdated: outcome.incomeUpdated,
      fees: feeRows.length,
      distinctOrderItemIds: t.distinctOrderItemIds,
      statementCount: t.statementCount,
      netPayout: expectedNet,
      reconDiff: t.reconDiff,
    };

    // Audit: store + counts + totals + batch id ONLY. No customer value exists.
    await logAudit({
      user,
      action: 'CREATE',
      module: 'DarazImport',
      recordId: outcome.batchId,
      newValue: summary,
    });

    return { ok: true, alreadyImported: false, summary };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Import failed and was rolled back.';
    return { ok: false, alreadyImported: false, error: msg };
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
