// Server-only. Turns two uploaded buffers into a dry-run preview and, on
// commit, writes ONE atomic, idempotent import transaction. Customer PII is
// encrypted before it ever reaches the database; no PII is logged or audited.

import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import type { SessionUser } from '@/lib/auth';
import {
  parseIncomeCsv,
  buildIncomeLines,
  normaliseOrderRows,
  parseDarazDate,
  type IncomeLine,
  type OrderItemRecord,
} from './parse';
import { computeDryRun, dupKey, type DryRunResult, type LedgerProduct } from './dryrun';
import { sha256Hex, batchFingerprint } from './fingerprint';
import { readOrdersWorkbook } from './xlsx';
import { encryptPii, blindIndex, piiKeyConfigured } from './crypto';

export interface ParsedUpload {
  orders: OrderItemRecord[];
  incomeLines: IncomeLine[];
  ordersHash: string;
  incomeHash: string;
  fingerprint: string;
  incomeFeeRowCount: number;
  ordersFileName: string;
  incomeFileName: string;
}

/** Parse both uploaded buffers into typed records + idempotency fingerprint. */
export async function parseUpload(
  ordersBuf: Buffer,
  ordersFileName: string,
  incomeText: string,
  incomeFileName: string
): Promise<ParsedUpload> {
  const orders = normaliseOrderRows(await readOrdersWorkbook(ordersBuf));
  const incomeFeeRows = parseIncomeCsv(incomeText);
  const incomeLines = buildIncomeLines(incomeFeeRows);
  const ordersHash = sha256Hex(ordersBuf);
  const incomeHash = sha256Hex(incomeText);
  return {
    orders,
    incomeLines,
    ordersHash,
    incomeHash,
    fingerprint: batchFingerprint(ordersHash, incomeHash),
    incomeFeeRowCount: incomeFeeRows.length,
    ordersFileName,
    incomeFileName,
  };
}

export interface PreviewOutput {
  result: DryRunResult;
  meta: {
    ordersFileName: string;
    incomeFileName: string;
    fingerprint: string;
    ordersRows: number;
    incomeFeeRows: number;
    alreadyCommitted: boolean;
  };
}

/** Read ledger context from the DB and compute the dry-run. Never writes. */
export async function buildPreview(parsed: ParsedUpload): Promise<PreviewOutput> {
  const [products, mappings, existingLines, existingBatch] = await Promise.all([
    prisma.product.findMany({
      where: { deletedAt: null },
      select: { id: true, sku: true, name: true, currentStock: true, purchaseCost: true },
    }),
    prisma.darazSkuMapping.findMany({ select: { sellerSku: true, productId: true } }),
    prisma.darazIncomeLine.findMany({ select: { orderItemId: true, statementNumber: true } }),
    prisma.darazImportBatch.findUnique({
      where: { fingerprint: parsed.fingerprint },
      select: { id: true, status: true },
    }),
  ]);

  const alreadyImported = new Set(existingLines.map((l) => dupKey(l.orderItemId, l.statementNumber)));

  const result = computeDryRun({
    incomeLines: parsed.incomeLines,
    orders: parsed.orders,
    skuMappings: mappings,
    products: products as LedgerProduct[],
    alreadyImported,
    batchAlreadyImported: !!existingBatch,
  });

  return {
    result,
    meta: {
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
    orderItems: number;
    customers: number;
    incomeLines: number;
    fees: number;
    distinctOrderItemIds: number;
    statementCount: number;
    netPayout: number;
    reconDiff: number;
  };
}

/**
 * Commit the import as a single atomic transaction. Idempotent at the batch
 * level (fingerprint) and the line level (composite unique). Rolls back on any
 * reconciliation difference. Encrypts all PII. Posts NO Sale / StockMovement /
 * stock / COGS / P&L — those wait until Seller SKUs are mapped.
 */
export async function commitImport(
  parsed: ParsedUpload,
  user: SessionUser | null
): Promise<CommitResult> {
  // Hard gate: refuse to persist customer data without a valid encryption key.
  if (!piiKeyConfigured()) {
    return {
      ok: false,
      alreadyImported: false,
      error: 'Customer PII encryption key (DARAZ_PII_KEY) is missing or invalid — import refused.',
    };
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

  // Resolve SKU → product (null until mapped) for stamping order items.
  const skuToProduct = new Map(
    (await prisma.darazSkuMapping.findMany({ select: { sellerSku: true, productId: true } })).map(
      (m) => [m.sellerSku, m.productId]
    )
  );

  // --- Build encrypted rows in memory (ids client-generated for bulk insert) ---
  const customers: {
    id: string;
    nameEnc: string | null;
    emailEnc: string | null;
    phoneEnc: string | null;
    nationalRegistrationEnc: string | null;
    phoneHash: string | null;
    emailHash: string | null;
  }[] = [];

  const orderItemRows: {
    id: string;
    orderItemId: string;
    orderNumber: string;
    sellerSku: string | null;
    lazadaSku: string | null;
    itemName: string | null;
    variation: string | null;
    quantity: number;
    unitPrice: number;
    paidPrice: number;
    status: string | null;
    createTime: Date | null;
    deliveredDate: Date | null;
    trackingCodeEnc: string | null;
    trackingUrlEnc: string | null;
    shippingProvider: string | null;
    shippingNameEnc: string | null;
    shippingAddressEnc: string | null;
    shippingPhoneEnc: string | null;
    shippingCityEnc: string | null;
    shippingPostCodeEnc: string | null;
    billingNameEnc: string | null;
    billingAddressEnc: string | null;
    billingPhoneEnc: string | null;
    billingCityEnc: string | null;
    shippingPhoneHash: string | null;
    customerId: string;
    productId: string | null;
  }[] = [];

  const batchId = randomUUID();

  for (const o of parsed.orders) {
    const customerId = randomUUID();
    customers.push({
      id: customerId,
      nameEnc: encryptPii(o.customerName),
      emailEnc: encryptPii(o.customerEmail),
      phoneEnc: encryptPii(o.shippingPhone),
      nationalRegistrationEnc: encryptPii(o.nationalRegistrationNumber),
      phoneHash: blindIndex(o.shippingPhone),
      emailHash: blindIndex(o.customerEmail),
    });
    orderItemRows.push({
      id: randomUUID(),
      orderItemId: o.orderItemId,
      orderNumber: o.orderNumber,
      sellerSku: o.sellerSku || null,
      lazadaSku: o.lazadaSku || null,
      itemName: o.itemName || null,
      variation: o.variation || null,
      quantity: 1,
      unitPrice: o.unitPrice,
      paidPrice: o.paidPrice,
      status: o.status || null,
      createTime: parseDarazDate(o.createTime),
      deliveredDate: parseDarazDate(o.deliveredDate),
      trackingCodeEnc: encryptPii(o.trackingCode),
      trackingUrlEnc: encryptPii(o.trackingUrl),
      shippingProvider: o.shippingProvider || null,
      shippingNameEnc: encryptPii(o.shippingName),
      shippingAddressEnc: encryptPii(o.shippingAddress),
      shippingPhoneEnc: encryptPii(o.shippingPhone),
      shippingCityEnc: encryptPii(o.shippingCity),
      shippingPostCodeEnc: encryptPii(o.shippingPostCode),
      billingNameEnc: encryptPii(o.billingName),
      billingAddressEnc: encryptPii(o.billingAddress),
      billingPhoneEnc: encryptPii(o.billingPhone),
      billingCityEnc: encryptPii(o.billingCity),
      shippingPhoneHash: blindIndex(o.shippingPhone),
      customerId,
      productId: o.sellerSku ? (skuToProduct.get(o.sellerSku) ?? null) : null,
    });
  }

  const incomeLineRows: {
    id: string;
    orderItemId: string;
    statementNumber: string;
    orderNumber: string | null;
    sellerSku: string | null;
    productName: string | null;
    statementPeriod: string | null;
    transactionDate: Date | null;
    orderCreationDate: Date | null;
    orderStatus: string | null;
    releaseStatus: string | null;
    productPriceRevenue: number;
    buyerShippingCredit: number;
    totalCredits: number;
    totalDeductions: number;
    netAmount: number;
    reconciled: boolean;
    importBatchId: string;
  }[] = [];
  const feeRows: {
    incomeLineId: string;
    label: string;
    category: IncomeLine['fees'][number]['category'];
    amount: number;
    vatAmount: number;
    isRefund: boolean;
    isReversal: boolean;
  }[] = [];

  for (const il of parsed.incomeLines) {
    const incomeLineId = randomUUID();
    incomeLineRows.push({
      id: incomeLineId,
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
      importBatchId: batchId,
    });
    for (const f of il.fees) {
      feeRows.push({
        incomeLineId,
        label: f.label,
        category: f.category,
        amount: f.amount,
        vatAmount: f.vatAmount,
        isRefund: f.isRefund,
        isReversal: f.isReversal,
      });
    }
  }

  try {
    const outcome = await prisma.$transaction(
      async (tx) => {
        // Batch-level idempotency: identical files → recognised, no duplicates.
        const existing = await tx.darazImportBatch.findUnique({
          where: { fingerprint: parsed.fingerprint },
          select: { id: true },
        });
        if (existing) return { batchId: existing.id, created: false };

        await tx.darazImportBatch.create({
          data: {
            id: batchId,
            fingerprint: parsed.fingerprint,
            ordersFileName: parsed.ordersFileName,
            ordersFileHash: parsed.ordersHash,
            incomeFileName: parsed.incomeFileName,
            incomeFileHash: parsed.incomeHash,
            status: 'COMMITTED',
            totalOrderItems: orderItemRows.length,
            totalIncomeLines: incomeLineRows.length,
            distinctOrderItemIds: t.distinctOrderItemIds,
            matchedLines: t.matched,
            unmatchedLines: t.unmatched,
            duplicateLines: t.duplicates,
            unresolvedSkus: t.unresolvedSkus,
            statementCount: t.statementCount,
            totalCredits: t.totalCredits,
            totalDeductions: t.totalDeductions,
            netPayout: t.darazNet,
            reconDiff: t.reconDiff,
            createdById: user?.id ?? null,
            createdBy: user?.name ?? user?.email ?? null,
          },
        });
        await tx.darazCustomer.createMany({ data: customers });
        await tx.darazOrderItem.createMany({ data: orderItemRows, skipDuplicates: true });
        await tx.darazIncomeLine.createMany({ data: incomeLineRows });
        await tx.darazIncomeFee.createMany({ data: feeRows });

        // Post-write reconciliation: persisted net must equal Daraz net exactly.
        const agg = await tx.darazIncomeLine.aggregate({
          where: { importBatchId: batchId },
          _sum: { netAmount: true },
        });
        const persistedNet = round2(agg._sum.netAmount ?? 0);
        if (persistedNet !== round2(t.darazNet)) {
          throw new Error(
            `Persisted net ${persistedNet} != Daraz net ${round2(t.darazNet)} — rolling back.`
          );
        }
        return { batchId, created: true };
      },
      { timeout: 120_000, maxWait: 20_000 }
    );

    if (!outcome.created) {
      return { ok: true, alreadyImported: true, summary: undefined };
    }

    const summary = {
      batchId: outcome.batchId,
      orderItems: orderItemRows.length,
      customers: customers.length,
      incomeLines: incomeLineRows.length,
      fees: feeRows.length,
      distinctOrderItemIds: t.distinctOrderItemIds,
      statementCount: t.statementCount,
      netPayout: round2(t.darazNet),
      reconDiff: t.reconDiff,
    };

    // Audit: counts + totals + batch id ONLY. Never any customer value.
    await logAudit({
      user,
      action: 'CREATE',
      module: 'DarazImport',
      recordId: outcome.batchId,
      newValue: summary,
    });

    return { ok: true, alreadyImported: false, summary };
  } catch (err) {
    // Never surface PII; the message here is derived only from counts/totals.
    const msg = err instanceof Error ? err.message : 'Import failed and was rolled back.';
    return { ok: false, alreadyImported: false, error: msg };
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
