import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

import { htmlPartials } from './scripts/vite-plugin-html-partials.mjs';

const page = (name) => fileURLToPath(new URL(`./${name}`, import.meta.url));

/**
 * Serves the clean catalog URLs from catalog.html during development.
 *
 * `/catalog` and `/catalog/<category>/<slug>` are client-rendered from a single
 * HTML entry, which is what the Firebase Hosting rewrites in firebase.json do
 * in production. Requests that look like files are left alone so assets and
 * module imports under those paths still resolve.
 */
function cleanRoutes() {
  return {
    name: 'esfenix-clean-routes',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const path = (req.url || '').split('?')[0];
        const isCatalogRoute = path === '/catalog' || path.startsWith('/catalog/');
        const looksLikeFile = /\.[a-z0-9]+$/i.test(path);
        if (isCatalogRoute && !looksLikeFile) req.url = '/catalog.html';
        next();
      });
    },
  };
}

export default defineConfig({
  base: '/',
  // The catalog is intentionally requested by the browser using the exact
  // Fresa variable names supplied to this project. The key is therefore
  // public at runtime and must be rotated for production.
  envPrefix: ['VITE_', 'FRESA_'],
  plugins: [htmlPartials(), cleanRoutes()],
  build: {
    rollupOptions: {
      input: {
        main: page('index.html'),
        catalog: page('catalog.html'),
      },
    },
  },
});
