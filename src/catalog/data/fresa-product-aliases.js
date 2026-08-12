/**
 * How each catalog product names itself in the Fresa form.
 *
 * The form's product list is not identical to the product database: it spells
 * some products differently per location ("Chrysanthemum - Daysi" in Houston,
 * "Chrysanthemum - Daisy" in Seattle), folds colours into the option label
 * ("Peony - white"), and splits duplicated source rows into "(linea 1)" and
 * "(linea 2)".
 *
 * Each entry returns candidate option labels in priority order; the first one
 * the form actually offers for that location wins. Returning several candidates
 * is how one rule covers locations that spell the product differently.
 *
 * Products not listed here fall back to `"<name> - <length>cm"` and then
 * `"<name>"`. `npm run check:fresa-map` reports anything that fails to resolve,
 * so a new product cannot silently go unmapped.
 *
 * @typedef {import('../core/types').ProductVariant} ProductVariant
 * @typedef {(variant: ProductVariant) => string[]} AliasRule
 * @type {Record<string, AliasRule>}
 */
export const FRESA_PRODUCT_ALIASES = {
  alstroemeria: () => ['Alstroemerias'],

  'bells-of-irland': () => ['Bells of Irland (molucella)'],

  'chrysanthemum-daisy': () => ['Chrysanthemum - Daisy', 'Chrysanthemum - Daysi'],
  'chrysanthemum-daysi': () => ['Chrysanthemum - Daisy', 'Chrysanthemum - Daysi'],

  'delphinium-light': () => ['Delphinium'],

  gypsophilia: () => [
    "Gypsophilia Xcelence (Baby's breath)",
    "Gypsophilia Xlence (Baby's breath)",
  ],
  'gypsophilia-xcelence-baby-s-breath': () => [
    "Gypsophilia Xcelence (Baby's breath)",
    "Gypsophilia Xlence (Baby's breath)",
  ],

  // The form offers hydrangeas only as the "Premium" line, with the colour in
  // the label. Colour tokens differ per location.
  hydrangeas: (variant) => {
    const color = String(variant.color ?? '').toLowerCase();
    const tokens = {
      white: ['white'],
      green: ['green'],
      blue: ['blue'],
      pink: ['pink'],
      'purple lavender': ['purple/lavender', 'purple'],
    }[color] ?? [color];
    return tokens.map((token) => `Hydrangeas Premium - ${token}`);
  },
  'hydrangeas-premium': (variant) => {
    const color = String(variant.color ?? '').toLowerCase();
    return [`Hydrangeas Premium - ${color}`];
  },
  'hydrangeas-premium-purple-lavender': () => [
    'Hydrangeas Premium - purple/lavender',
    'Hydrangeas Premium - purple',
  ],
  'hydrangeas-purple-lavender': () => [
    'Hydrangeas Premium - purple/lavender',
    'Hydrangeas Premium - purple',
  ],

  // Sold as two bunch sizes in Houston, as one product in Seattle.
  'leather-leaf': (variant) => {
    const stems = variant.attributes?.stemsPerBunch;
    if (stems === 20) return ['Leather leaf - (20 stems)', 'Leather Leaf'];
    return ['Leather leaf (10 stems)', 'Leather Leaf'];
  },
  'leather-leaf-10-stems': () => ['Leather leaf (10 stems)', 'Leather Leaf'],
  'leather-leaf-20-stems-costa-rica': () => ['Leather leaf - (20 stems)', 'Leather Leaf'],

  // The Houston list carries the duplicated source rows as two lines. The
  // Canadian-grown variant is the second one.
  lisianthus: (variant) =>
    variant.attributes?.origin === 'Canada'
      ? ['Lisianthus (linea 2)', 'Lisianthus']
      : ['Lisianthus (linea 1)', 'Lisianthus'],
  'lisianthus-canada': () => ['Lisianthus (linea 2)', 'Lisianthus'],

  ranunculos: () => ['Ranunculus'],

  'robellini-costa-rica': () => ['Robellini'],

  snapdragon: (variant) =>
    variant.attributes?.origin === 'Canada'
      ? ['Snapdragon (linea 2)', 'Snapdragon']
      : ['Snapdragon (linea 1)', 'Snapdragon'],
  'snapdragon-canada': () => ['Snapdragon (linea 2)', 'Snapdragon'],

  peony: (variant) =>
    String(variant.color ?? '').toLowerCase() === 'white'
      ? ['Peony - white']
      : ['Peony - other colors'],

  tulip: (variant) =>
    String(variant.color ?? '').toLowerCase() === 'white'
      ? ['Tulip - white']
      : ['Tulip - other colors'],

  'preserved-rose': (variant) => [`Preserved rose ${variant.variety ?? ''}`.trim()],

  'shiny-pitt-green': () => ['Shiny Pitt Green (Brillantina)', 'Shinny Pitt'],
  'shinny-pitt': () => ['Shiny Pitt Green (Brillantina)', 'Shinny Pitt'],

  solidago: () => ['Solidago golden glory', 'Solidago'],
  'solidago-golden-glory': () => ['Solidago golden glory', 'Solidago'],
};
