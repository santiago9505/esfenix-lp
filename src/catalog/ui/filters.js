/**
 * Catalog filters.
 *
 * One renderer, two presentations: a sidebar on desktop and a drawer on mobile
 * with "Apply filters" and "Clear all". The facets themselves come from
 * core/facets.js, which only ever returns options that lead somewhere — so a
 * facet with nothing to offer is simply absent, and there are no disabled
 * options sitting there unexplained.
 */

import { countActiveFilters } from '../core/facets.js';
import { el, replaceChildren } from './dom.js';
import { openModal } from './modal.js';

/**
 * @typedef {import('../core/types').Facet} Facet
 * @typedef {import('../core/types').FilterState} FilterState
 */

let groupId = 0;

/**
 * @param {{
 *   facets: Facet[],
 *   filters: FilterState,
 *   resultCount: number,
 *   onToggle: (facetId: string, value: string|number) => void,
 *   onClearAll: () => void,
 *   idPrefix?: string,
 * }} options
 */
export function filterPanel(options) {
  const active = countActiveFilters(options.filters);

  return el('div', { class: 'cat-filters' }, [
    el('div', { class: 'cat-filters-head' }, [
      el('h2', { class: 'cat-filters-title', text: 'Filters' }),
      active > 0
        ? el('button', {
            type: 'button',
            class: 'cat-clear',
            text: 'Clear all',
            onClick: options.onClearAll,
          })
        : null,
    ]),

    active > 0
      ? el('p', {
          class: 'cat-filters-active',
          text: `${active} filter${active === 1 ? '' : 's'} applied`,
        })
      : null,

    ...options.facets.map((facet) => facetGroup(facet, options)),

    options.facets.length === 0
      ? el('p', { class: 'cat-filters-empty', text: 'No filters available for this selection.' })
      : null,
  ]);
}

/**
 * @param {Facet} facet
 * @param {{ onToggle: (facetId: string, value: string|number) => void, idPrefix?: string }} options
 */
function facetGroup(facet, options) {
  const id = `${options.idPrefix ?? 'facet'}-${facet.id}-${++groupId}`;
  const isLong = facet.options.length > 8;

  const list = el(
    'ul',
    { class: `cat-facet-options ${isLong ? 'cat-facet-scroll' : ''}` },
    facet.options.map((option) => {
      const optionId = `${id}-${String(option.value).replace(/\W+/g, '')}`;
      return el('li', {}, [
        el('input', {
          type: 'checkbox',
          id: optionId,
          class: 'cat-facet-check',
          checked: option.selected,
          onChange: () => options.onToggle(facet.id, option.value),
        }),
        el('label', { for: optionId, class: 'cat-facet-label' }, [
          el('span', { class: 'cat-facet-name', text: option.label }),
          el('span', { class: 'cat-facet-count', text: String(option.count) }),
        ]),
      ]);
    }),
  );

  const body = el('div', { class: 'cat-facet-body', id: `${id}-body` }, [list]);

  const toggle = el('button', {
    type: 'button',
    class: 'cat-facet-toggle',
    'aria-expanded': 'true',
    'aria-controls': `${id}-body`,
    onClick(event) {
      const expanded = event.currentTarget.getAttribute('aria-expanded') === 'true';
      event.currentTarget.setAttribute('aria-expanded', String(!expanded));
      body.hidden = expanded;
    },
  }, [
    el('span', { text: facet.label }),
    el('span', { class: 'cat-facet-chevron', 'aria-hidden': 'true', text: '›' }),
  ]);

  return el('section', { class: 'cat-facet' }, [toggle, body]);
}

/**
 * The mobile entry point: a button showing how many filters are applied.
 *
 * @param {{ activeCount: number, onOpen: () => void }} options
 */
export function filterTrigger(options) {
  return el(
    'button',
    {
      type: 'button',
      class: 'btn btn-light cat-filters-trigger',
      onClick: options.onOpen,
    },
    [
      'Filters',
      options.activeCount > 0
        ? el('span', { class: 'cat-filters-badge', text: String(options.activeCount) })
        : null,
    ],
  );
}

/**
 * Opens the filters as a bottom sheet on mobile.
 *
 * The panel edits the live filter state as the visitor taps, so the result
 * count updates behind the sheet; "Apply filters" simply closes it. That keeps
 * the two presentations behaving the same rather than adding a second,
 * staged-state code path that could drift.
 *
 * @param {{
 *   render: (host: HTMLElement, close: () => void) => void,
 *   onClearAll: () => void,
 * }} options
 */
export function openFilterDrawer(options) {
  const host = el('div', { class: 'cat-filters-drawer-body' });

  const apply = el('button', {
    type: 'button',
    class: 'btn btn-primary',
    text: 'Apply filters',
    onClick: () => modal.close(),
  });

  const clear = el('button', {
    type: 'button',
    class: 'btn btn-light',
    text: 'Clear all',
    onClick: options.onClearAll,
  });

  const modal = openModal({
    title: 'Filters',
    content: host,
    footer: [apply, clear],
    variant: 'sheet',
  });

  options.render(host, () => modal.close());
  return { ...modal, host };
}

/**
 * Re-renders an open drawer in place, so tapping an option inside it updates
 * the counts without closing and reopening.
 * @param {HTMLElement} host
 * @param {Node} content
 */
export function updateDrawer(host, content) {
  replaceChildren(host, [content]);
}
