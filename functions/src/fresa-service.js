import { createHash } from 'node:crypto';

const CATALOG_PAGE_LIMIT = 1000;
const CLIENT_PAGE_LIMIT = 1000;
const MAX_PAGES = 20;
const FETCH_TIMEOUT_MS = 12_000;
const CATALOG_TTL_MS = 30 * 60_000;
const CLIENTS_TTL_MS = 60_000;
const DELIVERY_MINIMUM_CENTS = 15_000;

const MEASURES = new Set(['stem', 'bunch', 'unit', 'pack', 'box']);

const ROLE_ALIASES = {
  typeProduct: ['type product', 'type_product', 'product type', 'tipo producto', 'tipo de producto'],
  category: ['category', 'categoria', 'type product', 'tipo producto', 'classification', 'clasificacion'],
  group: ['group', 'grupo', 'family', 'familia', 'subcategory', 'subcategoria'],
  variety: ['variety', 'variedad', 'variedades', 'flower variety', 'tipo de flor'],
  color: ['color', 'colour', 'colores', 'tono', 'tonalidad'],
  lengthCm: ['stem length', 'length cm', 'longitud del tallo', 'longitud', 'size cm', 'size', 'tamano', 'tallo'],
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

const PRICE_ROLES = new Set(['stemPrice', 'bunchPrice', 'unitPrice', 'packPrice', 'boxPrice', 'genericPrice']);

const EMAIL_ALIASES = ['email', 'e mail', 'correo', 'correo electronico'];
const ACTIVE_ALIASES = ['activo', 'activa', 'active', 'enabled', 'habilitado'];
const ACTIVE_EXACT_ALIASES = ['estado', 'estatus', 'status'];
const FIRST_NAME_ALIASES = ['nombre contacto', 'first name', 'firstname', 'contact name', 'nombre'];
const LAST_NAME_ALIASES = ['apellido contacto', 'last name', 'lastname', 'surname', 'apellido'];
const FULL_NAME_ALIASES = ['nombre completo qb', 'nombre completo', 'full name', 'display name'];
const VIP_ALIASES = ['vip', 'cliente vip', 'es vip', 'vip cliente', 'cliente preferencial', 'preferencial'];

let catalogCache = null;
let catalogCacheKey = '';
let catalogExpiresAt = 0;
let catalogPending = null;
let clientsCache = null;
let clientsCacheKey = '';
let clientsExpiresAt = 0;
let clientsPending = null;

export class FresaServiceError extends Error {
  constructor(status, message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'FresaServiceError';
    this.status = status;
  }
}

export async function loadCatalog(options) {
  const cacheKey = `${options.apiUrl}|${options.integrationId ?? ''}`;
  const now = Date.now();
  if (catalogCache && catalogCacheKey === cacheKey && now < catalogExpiresAt) return catalogCache;
  if (catalogPending && catalogCacheKey === cacheKey) return catalogPending;

  catalogCacheKey = cacheKey;
  catalogPending = fetchCatalogPages(options)
    .then((catalog) => {
      catalogCache = catalog;
      catalogExpiresAt = Date.now() + CATALOG_TTL_MS;
      return catalog;
    })
    .finally(() => {
      catalogPending = null;
    });
  return catalogPending;
}

export async function publicCatalog(options) {
  const raw = await loadCatalog(options);
  const payload = sanitizeCatalog(raw);
  const serialized = JSON.stringify(payload);
  return {
    payload,
    serialized,
    etag: `"${createHash('sha256').update(serialized).digest('base64url')}"`,
  };
}

export async function findClientByEmail(email, options) {
  const normalizedEmail = normalizeEmail(email);
  if (!isEmail(normalizedEmail)) return null;
  const directory = await loadClientDirectory(options);
  return directory.get(normalizedEmail) ?? null;
}

export async function quotePricing(items, options) {
  const safeItems = normalizePricingItems(items);
  const catalog = await loadCatalog(options);
  const columns = Array.isArray(catalog.columns) ? catalog.columns : [];
  const products = Array.isArray(catalog.products) ? catalog.products : [];
  const byId = new Map(products.map((product) => [safeString(product?.id), product]));
  const columnsByList = groupColumnsByList(columns);
  let totalCents = 0;
  let unknownCount = 0;

  for (const item of safeItems) {
    const product = byId.get(item.sourceProductId);
    if (!product) {
      unknownCount += 1;
      continue;
    }
    const productColumns = columnsByList.get(safeString(product.listId)) ?? columns;
    const cents = productPriceCents(product, productColumns, item.measure);
    if (cents === null) {
      unknownCount += 1;
      continue;
    }
    totalCents += cents * item.quantity;
  }

  const calculatedProgress = Math.min(100, Math.floor((totalCents / DELIVERY_MINIMUM_CENTS) * 100));
  return {
    hasUnknownPricing: unknownCount > 0,
    deliveryProgress: unknownCount > 0 ? Math.min(99, calculatedProgress) : calculatedProgress,
    deliveryAllowed: safeItems.length > 0 && unknownCount === 0 && totalCents >= DELIVERY_MINIMUM_CENTS,
  };
}

async function fetchCatalogPages({ apiUrl, apiKey, integrationId, fetchImpl = fetch }) {
  if (!apiUrl || !apiKey) throw new FresaServiceError(500, 'The catalog service is not configured.');
  const productsById = new Map();
  let metadata = null;
  let offset = 0;
  const seenOffsets = new Set();

  while (!seenOffsets.has(offset) && seenOffsets.size < MAX_PAGES) {
    seenOffsets.add(offset);
    const url = new URL(apiUrl);
    url.searchParams.set('limit', String(CATALOG_PAGE_LIMIT));
    url.searchParams.set('offset', String(offset));
    const data = await fetchJson(url, apiKey, fetchImpl);
    const wrapped = data?.catalog && typeof data.catalog === 'object';
    const source = wrapped ? data.catalog : data?.source;
    const rawProducts = wrapped ? data.catalog?.products : data?.records;
    const rawColumns = wrapped ? data.catalog?.columns : data?.columns;
    const rawPage = wrapped ? data.catalog?.page : data?.page;

    if (offset === 0) assertSource(source, rawColumns, integrationId, 'Landing Page');
    if (data?.success !== true || !Array.isArray(rawProducts)) {
      throw new FresaServiceError(502, 'Fresa returned an invalid catalog response.');
    }

    metadata ??= {
      name: safeString(source?.name) || 'Landing Page',
      columns: Array.isArray(rawColumns) ? rawColumns : [],
      products: [],
    };
    for (const product of rawProducts) {
      const id = safeString(product?.id);
      if (id && !productsById.has(id)) productsById.set(id, product);
    }

    if (!rawPage?.hasMore || rawPage.nextOffset === null || rawPage.nextOffset === undefined) break;
    const nextOffset = Number(rawPage.nextOffset);
    if (!Number.isSafeInteger(nextOffset) || nextOffset <= offset) break;
    offset = nextOffset;
  }

  return { ...metadata, products: [...productsById.values()] };
}

async function loadClientDirectory(options) {
  const cacheKey = `${options.apiUrl}|${options.integrationId ?? ''}`;
  const now = Date.now();
  if (clientsCache && clientsCacheKey === cacheKey && now < clientsExpiresAt) return clientsCache;
  if (clientsPending && clientsCacheKey === cacheKey) return clientsPending;

  clientsCacheKey = cacheKey;
  clientsPending = fetchClientPages(options)
    .then(({ columns, records }) => buildClientDirectory(columns, records))
    .then((directory) => {
      clientsCache = directory;
      clientsExpiresAt = Date.now() + CLIENTS_TTL_MS;
      return directory;
    })
    .finally(() => {
      clientsPending = null;
    });
  return clientsPending;
}

async function fetchClientPages({ apiUrl, apiKey, integrationId, fetchImpl = fetch }) {
  if (!apiUrl || !apiKey) throw new FresaServiceError(500, 'The client lookup service is not configured.');
  const columns = [];
  const records = [];
  const seenIds = new Set();
  const seenOffsets = new Set();
  let offset = 0;

  while (!seenOffsets.has(offset) && seenOffsets.size < MAX_PAGES) {
    seenOffsets.add(offset);
    const url = new URL(apiUrl);
    url.searchParams.set('limit', String(CLIENT_PAGE_LIMIT));
    url.searchParams.set('offset', String(offset));
    const data = await fetchJson(url, apiKey, fetchImpl);
    const wrapped = data?.catalog ?? data;
    const source = data?.source ?? wrapped?.source ?? null;
    if (offset === 0) assertSource(source, wrapped?.columns, integrationId, 'Clientes Activos');
    if (data?.success !== true || !Array.isArray(wrapped?.records ?? wrapped?.products)) {
      throw new FresaServiceError(502, 'Fresa returned an invalid client directory.');
    }
    for (const column of wrapped.columns ?? []) {
      if (column?.key && !columns.some((current) => current.key === column.key)) columns.push(column);
    }
    const chunk = wrapped.records ?? wrapped.products ?? [];
    for (const record of chunk) {
      const id = safeString(record?.id);
      if (id && !seenIds.has(id)) {
        seenIds.add(id);
        records.push(record);
      }
    }
    const page = wrapped.page ?? null;
    if (!page?.hasMore || page.nextOffset === null || page.nextOffset === undefined) break;
    const nextOffset = Number(page.nextOffset);
    if (!Number.isSafeInteger(nextOffset) || nextOffset <= offset) break;
    const total = Number(page.totalCount);
    if (Number.isFinite(total) && nextOffset >= total) break;
    offset = nextOffset;
  }
  return { columns, records };
}

async function fetchJson(url, apiKey, fetchImpl) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        lastError = new FresaServiceError(response.status, `Fresa responded with ${response.status}.`);
        if (response.status === 429 || response.status >= 500) continue;
        throw lastError;
      }
      const data = await response.json();
      return data;
    } catch (error) {
      lastError = error instanceof FresaServiceError
        ? error
        : new FresaServiceError(502, 'Fresa is temporarily unavailable.', error);
    }
  }
  throw lastError ?? new FresaServiceError(502, 'Fresa is temporarily unavailable.');
}

function assertSource(source, columns, integrationId, expectedName) {
  const actualId = safeString(source?.id);
  const actualName = normalizeLabel(source?.name);
  if (integrationId ? actualId !== integrationId : actualName !== normalizeLabel(expectedName)) {
    throw new FresaServiceError(502, 'Fresa returned an unexpected data source.');
  }
  if (!Array.isArray(columns)) throw new FresaServiceError(502, 'Fresa returned an invalid schema.');
}

function sanitizeCatalog(catalog) {
  const columns = Array.isArray(catalog.columns) ? catalog.columns : [];
  const classified = classifyColumns(columns);
  const allowedByList = new Map();
  for (const entry of classified) {
    const listId = safeString(entry.column.list_id);
    if (!allowedByList.has(listId)) allowedByList.set(listId, new Map());
    allowedByList.get(listId).set(safeString(entry.column.key), entry);
  }

  return {
    success: true,
    catalog: {
      name: 'Landing Page',
      columns: classified.map(({ column, role }) => ({
        key: safeString(column.key),
        list_id: safeString(column.list_id),
        client_role: role,
        field_type: role === 'attachment' ? 'attachments' : role,
        is_file: role === 'attachment',
      })),
      products: (catalog.products ?? []).map((product) => {
        const fields = product?.fields && typeof product.fields === 'object' ? product.fields : {};
        const allowed = allowedByList.get(safeString(product?.listId)) ?? new Map();
        const publicFields = {};
        for (const [key, entry] of allowed) {
          if (!Object.prototype.hasOwnProperty.call(fields, key)) continue;
          publicFields[key] = PRICE_ROLES.has(entry.role)
            ? fields[key] !== null && fields[key] !== ''
            : entry.role === 'attachment'
              ? sanitizeAttachments(fields[key])
              : sanitizeScalarValue(fields[key]);
        }
        return {
          id: bounded(product?.id, 160),
          listId: bounded(product?.listId, 160),
          listName: bounded(product?.listName, 160),
          name: bounded(product?.name, 240),
          description: sanitizeDescription(product?.description),
          position: Number.isFinite(Number(product?.position)) ? Number(product.position) : 0,
          createdAt: bounded(product?.createdAt, 64),
          fields: publicFields,
        };
      }).filter((product) => product.id && product.name),
      page: { offset: 0, limit: CATALOG_PAGE_LIMIT, hasMore: false, nextOffset: null },
    },
  };
}

function classifyColumns(columns) {
  const columnsByList = groupColumnsByList(columns);
  const classified = [];

  for (const listColumns of columnsByList.values()) {
    classified.push(...classifyListColumns(listColumns));
  }

  return classified;
}

function classifyListColumns(columns) {
  const classified = [];
  const used = new Set();
  for (const role of Object.keys(ROLE_ALIASES)) {
    const column = findRoleColumn(columns, role, used);
    if (!column) continue;
    used.add(safeString(column.key));
    classified.push({ column, role });
  }
  const genericPrice = findGenericPriceColumn(columns, used);
  if (genericPrice) {
    used.add(safeString(genericPrice.key));
    classified.push({ column: genericPrice, role: 'genericPrice' });
  }
  for (const column of columns) {
    const key = safeString(column?.key);
    if (!key || used.has(key) || !isAttachmentColumn(column)) continue;
    used.add(key);
    classified.push({ column, role: 'attachment' });
  }
  return classified;
}

function findRoleColumn(columns, role, used = new Set()) {
  let best = null;
  let score = 0;
  for (const column of columns) {
    if (!column?.key || used.has(safeString(column.key))) continue;
    const labels = columnLabels(column);
    for (const label of labels) {
      for (const alias of ROLE_ALIASES[role] ?? []) {
        const normalizedAlias = normalizeLabel(alias);
        const candidate = label === normalizedAlias ? 100 : label.includes(normalizedAlias) ? 50 : 0;
        if (candidate > score) {
          best = column;
          score = candidate;
        }
      }
    }
  }
  return best;
}

function findGenericPriceColumn(columns, used = new Set()) {
  const labelPattern = /\b(?:wholesale|sale|selling)\s+(?:amount|price)\b|\b(?:amount|monto|rate|tarifa|price|precio)\b/;
  const typePattern = /currency|money|decimal|number|amount|moneda|dinero/;
  return columns.find((column) => {
    if (!column?.key || used.has(safeString(column.key))) return false;
    return typePattern.test(normalizeLabel(column.field_type ?? column.type ?? column.data_type))
      && labelPattern.test(columnLabels(column).join(' '));
  }) ?? null;
}

function productPriceCents(product, columns, measure) {
  if (!MEASURES.has(measure)) return null;
  const role = `${measure}Price`;
  const used = new Set();
  const roleColumn = findRoleColumn(columns, role, used);
  if (roleColumn) return priceToCents(product?.fields?.[roleColumn.key]);

  for (const specificRole of ['stemPrice', 'bunchPrice', 'unitPrice', 'packPrice', 'boxPrice']) {
    const column = findRoleColumn(columns, specificRole, used);
    if (column) used.add(safeString(column.key));
  }
  const generic = findGenericPriceColumn(columns, used);
  if (!generic) return null;
  const measureColumn = findRoleColumn(columns, 'measure');
  const recordedMeasure = normalizeMeasure(product?.fields?.[measureColumn?.key]);
  return recordedMeasure === measure ? priceToCents(product?.fields?.[generic.key]) : null;
}

function normalizePricingItems(items) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
    throw new FresaServiceError(400, 'Invalid quote items.');
  }
  return items.map((item) => {
    const sourceProductId = bounded(item?.sourceProductId, 160);
    const measure = normalizeMeasure(item?.measure);
    const quantity = Number(item?.quantity);
    if (!sourceProductId || !MEASURES.has(measure) || !Number.isInteger(quantity) || quantity < 1 || quantity > 10_000) {
      throw new FresaServiceError(400, 'Invalid quote item.');
    }
    return { sourceProductId, measure, quantity };
  });
}

function buildClientDirectory(columns, records) {
  const emailColumn = findClientColumn(columns, EMAIL_ALIASES, { preferredType: 'email', records });
  if (!emailColumn) throw new FresaServiceError(502, 'The client directory has no email field.');
  const activeColumn = findClientColumn(columns, ACTIVE_ALIASES, { exactAliases: ACTIVE_EXACT_ALIASES, records });
  const directory = new Map();
  for (const record of records) {
    if (activeColumn && !isChecked(record?.fields?.[activeColumn.key])) continue;
    const email = normalizeEmail(record?.fields?.[emailColumn.key]);
    if (!isEmail(email) || directory.has(email)) continue;
    directory.set(email, clientProfile(email, record, columns));
  }
  return directory;
}

function clientProfile(email, record, columns) {
  let firstName = clientField(record, columns, FIRST_NAME_ALIASES);
  let lastName = clientField(record, columns, LAST_NAME_ALIASES);
  if (!firstName && !lastName) {
    const parts = clientField(record, columns, FULL_NAME_ALIASES).split(/\s+/).filter(Boolean);
    firstName = parts[0] ?? '';
    lastName = parts.slice(1).join(' ');
  }
  const vipColumn = findClientColumn(columns, VIP_ALIASES, { records: [record] });
  return {
    email,
    firstName: bounded(firstName, 80),
    lastName: bounded(lastName, 80),
    phone: bounded(clientField(record, columns, ['telefono', 'phone number', 'phone', 'movil', 'mobile', 'numero telefono']), 40),
    company: bounded(clientField(record, columns, ['empresa', 'company name', 'company', 'nombre empresa']), 120),
    shipping: {
      address: bounded(clientField(record, columns, ['envio direccion', 'shipping address', 'delivery address']), 160),
      city: bounded(clientField(record, columns, ['envio ciudad', 'shipping city', 'delivery city']), 80),
      state: bounded(clientField(record, columns, ['envio estado', 'shipping state', 'delivery state']), 80),
      zipCode: bounded(clientField(record, columns, ['envio codigo postal', 'shipping postal code', 'delivery postal code', 'zip code', 'postal code']), 20),
      country: bounded(clientField(record, columns, ['envio pais', 'shipping country', 'delivery country']), 80),
    },
    ...(vipColumn && isChecked(record?.fields?.[vipColumn.key]) ? { vip: true } : {}),
  };
}

function findClientColumn(columns, aliases, { preferredType = null, exactAliases = [], records = [] } = {}) {
  const normalized = columns.map((column) => ({
    column,
    labels: columnLabels(column),
    type: normalizeLabel(column.field_type ?? column.type ?? column.data_type),
  }));
  if (preferredType) {
    const typed = normalized.find((entry) => entry.type === preferredType);
    if (typed) return typed.column;
  }
  for (const alias of [...aliases, ...exactAliases]) {
    const exact = normalized.find((entry) => entry.labels.includes(alias));
    if (exact) return exact.column;
  }
  for (const alias of aliases) {
    const partial = normalized.find((entry) => entry.labels.some((label) => label.includes(alias)));
    if (partial) return partial.column;
  }
  const recordKeys = [...new Set(records.flatMap((record) => Object.keys(record?.fields ?? {})))];
  for (const alias of [...aliases, ...exactAliases]) {
    const key = recordKeys.find((candidate) => normalizeLabel(candidate) === alias);
    if (key) return { key };
  }
  return null;
}

function clientField(record, columns, aliases) {
  const column = findClientColumn(columns, aliases, { records: [record] });
  return column ? safeString(record?.fields?.[column.key]) : '';
}

function groupColumnsByList(columns) {
  const result = new Map();
  for (const column of columns) {
    const listId = safeString(column?.list_id);
    if (!result.has(listId)) result.set(listId, []);
    result.get(listId).push(column);
  }
  return result;
}

function sanitizeAttachments(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 30).map((file, index) => {
    const url = safeHttpsUrl(file?.url);
    const type = bounded(file?.type, 100);
    return {
      id: bounded(file?.id, 160) || `attachment-${index}`,
      name: bounded(file?.name, 240) || `Attachment ${index + 1}`,
      type,
      size: Number.isFinite(Number(file?.size)) ? Math.max(0, Number(file.size)) : null,
      isImage: file?.isImage === true || type.toLowerCase().startsWith('image/'),
      url,
    };
  });
}

function sanitizeScalarValue(value) {
  if (Array.isArray(value)) return value.slice(0, 100).map(sanitizeScalarValue);
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (value === null || value === undefined) return null;
  return bounded(value, 500);
}

function sanitizeDescription(value) {
  const description = bounded(value, 1000);
  if (!description) return null;
  return /[$€£]\s*\d|\b(?:price|precio|cost|costo)\b|\b(?:stem|bunch|unit|pack|box)\s*(?:price|precio)?\s*[:=]?\s*[$€£]?\s*\d/i.test(description)
    ? null
    : description;
}

function priceToCents(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const amount = Number(String(value).trim().replace(/[$€£\s]/g, '').replace(/,/g, ''));
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : null;
}

function normalizeMeasure(value) {
  const normalized = normalizeLabel(Array.isArray(value) ? value[0] : value);
  if (/stem|tallo/.test(normalized)) return 'stem';
  if (/bunch|ramo/.test(normalized)) return 'bunch';
  if (/box|caja/.test(normalized)) return 'box';
  if (/pack|paquete/.test(normalized)) return 'pack';
  if (/unit|unidad|each/.test(normalized)) return 'unit';
  return normalized;
}

function columnLabels(column) {
  return [column?.key, column?.field_key, column?.field_name, column?.name, column?.label, column?.title]
    .map(normalizeLabel)
    .filter(Boolean);
}

function isAttachmentColumn(column) {
  return column?.is_file === true || normalizeLabel(column?.field_type) === 'attachments';
}

function isChecked(value) {
  return value === true || value === 1 || ['true', '1', 'active', 'activo', 'activa', 'yes', 'si', 'on', 'checked'].includes(normalizeLabel(value));
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(safeString(value));
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeEmail(value) {
  return safeString(value).toLowerCase();
}

function isEmail(value) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function bounded(value, maxLength) {
  return safeString(value).slice(0, maxLength);
}

function safeString(value) {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value.trim() : String(value).trim();
}

function normalizeLabel(value) {
  return safeString(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
