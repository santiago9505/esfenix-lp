/**
 * Vite plugin: `<!--#include name-->` -> contents of `src/partials/name.html`.
 *
 * The site is static HTML, so the header, mobile overlay and footer would
 * otherwise be copy-pasted into every page and drift apart. This keeps one
 * source of truth without pulling in a template engine.
 *
 * Runs in dev and in build (`transformIndexHtml` covers both). Editing a
 * partial triggers a full reload in dev.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const INCLUDE = /<!--#include\s+([a-z0-9-]+)\s*-->/gi;

/** @param {{ root?: string, dir?: string }} [options] */
export function htmlPartials(options = {}) {
  const dir = options.dir ?? 'src/partials';
  let root = options.root ?? process.cwd();

  return {
    name: 'esfenix-html-partials',
    enforce: 'pre',

    configResolved(config) {
      root = config.root;
    },

    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return html.replace(INCLUDE, (match, name) => {
          const file = resolve(root, dir, `${name}.html`);
          if (!existsSync(file)) {
            throw new Error(`html-partials: no partial named "${name}" at ${file}`);
          }
          return readFileSync(file, 'utf8').trimEnd();
        });
      },
    },

    configureServer(server) {
      server.watcher.add(resolve(root, dir));
      server.watcher.on('change', (file) => {
        if (file.replace(/\\/g, '/').includes(`/${dir}/`)) {
          server.ws.send({ type: 'full-reload' });
        }
      });
    },
  };
}
