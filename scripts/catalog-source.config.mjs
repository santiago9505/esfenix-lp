/**
 * Build-time configuration for `npm run build:catalog-data`.
 *
 * Everything here describes how the accounting exports in `data/sources/` map
 * onto the catalog's product model. Editing this file and re-running the build
 * is the supported way to change how source rows are interpreted.
 *
 * Prices are never configured here because they are never read: see
 * `SOURCE_COLUMNS` below, which is a strict allow-list.
 */

/**
 * The only columns read out of each workbook. Every monetary column in the
 * source files (stem_price, bunch_price, unit_price, ...) is absent from this
 * list and is therefore dropped before any row reaches the transform.
 */
export const SOURCE_COLUMNS = [
  'fully_qualified_name',
  'category',
  'product_family',
  'type_product',
  'color',
  'variety',
  'location',
  'size_cm',
  'sales_unit',
  'active',
];

/**
 * Column names that must never appear in the generated output. The build fails
 * if any of these leak through, so a future change to SOURCE_COLUMNS cannot
 * silently publish pricing.
 */
export const FORBIDDEN_COLUMNS = [
  'stem_price',
  'bunch_price',
  'unit_price',
  'price',
  'total',
  'subtotal',
  'currency',
  'discount',
  'qty_on_hand',
  'income_account_id',
  'income_account_name',
  'expense_account_id',
  'expense_account_name',
  'asset_account_id',
  'asset_account_name',
];

/**
 * Workbook -> catalog source id. A catalog source is a product list, not a
 * sales location: `the-woodlands` and `other` are served from `houston` and
 * that mapping lives in `src/catalog/data/locations.js`, not here.
 */
export const SOURCE_FILES = [
  { file: 'data/sources/houston.xlsx', catalogSource: 'houston', expectLocation: 'Houston' },
  { file: 'data/sources/seattle.xlsx', catalogSource: 'seattle', expectLocation: 'Seattle' },
  { file: 'data/sources/dmv.xlsx', catalogSource: 'dmv', expectLocation: 'DMV' },
];

/**
 * `type_product` -> top-level catalog category.
 * Categories are assigned from the source data, never inferred in components.
 */
export const TYPE_PRODUCT_TO_CATEGORY = {
  Roses: 'roses',
  'Other Flowers': 'other-flowers',
  Greenery: 'foliage',
  Supplies: 'supplies',
};

/**
 * `sales_unit` -> MeasureType. Only the measures actually present in the source
 * are emitted; `box`, `unit` and `pack` exist in the model but have no rows yet.
 */
export const SALES_UNIT_TO_MEASURE = {
  Stem: 'stem',
  Bunch: 'bunch',
  Box: 'box',
  Unit: 'unit',
  Pack: 'pack',
};

/**
 * Reconciles `product_family` values that refer to the same product under
 * different spellings across workbooks, so one product does not become two
 * cards. `attributes` is merged onto every variant built from that family,
 * which is how pack sizes baked into the family name are preserved.
 *
 * Keys are matched case-insensitively against the raw `product_family`.
 */
export const FAMILY_ALIASES = {
  // Same product, spelled two ways across the Houston and Seattle exports.
  ranunculos: { name: 'Ranunculus' },
  'chrysanthemum - daysi': { name: 'Chrysanthemum - Daisy' },
  'shinny pitt': { name: 'Shiny Pitt Green' },
  'shinny pitt green - brillantina': { name: 'Shiny Pitt Green' },
  // One product sold in two bunch sizes; the count moves into a variant
  // attribute instead of splitting the product in two.
  'leather leaf (10 stems)': { name: 'Leather Leaf', attributes: { stemsPerBunch: 10 } },
  'leather leaf (20 stems)': { name: 'Leather Leaf', attributes: { stemsPerBunch: 20 } },
};

/**
 * Some rows differ only inside `fully_qualified_name`: the accounting export
 * carries the distinction in the item name rather than in a structured column.
 * Without these rules those rows collapse into one variant and a real catalog
 * distinction disappears — Premium vs regular hydrangeas, Large vs Jumbo
 * preserved roses, Canadian-grown stock.
 *
 * Each rule only ever copies a token that is literally present in the source
 * name. Rules are applied in order and their results are merged; `family`
 * narrows a rule to one product, and is optional.
 *
 * The build reports any remaining collision, so a new qualifier appearing in a
 * future export shows up as `duplicateVariants` instead of being lost.
 */
export const VARIANT_QUALIFIERS = [
  // Hydrangeas deliberately have no qualifier. The export carries each colour
  // twice — "Hydrangeas Premium - blue" and "Hydrangeas  blue" — but both
  // regular price lists and the Fresa quote form offer only the Premium line,
  // so the pairs are the same product and are meant to collapse. The build
  // reports them under `duplicateVariants`.
  {
    family: 'Preserved rose',
    match: /^preserved\s+rose\s+(large|jumbo)\b/i,
    variety: (m) => m[1][0].toUpperCase() + m[1].slice(1).toLowerCase(),
  },
  {
    match: /\(\s*canada\s*\)/i,
    attributes: () => ({ origin: 'Canada' }),
  },
];

/**
 * Product images confirmed against the photography Esfenix delivered in
 * `public/assets/images/`. A product that is not listed here renders the
 * site's neutral `.ph` placeholder and is reported by the build, so missing
 * photography stays visible instead of being filled with a generic flower.
 */
export const PRODUCT_IMAGES = {
  'ecuadorian-roses': { src: '/assets/images/products/rosa.webp', alt: 'Ecuadorian roses' },
  'dyed-roses': { src: '/assets/images/products/died-roses.webp', alt: 'Dyed roses' },
  alstroemeria: { src: '/assets/images/products/astro.webp', alt: 'Alstroemeria blooms' },
  amaranthus: { src: '/assets/images/products/amarantus.webp', alt: 'Amaranthus stems' },
  anemones: { src: '/assets/images/products/anemones.webp', alt: 'Anemones' },
  'bird-of-paradise': { src: '/assets/images/products/bird-paradise.webp', alt: 'Bird of paradise' },
  'mini-callas': { src: '/assets/images/products/callas.webp', alt: 'Mini callas' },
  campanula: { src: '/assets/images/products/campanula.webp', alt: 'Campanula' },
  carnation: { src: '/assets/images/products/carnations.webp', alt: 'Carnations' },
  craspedias: { src: '/assets/images/products/craspedia.webp', alt: 'Craspedia' },
  sunflowers: { src: '/assets/images/girasoles.webp', alt: 'Sunflowers' },
};
