/**
 * The catalog's dialog primitive: backdrop, focus trap, Escape to close,
 * scroll lock, and focus restored to whatever opened it.
 *
 * Used by the location-change confirmation, the variant picker and the quote
 * summary, so keyboard and screen-reader behaviour is identical across all of
 * them rather than reimplemented three times.
 */

import { el, lockScroll, trapFocus, unlockScroll } from './dom.js';

let openCount = 0;

/**
 * @param {{
 *   title: string,
 *   description?: string,
 *   content: Node|Node[],
 *   footer?: Node|Node[]|null,
 *   variant?: 'center'|'drawer-left'|'drawer-right'|'sheet',
 *   labelledBy?: string,
 *   onClose?: () => void,
 *   closeLabel?: string,
 * }} options
 * @returns {{ element: HTMLElement, close: () => void }}
 */
export function openModal(options) {
  const titleId = `cat-modal-title-${++openCount}`;
  const variant = options.variant ?? 'center';

  const dialog = el(
    'div',
    {
      class: `cat-modal cat-modal-${variant}`,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      // Focusable as a last resort, so the dialog can always receive focus
      // even if it somehow contains no focusable control.
      tabindex: '-1',
    },
    [
      el('div', { class: 'cat-modal-head' }, [
        el('h2', { id: titleId, class: 'cat-modal-title', text: options.title }),
        el('button', {
          type: 'button',
          class: 'cat-modal-close',
          'aria-label': options.closeLabel ?? 'Close',
          html: '<span aria-hidden="true">×</span>',
          onClick: () => close(),
        }),
      ]),
      options.description ? el('p', { class: 'cat-modal-desc', text: options.description }) : null,
      el('div', { class: 'cat-modal-body' }, toArray(options.content)),
      options.footer ? el('div', { class: 'cat-modal-foot' }, toArray(options.footer)) : null,
    ],
  );

  const backdrop = el(
    'div',
    {
      class: 'cat-modal-backdrop',
      onClick(event) {
        if (event.target === event.currentTarget) close();
      },
    },
    [dialog],
  );

  document.body.append(backdrop);
  lockScroll();

  const release = trapFocus(dialog, { onEscape: () => close() });

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    release();
    backdrop.remove();
    // Another dialog may still be open (variant picker over the summary).
    if (document.querySelector('.cat-modal-backdrop') === null) unlockScroll();
    options.onClose?.();
  }

  // Let the CSS transition run from a clean starting state.
  requestAnimationFrame(() => backdrop.classList.add('is-open'));

  return { element: dialog, close };
}

/** @param {Node|Node[]|null|undefined} value */
function toArray(value) {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * The confirmation shown when the visitor changes location with products
 * already selected.
 *
 * A quote list belongs to one location, so this is a real decision, not a
 * courtesy prompt: continuing empties the list.
 *
 * @param {{
 *   nextLocationLabel: string,
 *   onConfirm: () => void,
 *   onCancel?: () => void,
 * }} options
 */
export function confirmLocationChange(options) {
  let confirmed = false;

  const modal = openModal({
    title: 'Change location?',
    variant: 'center',
    content: [
      el('p', {
        text: 'Products may vary by location. Changing your location will clear your current quote list.',
      }),
      el('p', { class: 'cat-modal-hint', text: `New location: ${options.nextLocationLabel}` }),
    ],
    footer: [
      el('button', {
        type: 'button',
        class: 'btn btn-primary',
        text: 'Clear list and change location',
        onClick() {
          confirmed = true;
          modal.close();
          options.onConfirm();
        },
      }),
      el('button', {
        type: 'button',
        class: 'btn btn-light',
        text: 'Keep current location',
        onClick: () => modal.close(),
      }),
    ],
    onClose() {
      if (!confirmed) options.onCancel?.();
    },
  });

  return modal;
}
