import { LOCATIONS } from '../data/locations.js';
import { QUOTE_FORM_URL } from '../data/quote-config.js';
import {
  catalogMeasureOptions,
  getFresaCatalogConfig,
  resolveFresaFormApi,
  resolveFresaProductFieldId,
} from './fresa-form-submission.js';
import { buildQuotePayload } from './quote-payload.js';

/**
 * Reads the same scoped catalog that validates a quote. The storefront keeps
 * only native product ids and their available measures from the response.
 */
export async function loadFresaOrderableMeasures({ formUrl = QUOTE_FORM_URL, fetchImpl = globalThis.fetch } = {}) {
  const { formApiUrl } = resolveFresaFormApi(formUrl);
  async function readForm(parameter, value) {
    const url = new URL(formApiUrl);
    url.searchParams.set(parameter, value);
    const response = await fetchImpl(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error('Fresa quote catalog is unavailable.');
    const data = await response.json();
    if (data?.success !== true || !Array.isArray(data?.form?.fields)) {
      throw new Error('Fresa quote catalog is invalid.');
    }
    return data;
  }

  const metadata = await readForm('catalog', 'metadata');
  // The location config maps Woodlands and other U.S. destinations to the
  // same product list as Houston. Fetch the representatives of those lists.
  const sources = LOCATIONS.filter((location) => location.id === location.catalogSource);
  return new Map(await Promise.all(sources.map(async ({ id }) => {
    const fieldId = resolveFresaProductFieldId(buildQuotePayload({ locationId: id }), metadata);
    const form = await readForm('catalogFieldId', fieldId);
    const field = form.form.fields.find((entry) => entry.id === fieldId);
    const { items } = getFresaCatalogConfig(form, fieldId, field);
    if (!Array.isArray(items)) throw new Error('Fresa quote catalog did not contain its products.');
    return [id, new Map(items.filter((item) => item?.value).map((item) => [
      String(item.value),
      catalogMeasureOptions(item),
    ]))];
  })));
}

/** Joins availability by source list and native product id, never by label. */
export function applyFresaOrderableMeasures(products, measuresByLocation) {
  return products.map((product) => ({
    ...product,
    locations: product.locations.map((location) => {
      const measuresById = measuresByLocation.get(location.location);
      if (!measuresById) return location;
      return {
        ...location,
        variants: location.variants.flatMap((variant) => {
          const measures = measuresById.get(String(variant.sourceProductId ?? ''));
          // An unpriced item can still be requested using its declared Fresa
          // sales unit. An empty form option list imposes no measure constraint;
          // it must not erase that unit or make a required measure impossible.
          return measures ? [{ ...variant, availableMeasures: measures.length ? measures : variant.availableMeasures }] : [];
        }),
      };
    }),
  }));
}
