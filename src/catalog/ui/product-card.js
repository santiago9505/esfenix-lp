/**
 * A product card in the catalog grid.
 *
 * The whole card opens the product page, via one real link whose ::after
 * covers the card — so there is a single tab stop and a single announced link,
 * rather than a div with a click handler. "Add to quote" sits above that layer
 * and stops propagation, so choosing a product never navigates by accident.
 *
 * The card stays deliberately quiet: photograph, category, name and one short
 * spec strip. The full breakdown of varieties, colours, lengths and
 * presentations lives on the product page, where there is room to read it.
 */

import { getCategoryLabel } from '../data/categories.js';
import { resolveInitialVariety } from '../core/product-defaults.js';
import { el, firstUsableImage, productMedia } from './dom.js';

/**
 * Uses the same opening variety as the product page before falling back to the
 * product-family gallery. Only EC Roses currently defines such a preference.
 *
 * @param {import('../core/repository').LocationProduct} product
 */
export function resolveProductCardImage(product) {
  const preferredVariety = resolveInitialVariety(product);
  if (preferredVariety) {
    const preferredImage = firstUsableImage(
      (product.variants ?? [])
        .filter((variant) => variant.variety === preferredVariety)
        .flatMap((variant) => variant.images ?? []),
    );
    if (preferredImage) return preferredImage;
  }

  return firstUsableImage(product.images);
}

/** Fill newly photographed cards without rebuilding buttons, filters or forms. */
export function refreshProductCardImages(container, products) {
  const byId = new Map(products.map(product => [product.id, product]));
  for (const card of container.querySelectorAll('.cat-card[data-product-id]')) {
    const media = card.querySelector('.cat-card-img.ph');
    if (!media) continue;
    const product = byId.get(card.dataset.productId);
    const image = product && resolveProductCardImage(product);
    if (!image) continue;
    media.replaceWith(productMedia(image, {
      label: product.name,
      className: 'cat-card-img',
      width: 480,
      height: 360,
    }));
  }
}

const uniqueValues = (values) => [...new Set(values.filter((value) => value !== null && value !== undefined && value !== ''))];

/**
 * The short spec list under the product name, one compact row per fact:
 * varieties (or options), stem length range and how it is sold. Only facts the
 * data actually has are shown, so a card never carries an empty row. Colours
 * are left to the product page, because Fresa does not list them for every
 * family.
 *
 * @param {import('../core/repository').LocationProduct} product
 * @returns {Array<[string, string]>}
 */
export function productCardSpecs(product) {
  const variants = product.variants ?? [];
  const varieties = uniqueValues(variants.map((variant) => variant.variety));
  const lengths = uniqueValues(variants.map((variant) => variant.lengthCm)).sort((a, b) => a - b);
  const measures = uniqueValues(variants.flatMap((variant) => variant.availableMeasures ?? []));
  const specs = [];

  if (varieties.length > 0) {
    const fewShortNames = varieties.length <= 2 && varieties.join(' · ').length <= 16;
    specs.push(['Varieties', fewShortNames ? varieties.join(' · ') : String(varieties.length)]);
  } else if (variants.length > 1) {
    specs.push(['Options', String(variants.length)]);
  }

  if (lengths.length > 1) specs.push(['Length', `${lengths[0]}–${lengths[lengths.length - 1]} cm`]);
  else if (lengths.length === 1) specs.push(['Length', `${lengths[0]} cm`]);

  const sold = ['stem', 'bunch'].filter((measure) => measures.includes(measure))
    .map((measure) => (measure === 'stem' ? 'Stem' : 'Bunch'));
  if (sold.length > 0) specs.push(['Sold by', sold.join(' · ')]);
  else if (measures.includes('unit')) specs.push(['Sold by', 'Unit']);

  return specs;
}

/**
 * @param {{
 *   product: import('../core/repository').LocationProduct,
 *   href: string,
 *   selectedCount?: number,
 *   onAdd: (product: import('../core/repository').LocationProduct) => void,
 *   eager?: boolean,
 * }} options
 */
export function productCard(options) {
  const { product } = options;
  const primary = resolveProductCardImage(product);
  const selected = options.selectedCount ?? 0;

  // Catalog results are useful content, not decorative reveals. Keeping cards
  // visible from their first DOM paint avoids an animation/observer delay.
  return el('article', {
    class: 'cat-card',
    'data-product-id': product.id,
    'data-category': product.category,
  }, [
    el('div', { class: 'cat-card-media' }, [
      productMedia(primary, {
        label: product.name,
        className: 'cat-card-img',
        width: 480,
        height: 360,
        eager: options.eager,
      }),
      product.isNew ? el('span', { class: 'cat-badge-new', text: 'New' }) : null,
    ]),

    el('div', { class: 'cat-card-body' }, [
      el('span', { class: 'cat-card-cat', text: getCategoryLabel(product.category) }),

      el('h3', { class: 'cat-card-title' }, [
        el('a', { class: 'cat-card-link', href: options.href, text: product.name }),
      ]),

      (() => {
        const specs = productCardSpecs(product);
        return specs.length > 0
          ? el('dl', { class: 'cat-card-specs' }, specs.map(([label, value]) => el('div', {}, [
            el('dt', { text: label }),
            el('dd', { text: value }),
          ])))
          : null;
      })(),

      el('div', { class: 'cat-card-actions' }, [
        el('button', {
          type: 'button',
          class: 'btn btn-light cat-card-add',
          'data-product-id': product.id,
          text: selected > 0 ? `Added · ${selected}` : 'Add to quote',
          'aria-label': `Add to quote: ${product.name}`,
          'data-selected': selected > 0 ? 'true' : null,
          onClick(event) {
            event.preventDefault();
            event.stopPropagation();
            options.onAdd(product);
          },
        }),
        el('a', { class: 'tlink cat-card-details', href: options.href, tabindex: '-1' }, [
          'See options ',
          el('span', { class: 'arr', text: '›' }),
        ]),
      ]),
    ]),
  ]);
}
