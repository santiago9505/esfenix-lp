/**
 * Category configuration.
 *
 * A product's category comes from the normalized Fresa catalog
 * (`product.category`). This
 * file only supplies presentation: order, label, copy and the image used when a
 * category has no products yet.
 *
 * Nothing in the UI decides a product's category with an inline condition.
 */

/** @typedef {import('../core/types').ProductCategory} ProductCategory */

/**
 * @type {Array<{
 *   id: ProductCategory,
 *   label: string,
 *   description: string,
 *   image: { src: string, alt: string },
 *   emptyMessage: string,
 *   emptyCta: string | null,
 * }>}
 */
export const CATEGORIES = [
  {
    id: 'roses',
    label: 'Roses',
    description: 'Varieties in different lengths and tones, with controlled freshness.',
    image: { src: '/assets/images/products/rosa.webp', alt: 'Roses' },
    emptyMessage: 'No roses are listed for this location yet.',
    emptyCta: null,
  },
  {
    id: 'other-flowers',
    label: 'Other Flowers',
    description: 'A wide selection of seasonal flowers for every occasion.',
    image: { src: '/assets/images/girasoles.webp', alt: 'Seasonal flowers' },
    emptyMessage: 'No other flowers are listed for this location yet.',
    emptyCta: null,
  },
  {
    id: 'foliage',
    label: 'Greenery',
    description: 'Greens and decorative foliage to add volume and texture.',
    image: { src: '/assets/images/products/follaje.webp', alt: 'Greenery' },
    emptyMessage: 'No greenery is listed for this location yet.',
    emptyCta: null,
  },
  {
    id: 'supplies',
    label: 'Supplies',
    description: 'Floral materials and accessories for your studio.',
    image: { src: '/assets/images/products/supplies.webp', alt: 'Floral supplies' },
    // Supplies are not part of the product export yet. Rather than invent a
    // supplies list, the category presents itself and offers a way to ask for
    // the current one.
    emptyMessage:
      'Our supplies catalog is not listed online yet. Tell us what you need and our team will send you the current selection.',
    emptyCta: 'Request current supplies catalog',
  },
];

export const CATEGORY_ORDER = CATEGORIES.map((category) => category.id);

/** @param {string|null|undefined} id */
export function getCategory(id) {
  return CATEGORIES.find((category) => category.id === id) ?? null;
}

/** @param {string|null|undefined} id */
export function getCategoryLabel(id) {
  return getCategory(id)?.label ?? '';
}

/**
 * Resolves a category value received from an external catalog to the current
 * presentation taxonomy. Matching uses the configured id or label; an
 * unknown value stays unknown so the caller can choose a safe fallback.
 * @param {unknown} value
 * @returns {ProductCategory|null}
 */
export function resolveCategoryId(value) {
  const normalized = String(value ?? '')
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!normalized) return null;

  return (
    CATEGORIES.find((category) => {
      const id = category.id.replace(/-/g, ' ');
      const label = category.label.toLocaleLowerCase();
      return normalized === id || normalized === label;
    })?.id ?? null
  );
}

/** Sorts by the configured order, so the UI never relies on data ordering. */
export function compareCategories(a, b) {
  return CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b);
}
