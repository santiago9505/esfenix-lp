import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const firebase = JSON.parse(await readFile(resolve(root, 'firebase.json'), 'utf8'));
const globalHeaders = firebase.hosting?.headers?.find((entry) => entry.source === '**')?.headers ?? [];
const policy = globalHeaders.find((header) => header.key.toLowerCase() === 'content-security-policy')?.value ?? '';

if (!policy) fail('firebase.json has no global Content-Security-Policy header.');

const scriptDirective = policy
  .split(';')
  .map((directive) => directive.trim())
  .find((directive) => directive.startsWith('script-src ')) ?? '';

if (!scriptDirective || scriptDirective.includes("'unsafe-inline'")) {
  fail("script-src must exist and must not allow 'unsafe-inline'.");
}

let count = 0;
for (const name of ['index.html', 'catalog.html']) {
  const html = await readFile(resolve(root, 'dist', name), 'utf8');
  const scripts = html.matchAll(/<script(?=[\s>])(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of scripts) {
    count += 1;
    const hash = `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`;
    if (!scriptDirective.includes(hash)) fail(`${name} contains an inline script missing from the CSP.`);
  }
}

console.log(`CSP check passed (${count} inline script hashes verified).`);

function fail(message) {
  console.error(`CSP check failed: ${message}`);
  process.exit(1);
}
