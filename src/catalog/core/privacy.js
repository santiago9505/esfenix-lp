const MASK = '•';

function maskedSuffix(visiblePrefix, count = 4) {
  return `${visiblePrefix}${MASK.repeat(count)}`;
}

/**
 * Keeps enough of an email visible for a returning client to recognize it
 * without exposing the complete address in the page or accessibility tree.
 */
export function maskEmailForDisplay(email) {
  const value = String(email ?? '').trim();
  const separator = value.lastIndexOf('@');
  if (separator <= 0 || separator === value.length - 1) return MASK.repeat(6);

  const local = value.slice(0, separator);
  const domain = value.slice(separator + 1);
  const dot = domain.lastIndexOf('.');
  const domainName = dot > 0 ? domain.slice(0, dot) : domain;
  const extension = dot > 0 ? domain.slice(dot) : '';

  return `${maskedSuffix(local.slice(0, 2))}@${maskedSuffix(domainName.slice(0, 2))}${extension}`;
}

/** Keeps the first and last two digits while preserving the original format. */
export function maskPhoneForDisplay(phone) {
  const value = String(phone ?? '').trim();
  const digitCount = (value.match(/\d/g) || []).length;
  if (digitCount === 0) return MASK.repeat(6);

  let digitIndex = 0;
  return [...value].map((character) => {
    if (!/\d/.test(character)) return character;
    const visible = digitIndex < 2 || digitIndex >= digitCount - 2;
    digitIndex += 1;
    return visible ? character : MASK;
  }).join('');
}
