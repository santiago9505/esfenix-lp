import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';

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

/**
 * `public/` keeps lossless source images beside their WebP derivatives so they
 * can be regenerated without quality loss. Production only needs the WebP
 * files. Removing duplicate sources from `dist/` cuts deploy size drastically
 * without changing a single requested URL.
 */
function pruneRedundantBuildAssets() {
  return {
    name: 'esfenix-prune-redundant-assets',
    closeBundle() {
      const images = fileURLToPath(new URL('./dist/assets/images', import.meta.url));
      if (!existsSync(images)) return;

      const visit = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const file = join(dir, entry.name);
          if (entry.isDirectory()) {
            visit(file);
            continue;
          }
          const extension = extname(entry.name).toLowerCase();
          if (!['.png', '.jpg', '.jpeg'].includes(extension)) continue;
          const webp = file.slice(0, -extension.length) + '.webp';
          if (existsSync(webp)) rmSync(file);
        }
      };

      visit(images);
      const rawHeroVideo = join(images, 'Hero-Video.mp4');
      if (existsSync(rawHeroVideo)) rmSync(rawHeroVideo);
    },
  };
}

function optimizeHtmlMarkup() {
  let coverageSvg = '';
  const coveragePath = '/assets/images/usa-coverage.svg';

  return {
    name: 'esfenix-optimize-html-markup',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const optimized = html.replace(
          /<svg class="fab-ico"[\s\S]*?<\/svg>/,
          '<img class="fab-ico" src="/assets/esfenix-logo-altern.svg" alt="" aria-hidden="true">',
        );
        return optimized.replace(/<svg id="usaMapSvg"[\s\S]*?<\/svg>/, (svg) => {
          coverageSvg = svg.replace('</svg>', `<style>
              .st0{fill:none!important;stroke:#8924a0;stroke-width:1.4;stroke-linejoin:round;stroke-linecap:round;stroke-dasharray:1;stroke-dashoffset:1;animation:map-draw 6s ease-in-out .15s forwards}
              .pin{fill:#8924a0;opacity:0;animation:pin-in .5s ease 3s forwards}
              .pulse{fill:#af30cd;opacity:0;transform-box:fill-box;transform-origin:center;animation:map-pulse 1.8s ease-out 3.2s infinite}
              @keyframes map-draw{to{stroke-dashoffset:0}}
              @keyframes pin-in{to{opacity:1}}
              @keyframes map-pulse{0%{opacity:.45;transform:scale(.45)}70%,100%{opacity:0;transform:scale(1.7)}}
              @media(prefers-reduced-motion:reduce){.st0{animation:none;stroke-dashoffset:0}.pin{animation:none;opacity:1}.pulse{display:none}}
            </style></svg>`);
          return `<img class="usa-map" src="${coveragePath}" alt="Coverage: United States" width="577" height="380" loading="lazy" decoding="async">`;
        });
      },
    },
    configureServer(server) {
      server.middlewares.use(coveragePath, (_request, response) => {
        if (!coverageSvg) return response.end();
        response.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
        response.setHeader('Cache-Control', 'no-cache');
        response.end(coverageSvg);
      });
    },
    closeBundle() {
      if (!coverageSvg) return;
      const output = fileURLToPath(new URL(`./dist${coveragePath}`, import.meta.url));
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, coverageSvg, 'utf8');
    },
  };
}

export default defineConfig({
  base: '/',
  // Only explicitly public variables may enter browser bundles. FRESA_* values
  // are private server configuration and must never be transformed by Vite.
  envPrefix: ['VITE_'],
  plugins: [htmlPartials(), cleanRoutes(), optimizeHtmlMarkup(), pruneRedundantBuildAssets()],
  build: {
    rollupOptions: {
      input: {
        main: page('index.html'),
        catalog: page('catalog.html'),
      },
    },
  },
});
