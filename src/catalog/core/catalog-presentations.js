/**
 * One card per flower family, with the native Fresa rows kept as choices.
 * These rules also accept older, already-normalized snapshots. Only confirmed
 * families are grouped; Mini Carnation, Carnation and other distinct flowers
 * keep their own cards. No availability or attachment crosses locations.
 */
const FAMILIES = [
  { match: /^preserved roses?(?: |$)/, name: 'Preserved Roses', slug: 'preserved-roses' },
  { match: /^lisianthus(?: |$)/, name: 'Lisianthus', slug: 'lisianthus' },
  { match: /^hydrangeas?(?: |$)/, name: 'Hydrangeas', slug: 'hydrangeas' },
  { match: /^peony(?: |$)/, name: 'Peony', slug: 'peony' },
  { match: /^tulips?(?: |$)/, name: 'Tulip', slug: 'tulip' },
  { match: /^snapdragon(?: |$)/, name: 'Snapdragon', slug: 'snapdragon' },
  { match: /^leather leaf(?: |$)/, name: 'Leather leaf', slug: 'leather-leaf' },
  { match: /^delphinium(?: |$)/, name: 'Delphinium', slug: 'delphinium' },
  { match: /^chrysanthemum(?: |$)/, name: 'Chrysanthemum', slug: 'chrysanthemum' },
];

function normalize(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function uniqueImages(images) {
  const seen = new Set();
  return images.filter(image => {
    const key = image.contentKey || image.src || image.url || image.id;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function qualifyVariant(variant, product, family) {
  const next = { ...variant };
  const label = normalize(variant.sourceProductName || product.name);
  switch (family.slug) {
    case 'preserved-roses': {
      const size = label.match(/\b(large|jumbo)\b/)?.[1];
      next.variety ||= size ? size[0].toUpperCase() + size.slice(1) : 'Standard';
      break;
    }
    case 'lisianthus':
    case 'snapdragon':
      next.variety ||= /\bcanada\b/.test(label) ? 'Canada' : 'Standard';
      break;
    case 'hydrangeas':
      next.variety ||= /\bpremium\b/.test(label) ? 'Premium' : 'Standard';
      break;
    case 'peony':
    case 'tulip':
      if (/\bother colors\b/.test(label)) next.color ||= 'Other colors';
      break;
    case 'leather-leaf': {
      const stems = label.match(/\b(\d+) stems\b/)?.[1];
      next.variety ||= stems
        ? `${stems} stems${/\bcosta rica\b/.test(label) ? ' (Costa Rica)' : ''}`
        : 'Standard';
      break;
    }
    case 'delphinium':
      if (/\blight blue\b/.test(label)) next.color = 'Light Blue';
      break;
    case 'chrysanthemum': {
      const variety = normalize(next.variety) || label.match(/\b(button|cushion|spider|cremom|cremon|daysi|daisy)\b/)?.[1];
      next.variety = /^(cremom|cremon)$/.test(variety) ? 'Cremon'
        : /^(daysi|daisy)$/.test(variety) ? 'Daisy'
          : variety ? variety[0].toUpperCase() + variety.slice(1) : 'Standard';
      break;
    }
  }
  return next;
}

export function groupCatalogPresentations(products) {
  const grouped = new Map();
  for (const product of products) {
    const family = FAMILIES.find(rule => rule.match.test(normalize(product.name)));
    if (!family) {
      grouped.set(`product:${product.id}`, product);
      continue;
    }
    const key = `${product.category}:${family.slug}`;
    const next = {
      ...product,
      name: family.name,
      slug: family.slug,
      group: family.slug,
      groupLabel: family.name,
      presentationGroup: true,
      legacySlugs: [...new Set([...(product.legacySlugs ?? []), product.slug])].filter(slug => slug !== family.slug),
      sourceProductIds: [...new Set(product.sourceProductIds ?? [product.id])],
      locations: product.locations.map(location => ({
        ...location,
        variants: location.variants.map(variant => qualifyVariant(variant, product, family)),
      })),
    };
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, next);
      continue;
    }
    // Prefer the existing base card's id, preserving bookmarks and saved lines
    // wherever possible. Other saved lines are reconciled by native task id.
    if (product.slug === family.slug) current.id = product.id;
    current.sourceProductIds = [...new Set([...current.sourceProductIds, ...next.sourceProductIds])];
    current.legacySlugs = [...new Set([...current.legacySlugs, ...next.legacySlugs])];
    current.images = uniqueImages([...(current.images ?? []), ...(next.images ?? [])]);
    current.files = uniqueImages([...(current.files ?? []), ...(next.files ?? [])]);
    current.catalogOrder = Math.min(current.catalogOrder ?? Infinity, next.catalogOrder ?? Infinity);
    current.position = Math.min(current.position ?? 0, next.position ?? 0);
    for (const location of next.locations) {
      const existing = current.locations.find(entry => entry.location === location.location);
      if (!existing) current.locations.push(location);
      else {
        // Similar labels must not collapse distinct orderable Fresa tasks.
        const ids = new Set(existing.variants.map(variant => variant.id));
        existing.variants.push(...location.variants.filter(variant => !ids.has(variant.id)));
      }
    }
  }
  return [...grouped.values()].map(product => {
    const varieties = new Set(product.locations.flatMap(location => location.variants.map(variant => variant.variety)).filter(Boolean));
    return { ...product, variety: varieties.size === 1 ? [...varieties][0] : null };
  });
}
