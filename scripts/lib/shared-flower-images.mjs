/** Exact flower identities used by the Fresa maintenance script. */
function normalize(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function flowerIdentity(product, variant, { includeLength = false } = {}) {
  const variety = normalize(variant.variety);
  return JSON.stringify([
    product.category,
    product.group || product.slug || normalize(product.name),
    variety === 'generic' ? '' : variety,
    normalize(variant.color),
    Object.entries(variant.attributes ?? {}).map(([key, value]) => [normalize(key), normalize(value)])
      .sort(([a], [b]) => a.localeCompare(b)),
    ...(includeLength ? [variant.lengthCm ?? null] : []),
  ]);
}

export function flowerRows(products, source) {
  return products.filter(product => ['roses', 'other-flowers', 'foliage'].includes(product.category))
    .flatMap(product => (product.locations ?? []).filter(location => location.location === source)
      .flatMap(location => location.variants.map(variant => ({ product, variant }))));
}

/** Photos may cross stem lengths, but never flower families, varieties or colors. */
export function sharedFlowerImages(products, source = 'houston') {
  const byIdentity = new Map();
  for (const { product, variant } of flowerRows(products, source)) {
    const key = flowerIdentity(product, variant);
    const images = byIdentity.get(key) ?? new Map();
    for (const image of variant.images ?? []) {
      if (String(image.src ?? '').trim()) images.set(image.contentKey || image.src, image);
    }
    if (images.size) byIdentity.set(key, images);
  }
  return new Map([...byIdentity].map(([key, images]) => [key, [...images.values()]]));
}

/** The franchise gets its own native rows; existing local identities always win. */
export function missingFranchiseFlowers(products, source = 'houston', franchise = 'dmv') {
  const existing = new Set(flowerRows(products, franchise)
    .map(({ product, variant }) => flowerIdentity(product, variant, { includeLength: true })));
  return flowerRows(products, source).filter(({ product, variant }) => {
    const key = flowerIdentity(product, variant, { includeLength: true });
    if (existing.has(key)) return false;
    existing.add(key);
    return true;
  });
}
