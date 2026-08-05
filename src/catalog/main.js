/**
 * Catalog entry point.
 *
 * Both `/catalog` and `/catalog/<category>/<slug>` are served from
 * catalog.html — see the rewrites in firebase.json and the dev middleware in
 * vite.config.js — and the route is resolved here from the pathname.
 */

import { createApp } from './app.js';
import { initSiteChrome } from './ui/site-chrome.js';

const head = document.getElementById('cat-head');
const body = document.getElementById('cat-app');

if (head && body) {
  initSiteChrome();
  const app = createApp({ head, body });
  // Views call ctx.render() after mutating the quote list from inside a form.
  app.ctx.render = app.render;
  app.start();
}
