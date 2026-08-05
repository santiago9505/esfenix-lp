/**
 * Editorial layer on top of the generated product data.
 *
 * `products.generated.json` is rebuilt from the source workbooks and must not
 * be hand-edited. Anything an editor decides — which products are New, product
 * copy, confirmed origin, extra photography, curated related products — lives
 * here and is merged on top at load time.
 *
 * Keys are product ids (the slug of the product family, e.g. `ecuadorian-roses`).
 * Every field is optional; omit what you do not want to change.
 *
 * Example:
 *
 *   'ecuadorian-roses': {
 *     isNew: true,
 *     createdAt: '2026-07-01',
 *     description: 'Grown at altitude in Ecuador…',
 *     origin: 'Ecuador',
 *     images: [{ id: 'ec-2', src: '/assets/images/products/rosa-2.webp', alt: '…' }],
 *     relatedProductIds: ['garden-roses', 'spray-roses'],
 *   },
 *
 * `isNew` is deliberately data, not something the interface computes from a
 * date: the badge appears only when this file (or the source data) says so.
 *
 * @typedef {import('../core/types').Product} Product
 * @type {Record<string, Partial<Product>>}
 */
export const PRODUCT_OVERRIDES = {
  // No editorial overrides have been supplied yet. The source workbooks carry
  // no "new product" flag and no product descriptions, so every product
  // currently renders with isNew = false and no description.
};

/**
 * Products to feature first inside a category, by id. Anything not listed keeps
 * its data order (alphabetical by name).
 * @type {Record<string, string[]>}
 */
export const CATEGORY_FEATURED = {
  roses: ['ecuadorian-roses', 'garden-roses', 'dyed-roses'],
};
