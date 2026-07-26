// Pure tests for the Purchase → Daraz SKU auto-mapping decision logic. No DB.
// These encode the workflow rules so the atomic server actions can rely on them:
//   • create new product + map        • existing product + map
//   • plain restock (no SKU) maps nothing
//   • same SKU in two stores = two independent mappings
//   • duplicate mapping (SKU already on another product) is rejected, not overwritten
// The server actions (savePurchase / saveNewProductPurchase) apply exactly what
// these functions decide, inside one transaction.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeSellerSku,
  skuMappingKey,
  shouldMapDaraz,
  decideSkuMapping,
  duplicateMappingMessage,
} from '../lib/daraz/mapping';
import { normalizeSellerSku as normalizeFromFees } from '../lib/daraz/fees';

test('normalization: the mapping normalizer IS the shared Daraz/COGS one (same trim)', () => {
  assert.equal(normalizeSellerSku, normalizeFromFees); // exact same helper, not a copy
  assert.equal(normalizeSellerSku('  812954-Black  '), '812954-Black');
  assert.equal(normalizeSellerSku('SKU-1'), 'SKU-1'); // case/punctuation preserved
  assert.equal(normalizeSellerSku(null), '');
  assert.equal(normalizeSellerSku(undefined), '');
});

test('mapping key normalizes the SKU and is store-scoped', () => {
  assert.equal(skuMappingKey('ashu', '  SKU-1 '), skuMappingKey('ashu', 'SKU-1'));
  assert.notEqual(skuMappingKey('ashu', 'SKU-1'), skuMappingKey('ge', 'SKU-1'));
});

test('new product atomic flow: brand-new (store, sku) → create the mapping', () => {
  assert.equal(shouldMapDaraz('ge', 'NEW-SKU'), true);
  const decision = decideSkuMapping(null, 'p-new'); // nothing mapped yet
  assert.deepEqual(decision, { action: 'create' });
});

test('existing product + SKU flow: first map creates; re-entry with same product is a no-op', () => {
  assert.equal(shouldMapDaraz('ashu', 'SKU-A'), true);
  // First time: no mapping exists → create for the selected existing product.
  assert.deepEqual(decideSkuMapping(null, 'p-existing'), { action: 'create' });
  // Saving the same purchase again (same SKU → same product) must not error or
  // duplicate — it is idempotent.
  assert.deepEqual(decideSkuMapping({ productId: 'p-existing' }, 'p-existing'), { action: 'noop' });
});

test('restock without a Daraz SKU maps nothing (behaves exactly as today)', () => {
  assert.equal(shouldMapDaraz('ashu', ''), false); // store but no SKU
  assert.equal(shouldMapDaraz('ashu', '   '), false); // whitespace-only SKU
  assert.equal(shouldMapDaraz('', 'SKU-A'), false); // SKU but no store
  assert.equal(shouldMapDaraz(null, null), false); // neither
});

test('same physical product may carry a different Seller SKU in each store', () => {
  // One ledger product p-a, two stores, two different SKUs — both create,
  // independently, because identity is (storeId, sellerSku).
  assert.deepEqual(decideSkuMapping(null, 'p-a'), { action: 'create' }); // ashu / SKU-ASHU
  assert.deepEqual(decideSkuMapping(null, 'p-a'), { action: 'create' }); // ge / SKU-GE
  assert.notEqual(skuMappingKey('ashu', 'SKU-ASHU'), skuMappingKey('ge', 'SKU-GE'));
  // The SAME SKU string in both stores is still two independent mappings.
  assert.notEqual(skuMappingKey('ashu', 'SHARED'), skuMappingKey('ge', 'SHARED'));
});

test('duplicate mapping rejection: a SKU already on another product is a conflict, never overwritten', () => {
  const decision = decideSkuMapping({ productId: 'p-other' }, 'p-new');
  assert.deepEqual(decision, { action: 'conflict', existingProductId: 'p-other' });
  // The rejection message names the SKU and the store, and never implies an overwrite.
  const msg = duplicateMappingMessage('  DUP-1  ', 'GrowthifyEdge');
  assert.match(msg, /DUP-1/);
  assert.match(msg, /GrowthifyEdge/);
  assert.match(msg, /already mapped to a different product/i);
});

test('conflict only when the product differs — same product is never a conflict', () => {
  assert.equal(decideSkuMapping({ productId: 'p-a' }, 'p-a').action, 'noop');
  assert.equal(decideSkuMapping({ productId: 'p-a' }, 'p-b').action, 'conflict');
});
