/**
 * The Supplies showcase: the printed catalog's supplies pages, made
 * interactive. Each group shows its photos on a grey band that names them,
 * exactly as in the catalog.
 *
 * Each photo is one supply and toggles only itself. A name on the band covers
 * the photos it describes (FLOWER BOXES covers two) and chooses or clears them
 * together. The bar at the bottom sends the visitor to the request form.
 *
 * Nothing here touches the quote list. The selection lives in the supplies
 * interest store and only travels with the request as names.
 */

import { SUPPLY_PAGES, getSupplyItem } from '../data/supplies.js';
import { el } from './dom.js';

/**
 * @param {{
 *   store: ReturnType<typeof import('../core/supplies-interest.js').createSuppliesInterestStore>,
 *   onRequest: () => void,
 * }} options
 */
export function suppliesShowcase(options) {
  const { store } = options;
  /** @type {Array<{ node: HTMLElement, items: string[] }>} */
  const controls = [];
  const register = (node, items) => {
    controls.push({ node, items });
    return node;
  };

  // As in the printed catalog, the title opens the left page and the right
  // page starts straight with its first group, so both columns end level.
  const head = el('header', { class: 'sup-head' }, [
    el('h2', { class: 'sup-title', id: 'sup-title', text: 'Supplies' }),
    el('p', { class: 'sup-intro' }, [
      el('strong', { text: 'Ask us about supplies.' }),
      el('span', {
        text: ' Select the supplies you’re interested in. We’ll check availability and confirm your options before adding any supplies to a quote.',
      }),
    ]),
  ]);
  const pages = SUPPLY_PAGES.map((groups, index) => el('div', { class: 'sup-page' }, [
    index === 0 ? head : null,
    ...groups.map((group) => supplyGroup(group, register, store)),
  ]));

  const status = el('p', { class: 'sup-bar-status', role: 'status', 'aria-live': 'polite' });
  const names = el('p', { class: 'sup-bar-names' });
  const clear = el('button', {
    type: 'button',
    class: 'cat-linkbtn sup-bar-clear',
    text: 'Clear',
    onClick: () => store.clear(),
  });
  const request = el('button', {
    type: 'button',
    class: 'btn btn-primary sup-bar-request',
    text: 'Ask about availability',
    onClick: () => {
      if (store.count() > 0) options.onRequest();
    },
  });
  const bar = el('div', { class: 'sup-bar' }, [
    el('div', { class: 'sup-bar-copy' }, [status, names]),
    el('div', { class: 'sup-bar-actions' }, [clear, request]),
  ]);

  const section = el('section', { class: 'sup', 'aria-labelledby': 'sup-title' }, [
    el('div', { class: 'sup-spread' }, pages),
    bar,
  ]);

  const paint = () => {
    const selected = new Set(store.getIds());
    for (const { node, items } of controls) {
      const chosen = items.filter((id) => selected.has(id)).length;
      node.setAttribute('aria-pressed', chosen === 0 ? 'false' : chosen === items.length ? 'true' : 'mixed');
    }
    const count = selected.size;
    bar.classList.toggle('has-selection', count > 0);
    status.textContent = count > 0 ? `${count} selected` : 'Tap the supplies you are interested in.';
    names.textContent = store.getLabels().join(' · ');
    names.hidden = count === 0;
    clear.hidden = count === 0;
    request.disabled = count === 0;
  };

  const unsubscribe = store.subscribe(() => {
    if (!section.isConnected) {
      unsubscribe();
      return;
    }
    paint();
  });
  paint();
  return section;
}

/**
 * @param {typeof SUPPLY_PAGES[number][number]} group
 * @param {(node: HTMLElement, items: string[]) => HTMLElement} register
 * @param {ReturnType<typeof import('../core/supplies-interest.js').createSuppliesInterestStore>} store
 */
function supplyGroup(group, register, store) {
  const photos = el('div', { class: 'sup-photos' }, group.tiles.map((tile) => {
    const label = getSupplyItem(tile.item)?.label ?? tile.item;
    // Each photo is individually selectable, including items that share a caption.
    return register(el('button', {
      type: 'button',
      class: 'sup-photo',
      style: `grid-column:span ${tile.span}`,
      'aria-label': label,
      title: label,
      dataset: { supply: tile.item },
      onClick: () => store.toggle(tile.item),
    }, [
      el('img', {
        src: tile.src,
        alt: '',
        loading: 'lazy',
        decoding: 'async',
        draggable: 'false',
        width: '640',
        height: '640',
        style: `object-position:${tile.position}`,
      }),
      el('span', { class: 'sup-check' }),
    ]), [tile.item]);
  }));

  const caption = el('p', { class: 'sup-caption' }, group.names.flatMap((entry, index) => [
    index > 0 ? el('span', { class: 'sup-sep', 'aria-hidden': 'true', text: '|' }) : null,
    register(el('button', {
      type: 'button',
      class: 'sup-name',
      dataset: { supplyName: entry.items.join(' ') },
      onClick: () => {
        // Choose every photo the name covers unless all are already chosen.
        const allChosen = entry.items.every((id) => store.has(id));
        store.setMany(entry.items, !allChosen);
      },
      text: entry.label,
    }), entry.items),
  ]));

  return el('article', { class: 'sup-group', 'aria-label': group.names.map((entry) => entry.label).join(', ') }, [
    photos,
    caption,
  ]);
}
