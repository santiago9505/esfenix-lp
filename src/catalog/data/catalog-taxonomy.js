/**
 * Presentation taxonomy for the product catalogue.
 *
 * Fresa remains the source of truth for product data. This module only gives
 * equivalent names a shared identity and supplies the editorial order used by
 * the catalogue UI.
 */

const KNOWN_FAMILIES = [
  {
    aliases: ['ec roses', 'ecuadorian rose', 'ecuadorian roses', 'ecuadorian rose stem'],
    familyKey: 'catalog:ecuadorian-roses',
    group: 'ecuadorian-roses',
    groupLabel: 'Ecuadorian Roses',
    category: 'roses',
    order: 1,
  },
  {
    aliases: ['garden rose', 'garden roses'],
    familyKey: 'catalog:garden-roses',
    group: 'garden-roses',
    groupLabel: 'Garden Roses',
    category: 'roses',
    order: 2,
  },
  {
    aliases: ['dyed rose', 'dyed roses'],
    familyKey: 'catalog:dyed-roses',
    group: 'dyed-roses',
    groupLabel: 'Dyed Roses',
    category: 'roses',
    order: 3,
  },
];

// This follows the visual sequence in the printed catalogue. Products that
// Fresa adds later are deliberately kept and appear after this known order.
const CATALOG_ORDER = [
  'ecuadorian-roses',
  'garden-roses',
  'dyed-roses',
  'preserved-rose-large',
  'preserved-rose-jumbo',
  'preserved-rose',
  'peony',
  'tulip',
  'alstroemerias',
  'amaranthus',
  'mini-callas',
  'anemones',
  'bird-of-paradise',
  'carnation',
  'mini-carnation',
  'campanula',
  'craspedias',
  'chrysanthemum-button',
  'chrysanthemum-cremon',
  'chrysanthemum-cushion',
  'chrysanthemum-daisy',
  'chrysanthemum-spider',
  'delphinium',
  'dianthus',
  'gerpoms',
  'gerbera-large',
  'mini-gerbera',
  'gypsophilia',
  'hydrangeas',
  'hypericum',
  'lily-asiatic',
  'lily-oriental',
  'lisianthus',
  'limonium',
  'ranunculus',
  'scabiosa',
  'snapdragon',
  'solidago',
  'spray-roses',
  'statice',
  'stock',
  'sunflowers',
  'veronica',
  'ammi-visnaga',
  'bells-of-irland',
  'cocculus',
  'dusty-miller',
  'eucalyptus-baby-blue',
  'eucalyptus-silver-dollar',
  'leather-leaf',
  'robellini',
  'ruscus',
  'shiny-pitt-green',
  'pinus',
];

const ORDER_BY_FAMILY = new Map(CATALOG_ORDER.map((family, index) => [family, index + 1]));
const ORDER_ALIASES = new Map([
  ['chrysanthemum-cremom', 'chrysanthemum-cremon'],
  ['chrysanthemum-daysi', 'chrysanthemum-daisy'],
  ['gerpom', 'gerpoms'],
  ['gypsophilia-xcelence', 'gypsophilia'],
  ['gypsophilia-xlence', 'gypsophilia'],
  ['shinny-pitt', 'shiny-pitt-green'],
  ['shiny-pitt', 'shiny-pitt-green'],
]);
const FAMILY_BY_ALIAS = new Map(
  KNOWN_FAMILIES.flatMap((family) => family.aliases.map((alias) => [normalizeLabel(alias), family])),
);

/** @param {unknown} value */
function normalizeLabel(value) {
  return String(value ?? '')
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** @param {unknown} value */
function familySlug(value) {
  return normalizeLabel(value).replace(/\s+/g, '-');
}

/**
 * Resolves only intentional cross-category aliases. Returning null for every
 * other name is important: unknown Fresa products must not be merged merely
 * because they happen to share a label.
 *
 * @param {unknown} value
 * @returns {{ familyKey: string, group: string, groupLabel: string, category: string, order: number }|null}
 */
export function resolveCatalogFamily(value) {
  const family = FAMILY_BY_ALIAS.get(normalizeLabel(value));
  return family ? { ...family } : null;
}

/** @param {unknown} value */
export function catalogOrderForFamily(value) {
  const slug = familySlug(value);
  const directOrder = ORDER_BY_FAMILY.get(slug);
  if (directOrder) return directOrder;

  const aliasedOrder = ORDER_BY_FAMILY.get(ORDER_ALIASES.get(slug));
  if (aliasedOrder) return aliasedOrder;

  const normalized = normalizeLabel(value);
  for (const family of CATALOG_ORDER) {
    const familyLabel = normalizeLabel(family.replace(/-/g, ' '));
    if (normalized.startsWith(`${familyLabel} `)) return ORDER_BY_FAMILY.get(family);
  }

  return Number.MAX_SAFE_INTEGER;
}
