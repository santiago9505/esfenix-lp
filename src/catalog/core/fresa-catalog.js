/**
 * Fresa catalog integration.
 *
 * This module is the only place that knows the remote catalog contract. The
 * rest of the catalog works with the small display view produced by
 * normalizeCatalog(). Price metadata is kept in a private index for the
 * minimum-order rule; it is never added to that view or to quote payloads.
 * Attachment URLs stay in memory only and are refreshed whenever the catalog
 * cache is revalidated.
 */

import { getCategoryLabel, resolveCategoryId } from '../data/categories.js';
import { LOCATIONS } from '../data/locations.js';
import { catalogOrderForFamily, resolveCatalogFamily } from '../data/catalog-taxonomy.js';
import { slugify } from './slug.js';
import { applyLocalProductImageFallbacks } from './local-image-fallback.js';
import { rememberVariantPrices } from './pricing.js';

const env = typeof import.meta !== 'undefined' ? import.meta.env ?? {} : {};

export const FRESA_CATALOG_API_URL = String(env.FRESA_CATALOG_API_URL ?? '').trim();
export const FRESA_CATALOG_API_KEY = String(env.FRESA_CATALOG_API_KEY ?? '').trim();
export const FRESA_CATALOG_INTEGRATION_ID = String(env.FRESA_CATALOG_INTEGRATION_ID ?? '').trim();
// Fresa attachment URLs are signed for one hour. Revalidate halfway through
// that window so a warm browser avoids repeatedly downloading the full source
// while every cached URL is still valid.
export const FRESA_CATALOG_REVALIDATE_MS = 30 * 60_000;
export const FRESA_CATALOG_SOURCE_NAME = 'Landing Page';
// The public Fresa endpoint accepts up to 1,000 records. The production source
// currently has more than 1,300 rows, so this reduces six sequential requests
// to two without changing the response contract.
const PAGE_LIMIT = 1000;

let cachedCatalog = null;
let cacheExpiresAt = 0;
let pendingRequest = null;

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   description: string|null,
 *   listName: string,
 *   position: number,
 *   fields: Record<string, unknown>,
 *   columns: Array<Record<string, unknown>>,
 *   createdAt: string|null,
 *   updatedAt: string|null,
 * }} FresaProduct
 */

export class FresaCatalogError extends Error {
  /** @param {number} status @param {string} message @param {unknown} [cause] */
  constructor(status, message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'FresaCatalogError';
    this.status = status;
  }
}

/**
 * Loads all pages of the catalog. Calls within the revalidation window share the
 * same response; a failed request is never cached so Retry remains useful.
 *
 * @param {{
 *   force?: boolean,
 *   apiUrl?: string,
 *   apiKey?: string,
 *   fetchImpl?: typeof fetch,
 * }} [options]
 */
export function loadFresaCatalog(options = {}) {
  const now = Date.now();
  if (!options.force && cachedCatalog && now < cacheExpiresAt) {
    return Promise.resolve(cachedCatalog);
  }
  if (pendingRequest) return pendingRequest;

  pendingRequest = fetchCatalogPages(options)
    .then((payload) => {
      cachedCatalog = payload;
      cacheExpiresAt = Date.now() + FRESA_CATALOG_REVALIDATE_MS;
      return payload;
    })
    .finally(() => {
      pendingRequest = null;
    });

  return pendingRequest;
}

/** Clears the in-memory Fresa response. Useful for tests and explicit retry. */
export function resetFresaCatalogCache() {
  cachedCatalog = null;
  cacheExpiresAt = 0;
  pendingRequest = null;
}

/**
 * Fetches every page from Fresa. The first page supplies the catalog metadata;
 * later pages only add products and are merged by product.id.
 */
export async function fetchCatalogPages({
  apiUrl = FRESA_CATALOG_API_URL,
  apiKey = FRESA_CATALOG_API_KEY,
  fetchImpl = globalThis.fetch,
} = {}) {
  const baseUrl = String(apiUrl ?? '').trim();
  const token = String(apiKey ?? '').trim();

  if (!baseUrl || !token) {
    throw new FresaCatalogError(
      0,
      'Fresa catalog is not configured. Set FRESA_CATALOG_API_URL and FRESA_CATALOG_API_KEY.',
    );
  }
  const clientsApiKey = String(env.FRESA_CLIENTS_API_KEY ?? '').trim();
  if (clientsApiKey && token === clientsApiKey) {
    throw new FresaCatalogError(
      0,
      'The catalog API key must be different from the active-client API key.',
    );
  }
  if (typeof fetchImpl !== 'function') {
    throw new FresaCatalogError(0, 'This browser cannot request the Fresa catalog.');
  }

  let offset = 0;
  const visitedOffsets = new Set();
  const productsById = new Map();
  let metadata = null;

  while (!visitedOffsets.has(offset)) {
    visitedOffsets.add(offset);
    const url = new URL(baseUrl);
    url.searchParams.set('limit', String(PAGE_LIMIT));
    url.searchParams.set('offset', String(offset));

    let response;
    try {
      response = await fetchImpl(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
        // Keep signed attachment responses out of browser/CDN caches while the
        // catalog is revalidated in memory before signed URLs expire.
        cache: 'no-store',
      });
    } catch (error) {
      throw new FresaCatalogError(0, 'Fresa catalog is temporarily unavailable.', error);
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new FresaCatalogError(response.status, 'Fresa returned an invalid catalog response.', error);
    }

    if (!response.ok) {
      throw new FresaCatalogError(response.status, messageForStatus(response.status));
    }
    const isWrappedCatalog = data?.catalog && typeof data.catalog === 'object';
    const rawProducts = isWrappedCatalog && Array.isArray(data.catalog.products)
      ? data.catalog.products
      : Array.isArray(data?.records)
        ? data.records
        : null;
    const rawColumns = isWrappedCatalog ? data.catalog.columns : data?.columns;
    const rawLists = isWrappedCatalog ? data.catalog.lists : data?.lists;
    const rawPage = isWrappedCatalog ? data.catalog.page : data?.page;
    const source = isWrappedCatalog ? data.catalog : data?.source;

    if (offset === 0) assertCatalogSource(source, rawColumns);

    // Fresa currently returns two equivalent shapes depending on the source:
    // product catalogs may be wrapped as `catalog.products`, while the active
    // source endpoint returns `records` at the top level. Normalize both at
    // this boundary so the rest of the product pipeline stays unchanged.
    if (!data?.success || !Array.isArray(rawProducts)) {
      throw new FresaCatalogError(response.status, 'Fresa returned an invalid catalog response.');
    }

    metadata ??= {
      id: safeString(source?.id),
      name: safeString(source?.name),
      description: safeString(source?.description),
      updatedAt: safeString(source?.updatedAt),
      lists: Array.isArray(rawLists) ? rawLists : [],
      columns: Array.isArray(rawColumns) ? rawColumns : [],
      page: rawPage ?? null,
    };

    for (const product of rawProducts) {
      if (!product || typeof product !== 'object') continue;
      const id = safeString(product.id);
      if (!id || productsById.has(id)) continue;
      productsById.set(id, product);
    }

    const page = rawPage ?? {};
    if (!page.hasMore || page.nextOffset === null || page.nextOffset === undefined) break;
    const nextOffset = Number(page.nextOffset);
    if (!Number.isSafeInteger(nextOffset) || nextOffset < 0) break;
    offset = nextOffset;
  }

  return {
    success: true,
    catalog: {
      ...metadata,
      products: [...productsById.values()],
      page: {
        ...(metadata?.page ?? {}),
        offset: 0,
        limit: PAGE_LIMIT,
        totalCount: productsById.size,
        hasMore: false,
        nextOffset: null,
      },
    },
  };
}

/**
 * The response source is part of the security boundary. Never let a valid
 * `records` response from another Fresa source be interpreted as products.
 *
 * @param {Record<string, unknown>|null|undefined} source
 * @param {unknown} columns
 */
function assertCatalogSource(source, columns) {
  const sourceName = normalizeLabel(source?.name);
  const sourceId = safeString(source?.id);
  if (FRESA_CATALOG_INTEGRATION_ID) {
    if (sourceId !== FRESA_CATALOG_INTEGRATION_ID) {
      throw new FresaCatalogError(
        0,
        'The catalog API returned an unexpected Fresa integration.',
      );
    }
  } else if (sourceName !== normalizeLabel(FRESA_CATALOG_SOURCE_NAME)) {
    throw new FresaCatalogError(
      0,
      'The catalog API returned an unexpected Fresa data source.',
    );
  }

  const hasCatalogTaxonomy = Array.isArray(columns) && columns.some((column) => {
    const label = [column?.key, column?.field_key, column?.field_name]
      .map(normalizeLabel)
      .join(' ');
    return /category|categoria|type product|tipo producto|classification|clasificacion/.test(label);
  });

  if (!hasCatalogTaxonomy) {
    throw new FresaCatalogError(
      0,
      'The catalog API response does not contain the authorized product fields.',
    );
  }
}

/**
 * Converts the Fresa response into the existing catalog view model. Product
 * fields are read through catalog.columns[].key; raw field names are never
 * guessed from the product object itself.
 *
 * @param {{ catalog?: { id?: unknown, name?: unknown, products?: unknown[], columns?: unknown[], lists?: unknown[] } }} payload
 */
export function normalizeCatalog(payload) {
  const catalog = payload?.catalog ?? payload ?? {};
  const allColumns = Array.isArray(catalog.columns)
    ? catalog.columns
    : Array.isArray(payload?.columns)
      ? payload.columns
      : [];
  const sourceName = safeString(catalog.name) || safeString(payload?.source?.name);
  const sourceId = safeString(catalog.id) || safeString(payload?.source?.id);
  if (sourceName || sourceId) assertCatalogSource({ name: sourceName, id: sourceId }, allColumns);
  const columnsByList = new Map();

  for (const column of allColumns) {
    if (!column || typeof column !== 'object') continue;
    const listId = safeString(column.list_id);
    if (!listId) continue;
    if (!columnsByList.has(listId)) columnsByList.set(listId, []);
    columnsByList.get(listId).push(column);
  }

  const rawProducts = Array.isArray(catalog.products)
    ? catalog.products
    : Array.isArray(payload?.records)
      ? payload.records
      : [];
  const products = [];
  const seenIds = new Set();

  for (const raw of rawProducts) {
    if (!raw || typeof raw !== 'object') continue;
    const id = safeString(raw.id);
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);

    const columns = columnsByList.get(safeString(raw.listId)) ?? [];
    products.push(normalizeProduct(raw, columns));
  }

  const groupedProducts = groupProductFamilies(products);

  const usedSlugs = new Set();
  for (const product of groupedProducts) {
    const base = product.slug;
    let slug = base;
    if (usedSlugs.has(slug)) slug = `${base}-${slugify(product.id) || 'product'}`;
    let suffix = 2;
    while (usedSlugs.has(slug)) slug = `${base}-${suffix++}`;
    product.slug = slug;
    usedSlugs.add(slug);
  }

  return applyLocalProductImageFallbacks(groupedProducts);
}

/**
 * @param {Record<string, unknown>} raw
 * @param {Array<Record<string, unknown>>} columns
 */
function normalizeProduct(raw, columns) {
  const fields = raw.fields && typeof raw.fields === 'object' ? raw.fields : {};
  const listName = safeString(raw.listName) || 'Products';
  const roleColumns = {
    typeProduct: findColumn(columns, 'typeProduct'),
    category: findColumn(columns, 'category'),
    group: findColumn(columns, 'group'),
    variety: findColumn(columns, 'variety'),
    color: findColumn(columns, 'color'),
    lengthCm: findColumn(columns, 'lengthCm'),
    measure: findColumn(columns, 'measure'),
    location: findColumn(columns, 'location'),
    origin: findColumn(columns, 'origin'),
    isNew: findColumn(columns, 'isNew'),
    stemPrice: findColumn(columns, 'stemPrice'),
    bunchPrice: findColumn(columns, 'bunchPrice'),
    unitPrice: findColumn(columns, 'unitPrice'),
    packPrice: findColumn(columns, 'packPrice'),
    boxPrice: findColumn(columns, 'boxPrice'),
  };

  // Fresa's `type_product` is the catalog taxonomy. A generic `category`
  // column may contain a more specific family such as "Ecuadorian Roses" and
  // must not hide the broader filter value "Roses".
  const categoryValue = firstScalar(
    readColumnValue(fields, roleColumns.typeProduct) ??
      readColumnValue(fields, roleColumns.category),
  );
  const category =
    resolveCategoryId(categoryValue) ??
    resolveCategoryId(listName) ??
    'other-flowers';

  const groupValue = firstScalar(readColumnValue(fields, roleColumns.group));
  const groupLabel = safeString(groupValue) ||
    (resolveCategoryId(listName) ? getCategoryLabel(category) : listName);
  const variants = buildVariants(raw, fields, columns, roleColumns);
  const locationValue = firstScalar(readColumnValue(fields, roleColumns.location));
  const images = uniqueAttachments(variants.flatMap((variant) => variant.images ?? []));
  const files = uniqueAttachments(variants.flatMap((variant) => variant.files ?? []));
  const varietyValues = distinctVariantValues(variants, 'variety');
  // Fresa may return a generated description that embeds wholesale metrics
  // (for example, "Stem $0.84 | Bunch $21.00"). Keep those metrics private:
  // they are captured below for the internal minimum-order rule, but must
  // never enter the public product view.
  const description = sanitizeCatalogDescription(raw.description);
  const createdAt = safeString(raw.createdAt);
  const resolvedFamilyName = familyName(safeString(raw.name), variants);
  const familyMeta = resolveCatalogFamily(resolvedFamilyName);
  const resolvedCategory = familyMeta?.category ?? category;
  const resolvedGroupLabel = familyMeta?.groupLabel ?? groupLabel;
  const resolvedGroup = familyMeta?.group ?? (slugify(resolvedGroupLabel) || resolvedCategory);

  return {
    id: safeString(raw.id),
    slug: slugify(safeString(raw.name)) || slugify(safeString(raw.id)) || 'product',
    name: safeString(raw.name) || 'Unnamed product',
    description,
    category: resolvedCategory,
    group: resolvedGroup,
    groupLabel: resolvedGroupLabel,
    variety: varietyValues.length === 1 ? varietyValues[0] : null,
    images,
    files,
    isNew: parseBoolean(readColumnValue(fields, roleColumns.isNew)),
    createdAt,
    origin: safeString(firstScalar(readColumnValue(fields, roleColumns.origin))),
    listName,
    position: Number.isFinite(Number(raw.position)) ? Number(raw.position) : 0,
    locations: [
      {
        location: resolveCatalogSource(locationValue || listName),
        catalogAvailable: true,
        listName,
        variants,
      },
    ],
    catalogOrder: familyMeta?.order ?? catalogOrderForFamily(resolvedFamilyName),
    familyKey: familyMeta?.familyKey ?? buildFamilyKey(category, raw.name, variants),
    familyName: resolvedFamilyName,
  };
}

/**
 * Keeps editorial descriptions while dropping Fresa-generated descriptions
 * that contain monetary or price-labelled content.
 * @param {unknown} value
 * @returns {string|null}
 */
export function sanitizeCatalogDescription(value) {
  const description = safeString(value);
  if (!description) return null;

  const hasPriceReference = /[$€£]\s*\d|\b(?:price|precio|cost|costo)\b|\b(?:stem|bunch|unit|pack|box)\s*(?:price|precio)?\s*[:=]?\s*[$€£]?\s*\d/i.test(description);
  return hasPriceReference ? null : description;
}

/**
 * Multiple Fresa records can be one sellable family: `EC ROSES 60`, `EC ROSES
 * 70`, and `EC ROSES 80` should be one card with three selectable variants.
 * The first source id remains the product id for backwards-compatible quote
 * lines; every source id is retained on the family and its variants.
 *
 * @param {Array<Record<string, any>>} products
 */
function groupProductFamilies(products) {
  const groups = new Map();

  for (const product of products) {
    const key = product.familyKey || `${product.category}|${normalizeLabel(product.name)}`;
    const current = groups.get(key);
    if (!current) {
      groups.set(key, {
        ...product,
        name: product.familyName || product.name,
        slug: slugify(product.familyName || product.name) || product.slug,
        sourceProductIds: [product.id],
      });
      continue;
    }

    current.sourceProductIds.push(product.id);
    current.description ||= product.description;
    current.createdAt ||= product.createdAt;
    current.origin ||= product.origin;
    current.isNew ||= product.isNew;
    current.position = Math.min(current.position ?? 0, product.position ?? 0);
    current.catalogOrder = Math.min(current.catalogOrder ?? Number.MAX_SAFE_INTEGER, product.catalogOrder ?? Number.MAX_SAFE_INTEGER);
    current.images = uniqueAttachments([...(current.images ?? []), ...(product.images ?? [])]);
    current.files = uniqueAttachments([...(current.files ?? []), ...(product.files ?? [])]);
    current.locations = mergeLocations(current.locations, product.locations);
  }

  return [...groups.values()].map((product) => {
    const allVariants = product.locations.flatMap((location) => location.variants);
    const varieties = distinctVariantValues(allVariants, 'variety');
    const { familyKey, familyName: _familyName, ...clean } = product;
    clean.variety = varieties.length === 1 ? varieties[0] : null;
    return clean;
  });
}

/**
 * @param {Array<Record<string, any>>} left
 * @param {Array<Record<string, any>>} right
 */
function mergeLocations(left = [], right = []) {
  const byLocation = new Map(left.map((entry) => [entry.location, { ...entry, variants: [...entry.variants] }]));

  for (const entry of right) {
    const existing = byLocation.get(entry.location);
    if (!existing) {
      byLocation.set(entry.location, { ...entry, variants: [...entry.variants] });
      continue;
    }
    existing.variants = mergeVariants(existing.variants, entry.variants);
  }

  return [...byLocation.values()];
}

/**
 * Collapses repeated records with the same selectable combination while
 * preserving all direct attachment URLs available for that combination.
 * @param {Array<Record<string, any>>} left
 * @param {Array<Record<string, any>>} right
 */
function mergeVariants(left, right) {
  const byCombination = new Map();
  for (const variant of [...left, ...right]) {
    const key = [
      variant.variety ?? '',
      variant.color ?? '',
      variant.lengthCm ?? '',
      [...(variant.availableMeasures ?? [])].sort().join(','),
    ].join('|');
    const existing = byCombination.get(key);
    if (!existing) {
      byCombination.set(key, { ...variant });
      continue;
    }
    existing.images = uniqueAttachments([...(existing.images ?? []), ...(variant.images ?? [])]);
    existing.files = uniqueAttachments([...(existing.files ?? []), ...(variant.files ?? [])]);
    existing.sourceProductIds = [
      ...new Set([...(existing.sourceProductIds ?? []), variant.sourceProductId].filter(Boolean)),
    ];
  }
  return [...byCombination.values()];
}

/** @param {string} category @param {unknown} rawName @param {Array<Record<string, any>>} variants */
function buildFamilyKey(category, rawName, variants) {
  return [category, normalizeLabel(familyName(safeString(rawName), variants))].join('|');
}

/**
 * Removes values already represented by authorized variant fields from the
 * display name. A trailing 2–3 digit token is also treated as a size when
 * Fresa did not authorize a length field, which covers names such as
 * `EC ROSES 60` without creating a second product card.
 * @param {string} rawName
 * @param {Array<Record<string, any>>} variants
 */
function familyName(rawName, variants) {
  let result = rawName.trim();
  const tokens = new Set();
  for (const variant of variants) {
    for (const value of [variant.variety, variant.color, variant.lengthCm]) {
      if (value !== null && value !== undefined && String(value).trim()) tokens.add(String(value).trim());
    }
  }

  for (const token of [...tokens].sort((a, b) => b.length - a.length)) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(`(?:^|\\s|[-–—/])${escaped}(?=\\s|$|[-–—/])`, 'gi'), ' ');
  }

  result = result.replace(/(?:^|\s)(\d{2,3})(?:\s*cm)?\s*$/i, '');
  result = result.replace(/\s*[-–—/:|]\s*$/g, '').replace(/\s+/g, ' ').trim();
  return result || rawName.trim();
}

/**
 * @param {Record<string, unknown>} raw
 * @param {Record<string, unknown>} fields
 * @param {Array<Record<string, unknown>>} columns
 * @param {Record<string, Record<string, unknown>|null>} roleColumns
 */
function buildVariants(raw, fields, columns, roleColumns) {
  const explicitLengths = scalarValues(readColumnValue(fields, roleColumns.lengthCm))
    .map(parseLength)
    .filter((value) => value !== null);
  const nameLength = parseTrailingLength(raw.name);

  const values = {
    variety: scalarValues(readColumnValue(fields, roleColumns.variety)),
    color: scalarValues(readColumnValue(fields, roleColumns.color)),
    lengthCm: explicitLengths.length > 0 ? explicitLengths : nameLength === null ? [] : [nameLength],
    measure: scalarValues(readColumnValue(fields, roleColumns.measure))
      .map(normalizeMeasure)
      .filter(Boolean),
  };
  const explicitPriceColumns = [
    roleColumns.stemPrice,
    roleColumns.bunchPrice,
    roleColumns.unitPrice,
    roleColumns.packPrice,
    roleColumns.boxPrice,
  ].filter(Boolean);
  const genericPriceColumn = explicitPriceColumns.length === 0
    ? findGenericPriceColumn(columns, roleColumns)
    : null;
  const prices = {
    stem: readColumnValue(fields, roleColumns.stemPrice),
    bunch: readColumnValue(fields, roleColumns.bunchPrice),
    unit: readColumnValue(fields, roleColumns.unitPrice),
    pack: readColumnValue(fields, roleColumns.packPrice),
    box: readColumnValue(fields, roleColumns.boxPrice),
  };
  if (genericPriceColumn) {
    // Some Fresa lists expose one currency column such as `Wholesale amount`
    // and keep the applicable measure in the sales-unit field. Keep that price
    // private, but attach it to the internal measure used by the quote line.
    const genericMeasure = values.measure[0] ?? 'unit';
    prices[genericMeasure] = readColumnValue(fields, genericPriceColumn);
  }
  const pricedMeasures = Object.entries(prices)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([measure]) => measure);
  const hasPriceDescriptor = explicitPriceColumns.length > 0 || Boolean(genericPriceColumn);
  const availableMeasures = [...new Set([...values.measure, ...pricedMeasures])]
    .filter((measure) => {
      // When Fresa exposes a price column, an empty value means that metric is
      // not available for this product. Older/sparse fixtures without price
      // descriptors keep their declared sales unit unchanged.
      if (!hasPriceDescriptor) return true;
      return pricedMeasures.includes(measure);
    });

  const customColumns = columns.filter((column) => {
    if (!safeString(column.key)) return false;
    if (isAttachmentColumn(column)) return false;
    if (isPrivateColumn(column) || isMetadataColumn(column)) return false;
    return !Object.values(roleColumns).includes(column);
  });

  const attributes = Object.fromEntries(
    customColumns
      .map((column) => {
        const value = firstScalar(readColumnValue(fields, column));
        return [safeString(column.field_name) || safeString(column.key), safeAttributeValue(value)];
      })
      .filter(([key, value]) => key && value !== null),
  );

  const attachments = columns
    .filter(isAttachmentColumn)
    .flatMap((column) => attachmentValues(readColumnValue(fields, column)));
  const images = attachments.filter((attachment) => attachment.isImage);
  const files = attachments.filter((attachment) => !attachment.isImage);

  const variants = cartesianVariants(values);
  return variants.map((variant, index) => {
    const normalized = {
      id: `${safeString(raw.id)}__variant_${index + 1}`,
    sourceProductId: safeString(raw.id),
    variety: variant.variety,
    color: variant.color,
    lengthCm: variant.lengthCm,
    availableMeasures,
    attributes,
    images,
    files,
    };
    rememberVariantPrices(normalized, prices);
    return normalized;
  });
}

/** @param {unknown} value */
function parseTrailingLength(value) {
  const match = safeString(value).match(/(?:^|\s)(\d{2,3})(?:\s*cm)?\s*$/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

/** @param {{ variety: unknown[], color: unknown[], lengthCm: unknown[], measure: unknown[] }} values */
function cartesianVariants(values) {
  const dimensions = [
    ['variety', values.variety],
    ['color', values.color],
    ['lengthCm', values.lengthCm],
  ].filter(([, entries]) => entries.length > 0);

  if (dimensions.length === 0) {
    return [{ variety: null, color: null, lengthCm: null }];
  }

  return dimensions.reduce(
    (rows, [key, entries]) =>
      rows.flatMap((row) => entries.map((value) => ({ ...row, [key]: value }))),
    [{ variety: null, color: null, lengthCm: null }],
  );
}

/** @param {Array<Record<string, unknown>>} columns @param {'typeProduct'|'category'|'group'|'variety'|'color'|'lengthCm'|'measure'|'location'|'origin'|'isNew'|'stemPrice'|'bunchPrice'|'unitPrice'|'packPrice'|'boxPrice'} role */
function findColumn(columns, role) {
  const aliases = ROLE_ALIASES[role];
  let best = null;
  let bestScore = 0;

  for (const column of columns) {
    const key = safeString(column.key);
    if (!key) continue;
    const labels = [key, column.field_key, column.field_name].map(normalizeLabel).filter(Boolean);
    let score = 0;
    for (const label of labels) {
      for (const alias of aliases) {
        const normalizedAlias = normalizeLabel(alias);
        if (label === normalizedAlias) score = Math.max(score, 100);
        else if (label.includes(normalizedAlias)) score = Math.max(score, 50);
      }
    }
    if (score > bestScore) {
      best = column;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Fresa also supports one generic currency field instead of one field per
 * measure. It must be found only after the measure-specific roles are checked,
 * otherwise a `stem_price` field could be mistaken for a generic amount.
 *
 * @param {Array<Record<string, unknown>>} columns
 * @param {Record<string, Record<string, unknown>|null>} roleColumns
 */
function findGenericPriceColumn(columns, roleColumns) {
  const usedKeys = new Set(
    Object.values(roleColumns)
      .filter(Boolean)
      .map((column) => safeString(column.key)),
  );
  const genericLabel = /\b(?:wholesale|sale|selling)\s+(?:amount|price)\b|\b(?:amount|monto|rate|tarifa|price|precio)\b/;
  const monetaryType = /currency|money|decimal|number|amount|moneda|dinero/;

  return columns.find((column) => {
    if (usedKeys.has(safeString(column.key))) return false;
    const label = [column.key, column.field_key, column.field_name, column.name, column.label, column.title]
      .map(normalizeLabel)
      .join(' ');
    const type = normalizeLabel(column.field_type ?? column.type ?? column.data_type);
    return monetaryType.test(type) && genericLabel.test(label);
  }) ?? null;
}

const ROLE_ALIASES = {
  typeProduct: ['type product', 'type_product', 'product type', 'tipo producto', 'tipo de producto'],
  category: ['category', 'categoria', 'type product', 'tipo producto', 'classification', 'clasificacion'],
  group: ['group', 'grupo', 'family', 'familia', 'subcategory', 'subcategoria'],
  variety: ['variety', 'variedad', 'variedades', 'flower variety', 'tipo de flor'],
  color: ['color', 'colour', 'colores', 'tono', 'tonalidad'],
  lengthCm: ['stem length', 'length cm', 'longitud del tallo', 'longitud', 'size cm', 'size', 'tamaño', 'tamano', 'tallo'],
  measure: ['measure', 'medida', 'unit', 'unidad', 'sales unit', 'presentacion', 'presentation'],
  location: ['location', 'ubicacion', 'sede', 'branch', 'market', 'region'],
  origin: ['origin', 'origen', 'grown in', 'procedencia'],
  isNew: ['is new', 'new', 'nuevo', 'novedad'],
  stemPrice: ['stem price', 'stem_price', 'price per stem', 'precio por tallo'],
  bunchPrice: ['bunch price', 'bunch_price', 'price per bunch', 'precio por ramo'],
  unitPrice: ['unit price', 'unit_price', 'price per unit', 'precio por unidad'],
  packPrice: ['pack price', 'pack_price', 'price per pack', 'precio por paquete'],
  boxPrice: ['box price', 'box_price', 'price per box', 'precio por caja'],
};

/** @param {Record<string, unknown>} fields @param {Record<string, unknown>|null} column */
function readColumnValue(fields, column) {
  if (!column) return null;
  const key = safeString(column.key);
  return key && Object.prototype.hasOwnProperty.call(fields, key) ? fields[key] : null;
}

/** @param {Record<string, unknown>} column */
function isAttachmentColumn(column) {
  return column.is_file === true || normalizeLabel(column.field_type) === 'attachments';
}

/** @param {Record<string, unknown>} column */
function isPrivateColumn(column) {
  const label = [column.key, column.field_key, column.field_name, column.field_type]
    .map(normalizeLabel)
    .join(' ');
  return /price|precio|currency|moneda|discount|descuento|subtotal|total|amount|monto|cost|costo|tarifa/.test(label);
}

/** @param {Record<string, unknown>} column */
function isMetadataColumn(column) {
  const label = [column.key, column.field_key, column.field_name]
    .map(normalizeLabel)
    .join(' ');
  return /fully qualified name|item id|sync token|active|qty on hand|income account|expense account|product status|product sequence|formula sku|purchase desc|inv start date|barcode|sku/.test(label);
}

/** @param {unknown} value @returns {unknown[]} */
function scalarValues(value) {
  if (Array.isArray(value)) return value.flatMap((entry) => scalarValues(entry));
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

/** @param {unknown} value */
function firstScalar(value) {
  return scalarValues(value)[0] ?? null;
}

/** @param {unknown} value */
function parseLength(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const match = String(value ?? '').match(/-?\d+(?:[.,]\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0].replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/** @param {unknown} value */
function normalizeMeasure(value) {
  const normalized = normalizeLabel(value);
  if (!normalized) return null;
  const known = {
    stem: 'stem',
    stems: 'stem',
    tallo: 'stem',
    bunch: 'bunch',
    bunches: 'bunch',
    ramo: 'bunch',
    unidad: 'unit',
    unit: 'unit',
    pack: 'pack',
    paquete: 'pack',
    box: 'box',
    caja: 'box',
  };
  return known[normalized] ?? String(value).trim();
}

/** @param {unknown} value */
function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'yes', 'si', 'sí', 'new', 'nuevo'].includes(normalizeLabel(value));
}

/** @param {unknown} value */
function safeAttributeValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}

/**
 * Maps Fresa's location value to the existing location source ids. The
 * catalog currently calls Houston's list "Texas", while its authorized
 * product field says "Houston"; both must feed the same existing catalog.
 * @param {unknown} value
 */
function resolveCatalogSource(value) {
  const normalized = normalizeLabel(value);
  if (!normalized) return '';

  const match = LOCATIONS.find((location) => {
    const candidates = [location.id, location.catalogSource, location.label.split(',')[0]];
    return candidates.some((candidate) => normalizeLabel(candidate) === normalized);
  });
  if (match) return match.catalogSource;
  if (normalized === 'texas') return 'houston';
  return slugify(safeString(value)) || safeString(value);
}

/** @param {unknown} value */
function safeString(value) {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value.trim() : String(value).trim();
}

/** @param {unknown} value */
function normalizeLabel(value) {
  return safeString(value)
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** @param {unknown} value */
function attachmentValues(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((file) => file && typeof file === 'object')
    .map((file, index) => {
      const type = safeString(file.type);
      const name = safeString(file.name) || `Attachment ${index + 1}`;
      const url = safeString(file.url) || null;
      const isImage = file.isImage === true || type.toLocaleLowerCase().startsWith('image/');
      return {
        id: safeString(file.id) || `${name}-${index}`,
        name,
        type,
        size: Number.isFinite(Number(file.size)) ? Number(file.size) : null,
        isImage,
        url,
        src: isImage ? url : null,
        alt: name,
      };
    });
}

/** @param {Array<Record<string, unknown>>} attachments */
function uniqueAttachments(attachments) {
  const seen = new Set();
  return attachments.filter((attachment) => {
    const key = `${attachment.id}|${attachment.url ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** @param {Array<Record<string, unknown>>} variants @param {'variety'|'color'} key */
function distinctVariantValues(variants, key) {
  return [...new Set(variants.map((variant) => variant[key]).filter(Boolean))];
}

function messageForStatus(status) {
  if (status === 401) return 'The Fresa catalog key is invalid or the catalog is inactive.';
  if (status === 403) return 'This landing domain is not authorized to read the Fresa catalog.';
  if (status >= 500) return 'Fresa is temporarily unavailable. Please try again shortly.';
  return 'The Fresa catalog could not be loaded. Please try again.';
}
