import assert from 'node:assert/strict';
import test from 'node:test';

import viteConfig from '../vite.config.js';

async function importQuoteConfig(hostname) {
  const previousWindow = globalThis.window;
  globalThis.window = { location: { hostname } };
  try {
    return await import(`../src/catalog/data/quote-config.js?hostname=${hostname}`);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
}

test('localhost uses the same-origin client lookup proxy', async () => {
  const config = await importQuoteConfig('localhost');
  assert.equal(config.CLIENT_LOOKUP_ENDPOINT, '/api/client-lookup');
});

test('production continues using the deployed client lookup Worker', async () => {
  const config = await importQuoteConfig('esfenix.com');
  assert.equal(
    config.CLIENT_LOOKUP_ENDPOINT,
    'https://esfenix-client-lookup.esfenix724.workers.dev',
  );
});

test('Vite proxies the local lookup in dev and preview without forwarding Origin', () => {
  for (const proxyConfig of [viteConfig.server.proxy, viteConfig.preview.proxy]) {
    const lookupProxy = proxyConfig['/api/client-lookup'];
    assert.equal(lookupProxy.target, 'https://esfenix-client-lookup.esfenix724.workers.dev');
    assert.equal(lookupProxy.changeOrigin, true);
    assert.equal(lookupProxy.rewrite('/api/client-lookup'), '/');

    let proxyRequestHandler;
    lookupProxy.configure({
      on(event, handler) {
        if (event === 'proxyReq') proxyRequestHandler = handler;
      },
    });
    let removedHeader = '';
    proxyRequestHandler({
      removeHeader(header) {
        removedHeader = header;
      },
    });
    assert.equal(removedHeader, 'origin');
  }
});
