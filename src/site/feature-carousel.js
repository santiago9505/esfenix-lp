/**
 * Adds manual previous/next controls to the selected landing-page feature.
 * Images are requested only after a visitor uses a control, keeping the
 * existing first image and initial page weight unchanged.
 */

for (const carousel of document.querySelectorAll('[data-feature-carousel]')) {
  const slides = [
    {
      src: carousel.dataset.src,
      description: 'Esfenix team member at the flower farm',
    },
    ...[...carousel.querySelectorAll('[data-carousel-slide]')].map((slide) => ({
      src: slide.dataset.src,
      description: slide.dataset.description,
    })),
  ].filter((slide) => slide.src);

  if (slides.length < 2) continue;

  const previous = carousel.querySelector('[data-carousel-previous]');
  const next = carousel.querySelector('[data-carousel-next]');
  const status = carousel.querySelector('[data-carousel-status]');
  let currentIndex = 0;
  let pendingRequest = 0;

  // The three added photos are landscape shots inside a portrait card. Keep
  // their full frame a little farther back so people and the van are not cut
  // off by the card edges. The original farm photo keeps its existing crop.
  const updateFraming = (index) => {
    carousel.classList.toggle('is-carousel-wide', index > 0);
  };
  updateFraming(currentIndex);

  const showSlide = (step) => {
    const nextIndex = (currentIndex + step + slides.length) % slides.length;
    const slide = slides[nextIndex];
    const request = ++pendingRequest;
    const image = new Image();

    image.onload = () => {
      if (request !== pendingRequest) return;
      currentIndex = nextIndex;
      carousel.style.setProperty('--bg', `url('${slide.src}')`);
      updateFraming(currentIndex);
      if (status) status.textContent = `Image ${currentIndex + 1} of ${slides.length}: ${slide.description}`;
    };

    image.src = slide.src;
  };

  previous?.addEventListener('click', () => showSlide(-1));
  next?.addEventListener('click', () => showSlide(1));
}
