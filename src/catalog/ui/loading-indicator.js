/**
 * Branded loading feedback shared by the catalog and quote flows.
 *
 * The visual treatment stays deliberately small and CSS-driven: it uses the
 * existing Esfenix flower-cart asset, the site's accent colors and the same
 * rounded surfaces as the rest of the catalog. Copy remains in the DOM so the
 * loading state is useful to screen-reader users as well.
 */

import { el } from './dom.js';

const LOADING_COPY = {
  catalog: {
    kicker: 'Esfenix catalog',
    title: 'Curating your selection',
    message: 'Loading products for your location…',
  },
  submission: {
    kicker: 'Esfenix quote request',
    title: 'Sending your request',
    message: 'Sharing your selection with our team…',
  },
  lookup: {
    kicker: 'Esfenix customer check',
    title: 'Checking your details',
    message: 'Looking for your saved information…',
  },
};

/**
 * @param {{ kind?: 'catalog'|'submission'|'lookup', compact?: boolean, role?: string|null }} [options]
 */
export function loadingIndicator(options = {}) {
  const kind = options.kind ?? 'catalog';
  const copy = LOADING_COPY[kind] ?? LOADING_COPY.catalog;
  const attrs = {
    class: `cat-loading${options.compact ? ' cat-loading-compact' : ''}`,
  };

  if (options.role !== null) {
    attrs.role = options.role ?? 'status';
    attrs['aria-live'] = 'polite';
    attrs['aria-busy'] = 'true';
  } else {
    attrs['aria-hidden'] = 'true';
  }

  return el('div', attrs, [
    el('div', { class: 'cat-loading-mark', 'aria-hidden': 'true' }, [
      el('span', { class: 'cat-loading-ring cat-loading-ring-primary' }),
      el('span', { class: 'cat-loading-ring cat-loading-ring-secondary' }),
      el('span', { class: 'cat-loading-spark cat-loading-spark-one' }),
      el('span', { class: 'cat-loading-spark cat-loading-spark-two' }),
      el('span', { class: 'cat-loading-core' }, [
        el('img', {
          src: '/assets/flower-cart-color.svg',
          alt: '',
          width: '28',
          height: '36',
          decoding: 'async',
        }),
      ]),
    ]),
    el('div', { class: 'cat-loading-copy' }, [
      el('span', { class: 'cat-loading-kicker', text: copy.kicker }),
      el('p', { class: 'cat-loading-title', text: copy.title }),
      el('p', { class: 'cat-loading-message', text: copy.message }),
    ]),
  ]);
}

/**
 * Creates a fixed loading layer for work that must temporarily block the
 * quote form, such as the final submission request.
 *
 * @param {{ kind?: 'catalog'|'submission'|'lookup' }} [options]
 */
export function createLoadingOverlay(options = {}) {
  const indicator = loadingIndicator({
    kind: options.kind ?? 'submission',
  });
  const overlay = el('div', {
    class: 'cat-loading-overlay',
    hidden: true,
    'aria-hidden': 'true',
  }, [indicator]);
  let hideTimer = null;
  let isShown = false;

  return {
    element: overlay,

    show() {
      isShown = true;
      if (hideTimer !== null) {
        window.clearTimeout(hideTimer);
        hideTimer = null;
      }
      overlay.hidden = false;
      overlay.setAttribute('aria-hidden', 'false');
      const scheduleFrame = window.requestAnimationFrame
        ? (callback) => window.requestAnimationFrame(callback)
        : (callback) => window.setTimeout(callback, 0);
      scheduleFrame(() => {
        if (isShown && !overlay.hidden) overlay.classList.add('is-visible');
      });
    },

    hide() {
      isShown = false;
      overlay.classList.remove('is-visible');
      overlay.setAttribute('aria-hidden', 'true');
      if (hideTimer !== null) window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => {
        overlay.hidden = true;
        hideTimer = null;
      }, 420);
    },
  };
}
