/**
 * Slug helpers shared by the build script and the runtime.
 *
 * Product and variety slugs appear in URLs (`/catalog/roses/ecuadorian-roses`,
 * `?variety=hot-lady`), so both sides must agree on exactly one algorithm.
 */

// Combining diacritical marks, stripped after NFD so "Ámbar" and "Ambar" agree.
const COMBINING_MARKS = /[̀-ͯ]/g;
const APOSTROPHES = /['‘’]/g;

/**
 * @param {unknown} value
 * @returns {string} lower-case, hyphen-separated, URL-safe
 */
export function slugify(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(APOSTROPHES, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Trims a source value to a string, mapping blanks to null so the model uses
 * `null` for "this product has no such attribute" as the spec requires.
 * @param {unknown} value
 * @returns {string|null}
 */
export function text(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}
