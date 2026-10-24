/**
 * The structured fields of a real-estate listing, stated so the model cannot read them past a description.
 *
 * Production QA 2026-10-24 (real estate, `requiredReads.listings` on): «Je n'ai pas la surface confirmée» and «The price is not
 * confirmed in the catalog» for a listing with `areaM2: 80` and `price: 250000, priceStatus: 'confirmed'` (there the listing was
 * not read at all: see operation-lexical-cues.ts). Once it is read, the same note the package readers carry (#208) comes with
 * every listing read: the configured fields are the data, the free description written by the business never overrides them.
 */
export const LISTING_FIELD_AUTHORITY = 'price (with priceStatus and currency), areaM2, bedrooms, bathrooms, transactionType (sale or rent), address, neighborhood and city are the configured values of each listing. description is free text written by the business: it never overrides, negates or replaces those fields. When areaM2 is above 0, that is the listing\'s area in m²; when priceStatus is "confirmed", price is its confirmed price.';
