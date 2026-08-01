// Presentation Safe View — Demo Interaction Layer sample data (Phase 5A).
//
// Pure, static, clearly-illustrative constants used ONLY inside active
// Presentation Safe View to make a demo feel populated and functional. There is
// no database, no seed, and no production record here. Every money value is a
// raw number that the active Operations/Finance profile redacts (status/band) at
// render, and every identifier is a placeholder that the redactor anonymises or
// masks — so nothing here is, or resembles, a real customer, order or amount.

import type { ReturnsSourceRow } from '@/lib/presentation/viewmodels/returns';

/** Illustrative returns shown only when the real protected dataset is empty. */
export const DEMO_RETURN_SOURCE: ReturnsSourceRow[] = [
  {
    id: 'demo-return-1',
    returnDate: '2026-01-14',
    productName: 'Wireless Earbuds Pro',
    storeName: 'Ashu Traderz',
    orderNumber: 'DEMO-ORD-0001',
    returnOrderId: 'DEMO-RO-0001',
    trackingNumber: 'DEMO-TRK-0001',
    quantity: 1,
    refundAmount: 2499,
    chargedTo: 'PLATFORM',
    refundStatus: 'COMPLETED',
    inventoryStatus: 'RESTOCKED',
    reason: 'Customer changed their mind',
  },
  {
    id: 'demo-return-2',
    returnDate: '2026-01-18',
    productName: 'Smart LED Strip 5m',
    storeName: 'GrowthifyEdge',
    orderNumber: 'DEMO-ORD-0002',
    returnOrderId: 'DEMO-RO-0002',
    trackingNumber: 'DEMO-TRK-0002',
    quantity: 2,
    refundAmount: 5980,
    chargedTo: 'SELLER',
    refundStatus: 'PENDING',
    inventoryStatus: 'PENDING',
    reason: 'Damaged in transit',
  },
  {
    id: 'demo-return-3',
    returnDate: '2026-01-22',
    productName: 'USB-C Fast Charger',
    storeName: 'Ashu Traderz',
    orderNumber: 'DEMO-ORD-0003',
    returnOrderId: 'DEMO-RO-0003',
    trackingNumber: 'DEMO-TRK-0003',
    quantity: 1,
    refundAmount: 1450,
    chargedTo: 'SELLER',
    refundStatus: 'COMPLETED',
    inventoryStatus: 'DAMAGED',
    reason: 'Wrong item received',
  },
];

/** Illustrative return status timeline for the read-only detail drawer. */
export const DEMO_RETURN_TIMELINE = [
  { label: 'Return requested', done: true },
  { label: 'Approved by store', done: true },
  { label: 'In transit', done: true },
  { label: 'Refund processed', done: false },
];

/** Illustrative stock movement history for the read-only product preview. */
export const DEMO_PRODUCT_MOVEMENTS = [
  { id: 'demo-m1', date: '2026-01-02', type: 'PURCHASE', quantity: 50, note: 'Opening restock' },
  { id: 'demo-m2', date: '2026-01-09', type: 'SALE', quantity: -6, note: 'Daraz orders' },
  { id: 'demo-m3', date: '2026-01-15', type: 'RETURNED', quantity: 1, note: 'Return restocked' },
  { id: 'demo-m4', date: '2026-01-21', type: 'DAMAGED', quantity: -1, note: 'Damaged in handling' },
];

/** Built-in fake filename + staged preview for the demo Daraz import flow. */
export const DEMO_IMPORT_FILENAME = 'daraz-payout-statement-demo.csv';

export const DEMO_IMPORT_STAGES = [
  { key: 'validate', label: 'Validating rows', detail: '128 rows read · 128 valid · 0 errors' },
  { key: 'match', label: 'Matching Daraz SKUs', detail: '124 matched · 4 pending mapping' },
  { key: 'reconcile', label: 'Reconciling payouts', detail: 'Released and Ready-to-Release balanced' },
  { key: 'commit', label: 'Staging income lines', detail: '128 income lines ready to import' },
];

/** Anonymised placeholder values for the demo Record Purchase form. Money stays
 *  masked so no figure is ever shown, even in a demo. */
export const DEMO_PURCHASE_PLACEHOLDER = {
  product: 'Wireless Earbuds Pro',
  store: 'Ashu Traderz',
  supplier: 'Preferred Supplier',
  quantity: '20',
  unitCost: '••••••',
  total: '••••••',
};
