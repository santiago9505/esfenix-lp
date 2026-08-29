/**
 * Fresa catalog integration.
 *
 * This module is the build-time-only adapter for the remote catalog contract.
 * The browser never imports the fetch path: `npm run snapshot:catalog` uses it
 * to produce the checked-in snapshot consumed by the site.
 */

import { getCategoryLabel, resolveCategoryId } from '../data/categories.js';
import { LOCATIONS } from '../data/locations.js';
import { catalogOrderForFamily, resolveCatalogFamily } from '../data/catalog-taxonomy.js';
import { resolveSalesMeasures } from './sales-measures.js';
import { slugify } from './slug.js';
import { priceToCents, rememberVariantPrices } from './pricing.js';

export const FRESA_CATALOG_SOURCE_NAME = 'Landing Page';
// The native public API caps task pages at 200 rows and returns explicit page
// metadata. Keeping the adapter at that limit makes pagination deterministic.
const PAGE_LIMIT = 200;

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
 * Fetches every page from Fresa. The first page supplies the catalog metadata;
 * later pages only add products and are merged by product.id. Native task list
 * responses can lag behind task detail responses for attachments, so the
 * build-time snapshot may opt into detail hydration.
 */
export async function fetchCatalogPages({
  apiUrl,
  apiKey,
  expectedListId,
  listName,
  fetchImpl = globalThis.fetch,
  pageLimit = PAGE_LIMIT,
  hydrateAttachments = false,
  attachmentConcurrency = 12,
  attachmentTimeoutMs = 8000,
} = {}) {
  const baseUrl = String(apiUrl ?? '').trim();
  const token = String(apiKey ?? '').trim();

  if (!baseUrl) {
    throw new FresaCatalogError(
      0,
      'The catalog endpoint is not configured.',
    );
  }
  if (typeof fetchImpl !== 'function') {
    throw new FresaCatalogError(0, 'This browser cannot request the Fresa catalog.');
  }

  const requestPageLimit = Math.min(
    1000,
    Math.max(1, Math.floor(Number(pageLimit) || PAGE_LIMIT)),
  );

  let offset = 0;
  const visitedOffsets = new Set();
  const productsById = new Map();
  let metadata = null;

  while (!visitedOffsets.has(offset)) {
    visitedOffsets.add(offset);
    const url = new URL(
      baseUrl,
      typeof window === 'undefined' || !window.location?.href
        ? 'http://localhost/'
        : window.location.href,
    );
    url.searchParams.set('limit', String(requestPageLimit));
    url.searchParams.set('offset', String(offset));

    let response;
    try {
      response = await fetchImpl(url.toString(), {
        headers: token ? { Authorization: `Bearer ${token}` } : { Accept: 'application/json' },
        cache: token ? 'no-store' : 'no-cache',
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
    const isTaskApi = Array.isArray(data?.tasks);
    const tasks = isTaskApi && hydrateAttachments
      ? await hydrateTaskAttachments(data.tasks, {
          listUrl: url,
          apiKey: token,
          fetchImpl,
          concurrency: attachmentConcurrency,
          timeoutMs: attachmentTimeoutMs,
        })
      : data.tasks;
    const taskPage = isTaskApi
      ? adaptTaskApiPage(tasks, {
          expectedListId: safeString(expectedListId) || safeString(url.searchParams.get('listId')),
          listName: safeString(listName) || FRESA_CATALOG_SOURCE_NAME,
          offset,
          pageLimit: requestPageLimit,
          page: data?.page,
        })
      : null;
    const isWrappedCatalog = data?.catalog && typeof data.catalog === 'object';
    const rawProducts = taskPage?.products ?? (isWrappedCatalog && Array.isArray(data.catalog.products)
      ? data.catalog.products
      : Array.isArray(data?.records)
        ? data.records
        : null);
    const rawColumns = taskPage?.columns ?? (isWrappedCatalog ? data.catalog.columns : data?.columns);
    const rawLists = taskPage?.lists ?? (isWrappedCatalog ? data.catalog.lists : data?.lists);
    const rawPage = taskPage?.page ?? (isWrappedCatalog ? data.catalog.page : data?.page);
    const source = taskPage?.source ?? (isWrappedCatalog ? data.catalog : data?.source);

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
        limit: requestPageLimit,
        totalCount: productsById.size,
        hasMore: false,
        nextOffset: null,
      },
    },
  };
}

/**
 * The task list endpoint may expose an attachment column as an empty array
 * while the task detail endpoint already has the uploaded file. Hydrate only
 * those empty attachment fields and leave the list response untouched when a
 * detail request is unavailable.
 *
 * @param {Array<Record<string, any>>} tasks
 * @param {{ listUrl: URL, apiKey: string, fetchImpl: typeof fetch, concurrency?: number, timeoutMs?: number }} options
 */
async function hydrateTaskAttachments(tasks, options) {
  const candidates = tasks.filter((task) => Object.values(task?.custom_fields ?? {})
    .some((field) => normalizeLabel(field?.type) === 'attachments' && !hasAttachmentValue(field?.value)));
  if (candidates.length === 0) return tasks;

  const hydrated = await mapWithConcurrency(candidates, options.concurrency ?? 12, async (task) => {
    const taskId = safeString(task?.task_id);
    if (!taskId) return task;

    const detailUrl = new URL(options.listUrl.toString());
    detailUrl.search = '';
    detailUrl.pathname = `${detailUrl.pathname.replace(/\/$/, '')}/${encodeURIComponent(taskId)}`;

    try {
      const response = await fetchWithTimeout(options.fetchImpl, detailUrl.toString(), {
        headers: options.apiKey
          ? { Authorization: `Bearer ${options.apiKey}` }
          : { Accept: 'application/json' },
        cache: options.apiKey ? 'no-store' : 'no-cache',
      }, options.timeoutMs ?? 8000);
      if (!response?.ok) return task;
      const data = await response.json();
      const detail = data?.task;
      if (!detail || safeString(detail.list_id) !== safeString(task.list_id)) return task;
      return {
        ...task,
        custom_fields: {
          ...(task.custom_fields ?? {}),
          ...(detail.custom_fields ?? {}),
        },
      };
    } catch {
      return task;
    }
  });

  const byId = new Map(hydrated.map((task) => [safeString(task.task_id), task]));
  return tasks.map((task) => byId.get(safeString(task.task_id)) ?? task);
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {string} url
 * @param {RequestInit} init
 * @param {number} timeoutMs
 */
async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  let timer;
  let timedOut = false;
  try {
    return await Promise.race([
      fetchImpl(url, { ...init, signal: controller.signal }),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new Error('Fresa attachment detail timed out.'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (timedOut) controller.abort();
  }
}

/** @param {unknown} value */
function hasAttachmentValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value === null || value === undefined || value === '') return false;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

/**
 * @template T
 * @param {T[]} values
 * @param {number} concurrency
 * @param {(value: T, index: number) => Promise<T>} worker
 * @returns {Promise<T[]>}
 */
async function mapWithConcurrency(values, concurrency, worker) {
  const results = new Array(values.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(Number(concurrency) || 1, values.length));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await worker(values[index], index);
    }
  }));
  return results;
}

/**
 * Adapts the native Fresa v1 task response to the catalog normalization
 * boundary. Custom-field definitions travel beside each value, so no
 * integration-specific schema or business profile is required.
 *
 * @param {Array<Record<string, any>>} tasks
 * @param {{ expectedListId: string, listName: string, offset: number, pageLimit: number, page?: Record<string, any> }} options
 */
function adaptTaskApiPage(tasks, options) {
  const expectedListId = safeString(options.expectedListId);
  if (!expectedListId) {
    throw new FresaCatalogError(0, 'The native Fresa task endpoint must be configured with a listId.');
  }
  if (tasks.some((task) => safeString(task?.list_id) !== expectedListId)) {
    throw new FresaCatalogError(0, 'The catalog API returned tasks from an unexpected Fresa list.');
  }

  const columnsById = new Map();
  const products = tasks.map((task) => {
    const fields = {};
    for (const [fieldId, definition] of Object.entries(task?.custom_fields ?? {})) {
      if (!definition || typeof definition !== 'object') continue;
      fields[fieldId] = definition.value ?? null;
      if (!columnsById.has(fieldId)) {
        const fieldType = safeString(definition.type);
        columnsById.set(fieldId, {
          list_id: expectedListId,
          key: fieldId,
          field_id: fieldId,
          field_key: safeString(definition.key),
          field_name: safeString(definition.name),
          field_type: fieldType,
          is_file: normalizeLabel(fieldType) === 'attachments',
        });
      }
    }
    return {
      id: safeString(task.task_id),
      name: safeString(task.name),
      description: safeString(task.description) || null,
      listId: expectedListId,
      listName: options.listName,
      position: Number(task.position) || 0,
      fields,
      createdAt: safeString(task.created_at) || null,
      updatedAt: safeString(task.updated_at) || null,
    };
  });

  return {
    products,
    columns: [...columnsById.values()],
    lists: [{ list_id: expectedListId, name: options.listName }],
    source: { id: expectedListId, name: FRESA_CATALOG_SOURCE_NAME },
    page: {
      offset: Number(options.page?.offset) || options.offset,
      limit: Number(options.page?.limit) || options.pageLimit,
      hasMore: typeof options.page?.hasMore === 'boolean'
        ? options.page.hasMore
        : tasks.length === options.pageLimit,
      nextOffset: options.page?.nextOffset === null
        ? null
        : Number.isSafeInteger(Number(options.page?.nextOffset))
          ? Number(options.page.nextOffset)
          : tasks.length === options.pageLimit
            ? options.offset + options.pageLimit
            : null,
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
  if (sourceName !== normalizeLabel(FRESA_CATALOG_SOURCE_NAME)) {
    throw new FresaCatalogError(
      0,
      'The catalog API returned an unexpected Fresa data source.',
    );
  }

  const hasCatalogTaxonomy = Array.isArray(columns) && columns.some((column) => {
    const label = [column?.key, column?.field_key, column?.field_name, column?.client_role]
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

  return inheritImagesAcrossStemLengths(groupedProducts);
}

/**
 * A Fresa photo belongs to the flower option, not to a particular stem
 * length. When one length has a real upload, share it with variants in the
 * same catalog location whose variety, colour and attributes are identical.
 * Other locations, varieties, colours and products remain blank when they
 * have no upload.
 *
 * @param {Array<Record<string, any>>} products
 * @returns {Array<Record<string, any>>}
 */
export function inheritImagesAcrossStemLengths(products) {
  for (const product of products) {
    for (const location of product.locations ?? []) {
      const groups = new Map();

      for (const variant of location.variants ?? []) {
        const key = imageIdentityWithoutLength(variant);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(variant);
      }

      for (const variants of groups.values()) {
        const images = uniqueAttachments(
          variants.flatMap((variant) => (variant.images ?? []).filter(hasUsableImage)),
        );
        if (images.length === 0) continue;

        for (const variant of variants) {
          if (!hasUsableImage(variant.images)) variant.images = [...images];
        }
      }
    }

    // Keep the product gallery in sync with the variant galleries, while
    // preserving the source attachments already present at product level.
    product.images = uniqueAttachments([
      ...(product.images ?? []),
      ...(product.locations ?? []).flatMap((location) =>
        (location.variants ?? []).flatMap((variant) => variant.images ?? []),
      ),
    ]);
  }

  return products;
}

/** @param {Record<string, any>} variant */
function imageIdentityWithoutLength(variant) {
  return JSON.stringify([
    normalizeLabel(variant.variety),
    normalizeLabel(variant.color),
    Object.entries(variant.attributes ?? {})
      .map(([key, value]) => [normalizeLabel(key), normalizeLabel(value)])
      .sort(([a], [b]) => a.localeCompare(b)),
  ]);
}

/** @param {Record<string, any>} image */
function hasUsableImage(image) {
  return Boolean(String(image?.src ?? '').trim());
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
    sku: findColumn(columns, 'sku'),
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
  const variants = buildVariants(raw, fields, columns, roleColumns, category);
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
 * @param {string} category
 */
function buildVariants(raw, fields, columns, roleColumns, category) {
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
  const sku = safeString(firstScalar(readColumnValue(fields, roleColumns.sku))) || null;
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
    // and keep the applicable measure in the sales-unit field.
    const genericMeasure = values.measure[0] ?? 'unit';
    prices[genericMeasure] = readColumnValue(fields, genericPriceColumn);
  }
  const pricedMeasures = Object.entries(prices)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([measure]) => measure);
  const hasPriceDescriptor = explicitPriceColumns.length > 0 || Boolean(genericPriceColumn);
  const detectedMeasures = [...new Set([...values.measure, ...pricedMeasures])]
    .filter((measure) => {
      // When Fresa exposes a price column, an empty value means that metric is
      // not available for this product. Older/sparse fixtures without price
      // descriptors keep their declared sales unit unchanged.
      if (!hasPriceDescriptor) return true;
      return pricedMeasures.includes(measure);
    });
  const hasStemPrice = roleColumns.stemPrice
    ? prices.stem !== null && prices.stem !== undefined && prices.stem !== ''
    : null;
  const salesMeasureSignals = [...new Set([...values.measure, ...detectedMeasures])];
  const availableMeasures = resolveSalesMeasures(category, salesMeasureSignals, { hasStemPrice });

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
    .flatMap((column) => attachmentValues(readColumnValue(fields, column), {
      imageHint: isImageAttachmentColumn(column),
    }));
  const images = attachments.filter((attachment) => attachment.isImage);
  const files = attachments.filter((attachment) => !attachment.isImage);

  const variants = cartesianVariants(values);
  return variants.map((variant, index) => {
    const normalized = {
      id: `${safeString(raw.id)}__variant_${index + 1}`,
      sourceProductId: safeString(raw.id),
      sourceProductName: safeString(raw.name),
      sku,
      variety: variant.variety,
      color: variant.color,
      lengthCm: variant.lengthCm,
      availableMeasures,
      prices: Object.fromEntries(
        Object.entries(prices)
          .map(([measure, value]) => [measure, priceToCents(value)])
          .filter(([, cents]) => cents !== null),
      ),
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

/** @param {Array<Record<string, unknown>>} columns @param {'typeProduct'|'category'|'group'|'variety'|'color'|'lengthCm'|'measure'|'location'|'origin'|'isNew'|'sku'|'stemPrice'|'bunchPrice'|'unitPrice'|'packPrice'|'boxPrice'} role */
function findColumn(columns, role) {
  const aliases = ROLE_ALIASES[role];
  let best = null;
  let bestScore = 0;

  for (const column of columns) {
    const key = safeString(column.key);
    if (!key) continue;
    if (safeString(column.client_role) === role) return column;
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
    if (safeString(column.client_role) === 'genericPrice') return true;
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
  sku: ['formula sku', 'formula_sku', 'sku', 'product sku', 'stock keeping unit'],
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
function isImageAttachmentColumn(column) {
  const label = [column.key, column.field_key, column.field_name]
    .map(normalizeLabel)
    .join(' ');
  return /(^|\s)(image|images|photo|photos|picture|pictures|imagen|imagenes|foto|fotos|gallery|galeria)(\s|$)/.test(label);
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

/**
 * Fresa normally returns attachment arrays, but imported/native fields can
 * also expose one URL, an attachment object, or a wrapper around either.
 * Normalize all of those shapes at the integration boundary so the rest of
 * the catalog only deals with stable attachment records.
 *
 * @param {unknown} value
 * @param {{ imageHint?: boolean }} [options]
 */
function attachmentValues(value, options = {}) {
  return attachmentEntries(value)
    .map((file, index) => {
      const type = safeString(file.type ?? file.mimeType ?? file.mime_type ?? file.contentType);
      const url = attachmentUrl(file);
      const name = safeString(file.name) || attachmentName(url) || `Attachment ${index + 1}`;
      const isImage = file.isImage === true
        || file.is_image === true
        || type.toLocaleLowerCase().startsWith('image/')
        || looksLikeImageUrl(url)
        || (options.imageHint === true && Boolean(url));
      return {
        id: safeString(file.id) || `${name}-${index}`,
        contentKey: safeString(file.contentKey ?? file.content_key) || null,
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

/** @param {unknown} value @returns {Array<Record<string, any>>} */
function attachmentEntries(value) {
  if (Array.isArray(value)) return value.flatMap((entry) => attachmentEntries(entry));
  if (typeof value === 'string') return value.trim() ? [{ url: value.trim() }] : [];
  if (!value || typeof value !== 'object') return [];

  const file = /** @type {Record<string, any>} */ (value);
  if (attachmentUrl(file) || file.name || file.type || file.mimeType || file.isImage !== undefined) {
    return [file];
  }

  for (const key of ['value', 'files', 'attachments', 'data', 'items']) {
    if (Object.prototype.hasOwnProperty.call(file, key)) return attachmentEntries(file[key]);
  }

  return [];
}

/** @param {Record<string, any>} file */
function attachmentUrl(file) {
  for (const key of ['url', 'src', 'link', 'href', 'download_url', 'downloadUrl', 'file_url', 'fileUrl', 'path']) {
    const candidate = safeString(file?.[key]);
    if (candidate) return candidate;
  }
  return typeof file?.value === 'string' ? file.value.trim() || null : null;
}

/** @param {string|null} url */
function attachmentName(url) {
  if (!url) return '';
  try {
    const pathname = new URL(url, 'https://catalog.invalid/').pathname;
    return decodeURIComponent(pathname.split('/').pop() ?? '').trim();
  } catch {
    return '';
  }
}

/** @param {string|null} url */
function looksLikeImageUrl(url) {
  return Boolean(url && (/^data:image\//i.test(url) || /\.(?:avif|gif|jpe?g|png|svg|webp)(?:[?#]|$)/i.test(url)));
}

/** @param {Array<Record<string, unknown>>} attachments */
function uniqueAttachments(attachments) {
  const seen = new Set();
  return attachments.filter((attachment) => {
    const contentKey = safeString(attachment.contentKey ?? attachment.content_key).toLowerCase();
    const url = safeString(attachment.src ?? attachment.url);
    const key = contentKey
      ? `content:${contentKey}`
      : url
        ? `url:${url}`
        : `id:${safeString(attachment.id)}`;
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
