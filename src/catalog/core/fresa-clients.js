/**
 * Fresa active-client directory integration.
 *
 * This is intentionally separate from the product catalog integration. The
 * endpoint is the same today, but the credential points at a different Fresa
 * source and the response uses `records` rather than `catalog.products`.
 * Only the normalized contact profile of active clients is retained in memory;
 * raw client records are never persisted by the landing page.
 *
 * Because both integrations share one URL, every request is made with
 * `cache: 'no-store'`. Fresa answers with `Cache-Control: public,
 * stale-while-revalidate` and without `Vary: Authorization`, so a cached
 * catalog response would otherwise be replayed for a client request — and the
 * directory would silently look like a list of products.
 */

const env = typeof import.meta !== 'undefined' ? import.meta.env ?? {} : {};

export const FRESA_CLIENTS_API_URL = String(env.FRESA_CLIENTS_API_URL ?? '').trim();
export const FRESA_CLIENTS_API_KEY = String(env.FRESA_CLIENTS_API_KEY ?? '').trim();
export const FRESA_CLIENTS_SOURCE_NAME = String(env.FRESA_CLIENTS_SOURCE_NAME ?? 'Clientes Activos').trim();
export const FRESA_CLIENTS_REVALIDATE_MS = 60_000;

// The directory is small enough to arrive in a single response, and asking for
// one page keeps the lookup inside the form's timeout. The loop below still
// paginates if Fresa caps the page size.
const PAGE_LIMIT = 1000;
const PAGE_RETRIES = 1;
const RETRY_DELAY_MS = 400;

const EMAIL_ALIASES = ['email', 'e mail', 'correo', 'correo electronico'];
const ACTIVE_ALIASES = ['activo', 'activa', 'active', 'enabled', 'habilitado'];
// `estado` is accepted only as an exact column name: the client source also has
// `facturacion_estado` and `envio_estado`, which are shipping states.
const ACTIVE_EXACT_ALIASES = ['estado', 'estatus', 'status'];
const FIRST_NAME_ALIASES = ['nombre contacto', 'first name', 'firstname', 'contact name', 'nombre'];
const LAST_NAME_ALIASES = ['apellido contacto', 'last name', 'lastname', 'surname', 'apellido'];
const FULL_NAME_ALIASES = ['nombre completo qb', 'nombre completo', 'full name', 'display name'];

let cachedDirectory = null;
let cacheExpiresAt = 0;
let pendingRequest = null;

export class FresaClientsError extends Error {
  /** @param {number} status @param {string} message @param {unknown} [cause] */
  constructor(status, message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'FresaClientsError';
    this.status = status;
  }
}

/**
 * Loads the active-client directory. Results are kept only in memory for one
 * minute so a temporary URL or a client change is revalidated, and so checking
 * one email does not re-download the whole directory on every step.
 *
 * @param {{ force?: boolean, apiUrl?: string, apiKey?: string, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<{ emails: Set<string>, profiles: Map<string, ReturnType<typeof clientProfile>> }>}
 */
export function loadClientDirectory(options = {}) {
  const now = Date.now();
  if (!options.force && cachedDirectory && now < cacheExpiresAt) {
    return Promise.resolve(cachedDirectory);
  }
  if (pendingRequest) return pendingRequest;

  pendingRequest = fetchActiveClientPages(options)
    .then(({ columns, records }) => {
      const directory = buildDirectory(columns, records);
      cachedDirectory = directory;
      cacheExpiresAt = Date.now() + FRESA_CLIENTS_REVALIDATE_MS;
      return directory;
    })
    .finally(() => {
      pendingRequest = null;
    });

  return pendingRequest;
}

/**
 * Loads the normalized emails of active clients.
 *
 * @param {{ force?: boolean, apiUrl?: string, apiKey?: string, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<Set<string>>}
 */
export async function loadActiveClientEmails(options = {}) {
  const { emails } = await loadClientDirectory(options);
  return emails;
}

/** Clears the in-memory client directory cache. */
export function resetFresaClientsCache() {
  cachedDirectory = null;
  cacheExpiresAt = 0;
  pendingRequest = null;
}

/**
 * Checks one email against the currently active client list.
 *
 * @param {string} email
 * @param {{ force?: boolean, apiUrl?: string, apiKey?: string, fetchImpl?: typeof fetch }} [options]
 */
export async function isActiveClientEmail(email, options = {}) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  const emails = await loadActiveClientEmails(options);
  return emails.has(normalized);
}

/**
 * Finds a matching active client without exposing the source record. The
 * returned profile stays in the caller's memory only; it is used to keep
 * known contact details out of visible fields while the quote is completed.
 *
 * A missing match is not an error. Callers may continue with a new contact.
 *
 * @param {string} email
 * @param {{ force?: boolean, apiUrl?: string, apiKey?: string, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<{ email: string, firstName: string, lastName: string, phone: string, company: string, shipping: { address: string, city: string, state: string, zipCode: string, country: string } }|null>}
 */
export async function findActiveClient(email, options = {}) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const { profiles } = await loadClientDirectory(options);
  return profiles.get(normalized) ?? null;
}

/** @param {string} value */
export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * Fetches every client page and keeps the response contract private to this
 * module. It supports both the active-client response (`records`) and the
 * catalog wrapper in case Fresa returns it for a compatible source.
 *
 * @param {{ apiUrl?: string, apiKey?: string, fetchImpl?: typeof fetch }} options
 */
export async function fetchActiveClientPages({
  apiUrl = FRESA_CLIENTS_API_URL,
  apiKey = FRESA_CLIENTS_API_KEY,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!apiUrl || !apiKey) {
    throw new FresaClientsError(
      0,
      'Client validation is not configured. Add the Fresa client API variables.',
    );
  }
  if (typeof fetchImpl !== 'function') {
    throw new FresaClientsError(0, 'Client validation is not available in this environment.');
  }

  const columns = [];
  const records = [];
  const seenIds = new Set();
  const visitedOffsets = new Set();
  let offset = 0;
  let page = null;
  let source = null;

  while (!visitedOffsets.has(offset)) {
    visitedOffsets.add(offset);
    const url = new URL(apiUrl, typeof window === 'undefined' ? 'http://localhost/' : window.location.href);
    url.searchParams.set('limit', String(PAGE_LIMIT));
    url.searchParams.set('offset', String(offset));

    const data = await requestPage(url.toString(), apiKey, fetchImpl);

    const wrapper = data?.catalog ?? data;
    source = source ?? data?.source ?? wrapper?.source ?? null;
    assertClientSource(source);

    for (const column of wrapper?.columns ?? []) {
      if (!columns.some((existing) => existing.key === column.key)) columns.push(column);
    }

    const chunk = wrapper?.records ?? wrapper?.products ?? [];
    for (const record of chunk) {
      if (!record?.id || seenIds.has(record.id)) continue;
      seenIds.add(record.id);
      records.push(record);
    }

    page = wrapper?.page ?? null;
    if (!chunk.length) break;
    if (!page?.hasMore || page.nextOffset === null || page.nextOffset === undefined) break;

    const nextOffset = Number(page.nextOffset);
    if (!Number.isFinite(nextOffset) || nextOffset <= offset) break;
    // Fresa answers 500 — not an empty page — when the offset runs past the end
    // of the source, so never walk past the reported total.
    const totalCount = Number(page.totalCount);
    if (Number.isFinite(totalCount) && nextOffset >= totalCount) break;
    offset = nextOffset;
  }

  return { source, columns, records, page };
}

/**
 * Requests one page, retrying once when Fresa is momentarily unreachable or
 * answers 5xx. A single failed page used to abort the whole lookup and show
 * the visitor "we could not verify this email".
 *
 * @param {string} url @param {string} apiKey @param {typeof fetch} fetchImpl
 */
async function requestPage(url, apiKey, fetchImpl) {
  let lastError = null;

  for (let attempt = 0; attempt <= PAGE_RETRIES; attempt += 1) {
    if (attempt > 0) await delay(RETRY_DELAY_MS);

    let response;
    try {
      response = await fetchImpl(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        // Both Fresa sources answer on the same URL and the response does not
        // vary on Authorization; a shared cache entry would return the catalog.
        cache: 'no-store',
      });
    } catch (error) {
      lastError = new FresaClientsError(0, 'We could not reach the client directory.', error);
      continue;
    }

    if (!response.ok) {
      lastError = new FresaClientsError(response.status, clientApiError(response.status));
      if (response.status >= 500 || response.status === 429) continue;
      throw lastError;
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new FresaClientsError(0, 'The client directory returned an invalid response.', error);
    }

    if (data?.success === false) {
      throw new FresaClientsError(0, 'The client directory did not accept the request.');
    }

    return data;
  }

  throw lastError ?? new FresaClientsError(0, 'We could not reach the client directory.');
}

/**
 * The catalog and the client directory share an integration route, so the
 * response source is part of the contract. A catalog response reaching this
 * module would otherwise be read as an empty client list and every visitor
 * would be treated as a new contact.
 *
 * @param {{ name?: unknown }|null} source
 */
function assertClientSource(source) {
  const name = normalizeLabel(source?.name);
  if (!name || !FRESA_CLIENTS_SOURCE_NAME) return;
  if (name !== normalizeLabel(FRESA_CLIENTS_SOURCE_NAME)) {
    throw new FresaClientsError(
      0,
      `The client directory returned the "${source?.name}" source instead of "${FRESA_CLIENTS_SOURCE_NAME}".`,
    );
  }
}

/** @param {number} ms */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {Array<Record<string, unknown>>} columns
 * @param {Array<Record<string, any>>} records
 */
function buildDirectory(columns, records) {
  const emailColumn = findColumn(columns, EMAIL_ALIASES, { preferredType: 'email', records });
  if (!emailColumn) {
    throw new FresaClientsError(0, 'The client directory has no authorized email column.');
  }

  const activeColumn = findColumn(columns, ACTIVE_ALIASES, { exactAliases: ACTIVE_EXACT_ALIASES, records });
  const emails = new Set();
  const profiles = new Map();

  for (const record of records) {
    if (activeColumn && !isActive(record.fields?.[activeColumn.key])) continue;
    const email = normalizeEmail(record.fields?.[emailColumn.key]);
    if (!email) continue;
    emails.add(email);
    if (!profiles.has(email)) profiles.set(email, clientProfile(email, record, columns));
  }

  return { emails, profiles };
}

/**
 * @param {string} email
 * @param {Record<string, any>} record
 * @param {Array<Record<string, unknown>>} columns
 */
function clientProfile(email, record, columns) {
  let firstName = clientField(record, columns, FIRST_NAME_ALIASES);
  let lastName = clientField(record, columns, LAST_NAME_ALIASES);

  // Part of the directory only carries the QuickBooks display name. Split it
  // rather than greeting a known client with an empty form.
  if (!firstName && !lastName) {
    const parts = clientField(record, columns, FULL_NAME_ALIASES).split(/\s+/).filter(Boolean);
    firstName = parts[0] ?? '';
    lastName = parts.slice(1).join(' ');
  }

  return {
    email,
    firstName,
    lastName,
    phone: clientField(record, columns, ['telefono', 'phone number', 'phone', 'movil', 'mobile', 'numero telefono']),
    company: clientField(record, columns, ['empresa', 'company name', 'company', 'nombre empresa']),
    shipping: {
      address: clientField(record, columns, ['envio direccion', 'shipping address', 'delivery address']),
      city: clientField(record, columns, ['envio ciudad', 'shipping city', 'delivery city']),
      state: clientField(record, columns, ['envio estado', 'shipping state', 'delivery state']),
      zipCode: clientField(record, columns, ['envio codigo postal', 'shipping postal code', 'delivery postal code', 'zip code', 'postal code']),
      country: clientField(record, columns, ['envio pais', 'shipping country', 'delivery country']),
    },
  };
}

/**
 * Resolves the column a value must be read from.
 *
 * Exact column names always win over partial ones. The directory carries both
 * `nombre_completo_qb` and `nombre_contacto`, so a plain substring search for
 * "nombre" used to fill the first-name field with the full QuickBooks name.
 *
 * @param {Array<Record<string, unknown>>} columns
 * @param {string[]} aliases
 * @param {{ preferredType?: string|null, exactAliases?: string[], records?: Array<Record<string, any>> }} [options]
 */
function findColumn(columns, aliases, { preferredType = null, exactAliases = [], records = [] } = {}) {
  const normalizedColumns = columns.map((column) => ({
    column,
    names: [
      column.field_name,
      column.field_key,
      column.key,
      column.name,
      column.label,
      column.title,
    ].map(normalizeLabel),
    type: normalizeLabel(column.field_type ?? column.type ?? column.data_type),
  }));

  if (preferredType) {
    const typed = normalizedColumns.find(({ type }) => type === preferredType);
    if (typed) return typed.column;
  }

  for (const alias of [...aliases, ...exactAliases]) {
    const exact = normalizedColumns.find(({ names }) => names.includes(alias));
    if (exact) return exact.column;
  }

  for (const alias of aliases) {
    const partial = normalizedColumns.find(({ names }) => names.some((name) => name.includes(alias)));
    if (partial) return partial.column;
  }

  // Some Fresa responses omit column descriptors while keeping the field keys
  // on each record. Recover only the requested kind of field from those keys.
  const recordKeys = [...new Set(records.flatMap((record) => Object.keys(record?.fields ?? {})))];
  for (const alias of [...aliases, ...exactAliases]) {
    const key = recordKeys.find((name) => normalizeLabel(name) === alias);
    if (key) return { key };
  }
  for (const alias of aliases) {
    const key = recordKeys.find((name) => normalizeLabel(name).includes(alias));
    if (key) return { key };
  }
  return null;
}

/** @param {Record<string, any>} record @param {Array<Record<string, unknown>>} columns @param {string[]} aliases */
function clientField(record, columns, aliases) {
  const column = findColumn(columns, aliases, { records: [record] });
  return column ? String(record.fields?.[column.key] ?? '').trim() : '';
}

/** @param {unknown} value */
function isActive(value) {
  if (value === true || value === 1) return true;
  return ['true', '1', 'active', 'activo', 'activa', 'yes', 'si'].includes(normalizeLabel(value));
}

/** @param {unknown} value */
function normalizeLabel(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** @param {number} status */
function clientApiError(status) {
  if (status === 401) return 'The Fresa client API key is invalid or inactive.';
  if (status === 403) return 'This landing page is not authorized to read the client directory.';
  if (status >= 500) return 'The Fresa client directory is temporarily unavailable.';
  return `The client directory responded with ${status}.`;
}
