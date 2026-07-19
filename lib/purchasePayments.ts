// Pure classification of a purchase's payment status into cash-flow buckets.
// No Prisma, no I/O — safe to unit-test directly.
//
// PAID                    → money actually reimbursed to Yahya (cash out).
// UNPAID                  → money owed to Yahya (a payable).
// RECONCILIATION_PENDING  → paid in reality but amount/date not yet reconciled:
//                           it is NEITHER owed NOR a settled cash payment, and
//                           must never affect owed/paid totals or net cash.

import type { PaymentStatus } from '@prisma/client';

export type PurchasePaymentClass =
  | 'paidToYahya'
  | 'owedToYahya'
  | 'reconciliationPending';

export function classifyPurchasePayment(status: PaymentStatus): PurchasePaymentClass {
  switch (status) {
    case 'PAID':
      return 'paidToYahya';
    case 'UNPAID':
      return 'owedToYahya';
    case 'RECONCILIATION_PENDING':
      return 'reconciliationPending';
  }
}

export interface PurchasePaymentTotals {
  paidToYahya: number;
  owedToYahya: number;
  reconciliationPending: number;
}

/** Sum purchase totalCosts into the three payment buckets. */
export function summarizePurchasePayments(
  rows: Array<{ paymentStatus: PaymentStatus; totalCost: number }>
): PurchasePaymentTotals {
  const t: PurchasePaymentTotals = {
    paidToYahya: 0,
    owedToYahya: 0,
    reconciliationPending: 0,
  };
  for (const r of rows) t[classifyPurchasePayment(r.paymentStatus)] += r.totalCost;
  return t;
}
