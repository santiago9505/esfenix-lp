import {
  isFresaDeliveryOrder, resolveFresaContactFields, resolveFresaFormApi, resolveFresaQuoteAnswerIds,
  resolveFresaShippingFields, resolveFresaSubmitError,
} from '../../src/catalog/core/fresa-form-submission.js';
import { normalizeSocialMediaUrl } from '../../src/catalog/core/social-media-url.js';
import { normalizeEmail } from './client-lookup.js';

const CONTACT_KEYS = ['firstName', 'lastName', 'phone', 'company', 'socialMediaProfiles'];
const REQUIRED_KEYS = ['firstName', 'lastName', 'phone'];
const CONTACT_UNAVAILABLE = 'SAVED_CONTACT_UNAVAILABLE';
const SHIPPING_UNAVAILABLE = 'SAVED_SHIPPING_UNAVAILABLE';

function savedContact(profile) {
  return {
    firstName: profile['First Name'] || '',
    lastName: profile['Last Name'] || '',
    phone: profile['Phone Number'] || '',
    company: profile.Company || '',
    socialMediaProfiles: profile['Social Media Profiles'] || '',
  };
}

export function contactPreview(profile) {
  const contact = savedContact(profile);
  const preview = Object.fromEntries(CONTACT_KEYS.filter((key) => contact[key]).map((key) => [key, true]));
  const digits = contact.phone.replace(/\D/g, '');
  if (digits.length > 2) preview.phoneLastDigits = digits.slice(-2);
  for (const key of ['firstName', 'lastName', 'company']) {
    const prefix = maskedPrefix(contact[key], 2);
    if (!prefix) continue;
    preview[`${key}Prefix`] = prefix;
    preview[`${key}Initial`] = [...prefix][0];
  }
  return preview;
}

function maskedPrefix(value, limit) {
  const characters = value.normalize('NFC').match(/[\p{L}\p{N}]/gu) ?? [];
  const visibleLength = Math.min(limit, characters.length - 1);
  if (visibleLength < 1) return '';
  return characters.slice(0, visibleLength).join('').match(/^\p{L}+/u)?.[0] ?? '';
}

function savedShipping(profile) {
  const shipping = { address: profile.Address, city: profile.City, state: profile.State, zipCode: profile['Zip Code'] };
  return Object.values(shipping).every((value) => typeof value === 'string' && value.trim()) ? shipping : null;
}

export function shippingPreview(profile) {
  const shipping = savedShipping(profile);
  if (!shipping) return null;
  const zipDigits = shipping.zipCode.replace(/\D/g, '');
  return {
    available: true,
    cityInitial: maskedPrefix(shipping.city, 1),
    stateInitial: maskedPrefix(shipping.state, 1),
    zipCodeLastDigits: zipDigits.length > 2 ? zipDigits.slice(-2) : '',
  };
}

export async function submitQuoteWithSavedContact({ body, email, client, formUrl, fetchImpl = globalThis.fetch }) {
  if (!client.found || !formUrl) return failure(409, CONTACT_UNAVAILABLE);
  const { token, formApiUrl, submitUrl } = resolveFresaFormApi(formUrl);
  if (body.formToken !== token || !submitUrl.startsWith('https://')) return failure(409, CONTACT_UNAVAILABLE);
  if (!body.answers || typeof body.answers !== 'object' || Array.isArray(body.answers)) return failure(400);
  const requestedFields = body.savedContactFields ?? [];
  const useSavedShippingAddress = body.useSavedShippingAddress === true;
  if (!Array.isArray(requestedFields) || (!requestedFields.length && !useSavedShippingAddress)
    || requestedFields.length > CONTACT_KEYS.length
    || !requestedFields.every((key) => CONTACT_KEYS.includes(key))) return failure(400);
  const requested = new Set(requestedFields);

  const formResponse = await fetchImpl(`${formApiUrl}?catalog=metadata`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  const metadata = await formResponse?.json().catch(() => null);
  const form = metadata?.form;
  if (!formResponse?.ok || metadata?.success !== true || form?.enabled !== true || !Array.isArray(form.fields)) {
    return failure(503, CONTACT_UNAVAILABLE);
  }
  const fields = resolveFresaContactFields(form.fields);
  const formAnswers = body.answers;
  if (typeof formAnswers[fields.email.id] !== 'string' || normalizeEmail(formAnswers[fields.email.id]) !== email) {
    return failure(400);
  }
  if (formAnswers[fields.vip.id] !== client.vip) return failure(409, CONTACT_UNAVAILABLE);

  const answers = Object.fromEntries(resolveFresaQuoteAnswerIds(form.fields, fields)
    .filter((id) => Object.hasOwn(formAnswers, id))
    .map((id) => [id, formAnswers[id]]));
  answers[fields.email.id] = email;
  const saved = savedContact(client.profile);
  const socialField = fields.socialMediaProfiles;
  const socialValue = socialField?.type === 'url'
    ? normalizeSocialMediaUrl(saved.socialMediaProfiles)
    : saved.socialMediaProfiles;
  for (const key of CONTACT_KEYS) {
    const fieldId = fields[key]?.id;
    const value = key === 'socialMediaProfiles' ? socialValue : saved[key];
    if (!requested.has(key) || !fieldId || !value) continue;
    const answer = answers[fieldId];
    if (answer == null || (typeof answer === 'string' && !answer.trim())) answers[fieldId] = value;
  }
  if (REQUIRED_KEYS.some((key) => typeof answers[fields[key].id] !== 'string' || !answers[fields[key].id].trim())) {
    return failure(409, CONTACT_UNAVAILABLE);
  }

  if (useSavedShippingAddress) {
    if (!isFresaDeliveryOrder(form.fields, answers)) return failure(400);
    const shipping = savedShipping(client.profile);
    if (!shipping) return failure(409, SHIPPING_UNAVAILABLE);
    const shippingFields = resolveFresaShippingFields(form.fields);
    for (const [key, field] of Object.entries(shippingFields)) answers[field.id] = shipping[key];
  }

  if (fields.notes?.id) {
    const notes = [
      requested.has('company') && saved.company && !formAnswers[fields.company?.id]
        ? `Company: ${saved.company}` : '',
      requested.has('socialMediaProfiles') && saved.socialMediaProfiles
        && (!socialField?.id || (!socialValue && !formAnswers[socialField.id]))
        ? `Social media profiles (business): ${saved.socialMediaProfiles}` : '',
      typeof answers[fields.notes.id] === 'string' ? answers[fields.notes.id] : '',
    ].filter(Boolean).join('\n\n');
    if (notes) answers[fields.notes.id] = notes;
  }

  const response = await fetchImpl(submitUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      answers,
      meta: {
        source: body.meta?.source === 'esfenix-product-catalog' ? body.meta.source : 'esfenix-website',
        timeZone: typeof body.meta?.timeZone === 'string' ? body.meta.timeZone.slice(0, 100) : undefined,
        userAgent: typeof body.meta?.userAgent === 'string' ? body.meta.userAgent.slice(0, 500) : undefined,
      },
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(35_000),
  });
  const result = await response.json().catch(() => null);
  if (response.ok && result?.success === true && typeof result.taskId === 'string') {
    return { status: 200, data: { success: true, taskId: result.taskId } };
  }
  // Upstream errors can include submitted values. Only forward known codes.
  return failure(response.ok ? 502 : response.status, resolveFresaSubmitError(response.status, result?.error));
}

function failure(status, code) {
  return { status, data: { success: false, ...(code && { code }) } };
}
