/**
 * Image carousels for the "Why Esfenix" feature cards.
 *
 * The first slide is loaded lazily by the shared `.ph[data-img]` loader.
 * Extra slides are declared as hidden `[data-carousel-slide]` elements. The
 * next slide is fetched when the card scrolls into view and the rest as soon
 * as the visitor points at, focuses or touches the card, so a click never
 * waits for the network.
 *
 * Controls react at once: the dots and the screen-reader status move on the
 * click itself, and the photo cross-fades in quickly behind them.
 *
 * Slide images are exported already framed for the card (2:3 portrait), so
 * `background-size: cover` never cuts people or products at the edges.
 */

const SWIPE_THRESHOLD = 40;
const FADE_FALLBACK_MS = 400;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(src);
    image.onerror = reject;
    image.src = src;
  });
}

function setupCarousel(carousel) {
  const slides = [
    { src: carousel.dataset.src, description: carousel.dataset.description },
    ...[...carousel.querySelectorAll('[data-carousel-slide]')].map((slide) => ({
      src: slide.dataset.src,
      description: slide.dataset.description,
    })),
  ].filter((slide) => slide.src);

  const previous = carousel.querySelector('[data-carousel-previous]');
  const next = carousel.querySelector('[data-carousel-next]');
  const status = carousel.querySelector('[data-carousel-status]');

  if (slides.length < 2) {
    previous?.remove();
    next?.remove();
    status?.remove();
    carousel.removeAttribute('aria-roledescription');
    return;
  }

  const dots = document.createElement('span');
  dots.className = 'feature-carousel-dots';
  dots.setAttribute('aria-hidden', 'true');
  for (let index = 0; index < slides.length; index += 1) dots.append(document.createElement('span'));

  carousel.append(dots);

  const loaded = new Map();
  const preload = (index) => {
    const { src } = slides[index];
    if (!loaded.has(src)) {
      loaded.set(src, loadImage(src).catch((error) => {
        loaded.delete(src);
        throw error;
      }));
    }
    return loaded.get(src);
  };
  const preloadAll = () => slides.forEach((_, index) => preload(index).catch(() => {}));

  // Index the controls point at. It moves on every click, before the photo loads.
  let targetIndex = 0;
  let pendingRequest = 0;
  let activeLayer = null;

  const paintIndicators = () => {
    [...dots.children].forEach((dot, index) => dot.classList.toggle('is-active', index === targetIndex));
    if (status) {
      const { description } = slides[targetIndex];
      status.textContent = `Image ${targetIndex + 1} of ${slides.length}${description ? `: ${description}` : ''}`;
    }
  };

  const setBackground = (src) => carousel.style.setProperty('--bg', `url('${src}')`);

  const settleLayer = () => {
    if (!activeLayer) return;
    setBackground(activeLayer.dataset.src);
    activeLayer.remove();
    activeLayer = null;
  };

  const fadeTo = (index) => {
    const { src } = slides[index];
    // A fade still running is finished at once so quick clicks never stack up.
    settleLayer();
    if (reduceMotion.matches) {
      setBackground(src);
      return;
    }
    const layer = document.createElement('span');
    layer.className = 'feature-carousel-layer';
    layer.setAttribute('aria-hidden', 'true');
    layer.dataset.src = src;
    layer.style.backgroundImage = `url('${src}')`;
    carousel.insertBefore(layer, carousel.firstChild);
    activeLayer = layer;
    // Flush styles so the opacity transition runs from 0.
    void layer.offsetWidth;
    layer.classList.add('is-visible');
    const finish = () => {
      if (activeLayer === layer) settleLayer();
    };
    layer.addEventListener('transitionend', finish, { once: true });
    window.setTimeout(finish, FADE_FALLBACK_MS);
  };

  const showSlide = (step) => {
    targetIndex = (targetIndex + step + slides.length) % slides.length;
    paintIndicators();
    const index = targetIndex;
    const request = ++pendingRequest;
    preload(index).then(() => {
      if (request !== pendingRequest) return;
      fadeTo(index);
    }, () => {
      // Keep the photo on screen if a slide fails to load.
    });
    preload((index + step + slides.length) % slides.length).catch(() => {});
  };

  // The buttons cover the left and right halves of the photo, so a swipe ends
  // on one of them; its trailing click must not move twice.
  let swiped = false;
  const onControl = (step) => () => {
    if (swiped) { swiped = false; return; }
    showSlide(step);
  };
  previous?.addEventListener('click', onControl(-1));
  next?.addEventListener('click', onControl(1));


  carousel.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); showSlide(-1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); showSlide(1); }
  });

  // Fetch the rest of the photos as soon as the visitor shows intent.
  for (const type of ['pointerenter', 'focusin', 'touchstart']) {
    carousel.addEventListener(type, preloadAll, { once: true, passive: true });
  }

  // Fetch the second photo once the card is close to the screen.
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      preload(1).catch(() => {});
    }, { rootMargin: '200px 0px' });
    observer.observe(carousel);
  }

  // Swipe on touch screens. Vertical scrolling keeps working (touch-action: pan-y).
  let startX = null;
  let startY = null;
  carousel.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse') return;
    swiped = false;
    startX = event.clientX;
    startY = event.clientY;
  });
  carousel.addEventListener('pointerup', (event) => {
    if (startX === null) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    startX = null;
    if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      swiped = true;
      window.setTimeout(() => { swiped = false; }, 400);
      showSlide(dx < 0 ? 1 : -1);
    }
  });
  carousel.addEventListener('pointercancel', () => { startX = null; });

  paintIndicators();
}

for (const carousel of document.querySelectorAll('[data-feature-carousel]')) setupCarousel(carousel);
