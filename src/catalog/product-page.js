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
import { resolveInitialVariety } from './core/product-defaults.js';
import { productExistsAnywhere } from './core/repository.js';
import { slugify } from './core/slug.js';
import { validateSelection } from './core/quote-store.js';
import { variantForm } from './ui/variant-picker.js';

const MEASURE_LABELS = { stem: 'Stem', bunch: 'Bunch', unit: 'Unit', pack: 'Pack', box: 'Box' };

/**
 * An explicitly selected variety must win even when another family image is
 * marked as primary. The family gallery is only the fallback.
 *
 * @param {Array<{ src?: string|null, isPrimary?: boolean }>} images
 * @param {{ src?: string|null, isPrimary?: boolean }|null} imageOverride
 */
export function resolveGalleryPrimaryImage(images, imageOverride = null) {
  return firstUsableImage(imageOverride ? [imageOverride] : [])
    ?? firstUsableImage(images);
}

export { resolveInitialVariety } from './core/product-defaults.js';

/**
 * @param {any} ctx
 * @param {{ category: string|null, slug: string|null }} route
 */
export function renderProductView(ctx, route) {
  const product = findProductBySlug(ctx.products, route.slug ?? '');

  if (!product) return notFoundView(ctx, route);

  const varietyParam = new URLSearchParams(window.location.search).get('variety');
  const requestedVariety = varietyParam
    ? distinctValues(product.variants, 'variety').find((v) => slugify(v) === varietyParam) ?? null
    : null;
  const initialVariety = resolveInitialVariety(product, requestedVariety);

  const related = getRelatedProducts(product, ctx.products, 6);
  let detailView = null;
  const galleryView = gallery(product, {
    onVariantSelect: (variant) => detailView?.selectVariant(variant),
    onVarietySelect: (variety) => detailView?.selectVariety(variety),
  });
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
            el('div', { class: 'cat-product-visual' }, [
              galleryView.element,
              detailView.varietyElement
                ? el('section', {
                    class: 'cat-product-variety-panel',
                    'aria-label': 'Choose a variety',
                  }, [detailView.varietyElement])
                : null,
            ]),
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
 * @param {{
 *   onVariantSelect?: (variant: import('./core/types').ProductVariant) => void,
 *   onVarietySelect?: (variety: string) => void,
 * }} [options]
 * @returns {{
 *   element: HTMLElement,
 *   setVariant: (variant: import('./core/types').ProductVariant|null) => void,
 *   setVariety: (variety: string|null) => void,
 * }}
 */
function gallery(product, options = {}) {
  const mainHost = el('div', { class: 'cat-gallery-main' });
  const thumbsHost = el('div', { class: 'cat-gallery-thumbs-host' });
  const varietyIsTheGallery = distinctValues(product.variants, 'variety').length > 0;
  let activeVariant = null;
  let activeVariety = null;
  let activeImageKey = null;
  let renderedMainKey = null;
  let thumbnailsMounted = false;

  const imageKey = (image) => image?.id ?? image?.src ?? null;
  const thumbnailKey = (image) => String(image?.src ?? imageKey(image) ?? '').trim();
  const thumbnailImages = uniqueThumbnailImages(product.images);

  const labelForVariant = (variant) =>
    variant?.variety && variant.variety !== 'generic'
      ? variant.variety
      : variant?.color ?? product.name;

  function uniqueThumbnailImages(images) {
    const seen = new Set();
    return (images ?? []).filter((image) => {
      const key = thumbnailKey(image);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function variantForImage(image) {
    const key = thumbnailKey(image);
    if (!key) return null;

    return product.variants.find((variant) =>
      (variant.images ?? []).some((candidate) => thumbnailKey(candidate) === key),
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

  function viewerItems() {
    if (varietyIsTheGallery) {
      return distinctValues(product.variants, 'variety').flatMap((variety) => {
        const image = firstUsableImage(imagesForVariety(variety));
        if (!image) return [];
        const variant = product.variants.find((candidate) =>
          candidate.variety === variety && firstUsableImage(candidate.images ?? []),
        );
        return [{
          image,
          variety,
          title: variety === 'generic' ? product.name : variety,
          color: variant?.color ?? null,
        }];
      });
    }

    return thumbnailImages.map((image) => {
      const variant = variantForImage(image);
      return {
        image,
        variety: null,
        title: variant?.variety ?? variant?.color ?? product.name,
        color: variant?.color ?? null,
      };
    });
  }

  function openImageViewer(primary) {
    const items = viewerItems();
    if (items.length === 0) return;

    let index = items.findIndex((item) =>
      (activeVariety && item.variety === activeVariety)
      || (!activeVariety && thumbnailKey(item.image) === thumbnailKey(primary)),
    );
    if (index < 0) index = 0;

    const imageHost = el('div', { class: 'cat-image-viewer-media' });
    const captionTitle = el('strong');
    const captionMeta = el('span');
    const counter = el('span', { class: 'cat-image-viewer-counter' });
    const selectVariety = el('button', {
      type: 'button',
      class: 'btn btn-primary cat-image-viewer-select',
      text: 'Select this variety',
      onClick() {
        const item = items[index];
        if (!item?.variety || !options.onVarietySelect) return;
        options.onVarietySelect(item.variety);
        modal?.close();
      },
    });
    const previous = el('button', {
      type: 'button',
      class: 'cat-image-viewer-nav cat-image-viewer-prev',
      'aria-label': 'Previous variety',
      hidden: items.length < 2,
      text: '‹',
      onClick: () => show(index - 1),
    });
    const next = el('button', {
      type: 'button',
      class: 'cat-image-viewer-nav cat-image-viewer-next',
      'aria-label': 'Next variety',
      hidden: items.length < 2,
      text: '›',
      onClick: () => show(index + 1),
    });
    let modal = null;

    const viewer = el('div', { class: 'cat-image-viewer' }, [
      el('div', { class: 'cat-image-viewer-stage' }, [previous, imageHost, next]),
      el('div', {
        class: 'cat-image-viewer-caption',
        role: 'status',
        'aria-live': 'polite',
        'aria-atomic': 'true',
      }, [
        el('div', { class: 'cat-image-viewer-copy' }, [captionTitle, captionMeta]),
        el('div', { class: 'cat-image-viewer-actions' }, [selectVariety, counter]),
      ]),
    ]);

    function show(nextIndex) {
      index = (nextIndex + items.length) % items.length;
      const item = items[index];
      replaceChildren(imageHost, [
        productMedia(item.image, {
          label: item.title,
          className: 'cat-image-viewer-image',
          width: 1600,
          height: 1200,
          eager: true,
        }),
      ]);
      captionTitle.textContent = item.title;
      captionMeta.textContent = [product.name, item.color]
        .filter((value, itemIndex, values) => value && values.indexOf(value) === itemIndex && value !== item.title)
        .join(' · ');
      counter.textContent = `${index + 1} of ${items.length}`;
      const canSelect = Boolean(item.variety && options.onVarietySelect);
      const isSelected = canSelect && item.variety === activeVariety;
      selectVariety.hidden = !canSelect;
      selectVariety.disabled = isSelected;
      selectVariety.textContent = isSelected ? 'Selected' : 'Select this variety';
      const modalTitle = modal?.element.querySelector('.cat-modal-title');
      if (modalTitle) modalTitle.textContent = item.title;
    }

    function handleKeydown(event) {
      if (event.key === 'ArrowLeft' && items.length > 1) {
        event.preventDefault();
        show(index - 1);
      } else if (event.key === 'ArrowRight' && items.length > 1) {
        event.preventDefault();
        show(index + 1);
      }
    }

    modal = openModal({
      title: items[index].title,
      variant: 'image',
      closeLabel: 'Close image viewer',
      content: viewer,
      onClose() {
        document.removeEventListener('keydown', handleKeydown);
      },
    });
    document.addEventListener('keydown', handleKeydown);
    show(index);
  }

  function render(variant = activeVariant, imageOverride = null) {
    // Once a variant is selected, do not borrow another variant's photo. A
    // missing image for that exact option must remain a placeholder.
    const images = variant ? variant.images ?? [] : product.images ?? [];
    // Keep the family gallery visible after selecting one exact variant. The
    // selected variant controls the main image, while the full image list
    // keeps the other varieties available for the next click.
    const primary = resolveGalleryPrimaryImage(images, imageOverride);
    const primaryVariant = variant ?? variantForImage(primary);
    const primaryLabel = activeVariety && activeVariety !== 'generic'
      ? activeVariety
      : labelForVariant(primaryVariant);
    renderedMainKey = `${thumbnailKey(primary) || (variant ? `placeholder:${variant.id}` : 'product-placeholder')}|${primaryLabel}`;

    const media = productMedia(primary, {
      label: primaryLabel,
      className: 'cat-gallery-img',
      width: 960,
      height: 720,
      eager: true,
    });

    replaceChildren(mainHost, [
      primary
        ? el('button', {
            type: 'button',
            class: 'cat-gallery-open',
            'aria-label': `Enlarge ${primaryLabel} photo`,
            onClick: () => openImageViewer(primary),
          }, [
            media,
            el('span', { class: 'cat-gallery-expand', 'aria-hidden': 'true' }, [
              el('span', { class: 'cat-gallery-expand-icon', text: '↗' }),
              el('span', { text: 'View larger' }),
            ]),
          ])
        : media,
      product.isNew ? el('span', { class: 'cat-badge-new', text: 'New' }) : null,
    ]);

    // Varieties are rendered as labelled image choices in the order form, so
    // repeating all of them below the main image creates two competing pickers.
    // Products without varieties keep their ordinary photo thumbnails.
    if (!thumbnailsMounted) {
      replaceChildren(
        thumbsHost,
        !varietyIsTheGallery && thumbnailImages.length > 1
          ? [
              el(
                'ul',
                { class: 'cat-gallery-thumbs' },
                thumbnailImages.map((image) => {
                  const imageVariant = variantForImage(image);
                  const key = thumbnailKey(image);
                  return el('li', {}, [
                    el('button', {
                      type: 'button',
                      class: 'cat-gallery-thumb-button',
                      'data-thumbnail-key': key,
                      'aria-label': imageVariant?.variety
                        ? `View ${imageVariant.variety}`
                        : `View ${product.name} photo`,
                      'aria-pressed': key !== null && key === activeImageKey ? 'true' : 'false',
                      onClick() {
                        activeImageKey = key;
                        if (imageVariant && options.onVariantSelect) {
                          options.onVariantSelect(imageVariant);
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
      thumbnailsMounted = true;
    }

    for (const button of thumbsHost.querySelectorAll('.cat-gallery-thumb-button')) {
      button.setAttribute('aria-pressed', button.dataset.thumbnailKey === activeImageKey ? 'true' : 'false');
    }
  }

  render();
  return {
    element: el('div', { class: 'cat-gallery' }, [mainHost, thumbsHost]),
    setVariant(variant) {
      const nextImageKey = thumbnailKey(firstUsableImage(variant?.images ?? []));
      const nextMainKey = `${nextImageKey || (variant ? `placeholder:${variant.id}` : 'product-placeholder')}|${labelForVariant(variant)}`;
      activeVariant = variant;
      activeVariety = variant?.variety ?? null;
      activeImageKey = nextImageKey;
      if (renderedMainKey === nextMainKey) return;
      render(variant);
    },
    setVariety(variety) {
      activeVariant = null;
      activeVariety = variety;
      const image = firstUsableImage(imagesForVariety(variety));
      activeImageKey = thumbnailKey(image);
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
  const summary = selectionSummary(product);
  const hasVariety = distinctValues(product.variants, 'variety').length > 0;
  const activeName = el('h1', {
    class: 'eyebrow cat-product-active-name',
    text: initialVariety ?? product.name,
  });
  const form = variantForm(product, {
    initial: { variety: initialVariety },
    splitVariety: true,
    onSelectionChange: (selection) => {
      const { variant, variety } = selection;
      summary.update(selection);
      activeName.textContent = variety && variety !== 'generic' ? variety : product.name;
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
      const added = ctx.quoteStore.addItem(product, selection);
      if (!added.ok) {
        form.showErrors(added.errors);
        return;
      }
      // The product page is already mounted and the quote store updates the
      // global count. Opening the summary directly avoids rebuilding the
      // gallery and variant form just before the dialog appears.
      ctx.openQuote();
    },
  });

  return {
    element: el('div', { class: 'cat-product-info' }, [
      el('div', { class: 'cat-product-kicker' }, [
        activeName,
        product.groupLabel && product.groupLabel !== getCategoryLabel(product.category)
          ? el('span', { class: 'cat-product-family', text: product.groupLabel })
          : null,
      ]),

      product.description
        ? el('p', { class: 'cat-product-desc', text: product.description })
        : el('p', {
            class: 'cat-product-desc',
            text: 'Choose the option that fits your order. The image and available formats update as you make your selection.',
          }),

      summary.element,

      el('div', { class: 'cat-product-form' }, [
        el('div', { class: 'cat-product-form-head' }, [
          el('h2', { text: 'Build your order' }),
          el('p', {
            text: hasVariety
              ? 'Continue with stem length, quantity and unit.'
              : 'Choose each available option in order.',
          }),
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
          el('h2', { text: 'Availability' }),
          el('span', { class: 'cat-product-facts-rule', 'aria-hidden': 'true' }),
        ]),
        productContext(product, ctx),
        attachmentLinks(product),
      ]),

      availabilityNote(PRODUCT_AVAILABILITY_NOTE),
    ]),
    varietyElement: form.hasVariety ? form.varietyElement : null,
    selectVariety: form.selectVariety,
    selectVariant: form.selectVariant,
  };
}

/**
 * @param {import('./core/repository').LocationProduct} product
 */
function selectionSummary(product) {
  const status = el('span', { class: 'cat-selection-status', text: 'In progress' });
  const helper = el('p', {
    class: 'cat-selection-helper',
    text: 'Start by choosing a variety.',
  });
  const values = {
    variety: el('dd', { text: 'Not selected' }),
    color: el('dd', { text: '—' }),
    length: el('dd', { text: 'Not selected' }),
    quantity: el('dd', { text: '1' }),
    measure: el('dd', { text: 'Not selected' }),
  };
  const hasColor = product.variants.some((variant) => variant.color);
  const hasLength = product.variants.some(
    (variant) => variant.lengthCm !== null && variant.lengthCm !== undefined,
  );
  const hasMeasure = product.variants.some((variant) => (variant.availableMeasures ?? []).length > 0);

  const item = (label, value, visible = true) => visible
    ? el('div', { class: 'cat-selection-item' }, [el('dt', { text: label }), value])
    : null;

  const element = el('section', {
    class: 'cat-selection-summary',
    'aria-label': 'Current selection',
    'aria-live': 'polite',
  }, [
    el('div', { class: 'cat-selection-summary-head' }, [
      el('h2', { text: 'Your selection' }),
      status,
    ]),
    helper,
    el('dl', { class: 'cat-selection-values' }, [
      item('Variety', values.variety),
      item('Color', values.color, hasColor),
      item('Stem length', values.length, hasLength),
      item('Quantity', values.quantity),
      item('Unit', values.measure, hasMeasure),
    ]),
  ]);

  const displayValue = (node, value, fallback = 'Not selected') => {
    node.textContent = value || fallback;
    node.classList.toggle('is-pending', !value);
  };

  return {
    element,
    update(selection) {
      const variety = selection.variety === 'generic' ? 'Standard' : selection.variety;
      displayValue(values.variety, variety);
      displayValue(values.color, selection.color, '—');
      displayValue(
        values.length,
        selection.lengthCm !== null && selection.lengthCm !== undefined
          ? `${selection.lengthCm} cm`
          : null,
      );
      displayValue(
        values.quantity,
        Number.isInteger(selection.quantity) && selection.quantity > 0 ? String(selection.quantity) : null,
      );
      displayValue(
        values.measure,
        selection.measure ? (MEASURE_LABELS[selection.measure] ?? capitalize(selection.measure)) : null,
      );

      const complete = Boolean(selection.variant && (!hasMeasure || selection.measure));
      status.textContent = complete ? 'Ready to add' : 'In progress';
      status.classList.toggle('is-complete', complete);
      helper.textContent = !selection.variety
        ? 'Start by choosing a variety.'
        : hasLength && (selection.lengthCm === null || selection.lengthCm === undefined)
          ? 'Variety selected. Choose the stem length next.'
          : hasMeasure && !selection.measure
            ? 'Set the quantity, then choose the unit.'
            : 'Your selection is complete and ready to add.';
    },
  };
}

/**
 * Keeps only stable context below the order controls. Variant-specific facts
 * live in the selection summary above instead of describing the whole family.
 * @param {import('./core/repository').LocationProduct} product
 * @param {any} ctx
 */
function productContext(product, ctx) {
  const rows = [];
  const add = (label, value) => {
    if (value) rows.push(el('dt', { text: label }), el('dd', { text: value }));
  };

  add('Catalog location', ctx.location.label);
  if (product.groupLabel && product.groupLabel !== getCategoryLabel(product.category)) {
    add('Family', product.groupLabel);
  }
  if (product.origin) add('Origin', product.origin);

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
