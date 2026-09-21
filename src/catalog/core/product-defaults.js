/**
 * Resolves the variety that should greet the visitor on a product family.
 * Explicit URL choices always win. EC Roses otherwise opens on its familiar
 * pink reference so the catalog card and product page tell the same story.
 *
 * @param {import('./repository').LocationProduct} product
 * @param {string|null} requestedVariety
 */
export function resolveInitialVariety(product, requestedVariety = null) {
  const varieties = new Set(
    (product.variants ?? [])
      .map((variant) => variant.variety)
      .filter(Boolean),
  );
  if (requestedVariety && varieties.has(requestedVariety)) return requestedVariety;

  const isEcRoses = product.slug === 'ec-roses' || product.group === 'ecuadorian-roses';
  if (!isEcRoses) return null;

  return (product.variants ?? []).find((variant) =>
    String(variant.color ?? '').trim().toLocaleLowerCase() === 'pink'
    && variant.variety,
  )?.variety ?? null;
}
