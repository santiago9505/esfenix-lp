import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { htmlPartials } from '../scripts/vite-plugin-html-partials.mjs';

test('Windows HTML and partials produce the same inline-script CSP hashes as LF checkouts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'esfenix-html-partials-'));
  const partialDir = join(root, 'partials');
  const partialPath = join(partialDir, 'header.html');
  await mkdir(partialDir);
  const page = '<!--#include header-->\n<script>\nwindow.example = true;\n</script>\n';
  const partial = '<header>\n<script>\nwindow.header = true;\n</script>\n</header>\n';
  const plugin = htmlPartials({ root, dir: 'partials' });
  const hashes = html => [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(match => createHash('sha256').update(match[1]).digest('hex'));
  try {
    await writeFile(partialPath, partial);
    const canonical = plugin.transformIndexHtml.handler(page);
    await writeFile(partialPath, partial.replace(/\n/g, '\r\n'));
    const windows = plugin.transformIndexHtml.handler(page.replace(/\n/g, '\r\n'));
    assert.deepEqual(hashes(windows), hashes(canonical));
    assert.equal(windows, canonical);
  } finally {
    await unlink(partialPath);
    await rmdir(partialDir);
    await rmdir(root);
  }
});
