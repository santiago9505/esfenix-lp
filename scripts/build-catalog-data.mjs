/**
 * Generates the catalog seed data from the accounting exports in `data/sources/`.
 *
 *   npm run build:catalog-data
 *
 * Output:
 *   src/catalog/data/products.generated.json   committed, price-free, read by the app
 *   data/catalog-extraction-report.json        not committed, for reviewing source quality
 *
 * The source workbooks contain pricing. This script reads a strict allow-list of
 * structural columns (see scripts/catalog-source.config.mjs), then asserts the
 * serialized output contains no monetary field before writing it. The workbooks
 * themselves stay out of git via .gitignore.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { slugify, text } from '../src/catalog/core/slug.js';
import { readSheetAsObjects } from './lib/xlsx-reader.mjs';
import {
  FAMILY_ALIASES,
  FORBIDDEN_COLUMNS,
  PRODUCT_IMAGES,
  SALES_UNIT_TO_MEASURE,
  SOURCE_COLUMNS,
  SOURCE_FILES,
  TYPE_PRODUCT_TO_CATEGORY,
  VARIANT_QUALIFIERS,
} from './catalog-source.config.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DATA = resolve(ROOT, 'src/catalog/data/products.generated.json');
const OUT_REPORT = resolve(ROOT, 'data/catalog-extraction-report.json');

/** Stem length in centimetres, or null when the product has no length. */
function lengthCm(value) {
  const s = text(value);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function resolveFamily(rawFamily) {
  const raw = text(rawFamily);
  if (raw === null) return null;
  const alias = FAMILY_ALIASES[raw.toLowerCase()];
  return {
    name: alias?.name ?? raw,
    attributes: alias?.attributes ?? null,
    sourceName: raw,
  };
}

/**
 * Applies VARIANT_QUALIFIERS to one row's item name.
 * @param {string|null} fullName raw `fully_qualified_name`
 * @param {string} familyName resolved product family
 */
function resolveQualifiers(fullName, familyName) {
  if (fullName === null) return { variety: null, attributes: null, applied: [] };

  let variety = null;
  let attributes = null;
  const applied = [];

  for (const rule of VARIANT_QUALIFIERS) {
    if (rule.family && rule.family !== familyName) continue;
    const m = rule.match.exec(fullName);
    if (!m) continue;
    if (rule.variety) variety = rule.variety(m);
    if (rule.attributes) attributes = { ...attributes, ...rule.attributes(m) };
    applied.push(String(rule.match));
  }
  return { variety, attributes, applied };
}

const report = {
  generatedAt: new Date().toISOString(),
  sources: [],
  skippedRows: [],
  duplicateVariants: [],
  qualifiersApplied: [],
  productsWithoutImage: [],
  familyAliasesApplied: [],
  unmappedTypeProducts: [],
  unmappedSalesUnits: [],
};

/** @type {Map<string, any>} */
const products = new Map();

for (const source of SOURCE_FILES) {
  const filePath = resolve(ROOT, source.file);
  const { records } = readSheetAsObjects(filePath, SOURCE_COLUMNS);

  let kept = 0;
  for (const [index, row] of records.entries()) {
    const rowNumber = index + 2; // +1 for the header, +1 for 1-based rows
    const skip = (reason) => {
      report.skippedRows.push({
        source: source.file,
        row: rowNumber,
        reason,
        name: text(row.fully_qualified_name),
      });
    };

    if (text(row.active) !== 'Yes') {
      skip('row is not marked active');
      continue;
    }
    const location = text(row.location);
    if (location === null) {
      skip('missing location');
      continue;
    }
    if (location !== source.expectLocation) {
      skip(`unexpected location "${location}", expected "${source.expectLocation}"`);
      continue;
    }

    const family = resolveFamily(row.product_family);
    if (family === null) {
      skip('missing product_family');
      continue;
    }
    if (family.name !== family.sourceName) {
      report.familyAliasesApplied.push({ from: family.sourceName, to: family.name, source: source.file });
    }

    const typeProduct = text(row.type_product);
    const category = TYPE_PRODUCT_TO_CATEGORY[typeProduct];
    if (!category) {
      report.unmappedTypeProducts.push({ source: source.file, row: rowNumber, value: typeProduct });
      skip(`type_product "${typeProduct}" has no category mapping`);
      continue;
    }

    const salesUnit = text(row.sales_unit);
    const measure = SALES_UNIT_TO_MEASURE[salesUnit];
    if (!measure) {
      report.unmappedSalesUnits.push({ source: source.file, row: rowNumber, value: salesUnit });
      skip(`sales_unit "${salesUnit}" has no measure mapping`);
      continue;
    }

    const productId = slugify(family.name);
    if (!products.has(productId)) {
      products.set(productId, {
        id: productId,
        slug: productId,
        name: family.name,
        category,
        group: slugify(text(row.category) ?? category),
        groupLabel: text(row.category) ?? null,
        variety: null,
        description: null,
        images: [],
        isNew: false,
        createdAt: null,
        locations: new Map(),
        relatedProductIds: [],
      });
    }
    const product = products.get(productId);

    const locations = product.locations;
    if (!locations.has(source.catalogSource)) {
      locations.set(source.catalogSource, {
        location: source.catalogSource,
        catalogAvailable: true,
        variants: new Map(),
      });
    }
    const variants = locations.get(source.catalogSource).variants;

    const qualifier = resolveQualifiers(text(row.fully_qualified_name), family.name);
    if (qualifier.applied.length) {
      report.qualifiersApplied.push({
        source: source.file,
        row: rowNumber,
        name: text(row.fully_qualified_name),
        variety: qualifier.variety,
        attributes: qualifier.attributes,
      });
    }

    const variety = text(row.variety) ?? qualifier.variety;
    const color = text(row.color);
    const size = lengthCm(row.size_cm);
    const rowAttributes =
      family.attributes || qualifier.attributes
        ? { ...family.attributes, ...qualifier.attributes }
        : null;
    // Attributes are part of the variant's identity: two rows can share
    // variety/colour/length and still be different products to order (for
    // example Leather Leaf sold in 10-stem and 20-stem bunches).
    const attributeKey = rowAttributes
      ? Object.entries(rowAttributes)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${slugify(k)}-${slugify(v)}`)
          .join('_')
      : null;
    const variantId = [
      slugify(variety) || 'novariety',
      slugify(color) || 'nocolor',
      size === null ? 'nolength' : `${size}cm`,
      ...(attributeKey ? [attributeKey] : []),
    ].join('_');

    if (variants.has(variantId) && variants.get(variantId).availableMeasures.has(measure)) {
      // Two source rows describe the same orderable variant. Nothing is lost
      // for the catalog, but it is worth surfacing so Esfenix can de-duplicate
      // the accounting export.
      report.duplicateVariants.push({
        source: source.file,
        row: rowNumber,
        product: family.name,
        variantId,
        name: text(row.fully_qualified_name),
      });
    }

    if (!variants.has(variantId)) {
      variants.set(variantId, {
        id: variantId,
        variety,
        color,
        lengthCm: size,
        availableMeasures: new Set(),
        attributes: rowAttributes,
      });
    }
    variants.get(variantId).availableMeasures.add(measure);
    kept += 1;
  }

  report.sources.push({ file: source.file, rowsRead: records.length, rowsKept: kept });
}

const MEASURE_ORDER = ['stem', 'bunch', 'unit', 'pack', 'box'];

/** Sorts variants so the UI reads predictably: variety, then colour, then length. */
function compareVariants(a, b) {
  return (
    String(a.variety ?? '').localeCompare(String(b.variety ?? '')) ||
    String(a.color ?? '').localeCompare(String(b.color ?? '')) ||
    (a.lengthCm ?? 0) - (b.lengthCm ?? 0)
  );
}

const serialized = [...products.values()]
  .map((product) => {
    const image = PRODUCT_IMAGES[product.id];
    if (!image) report.productsWithoutImage.push({ id: product.id, name: product.name });

    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      category: product.category,
      group: product.group,
      groupLabel: product.groupLabel,
      variety: product.variety,
      description: product.description,
      images: image
        ? [{ id: `${product.id}-primary`, src: image.src, alt: image.alt, isPrimary: true }]
        : [],
      isNew: product.isNew,
      createdAt: product.createdAt,
      locations: [...product.locations.values()]
        .map((entry) => ({
          location: entry.location,
          catalogAvailable: entry.catalogAvailable,
          variants: [...entry.variants.values()]
            .map((variant) => ({
              id: variant.id,
              variety: variant.variety,
              color: variant.color,
              lengthCm: variant.lengthCm,
              availableMeasures: MEASURE_ORDER.filter((m) => variant.availableMeasures.has(m)),
              ...(variant.attributes ? { attributes: variant.attributes } : {}),
            }))
            .sort(compareVariants),
        }))
        .sort((a, b) => a.location.localeCompare(b.location)),
      relatedProductIds: product.relatedProductIds,
    };
  })
  .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));

const payload = {
  generatedAt: report.generatedAt,
  note: 'Generated by scripts/build-catalog-data.mjs. Contains no pricing data. Do not edit by hand — edit the source workbooks or src/catalog/data/product-overrides.js.',
  catalogSources: SOURCE_FILES.map((s) => s.catalogSource),
  products: serialized,
};

// Guard: fail loudly rather than ship a price into the public bundle.
const json = JSON.stringify(payload, null, 2);
const leaked = FORBIDDEN_COLUMNS.filter((column) => json.includes(`"${column}"`));
if (leaked.length) {
  throw new Error(`Refusing to write catalog data: monetary field(s) present: ${leaked.join(', ')}`);
}
if (/[$€£]\s?\d/.test(json)) {
  throw new Error('Refusing to write catalog data: output contains a currency amount.');
}

mkdirSync(dirname(OUT_DATA), { recursive: true });
writeFileSync(OUT_DATA, `${json}\n`);
mkdirSync(dirname(OUT_REPORT), { recursive: true });
writeFileSync(OUT_REPORT, `${JSON.stringify(report, null, 2)}\n`);

const variantCount = serialized.reduce(
  (sum, p) => sum + p.locations.reduce((s, l) => s + l.variants.length, 0),
  0,
);
console.log(`Products:  ${serialized.length}`);
console.log(`Variants:  ${variantCount}`);
console.log(`Skipped:   ${report.skippedRows.length} row(s) — see ${OUT_REPORT}`);
console.log(`Duplicate: ${report.duplicateVariants.length} source row(s) describing an existing variant`);
console.log(`No image:  ${report.productsWithoutImage.length} product(s)`);
console.log(`Written:   ${OUT_DATA}`);
