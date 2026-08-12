/**
 * Converts the catalog's quote payload into the live public-form contract used
 * by Fresa. Field ids and related product task ids are intentionally resolved
 * from the public form response instead of being duplicated in this project.
 */

/** @param {unknown} value */
function normalizeLabel(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export class FresaFormConfigurationError extends Error {
  /** @param {string} message @param {string} [code] */
  constructor(message, code = 'FRESA_FORM_CONFIGURATION') {
    super(message);
    this.name = 'FresaFormConfigurationError';
    this.code = code;
  }
}

/**
 * Resolves the API URL from a public form URL such as
 * https://fresaai.app/f/<token>.
 *
 * @param {string} formUrl
 */
export function resolveFresaFormApi(formUrl) {
  let parsed;
  try {
    parsed = new URL(formUrl);
  } catch {
    throw new FresaFormConfigurationError('The Fresa form address is invalid.');
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  const formIndex = segments.lastIndexOf('f');
  const token = formIndex >= 0 ? String(segments[formIndex + 1] ?? '').trim() : '';
  if (!token) {
    throw new FresaFormConfigurationError('The Fresa form address does not contain a public token.');
  }

  const formApiUrl = new URL(`/api/forms/${encodeURIComponent(token)}`, parsed.origin).toString();
  return {
    token,
    formApiUrl,
    submitUrl: `${formApiUrl}/submit`,
  };
}

/** @param {Array<any>} fields @param {string} label @param {string} [type] */
function findField(fields, label, type) {
  const normalized = normalizeLabel(label);
  return fields.find((field) =>
    (!type || field?.type === type) && normalizeLabel(field?.label) === normalized
  ) ?? null;
}

/** @param {any} field @param {string} label */
function findOptionValue(field, label) {
  const normalized = normalizeLabel(label);
  const option = (field?.options ?? []).find((candidate) =>
    normalizeLabel(candidate?.label) === normalized || normalizeLabel(candidate?.value) === normalized
  );
  return typeof option?.value === 'string' ? option.value : null;
}

/** @param {Array<any>} fields @param {string} label @param {string} type */
function requireField(fields, label, type) {
  const field = findField(fields, label, type);
  if (!field?.id) {
    throw new FresaFormConfigurationError(`Fresa is missing the "${label}" field.`);
  }
  return field;
}

/**
 * Selects the catalog_items field whose show rule matches the current location
 * and VIP status. This mirrors Fresa's own form visibility rules.
 */
function findProductField(fields, locationField, vipField, locationValue, vip) {
  const expectedVipOperator = vip ? 'is_true' : 'is_false';
  const catalogFields = fields.filter((field) => field?.type === 'catalog_items');

  const byRules = catalogFields.find((field) => (field.actionRules ?? []).some((rule) => {
    if (rule?.enabled === false) return false;
    const conditions = Array.isArray(rule?.conditions) ? rule.conditions : [];
    const locationMatches = conditions.some((condition) =>
      condition?.sourceFieldId === locationField.id
      && condition?.operator === 'equals'
      && String(condition?.value ?? '') === locationValue
    );
    const vipMatches = conditions.some((condition) =>
      condition?.sourceFieldId === vipField.id && condition?.operator === expectedVipOperator
    );
    return locationMatches && vipMatches;
  }));
  if (byRules) return byRules;

  // Defensive fallback for a form whose actions were recreated but labels
  // retained. Exact visibility-rule matching above remains the primary path.
  const locationWords = normalizeLabel(
    (locationField.options ?? []).find((option) => option?.value === locationValue)?.label ?? locationValue
  ).replace(/^tx |^wa /, '');
  return catalogFields.find((field) => {
    const label = normalizeLabel(field?.label);
    return label.includes(locationWords) && label.includes('vip') === vip;
  }) ?? null;
}

/** @param {unknown} value */
function normalizeMeasure(value) {
  const normalized = normalizeLabel(value);
  if (['stem', 'stems', 'tallo', 'tallos'].includes(normalized)) return 'stem';
  if (['bunch', 'bunches', 'bonche', 'bonches', 'ramo', 'ramos'].includes(normalized)) return 'bunch';
  return normalized || null;
}

/**
 * Mirrors the public form's measure discovery for catalog rows. Fresa exposes
 * explicit options when configured, or derives stem/bunch from the product's
 * non-empty price reference columns.
 *
 * @param {any} item
 */
function catalogMeasureOptions(item) {
  const configured = (Array.isArray(item?.measureOptions) ? item.measureOptions : [])
    .map((option) => normalizeMeasure(option?.value ?? option?.label ?? option))
    .filter(Boolean);
  if (configured.length > 0) return [...new Set(configured)];

  const derived = Object.entries(item?.referenceValues ?? {}).flatMap(([key, value]) => {
    if (value === null || value === undefined || String(value).trim() === '') return [];
    const normalizedKey = normalizeLabel(key).replace(/ /g, '_');
    if (normalizedKey.includes('stem_price') || normalizedKey.includes('price_stem')) return ['stem'];
    if (normalizedKey.includes('bunch_price') || normalizedKey.includes('price_bunch')) return ['bunch'];
    return [];
  });
  return [...new Set(derived)];
}

/** @param {any} payload @param {Array<any>} items */
function buildProductLines(payload, items) {
  if ((payload?.fresa?.unmappedProducts ?? []).length > 0) {
    const names = payload.fresa.unmappedProducts
      .map((item) => item?.productName)
      .filter(Boolean)
      .join(', ');
    throw new FresaFormConfigurationError(
      `These products are not mapped to Fresa yet: ${names}.`,
      'UNMAPPED_PRODUCTS',
    );
  }

  const requested = Array.isArray(payload?.fresa?.products) ? payload.fresa.products : [];
  if (requested.length === 0) {
    throw new FresaFormConfigurationError(
      'Select at least one product before requesting a quote.',
      'PRODUCTS_REQUIRED',
    );
  }

  const itemByLabel = new Map(
    items
      .filter((item) => item?.value && item?.label)
      .map((item) => [normalizeLabel(item.label), item]),
  );
  const missing = [];
  const lines = requested.map((row) => {
    const matched = itemByLabel.get(normalizeLabel(row?.product));
    if (!matched) {
      missing.push(String(row?.product ?? '').trim());
      return null;
    }
    const measure = normalizeMeasure(row?.measure);
    const availableMeasures = catalogMeasureOptions(matched);
    if (availableMeasures.length > 0 && (!measure || !availableMeasures.includes(measure))) {
      throw new FresaFormConfigurationError(
        `The measure for "${row?.product ?? ''}" must be one of: ${availableMeasures.join(', ')}.`,
        'FRESA_PRODUCT_MEASURE_UNAVAILABLE',
      );
    }
    const quantity = Number(row?.quantity);
    const minimumQuantity = Number(matched?.minimumQuantity);
    if (Number.isFinite(minimumQuantity) && minimumQuantity > 0 && quantity < minimumQuantity) {
      throw new FresaFormConfigurationError(
        `The minimum quantity for "${row?.product ?? ''}" is ${minimumQuantity}.`,
        'FRESA_PRODUCT_MINIMUM_NOT_MET',
      );
    }
    return {
      productId: matched.value,
      quantity,
      size: null,
      measure,
      ...(row?.sourceProductId ? {
        values: { __fresa_source_product_id: String(row.sourceProductId).trim() },
      } : {}),
    };
  }).filter(Boolean);

  if (missing.length > 0) {
    throw new FresaFormConfigurationError(
      `These products are not available in the selected Fresa list: ${missing.join(', ')}.`,
      'FRESA_PRODUCTS_UNAVAILABLE',
    );
  }
  if (lines.some((line) => !Number.isFinite(line.quantity) || line.quantity <= 0)) {
    throw new FresaFormConfigurationError(
      'Every selected product must have a valid quantity.',
      'PRODUCT_QUANTITY_INVALID',
    );
  }
  return lines;
}

/**
 * Builds the body accepted by POST /api/forms/:token/submit.
 *
 * @param {ReturnType<typeof import('./quote-payload').buildQuotePayload>} payload
 * @param {any} publicFormResponse
 */
export function buildFresaFormSubmission(payload, publicFormResponse) {
  const form = publicFormResponse?.form;
  const fields = Array.isArray(form?.fields) ? form.fields : [];
  if (publicFormResponse?.success !== true || form?.enabled !== true || fields.length === 0) {
    throw new FresaFormConfigurationError('The Fresa quote form is unavailable or disabled.');
  }

  const emailField = requireField(fields, 'Email', 'email');
  const vipField = requireField(fields, 'VIP?', 'checkbox');
  const firstNameField = requireField(fields, 'First Name', 'short_text');
  const lastNameField = requireField(fields, 'Last Name', 'short_text');
  const phoneField = requireField(fields, 'Phone Number', 'phone');
  const locationField = requireField(fields, 'Location', 'select');
  const orderTypeField = requireField(fields, 'Type of Order', 'select');

  const locationValue = findOptionValue(locationField, payload?.fresa?.location);
  if (!locationValue) {
    throw new FresaFormConfigurationError(
      `The location "${payload?.fresa?.location ?? ''}" is not available in Fresa.`,
      'FRESA_LOCATION_UNAVAILABLE',
    );
  }

  const orderType = payload?.orderType === 'Delivery' ? 'Delivery' : 'Pickup';
  const orderTypeValue = findOptionValue(orderTypeField, orderType);
  if (!orderTypeValue) {
    throw new FresaFormConfigurationError(
      `The order type "${orderType}" is not available in Fresa.`,
      'FRESA_ORDER_TYPE_UNAVAILABLE',
    );
  }

  const vip = payload?.vip === true;
  const productField = findProductField(fields, locationField, vipField, locationValue, vip);
  if (!productField?.id) {
    throw new FresaFormConfigurationError(
      `Fresa has no product field configured for ${payload?.fresa?.location ?? 'this location'}${vip ? ' VIP' : ''}.`,
      'FRESA_PRODUCT_FIELD_UNAVAILABLE',
    );
  }

  const contact = payload?.contact ?? {};
  const answers = {
    [emailField.id]: payload?.email ?? '',
    [vipField.id]: vip,
    [firstNameField.id]: contact.firstName ?? '',
    [lastNameField.id]: contact.lastName ?? '',
    [phoneField.id]: contact.phone ?? '',
    [locationField.id]: locationValue,
    [productField.id]: buildProductLines(payload, productField.catalogConfig?.items ?? []),
    [orderTypeField.id]: orderTypeValue,
  };

  if (orderType === 'Delivery') {
    const deliveryField = requireField(fields, 'Delivery', 'date');
    const addressField = requireField(fields, 'Address', 'short_text');
    const cityField = requireField(fields, 'City', 'short_text');
    const stateField = requireField(fields, 'State', 'short_text');
    const zipField = requireField(fields, 'Zip Code', 'short_text');
    answers[deliveryField.id] = payload?.deliveryDateTime ?? '';
    answers[addressField.id] = payload?.delivery?.address ?? '';
    answers[cityField.id] = payload?.delivery?.city ?? '';
    answers[stateField.id] = payload?.delivery?.state ?? '';
    answers[zipField.id] = payload?.delivery?.zipCode ?? '';
  } else {
    const pickupField = requireField(fields, 'pickup', 'date');
    answers[pickupField.id] = payload?.deliveryDateTime ?? '';
  }

  const notesField = findField(fields, 'Notes for the seller', 'long_text');
  const notes = [
    contact.company ? `Company: ${contact.company}` : '',
    payload?.fresa?.notes ?? payload?.notes ?? '',
  ].filter(Boolean).join('\n\n');
  if (notesField?.id && notes) answers[notesField.id] = notes;

  return {
    answers,
    meta: {
      source: payload?.source ?? 'esfenix-website',
      timeZone: payload?.deliveryTimeZone ?? payload?.delivery?.timeZone ?? undefined,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    },
    listId: publicFormResponse?.listId ?? null,
    productFieldId: productField.id,
  };
}
