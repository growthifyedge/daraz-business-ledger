// App-wide configuration. Change the currency here to match your Daraz market.
// Daraz operates in PK (Rs / PKR), BD (৳ / BDT), NP (Rs / NPR), LK (Rs / LKR).

export const APP_NAME = 'Daraz Business Ledger';
export const APP_TAGLINE = 'Ledger & Inventory System';

export const CURRENCY = {
  symbol: 'Rs', // e.g. 'Rs', '৳', '$'
  code: 'PKR',
  // locale used for number grouping (1,000,000)
  locale: 'en-PK',
};

// The profit split between Yahya and the Owner (must sum to 1).
export const PROFIT_SPLIT = {
  yahya: 0.5,
  owner: 0.5,
};

// Fixed product category for this business.
export const PRODUCT_CATEGORY = 'Lifestyle Gadgets';
