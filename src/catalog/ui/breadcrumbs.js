/**
 * Breadcrumbs. On narrow screens CSS collapses the trail to the last two
 * levels, so the current product stays readable instead of wrapping over three
 * lines.
 */

import { el } from './dom.js';

/**
 * @param {Array<{ label: string, href?: string|null }>} trail
 *   The last entry is the current page and is never a link.
 */
export function breadcrumbs(trail) {
  return el('nav', { class: 'cat-crumbs', 'aria-label': 'Breadcrumb' }, [
    el(
      'ol',
      {},
      trail.map((crumb, index) => {
        const isLast = index === trail.length - 1;
        return el('li', { 'data-depth': String(index) }, [
          isLast || !crumb.href
            ? el('span', { 'aria-current': isLast ? 'page' : null, text: crumb.label })
            : el('a', { href: crumb.href, text: crumb.label }),
        ]);
      }),
    ),
  ]);
}
