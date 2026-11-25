/**
 * Supplies showcase, laid out like the printed Esfenix catalog (pages 10–11):
 * groups of photos sitting on a grey band that names what they show, for
 * example "FLORAL FOAM | TAPE | ROSE THORN STRIPPER | SCISSORS".
 *
 * Supplies change often and are not always in stock, so they are not added to
 * the quote list. Visitors mark the ones they are interested in and ask for
 * more information; the names travel with the quote request (see
 * `suppliesInterest` in quote-payload.js and fresa-form-submission.js).
 *
 * Which locations show supplies is decided in data/locations.js
 * (`offersSupplies`). To change the showcase, edit SUPPLY_ITEMS and
 * SUPPLY_PAGES; photos live in /assets/images/supplies/.
 */

/**
 * Every supply a visitor can ask about, one per photo, in catalog order.
 * `label` is what Fresa receives. Where the catalog names two photos together
 * (FLOWER BOXES, STUFFED ANIMALS) each photo is its own supply, so choosing
 * one never marks the other.
 */
export const SUPPLY_ITEMS = [
  { id: 'floral-foam', label: 'Floral foam' },
  { id: 'tape', label: 'Tape' },
  { id: 'rose-thorn-stripper', label: 'Rose thorn stripper' },
  { id: 'scissors', label: 'Scissors' },
  { id: 'card-holder', label: 'Card holder' },
  { id: 'clear-tape', label: 'Clear tape' },
  { id: 'cards', label: 'Cards' },
  { id: 'round-flower-box', label: 'Round flower box' },
  { id: 'purse-flower-box', label: 'Purse flower box' },
  { id: 'crowns', label: 'Crowns' },
  { id: 'wrapping-paper', label: 'Wrapping paper' },
  { id: 'ribbons', label: 'Ribbons' },
  { id: 'teddy-bears', label: 'Teddy bears' },
  { id: 'cow-plush', label: 'Cow plush' },
  { id: 'floral-mesh', label: 'Floral mesh' },
  { id: 'needle', label: 'Needle' },
  { id: 'pearl-bow', label: 'Pearl bow' },
  { id: 'stem-tubes', label: 'Stem tubes' },
  { id: 'flower-butterflies', label: 'Flower butterflies' },
  { id: 'hairpin', label: 'Hairpin' },
  { id: 'cake-toppers', label: 'Cake toppers' },
];

const IMAGE_DIR = '/assets/images/supplies';

/**
 * One photo tile. `span` counts sixths of the group width, so three tiles of
 * span 2 fill a row and two tiles of span 1 share one column, as the catalog
 * does with the thorn stripper and the scissors. `position` is the CSS
 * object-position used when the tile crops the photo.
 */
function tile(item, file, span = 2, position = '50% 50%') {
  return { item, src: `${IMAGE_DIR}/${file}.webp`, span, position };
}

/**
 * A caption name as printed in the catalog and the supplies (photos) it
 * covers. Tapping the name chooses or clears all of them together.
 * @param {string} label
 * @param {string[]} items
 */
function name(label, items) {
  return { label, items };
}

/**
 * The two catalog pages, each a column of groups. On wide screens they sit
 * side by side like the printed spread; on narrow screens they stack.
 * `names` is the grey band; `tiles` are the photos, one supply each.
 */
export const SUPPLY_PAGES = [
  [
    {
      id: 'mechanics',
      names: [
        name('Floral foam', ['floral-foam']),
        name('Tape', ['tape']),
        name('Rose thorn stripper', ['rose-thorn-stripper']),
        name('Scissors', ['scissors']),
      ],
      tiles: [
        tile('floral-foam', 'floral-foam'),
        tile('tape', 'tape'),
        tile('rose-thorn-stripper', 'rose-thorn-stripper', 1, '38% 50%'),
        tile('scissors', 'scissors', 1),
      ],
    },
    {
      id: 'cards',
      names: [name('Card holder', ['card-holder']), name('Clear tape', ['clear-tape']), name('Cards', ['cards'])],
      tiles: [
        tile('card-holder', 'card-holder'),
        tile('clear-tape', 'clear-tape'),
        tile('cards', 'cards'),
      ],
    },
    {
      id: 'boxes',
      names: [name('Flower boxes', ['round-flower-box', 'purse-flower-box']), name('Crowns', ['crowns'])],
      tiles: [
        tile('round-flower-box', 'flower-box-round', 2, '50% 40%'),
        tile('purse-flower-box', 'flower-box-purse'),
        tile('crowns', 'crowns'),
      ],
    },
  ],
  [
    {
      id: 'wrapping',
      names: [name('Wrapping paper', ['wrapping-paper']), name('Ribbons', ['ribbons'])],
      tiles: [
        tile('wrapping-paper', 'wrapping-paper', 3, '50% 55%'),
        tile('ribbons', 'ribbons', 3),
      ],
    },
    {
      id: 'gifts',
      names: [name('Stuffed animals', ['teddy-bears', 'cow-plush']), name('Floral mesh', ['floral-mesh'])],
      tiles: [
        tile('teddy-bears', 'stuffed-animals-bears'),
        tile('cow-plush', 'stuffed-animals-cow'),
        tile('floral-mesh', 'floral-mesh'),
      ],
    },
    {
      id: 'details',
      names: [name('Needle', ['needle']), name('Pearl bow', ['pearl-bow']), name('Stem tubes', ['stem-tubes'])],
      tiles: [
        tile('needle', 'needle'),
        tile('pearl-bow', 'pearl-bow'),
        tile('stem-tubes', 'stem-tubes'),
      ],
    },
    {
      id: 'toppers',
      names: [
        name('Flower butterflies', ['flower-butterflies']),
        name('Hairpin', ['hairpin']),
        name('Cake toppers', ['cake-toppers']),
      ],
      tiles: [
        tile('flower-butterflies', 'flower-butterflies'),
        tile('hairpin', 'hairpin'),
        tile('cake-toppers', 'cake-toppers'),
      ],
    },
  ],
];

const ITEM_BY_ID = new Map(SUPPLY_ITEMS.map((item) => [item.id, item]));

/** @param {string} id */
export function getSupplyItem(id) {
  return ITEM_BY_ID.get(id) ?? null;
}

/** Ids saved before each photo became its own supply. */
const LEGACY_IDS = {
  'flower-boxes': ['round-flower-box', 'purse-flower-box'],
  'stuffed-animals': ['teddy-bears', 'cow-plush'],
};

/**
 * Keeps only known ids, once each, in catalog order.
 * @param {unknown} ids
 * @returns {string[]}
 */
export function normalizeSupplyIds(ids) {
  const wanted = new Set((Array.isArray(ids) ? ids.map(String) : []).flatMap((id) => LEGACY_IDS[id] ?? [id]));
  return SUPPLY_ITEMS.filter((item) => wanted.has(item.id)).map((item) => item.id);
}

/**
 * The English labels Fresa receives, in catalog order.
 * @param {unknown} ids
 * @returns {string[]}
 */
export function supplyLabels(ids) {
  return normalizeSupplyIds(ids).map((id) => ITEM_BY_ID.get(id).label);
}
