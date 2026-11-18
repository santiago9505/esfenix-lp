/**
 * Image carousels for the "Why Esfenix" feature cards.
 *
 * Every card keeps its current photo as the first slide (loaded lazily by the
 * shared `.ph[data-img]` loader). Extra slides are declared as hidden
 * `[data-carousel-slide]` elements and are only downloaded after a visitor
 * interacts with the card, so the initial page weight stays the same.
 *
 * Slide images are exported already framed for the card (2:3 portrait), so
 * `background-size: cover` never cuts people or products at the edges.
 */

const SWIPE_THRESHOLD = 40;
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

  let currentIndex = 0;
  let pendingRequest = 0;

  const paintDots = () => {
    [...dots.children].forEach((dot, index) => dot.classList.toggle('is-active', index === currentIndex));
  };

  const paintStatus = () => {
    if (!status) return;
    const { description } = slides[currentIndex];
    status.textContent = `Image ${currentIndex + 1} of ${slides.length}${description ? `: ${description}` : ''}`;
  };

  const commit = (index) => {
    currentIndex = index;
    carousel.style.setProperty('--bg', `url('${slides[index].src}')`);
    paintDots();
    paintStatus();
  };

  const fadeTo = (index) => {
    carousel.querySelector('.feature-carousel-layer')?.remove();
    if (reduceMotion.matches) {
      commit(index);
      return;
    }
    const layer = document.createElement('span');
    layer.className = 'feature-carousel-layer';
    layer.setAttribute('aria-hidden', 'true');
    layer.style.backgroundImage = `url('${slides[index].src}')`;
    carousel.insertBefore(layer, carousel.firstChild);
    // Flush styles so the opacity transition runs from 0.
    void layer.offsetWidth;
    layer.classList.add('is-visible');
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      commit(index);
      layer.remove();
    };
    layer.addEventListener('transitionend', finish, { once: true });
    window.setTimeout(finish, 700);
  };

  const showSlide = (step) => {
    const nextIndex = (currentIndex + step + slides.length) % slides.length;
    const request = ++pendingRequest;
    preload(nextIndex).then(() => {
      if (request !== pendingRequest) return;
      fadeTo(nextIndex);
      // Warm the following slide so the next click feels instant.
      preload((nextIndex + step + slides.length) % slides.length).catch(() => {});
    }, () => {
      // Keep the current photo if a slide fails to load.
    });
  };

  previous?.addEventListener('click', () => showSlide(-1));
  next?.addEventListener('click', () => showSlide(1));

  carousel.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); showSlide(-1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); showSlide(1); }
  });

  // Swipe on touch screens. Vertical scrolling keeps working (touch-action: pan-y).
  let startX = null;
  let startY = null;
  carousel.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' || event.target.closest('button')) return;
    startX = event.clientX;
    startY = event.clientY;
  });
  carousel.addEventListener('pointerup', (event) => {
    if (startX === null) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    startX = null;
    if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) showSlide(dx < 0 ? 1 : -1);
  });
  carousel.addEventListener('pointercancel', () => { startX = null; });

  paintDots();
  paintStatus();
}

for (const carousel of document.querySelectorAll('[data-feature-carousel]')) setupCarousel(carousel);
