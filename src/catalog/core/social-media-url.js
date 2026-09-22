/**
 * Turns a website or social-media domain into an absolute HTTP(S) URL.
 *
 * Visitors commonly paste `example.com` or `www.example.com` instead of a
 * URL with a protocol. Those forms are safe to interpret as HTTPS. Explicit
 * HTTP(S) URLs are preserved so existing values keep their original shape.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeSocialMediaUrl(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';

  const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(text);
  const candidate = hasScheme
    ? text
    : `https://${text.replace(/^\/\//, '')}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (url.username || url.password) return '';

    // Without an explicit scheme, require a recognizable domain. This keeps
    // arbitrary text from being silently converted into a link.
    if (!hasScheme && !url.hostname.includes('.')) return '';

    return hasScheme ? text : candidate;
  } catch {
    return '';
  }
}
