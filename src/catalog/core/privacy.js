const MASK = '•';

/**
 * Keeps the beginning of a name or company visible so the returning client can
 * recognize it, while masking the remaining letters and digits.
 */
export function maskTextForDisplay(text) {
  const value = String(text ?? '').trim();
  const characterCount = ([...value].filter((character) => /[\p{L}\p{N}]/u.test(character))).length;
  if (characterCount === 0) return MASK.repeat(3);

  const visibleCount = characterCount <= 3 ? 1 : 2;
  let seen = 0;
  return [...value].map((character) => {
    if (!/[\p{L}\p{N}]/u.test(character)) return character;
    const visible = seen < visibleCount;
    seen += 1;
    return visible ? character : MASK;
  }).join('');
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
