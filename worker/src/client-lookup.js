const DEFAULT_PAGE_LIMIT = 200;
const MAX_PAGES = 20;
const FETCH_TIMEOUT_MS = 8_000;
const ACTIVE_STATUS_VALUES = new Set(['activa', 'active']);

const EMAIL_ALIASES = ['email', 'e mail', 'correo', 'correo electronico', 'email address'];
const ACTIVE_ALIASES = ['activo', 'activa', 'active', 'enabled', 'habilitado'];
const VIP_ALIASES = ['vip', 'cliente vip', 'es vip', 'vip cliente', 'cliente preferencial', 'preferencial'];
const FIRST_NAME_ALIASES = ['nombre contacto', 'first name', 'firstname', 'contact name', 'nombre', 'given name'];
const LAST_NAME_ALIASES = ['apellido contacto', 'last name', 'lastname', 'surname', 'apellido', 'family name'];
const PHONE_ALIASES = ['movil', 'mobile', 'celular', 'phone', 'phone number', 'telephone', 'telefono'];
const COMPANY_ALIASES = ['company', 'company name', 'empresa', 'nombre empresa'];
const SOCIAL_ALIASES = ['social media', 'social media profiles', 'social media link', 'social media url'];
const ADDRESS_ALIASES = ['address', 'shipping address', 'delivery address', 'direccion', 'envio direccion'];
const CITY_ALIASES = ['envio ciudad', 'city', 'shipping city', 'delivery city', 'ciudad'];
const STATE_ALIASES = ['envio estado', 'state', 'shipping state', 'delivery state', 'estado'];
const ZIP_ALIASES = ['envio codigo postal', 'zip', 'zip code', 'postal code', 'shipping postal code', 'codigo postal'];

export class FresaClientLookupError extends Error {
  constructor(status, message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'FresaClientLookupError';
    this.status = status;
  }
}

/**
 * Reads the Active clients list on every invocation. Nothing is cached or
 * persisted, so the next request sees the latest data available in Fresa.
 */
export async function lookupActiveClientByEmail(email, options = {}) {
  const normalizedEmail = normalizeEmail(email);
  if (!isEmail(normalizedEmail)) {
    return { found: false, vip: false, profile: {}, taskId: null };
  }

  const tasks = await fetchActiveClientPages({ ...options, filterEmail: normalizedEmail });
  const task = tasks.find((candidate) => {
    if (!isActiveTask(candidate, options.activeFieldId)) return false;
    return normalizeEmail(emailFromTask(candidate, options.emailFieldId)) === normalizedEmail;
  });

  if (!task) return { found: false, vip: false, profile: {}, taskId: null };

  // Fresa's filtered collection response identifies the exact record, while
  // the task detail endpoint carries every field authorized for this key.
  // If detail is briefly unavailable, the already-verified collection record
  // still provides a safe partial profile.
  let profileTask = task;
  try {
    profileTask = await fetchClientDetail(task, options);
  } catch {
    profileTask = task;
  }
  const details = profileFromTask(profileTask, options.vipFieldId);
  return {
    found: true,
    vip: details.vip,
    profile: details.profile,
    taskId: safeText(task.task_id ?? task.taskId, 160) || null,
  };
}

export async function fetchActiveClientPages({
  apiUrl,
  apiKey,
  expectedListId,
  emailFieldId,
  filterEmail,
  pageLimit = DEFAULT_PAGE_LIMIT,
  fetchImpl = globalThis.fetch,
} = {}) {
  const baseUrl = String(apiUrl ?? '').trim();
  const token = String(apiKey ?? '').trim();
  const listId = String(expectedListId ?? '').trim();
  if (!baseUrl || !token || !listId) {
    throw new FresaClientLookupError(500, 'The client lookup service is not configured.');
  }
  if (typeof fetchImpl !== 'function') {
    throw new FresaClientLookupError(500, 'The client lookup service is unavailable.');
  }

  const limit = Math.min(200, Math.max(1, Math.floor(Number(pageLimit) || DEFAULT_PAGE_LIMIT)));
  const tasks = [];
  const seenOffsets = new Set();
  let offset = 0;
  let complete = false;

  while (!seenOffsets.has(offset) && seenOffsets.size < MAX_PAGES) {
    seenOffsets.add(offset);
    const url = new URL(baseUrl);
    url.searchParams.set('listId', listId);
    url.searchParams.set('statusCanonical', 'ACTIVA');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));
    if (filterEmail && emailFieldId) {
      url.searchParams.set('filterFieldId', String(emailFieldId));
      url.searchParams.set('filterFieldValueJson', JSON.stringify(normalizeEmail(filterEmail)));
    }

    const data = await fetchPage(url, token, fetchImpl);
    if (data?.success !== true || !Array.isArray(data.tasks)) {
      throw new FresaClientLookupError(502, 'Fresa returned an invalid client directory.');
    }

    for (const task of data.tasks) {
      if (!task || typeof task !== 'object') continue;
      const taskListId = String(task.list_id ?? task.listId ?? '').trim();
      if (taskListId !== listId) {
        throw new FresaClientLookupError(502, 'Fresa returned an unexpected client list.');
      }
      tasks.push(task);
    }

    const page = data.page ?? {};
    if (!page.hasMore) {
      complete = true;
      break;
    }
    const nextOffset = Number(page.nextOffset);
    if (!Number.isSafeInteger(nextOffset) || nextOffset <= offset) {
      throw new FresaClientLookupError(502, 'Fresa returned invalid client pagination.');
    }
    offset = nextOffset;
  }

  if (!complete) {
    throw new FresaClientLookupError(502, 'Fresa returned too many client pages.');
  }
  return tasks;
}

async function fetchClientDetail(task, { apiUrl, apiKey, expectedListId, emailFieldId, activeFieldId, fetchImpl = globalThis.fetch } = {}) {
  const taskId = safeText(task?.task_id ?? task?.taskId, 160);
  if (!taskId) return task;

  const url = new URL(String(apiUrl ?? ''));
  url.search = '';
  url.pathname = `${url.pathname.replace(/\/$/, '')}/${encodeURIComponent(taskId)}`;
  const data = await fetchPage(url, String(apiKey ?? '').trim(), fetchImpl);
  const detail = data?.task;
  if (data?.success !== true || !detail || typeof detail !== 'object') {
    throw new FresaClientLookupError(502, 'Fresa returned an invalid client detail.');
  }
  const detailId = safeText(detail.task_id ?? detail.taskId, 160);
  const detailListId = String(detail.list_id ?? detail.listId ?? '').trim();
  if (detailId !== taskId || detailListId !== String(expectedListId ?? '').trim()) {
    throw new FresaClientLookupError(502, 'Fresa returned an unexpected client detail.');
  }
  if (!isActiveTask(detail, activeFieldId)) {
    throw new FresaClientLookupError(502, 'Fresa returned an inactive client detail.');
  }

  const expectedEmail = normalizeEmail(emailFromTask(task, emailFieldId));
  const detailEmail = normalizeEmail(emailFromTask(detail, emailFieldId));
  if (detailEmail && detailEmail !== expectedEmail) {
    throw new FresaClientLookupError(502, 'Fresa returned a different client detail.');
  }
  return detail;
}

async function fetchPage(url, apiKey, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
      signal: controller.signal,
    });
    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new FresaClientLookupError(response.status, 'Fresa returned invalid JSON.', error);
    }
    if (!response.ok) {
      throw new FresaClientLookupError(response.status, `Fresa responded with ${response.status}.`);
    }
    return data;
  } catch (error) {
    if (error instanceof FresaClientLookupError) throw error;
    throw new FresaClientLookupError(
      error?.name === 'AbortError' ? 504 : 502,
      error?.name === 'AbortError' ? 'Fresa took too long to respond.' : 'Fresa is temporarily unavailable.',
      error,
    );
  } finally {
    clearTimeout(timer);
  }
}

function isActiveTask(task, activeFieldId) {
  const status = normalizeLabel(task.status_canonical ?? task.statusCanonical ?? task.status);
  if (status && !ACTIVE_STATUS_VALUES.has(status)) return false;

  const fields = customFields(task);
  const activeField = findField(fields, activeFieldId, ACTIVE_ALIASES);
  const activeValue = activeField ? fieldValue(activeField) : undefined;
  if (hasValue(activeValue)) return booleanValue(activeValue);
  return ACTIVE_STATUS_VALUES.has(status);
}

function emailFromTask(task, emailFieldId) {
  return fieldValue(findField(customFields(task), emailFieldId, EMAIL_ALIASES));
}

function profileFromTask(task, vipFieldId) {
  const fields = customFields(task);
  const entity = extractQuickBooksEntity(task.description);
  const shipping = entity.ShipAddr ?? entity.ShippingAddr ?? {};
  const nameParts = splitTaskName(task.name);

  const firstName = firstText(
    fieldValue(findField(fields, '', FIRST_NAME_ALIASES)),
    entity.GivenName,
    nameParts.first,
  );
  const lastName = firstText(
    fieldValue(findField(fields, '', LAST_NAME_ALIASES)),
    entity.FamilyName,
    nameParts.last,
  );
  const phone = firstText(
    fieldValue(findField(fields, '', PHONE_ALIASES)),
    entity.PrimaryPhone?.FreeFormNumber,
    entity.PrimaryPhone?.freeFormNumber,
  );
  const company = firstText(
    fieldValue(findField(fields, '', COMPANY_ALIASES)),
    entity.CompanyName,
  );
  const address = firstText(
    fieldValue(findField(fields, '', ADDRESS_ALIASES)),
    shipping.Line1,
    shipping.Line2,
  );
  const city = firstText(fieldValue(findField(fields, '', CITY_ALIASES)), shipping.City);
  const state = firstText(
    fieldValue(findField(fields, '', STATE_ALIASES)),
    shipping.CountrySubDivisionCode,
    shipping.CountrySubdivisionCode,
  );
  const zipCode = firstText(fieldValue(findField(fields, '', ZIP_ALIASES)), shipping.PostalCode);
  const socialMedia = firstText(fieldValue(findField(fields, '', SOCIAL_ALIASES)));
  const vip = booleanValue(
    fieldValue(findField(fields, vipFieldId, VIP_ALIASES))
      ?? task.vip
      ?? task.is_vip,
  );

  const profile = compactProfile({
    'First Name': firstName,
    'Last Name': lastName,
    'Phone Number': phone,
    Company: company,
    'Social Media Profiles': socialMedia,
    Address: address,
    City: city,
    State: state,
    'Zip Code': zipCode,
  });
  return { profile, vip };
}

function customFields(task) {
  const source = task.custom_fields ?? task.customFields;
  if (Array.isArray(source)) return source.filter((field) => field && typeof field === 'object');
  if (!source || typeof source !== 'object') return [];
  return Object.entries(source).map(([mapKey, field]) => ({
    ...(field && typeof field === 'object' ? field : {}),
    _mapKey: mapKey,
    ...(field && typeof field === 'object' && Object.hasOwn(field, 'value') ? {} : { value: field }),
  }));
}

function findField(fields, fieldId, aliases) {
  const configuredId = String(fieldId ?? '').trim();
  if (configuredId) {
    const exact = fields.find((field) => String(field.id ?? field._mapKey ?? '').trim() === configuredId);
    if (exact) return exact;
  }
  for (const alias of aliases.map(normalizeLabel)) {
    const field = fields.find((candidate) => [candidate.key, candidate.name, candidate.label, candidate._mapKey]
      .some((value) => normalizeLabel(value) === alias));
    if (field) return field;
  }
  return undefined;
}

function fieldValue(field) {
  if (!field) return undefined;
  const value = field.value;
  if (value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'value')) {
    return value.value;
  }
  return value;
}

function extractQuickBooksEntity(description) {
  const text = String(description ?? '');
  const blocks = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (const match of blocks) {
    try {
      const parsed = JSON.parse(match[1]);
      const entity = parsed?.quickbooks?.entity ?? parsed?.entity;
      if (entity && typeof entity === 'object') return entity;
    } catch {
      // The description is optional enrichment; custom fields remain valid.
    }
  }
  return {};
}

function splitTaskName(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') };
}

function compactProfile(profile) {
  return Object.fromEntries(Object.entries(profile)
    .filter(([, value]) => hasValue(value))
    .map(([key, value]) => [key, safeText(value, 500)]));
}

function firstText(...values) {
  return values.find((value) => hasValue(value)) ?? '';
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function booleanValue(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  return ['true', '1', 'yes', 'si', 'sí', 'activo', 'activa', 'active', 'vip'].includes(normalizeLabel(value));
}

function normalizeEmail(value) {
  return String(value ?? '')
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/^mailto:/i, '')
    .toLowerCase();
}

function isEmail(value) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(value);
}

function normalizeLabel(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function safeText(value, maxLength) {
  const text = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  return text.slice(0, maxLength);
}
