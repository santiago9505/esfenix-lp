/**
 * Wires up the shared chrome on the catalog pages: the mobile overlay menu,
 * the lazy background loader used by `.ph[data-img]`, and the reveal-on-scroll
 * utility.
 *
 * The Home page has its own inline copy of this behaviour, tied to its hero
 * (transparent header over the video, hide-on-scroll, parallax). The catalog
 * has no hero, so rather than generalise the Home page's script — and risk
 * changing the landing — it gets this small module. The markup and the CSS are
 * shared; only the initialisation differs.
 */

const prefersReducedMotion = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Loads a `.ph[data-img]` element's background once it is near the viewport. */
function loadBackground(node) {
  if (node.dataset.loaded) return;
  node.dataset.loaded = 'true';
  const src = node.dataset.src;
  if (!src) return;

  const image = new Image();
  image.onload = () => node.style.setProperty('--bg', `url('${src}')`);
  image.src = src;
}

function initBackgrounds() {
  const nodes = [...document.querySelectorAll('.ph[data-img][data-src]')];
  if (nodes.length === 0) return;

  if (!('IntersectionObserver' in window)) {
    nodes.forEach(loadBackground);
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        loadBackground(entry.target);
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: '900px 0px', threshold: 0.01 },
  );
  nodes.forEach((node) => observer.observe(node));
}

/**
 * Reveals elements as they scroll into view, matching the Home page's feel.
 *
 * The reveal classes start at `opacity: 0`, so this is the only thing making
 * the product grid visible. That is fine as an effect and unacceptable as a
 * dependency: if the observer never reports — reduced motion, no support, a
 * renderer that is not compositing — the catalog would simply be blank. So the
 * animation is treated as an enhancement with a hard deadline, after which
 * anything still hidden is shown regardless.
 */
export function initReveals(root = document) {
  const nodes = [...root.querySelectorAll('.rv, .reveal, .fx-pop')];
  if (nodes.length === 0) return;

  const showAll = () => nodes.forEach((node) => node.classList.add('show'));

  if (prefersReducedMotion() || !('IntersectionObserver' in window)) {
    showAll();
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) entry.target.classList.toggle('show', entry.isIntersecting);
    },
    { threshold: 0.12 },
  );
  nodes.forEach((node) => observer.observe(node));

  // Safety net: content is never left invisible because an effect did not run.
  window.setTimeout(() => {
    if (nodes.some((node) => node.classList.contains('show'))) return;
    observer.disconnect();
    showAll();
  }, 1200);
}

function initOverlayMenu() {
  const overlay = document.getElementById('overlay');
  const openButton = document.getElementById('menuOpen');
  const closeButton = document.getElementById('menuClose');
  if (!overlay || !openButton || !closeButton) return;

  const menuBackground = overlay.querySelector('[data-menu-bg]');

  function open() {
    overlay.classList.add('open');
    document.body.classList.add('lock');
    openButton.setAttribute('aria-expanded', 'true');
    if (menuBackground) loadBackground(menuBackground);
    overlay.querySelectorAll('nav a').forEach((link, index) => {
      link.style.transitionDelay = `${0.08 + index * 0.06}s`;
    });
    closeButton.focus();
  }

  function close() {
    overlay.classList.remove('open');
    document.body.classList.remove('lock');
    openButton.setAttribute('aria-expanded', 'false');
    openButton.focus();
  }

  openButton.addEventListener('click', open);
  closeButton.addEventListener('click', close);
  overlay.querySelectorAll('nav a, .ov-foot a').forEach((link) => {
    link.addEventListener('click', close);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && overlay.classList.contains('open')) close();
  });
}

/** Marks the Catalog links as the current section. */
function markCurrentNav() {
  for (const link of document.querySelectorAll('[data-nav-catalog]')) {
    link.setAttribute('aria-current', 'page');
  }
}

export function initSiteChrome() {
  initBackgrounds();
  initOverlayMenu();
  markCurrentNav();
  initReveals();
}
