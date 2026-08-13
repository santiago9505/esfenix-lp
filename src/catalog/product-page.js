/**
 * The /catalog/[category]/[slug] view: gallery, characteristics, variant
 * selection, and the category sidebar that lets the visitor keep browsing
 * without going back to the grid. A product page represents one family; its
 * varieties and formats are selected here instead of becoming 70 separate
 * navigation destinations.
 *
 * Two "not found" cases are distinguished, because they need different
 * answers: a product that does not exist at all, and a product that exists but
 * is not listed in the location the visitor selected.
 */

import { AVAILABILITY_NOTE, PRODUCT_AVAILABILITY_NOTE, availabilityNote, emptyState } from './ui/states.js';
import { LOCATIONS, resolveLocation } from './data/locations.js';
import { breadcrumbs } from './ui/breadcrumbs.js';
import { categoryNav, categoryNavTrigger } from './ui/category-nav.js';
import {
  distinctLengths,
  distinctMeasures,
  distinctValues,
  listSentence,
  capitalize,
} from './core/format.js';
import { el, firstUsableImage, productMedia, replaceChildren } from './ui/dom.js';
import { findProductBySlug, getCatalogSourcesForProduct, getRelatedProducts } from './core/repository.js';
import { getCategoryLabel } from './data/categories.js';
import { locationSelect } from './ui/location-select.js';
import { openModal } from './ui/modal.js';
import { productCard } from './ui/product-card.js';
import { productExistsAnywhere } from './core/repository.js';
import { slugify } from './core/slug.js';
import { validateSelection } from './core/quote-store.js';
import { variantForm } from './ui/variant-picker.js';

const MEASURE_LABELS = { stem: 'Stem', bunch: 'Bunch', unit: 'Unit', pack: 'Pack', box: 'Box' };

/**
 * @param {any} ctx
 * @param {{ category: string|null, slug: string|null }} route
 */
export function renderProductView(ctx, route) {
  const product = findProductBySlug(ctx.products, route.slug ?? '');

  if (!product) return notFoundView(ctx, route);

  const varietyParam = new URLSearchParams(window.location.search).get('variety');
  const initialVariety = varietyParam
    ? distinctValues(product.variants, 'variety').find((v) => slugify(v) === varietyParam) ?? null
    : null;

  const related = getRelatedProducts(product, ctx.products, 6);
  let detailView = null;
  const galleryView = gallery(product, (variant) => detailView?.selectVariety(variant?.variety ?? null));
  detailView = details(ctx, product, initialVariety, galleryView.setVariant, galleryView.setVariety);

  return {
    head: el('div', {}, [
      breadcrumbs([
        { label: 'Home', href: '/' },
        { label: 'Catalog', href: ctx.catalogHref(false) },
        { label: getCategoryLabel(product.category), href: `${ctx.catalogHref(false)}&category=${product.category}`.replace('?&', '?') },
        { label: product.name },
      ]),
    ]),

    body: [
      el('div', { class: 'wrap' }, [
        el('div', { class: 'cat-product-toolbar' }, [
          locationSelect({
            locationId: ctx.locationId,
            onRequestChange: (next) => ctx.requestLocationChange(next),
            compact: true,
          }),
          categoryNavTrigger({
            label: 'Browse categories',
            onOpen: () => openCategoryDrawer(ctx, product),
          }),
        ]),

        el('div', { class: 'cat-product-layout' }, [
          el('aside', { class: 'cat-product-side' }, [
            categoryNav({
              tree: ctx.categoryTree(),
              currentProductId: product.id,
              currentCategory: product.category,
              hrefFor: (entry) => ctx.hrefFor(entry),
              catalogHref: ctx.catalogHref(false),
            }),
          ]),

          el('div', { class: 'cat-product-main' }, [
            galleryView.element,
            detailView.element,
          ]),
        ]),

        related.length > 0 ? similarProducts(ctx, related) : null,
      ]),
    ],
  };
}

/**
 * @param {import('./core/repository').LocationProduct} product
 * @param {(variant: import('./core/types').ProductVariant) => void} [onImageSelect]
 * @returns {{
 *   element: HTMLElement,
 *   setVariant: (variant: import('./core/types').ProductVariant|null) => void,
 *   setVariety: (variety: string|null) => void,
 * }}
 */
function gallery(product, onImageSelect) {
  const mainHost = el('div', { class: 'cat-gallery-main' });
  const thumbsHost = el('div', { class: 'cat-gallery-thumbs-host' });
  let activeVariant = null;
  let activeImageKey = null;

  const imageKey = (image) => image?.id ?? image?.src ?? null;

  function variantForImage(image) {
    const key = imageKey(image);
    if (!key) return null;

    return product.variants.find((variant) =>
      (variant.images ?? []).some((candidate) => imageKey(candidate) === key),
    ) ?? null;
  }

  function imagesForVariety(variety) {
    const images = product.variants
      .filter((variant) => variant.variety === variety)
      .flatMap((variant) => variant.images ?? []);
    const seen = new Set();
    return images.filter((image) => {
      const key = imageKey(image);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function render(variant = activeVariant, imageOverride = null) {
    // Once a variant is selected, do not borrow another variant's photo. A
    // missing image for that exact option must remain a placeholder.
    const images = variant ? variant.images ?? [] : product.images ?? [];
    const primary = firstUsableImage(
      imageOverride ? [imageOverride, ...images.filter((image) => imageKey(image) !== imageKey(imageOverride))] : images,
    );

    replaceChildren(mainHost, [
      productMedia(primary, {
        label: product.name,
        className: 'cat-gallery-img',
        width: 960,
        height: 720,
        eager: true,
      }),
      product.isNew ? el('span', { class: 'cat-badge-new', text: 'New' }) : null,
    ]);

    replaceChildren(
      thumbsHost,
      images.length > 1
        ? [
            el(
              'ul',
              { class: 'cat-gallery-thumbs' },
              images.map((image) => {
                const imageVariant = variantForImage(image);
                const key = imageKey(image);
                return el('li', {}, [
                  el('button', {
                    type: 'button',
                    class: 'cat-gallery-thumb-button',
                    'aria-label': imageVariant?.variety
                      ? `View ${imageVariant.variety}`
                      : `View ${product.name} photo`,
                    'aria-pressed': key !== null && key === activeImageKey ? 'true' : 'false',
                    onClick() {
                      activeImageKey = key;
                      if (imageVariant?.variety && onImageSelect) {
                        onImageSelect(imageVariant);
                      } else {
                        render(variant, image);
                      }
                    },
                  }, [
                    productMedia(image, {
                      label: imageVariant?.variety ?? product.name,
                      className: 'cat-gallery-thumb',
                      width: 160,
                      height: 120,
                    }),
                  ]),
                ]);
              }),
            ),
          ]
        : [],
    );
  }

  render();
  return {
    element: el('div', { class: 'cat-gallery' }, [mainHost, thumbsHost]),
    setVariant(variant) {
      activeVariant = variant;
      activeImageKey = null;
      render(variant);
    },
    setVariety(variety) {
      activeVariant = null;
      const image = firstUsableImage(imagesForVariety(variety));
      activeImageKey = imageKey(image);
      render(null, image);
    },
  };
}

/**
 * @param {any} ctx
 * @param {import('./core/repository').LocationProduct} product
 * @param {string|null} initialVariety
 * @param {(variant: import('./core/types').ProductVariant|null) => void} [onVariantChange]
 * @param {(variety: string|null) => void} [onVarietyChange]
 */
function details(ctx, product, initialVariety, onVariantChange, onVarietyChange) {
  const form = variantForm(product, {
    initial: { variety: initialVariety },
    onSelectionChange: ({ variant, variety }) => {
      if (variant) onVariantChange?.(variant);
      else onVarietyChange?.(variety);
    },
  });

  const addButton = el('button', {
    type: 'button',
    class: 'btn btn-primary',
    text: 'Add to quote',
    onClick() {
      const selection = form.read();
      const result = validateSelection(product, selection);
      if (!result.ok) {
        form.showErrors(result.errors);
        return;
      }
      form.showErrors([]);
      ctx.quoteStore.addItem(product, selection);
      ctx.render?.();
      ctx.openQuote();
    },
  });

  return {
    element: el('div', { class: 'cat-product-info' }, [
      el('div', { class: 'cat-product-kicker' }, [
        el('span', { class: 'eyebrow', text: getCategoryLabel(product.category) }),
        product.groupLabel && product.groupLabel !== getCategoryLabel(product.category)
          ? el('span', { class: 'cat-product-family', text: product.groupLabel })
          : null,
      ]),
      el('h1', { class: 'cat-product-title', text: product.name }),

      product.description
        ? el('p', { class: 'cat-product-desc', text: product.description })
        : el('p', {
            class: 'cat-product-desc',
            text: 'Choose the option that fits your order. The image and available formats update as you make your selection.',
          }),

      el('div', { class: 'cat-product-selection-note' }, [
        el('span', { class: 'cat-product-selection-step', text: '1' }),
        el('p', {}, [
          el('strong', { text: 'Build your selection' }),
          ' Start with the variety, then choose the stem length and presentation.',
        ]),
      ]),

      el('div', { class: 'cat-product-form' }, [
        el('div', { class: 'cat-product-form-head' }, [
          el('h2', { text: 'Choose your options' }),
          el('p', { text: 'Only combinations available for this location are shown.' }),
        ]),
        form.element,
      ]),

      el('div', { class: 'cat-product-actions' }, [
        addButton,
        el('button', {
          type: 'button',
          class: 'btn btn-light',
          text: 'Request a quote',
          onClick: () => (ctx.quoteStore.isEmpty() ? ctx.startQuoteWithoutProducts() : ctx.openQuote()),
        }),
      ]),

      el('div', { class: 'cat-product-facts' }, [
        el('div', { class: 'cat-product-facts-head' }, [
          el('span', { class: 'eyebrow', text: 'Product details' }),
          el('span', { class: 'cat-product-facts-rule', 'aria-hidden': 'true' }),
        ]),
        characteristics(product, ctx),
        attachmentLinks(product),
      ]),

      availabilityNote(PRODUCT_AVAILABILITY_NOTE),
    ]),
    selectVariety: form.selectVariety,
  };
}

/**
 * The characteristics table. Only rows the product actually has are rendered —
 * no "—" placeholders for attributes that do not apply.
 *
 * @param {import('./core/repository').LocationProduct} product
 * @param {any} ctx
 */
function characteristics(product, ctx) {
  const rows = [];
  const add = (label, value) => {
    if (value) rows.push(el('dt', { text: label }), el('dd', { text: value }));
  };

  add('Category', getCategoryLabel(product.category));
  if (product.groupLabel && product.groupLabel !== getCategoryLabel(product.category)) {
    add('Group', product.groupLabel);
  }

  const varieties = distinctValues(product.variants, 'variety');
  if (varieties.length > 0) {
    add('Variety', varieties.length > 6 ? `${varieties.length} varieties available` : listSentence(varieties));
  }

  const colors = distinctValues(product.variants, 'color');
  if (colors.length > 0) add('Available colors', listSentence(colors));

  const lengths = distinctLengths(product.variants);
  if (lengths.length > 0) add('Available stem lengths', lengths.map((l) => `${l} cm`).join(' · '));

  const measures = distinctMeasures(product.variants);
  if (measures.length > 0) {
    add('Available as', measures.map((m) => MEASURE_LABELS[m] ?? capitalize(m)).join(' · '));
  }

  // Origin is shown only when it is confirmed in the data, never inferred.
  if (product.origin) add('Origin', product.origin);

  const attributes = new Map();
  for (const variant of product.variants) {
    for (const [key, value] of Object.entries(variant.attributes ?? {})) {
      if (value !== null && value !== undefined && value !== '') attributes.set(key, String(value));
    }
  }
  for (const [key, value] of attributes) add(key, value);

  const sources = getCatalogSourcesForProduct(ctx.allProducts, product.slug);
  const locationLabels = LOCATIONS.filter((location) => sources.includes(location.catalogSource)).map(
    (location) => location.label,
  );
  if (locationLabels.length > 0) add('Locations where available', locationLabels.join(' · '));

  if (rows.length === 0) return null;

  return el('dl', { class: 'cat-specs' }, rows);
}

/**
 * Non-image attachments remain direct download links. Missing URLs are hidden
 * rather than turned into broken links.
 * @param {import('./core/repository').LocationProduct} product
 */
function attachmentLinks(product) {
  const files = (product.files ?? []).filter((file) => !file.isImage && file.url);
  if (files.length === 0) return null;

  return el('div', { class: 'cat-product-files' }, [
    el('span', { class: 'eyebrow', text: 'Product files' }),
    el(
      'ul',
      {},
      files.map((file) =>
        el('li', {}, [
          el('a', {
            class: 'tlink',
            href: file.url,
            target: '_blank',
            rel: 'noopener noreferrer',
            text: file.name || 'Download file',
          }),
        ]),
      ),
    ),
  ]);
}

/**
 * @param {any} ctx
 * @param {import('./core/repository').LocationProduct[]} related
 */
function similarProducts(ctx, related) {
  return el('section', { class: 'cat-similar' }, [
    el('div', { class: 'sec-head' }, [
      el('span', { class: 'eyebrow', text: 'Similar products' }),
      el('h2', { text: 'You may also need' }),
    ]),
    el(
      'div',
      { class: 'cat-grid cat-grid-similar' },
      related.map((product) =>
        productCard({
          product,
          href: ctx.hrefFor(product),
          selectedCount: ctx.selectedCount(product.id),
          onAdd: (target) => ctx.addProduct(target),
        }),
      ),
    ),
    availabilityNote(AVAILABILITY_NOTE),
  ]);
}

/** The mobile presentation of the category sidebar. */
function openCategoryDrawer(ctx, product) {
  const modal = openModal({
    title: 'Browse categories',
    variant: 'sheet',
    content: categoryNav({
      tree: ctx.categoryTree(),
      currentProductId: product?.id ?? null,
      currentCategory: product?.category ?? null,
      hrefFor: (entry) => ctx.hrefFor(entry),
      catalogHref: ctx.catalogHref(false),
    }),
  });
  return modal;
}

/**
 * @param {any} ctx
 * @param {{ category: string|null, slug: string|null }} route
 */
function notFoundView(ctx, route) {
  const existsElsewhere = productExistsAnywhere(ctx.allProducts, route.slug ?? '');
  const location = resolveLocation(ctx.locationId);

  const otherLocations = existsElsewhere
    ? LOCATIONS.filter((entry) => {
        const sources = getCatalogSourcesForProduct(ctx.allProducts, route.slug ?? '');
        return sources.includes(entry.catalogSource) && entry.id !== ctx.locationId;
      })
    : [];

  return {
    head: el('div', {}, [
      breadcrumbs([
        { label: 'Home', href: '/' },
        { label: 'Catalog', href: ctx.catalogHref(false) },
        { label: existsElsewhere ? 'Not in this catalog' : 'Product not found' },
      ]),
    ]),

    body: [
      el('div', { class: 'wrap' }, [
        el('div', { class: 'cat-notfound' }, [
          locationSelect({
            locationId: ctx.locationId,
            onRequestChange: (next) => ctx.requestLocationChange(next),
            compact: true,
          }),

          existsElsewhere
            ? emptyState({
                title: 'Not listed for this location',
                message: `This product is not in the ${location.label} catalog.${
                  otherLocations.length > 0
                    ? ` It is available for ${listSentence(otherLocations.map((l) => l.label))}.`
                    : ''
                }`,
                actions: [
                  ...otherLocations.slice(0, 2).map((entry) => ({
                    label: `Switch to ${entry.label}`,
                    variant: 'primary',
                    onClick: () => ctx.requestLocationChange(entry.id),
                  })),
                  {
                    label: 'Back to catalog',
                    onClick: () => {
                      window.location.href = ctx.catalogHref(false);
                    },
                  },
                ],
              })
            : emptyState({
                title: 'Product not found',
                message: 'We could not find that product. It may have been renamed or removed.',
                actions: [
                  {
                    label: 'Back to catalog',
                    variant: 'primary',
                    onClick: () => {
                      window.location.href = ctx.catalogHref(false);
                    },
                  },
                  {
                    label: 'Request product availability',
                    onClick: () => ctx.startQuoteWithoutProducts(),
                  },
                ],
              }),
        ]),
      ]),
    ],
  };
}
