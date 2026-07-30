// Presentation Safe View — Products & Inventory view-model (Phase 3A).
//
// Pure mapping from a (reduced) Product row to a redacted, display-ready DTO.
// Purchase cost, selling price and stock value become a safe band/status; notes
// are omitted from the query. Product name, SKU, category, stock quantities and
// operational status are preserved — those are safe to demonstrate. No DB,
// schema, calculation or business logic is touched.

import { redactMoney } from '../redact';
import type { PresentationContext } from '../core';

/**
 * Input shape. The active query omits `notes`; it is optional here so the mapper
 * is also testable for the inactive identity contract.
 */
export interface ProductsSourceRow {
  id: string;
  name: string;
  sku: string;
  category: string;
  purchaseCost: number;
  sellingPrice: number;
  currentStock: number;
  minStockLevel: number;
  damagedStock: number;
  lostStock: number;
  returnedStock: number;
  active: boolean;
  storeNames: string[];
  /** Only present in inactive identity tests; never fetched in the active query. */
  notes?: string | null;
}

export interface ProductsPresentationRow {
  id: string;
  name: string;
  sku: string;
  category: string;
  storeNames: string[];
  currentStock: number;
  minStockLevel: number;
  damagedStock: number;
  lostStock: number;
  returnedStock: number;
  active: boolean;
  lowStock: boolean;
  purchaseCost: string;
  sellingPrice: string;
  stockValue: string;
}

export function toProductsPresentationRows(
  rows: ProductsSourceRow[],
  ctx: PresentationContext
): ProductsPresentationRow[] {
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    category: p.category,
    storeNames: p.storeNames,
    currentStock: p.currentStock,
    minStockLevel: p.minStockLevel,
    damagedStock: p.damagedStock,
    lostStock: p.lostStock,
    returnedStock: p.returnedStock,
    active: p.active,
    lowStock: p.currentStock <= p.minStockLevel,
    // Financials: never exact — status (Operations) or band (Finance).
    purchaseCost: redactMoney(p.purchaseCost, ctx),
    sellingPrice: redactMoney(p.sellingPrice, ctx),
    stockValue: redactMoney(p.currentStock * p.purchaseCost, ctx),
  }));
}
