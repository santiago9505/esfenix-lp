/**
 * DOM helpers shared by the catalog views.
 *
 * Deliberately small: an element builder, a focus trap and a couple of
 * accessibility utilities. The site has no framework and does not need one for
 * this, but it does need dialogs that keyboard and screen-reader users can
 * actually operate.
 */

/**
 * Builds an element. Attributes starting with `on` are treated as listeners,
 * `class`/`text`/`html` are handled specially, everything else is an attribute.
 *
 * @param {string} tag
 * @param {Record<string, any>} [attrs]
 * @param {Array<Node|string|null|undefined>|Node|string} [children]
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }

  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** @param {HTMLElement} node */
export function clear(node) {
  while (node.firstChild) node.firstChild.remove();
}

/**
 * @param {HTMLElement} node
 * @param {Array<Node|string|null|undefined>} children
 */
export function replaceChildren(node, children) {
  clear(node);
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** @param {HTMLElement} container */
export function focusableWithin(container) {
  return [...container.querySelectorAll(FOCUSABLE)].filter(
    (node) => node.offsetParent !== null || node === document.activeElement,
  );
}

/**
 * Traps Tab inside a container and restores focus when released.
 * Escape is handled by the caller, which usually wants to do more than close.
 *
 * @param {HTMLElement} container
 * @param {{ onEscape?: () => void, initialFocus?: HTMLElement|null }} [options]
 * @returns {() => void} release
 */
export function trapFocus(container, options = {}) {
  const previouslyFocused = /** @type {HTMLElement|null} */ (document.activeElement);

  /** @param {KeyboardEvent} event */
  function onKeydown(event) {
    if (event.key === 'Escape') {
      options.onEscape?.();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = focusableWithin(container);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  document.addEventListener('keydown', onKeydown, true);

  // Defer one turn so the container is laid out and actually focusable.
  // A timeout rather than requestAnimationFrame: rAF is throttled in
  // background tabs and does not run at all where nothing is being painted,
  // and a dialog that never takes focus is a keyboard trap in the bad sense.
  window.setTimeout(() => {
    if (!container.isConnected) return;
    const target = options.initialFocus ?? focusableWithin(container)[0] ?? container;
    if (target && !container.contains(document.activeElement)) target.focus?.();
  }, 0);

  return () => {
    document.removeEventListener('keydown', onKeydown, true);
    previouslyFocused?.focus?.();
  };
}

/** Prevents the page behind a dialog from scrolling. Reuses the site's class. */
export function lockScroll() {
  document.body.classList.add('lock');
}

export function unlockScroll() {
  document.body.classList.remove('lock');
}

let liveRegion = null;

/**
 * Announces a message to screen readers without moving focus.
 * @param {string} message
 */
export function announce(message) {
  if (!liveRegion) {
    liveRegion = el('div', {
      class: 'cat-sr',
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
    });
    document.body.append(liveRegion);
  }
  // Clearing first makes repeated identical messages announce again.
  liveRegion.textContent = '';
  window.setTimeout(() => {
    liveRegion.textContent = message;
  }, 50);
}

/**
 * Renders an image with the site's branded placeholder fallback.
 *
 * Products without a usable API image or a local fallback intentionally render
 * the site's `.ph` placeholder, so a missing image stays visible as missing
 * while still carrying the site's brand mark.
 *
 * @param {{ src?: string, alt?: string }|null} image
 * @param {{ label: string, className?: string, width?: number, height?: number, eager?: boolean }} options
 */
export function productMedia(image, options) {
  const className = options.className ?? 'cat-media';

  if (!image || !image.src) {
    return el('div', {
      class: `${className} ph`,
      'data-label': options.label,
      'data-placeholder': 'true',
      role: 'img',
      'aria-label': `${options.label} — photography pending`,
    });
  }

  const width = options.width ?? 640;
  const src = thumbnailSource(image.src, width);

  return el('div', { class: `${className} cat-media-img` }, [
    el('img', {
      src,
      alt: image.alt || options.label,
      width,
      height: options.height ?? 480,
      loading: options.eager ? 'eager' : 'lazy',
      decoding: 'async',
      onerror(event) {
        // Fall back to the placeholder rather than a broken image icon.
        const img = event.currentTarget;
        const wrapper = img.parentElement;
        if (!wrapper) return;
        wrapper.classList.remove('cat-media-img');
        wrapper.classList.add('ph');
        wrapper.dataset.label = options.label;
        wrapper.dataset.placeholder = 'true';
        img.remove();
      },
    }),
  ]);
}

/**
 * Local fallback photos are often displayed as 96–160px thumbnails while the
 * source is prepared for the full product gallery. Use a dedicated small
 * derivative for those slots; remote Fresa URLs continue unchanged.
 * @param {string} src
 * @param {number} width
 */
function thumbnailSource(src, width) {
  if (width > 240 || !/^\/assets\/images\/flowers-fallback\/[^?#]+\.webp$/i.test(src)) return src;
  return src.replace(/\.webp$/i, '-thumb.webp');
}

/**
 * Picks an image that can actually render. API attachment arrays can contain
 * an empty URL before a valid attachment, so choosing the first array entry
 * would hide the valid image behind the placeholder.
 *
 * @param {Array<{ src?: string|null, isPrimary?: boolean }>|null|undefined} images
 */
export function firstUsableImage(images) {
  return images?.find((image) => image?.isPrimary && String(image.src ?? '').trim())
    ?? images?.find((image) => String(image.src ?? '').trim())
    ?? null;
}
