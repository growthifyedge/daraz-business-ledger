// Presentation Safe View — Stores view-model (Phase 3C).
//
// Pure mapping from a (reduced) Store row to a display-ready DTO for the
// read-only presentation view. The store display name and active status are
// preserved (safe to demonstrate); the confidential notes field is omitted from
// the query entirely, and the linked-product count is a safe operational number.
// The Store row carries no monetary figures. No DB, schema, calculation or
// business logic is touched.
//
// Contract: the DTO never carries notes; it is only built in the active branch.

/**
 * Input shape. The active query omits `notes`; it is optional here so the
 * "never carries notes" contract is directly testable.
 */
export interface StoresSourceRow {
  id: string;
  name: string;
  active: boolean;
  productCount: number;
  /** Only present in leak tests; never fetched in the active query. */
  notes?: string | null;
}

export interface StoresPresentationRow {
  id: string;
  name: string;
  active: boolean;
  productCount: number;
}

export function toStoresPresentationRows(rows: StoresSourceRow[]): StoresPresentationRow[] {
  // Notes are never carried into the DTO. Name, active status and product count
  // are safe operational context and pass through unchanged.
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    active: s.active,
    productCount: s.productCount,
  }));
}
