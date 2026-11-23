/**
 * Families whose varieties come in several colours that Fresa does not list as
 * separate choices. Their product page shows a small colour spectrum under the
 * varieties and asks the buyer to name the colour in the quote notes.
 *
 * Add a family slug here only when Esfenix confirms it comes in several
 * colours. Preserved Roses are the first confirmed family.
 */
export const COLORS_ON_REQUEST = new Set(['preserved-roses']);

/**
 * @param {{ slug?: string, group?: string, variants?: Array<{ color?: string|null }> }|null|undefined} product
 */
export function offersColorsOnRequest(product) {
  if (!product) return false;
  const listed = [product.slug, product.group].some((slug) => COLORS_ON_REQUEST.has(slug));
  if (!listed) return false;
  // Once Fresa lists the colours, the normal colour choice takes over.
  return !(product.variants ?? []).some((variant) => variant.color);
}
