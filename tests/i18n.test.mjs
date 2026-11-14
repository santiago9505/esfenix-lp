import test from 'node:test';
import assert from 'node:assert/strict';
import { translateText } from '../src/i18n/translations.js';

test('Spanish copy covers the catalog, quote flow, dynamic counts, and countries', () => {
  assert.equal(translateText('Request a quote'), 'Solicitar cotización');
  assert.equal(translateText('3 products match'), '3 productos coinciden');
  assert.equal(translateText('1 product selected'), '1 producto seleccionado');
  assert.equal(translateText('Quantity for Carnation'), 'Cantidad de Clavel');
  assert.equal(translateText('High season — Mother\'s Day'), 'Temporada alta — Día de la Madre');
  assert.equal(translateText('United States'), 'Estados Unidos');
  assert.equal(translateText('Freedom · Red · 60 cm · Bunch'), 'Freedom · Rojo · 60 cm · Ramo');
  assert.equal(translateText('Email address *'), 'Correo electrónico *');
  assert.equal(translateText('Your selection is 80% toward the $150 minimum for Delivery.'), 'Tu selección alcanza el 80% del mínimo de $150 para entrega.');
  assert.equal(translateText('FREEDOM'), 'FREEDOM');
});

test('switching language restores source copy and translates newly rendered content', async () => {
  class TextNode {
    nodeType = 3;
    constructor(value) { this.nodeValue = value; this.parentElement = null; }
  }
  class Element {
    nodeType = 1;
    children = [];
    attributes = new Map();
    dataset = {};
    constructor(tagName, attributes = {}) {
      this.tagName = tagName.toUpperCase();
      for (const [key, value] of Object.entries(attributes)) this.setAttribute(key, value);
    }
    append(...nodes) {
      for (const node of nodes) { node.parentElement = this; this.children.push(node); }
    }
    hasAttribute(name) { return this.attributes.has(name); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    set content(value) { this.setAttribute('content', value); }
    get content() { return this.getAttribute('content'); }
    closest(selector) { return selector === '[data-lang-switch]' && this.hasAttribute('data-lang-switch') ? this : null; }
  }
  const html = new Element('html');
  const head = new Element('head');
  const body = new Element('body');
  const title = new Element('title');
  const titleText = new TextNode('Product Catalog — Esfenix');
  title.append(titleText);
  const meta = new Element('meta', { property: 'og:locale', content: 'en_US' });
  const button = new Element('button', { 'data-lang-switch': 'en', 'aria-pressed': 'true' });
  button.dataset.langSwitch = 'en';
  const spanishButton = new Element('button', { 'data-lang-switch': 'es', 'aria-pressed': 'false' });
  spanishButton.dataset.langSwitch = 'es';
  const nav = new Element('nav', { 'aria-label': 'Primary' });
  const link = new Element('a');
  const linkText = new TextNode('Catalog');
  link.append(linkText);
  nav.append(link);
  const heading = new Element('h2', { 'data-i18n-es': 'Calidad' });
  const headingText = new TextNode('Premium ');
  const emphasis = new Element('em', { 'data-i18n-es': 'premium' });
  const emphasisText = new TextNode('Quality');
  emphasis.append(emphasisText);
  heading.append(headingText, emphasis);
  head.append(title, meta);
  body.append(button, spanishButton, nav, heading);
  html.append(head, body);

  const storage = new Map();
  const listeners = new Map();
  let observer;
  globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1, DOCUMENT_NODE: 9 };
  globalThis.NodeFilter = { SHOW_ELEMENT: 1, SHOW_TEXT: 4 };
  globalThis.CustomEvent = class { constructor(type, options) { this.type = type; this.detail = options.detail; } };
  globalThis.MutationObserver = class {
    constructor(callback) { observer = callback; }
    observe() {}
  };
  globalThis.document = {
    documentElement: html,
    querySelectorAll: () => [button, spanishButton],
    querySelector: (selector) => selector === 'meta[property="og:locale"]' ? meta : null,
    addEventListener(type, callback) { listeners.set(type, callback); },
    createTreeWalker(root) {
      const descendants = [];
      const visit = (node) => { for (const child of node.children ?? []) { descendants.push(child); visit(child); } };
      visit(root);
      let index = -1;
      return { currentNode: null, nextNode() { this.currentNode = descendants[++index]; return Boolean(this.currentNode); } };
    },
  };
  globalThis.window = {
    location: { search: '?lang=es' },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    dispatchEvent() {},
  };

  try {
    const { initLanguage, getLanguage } = await import('../src/i18n/locale.js');
    initLanguage();
    assert.equal(getLanguage(), 'es');
    assert.equal(html.lang, 'es');
    assert.equal(linkText.nodeValue, 'Catálogo');
    assert.equal(nav.getAttribute('aria-label'), 'Navegación principal');
    assert.equal(titleText.nodeValue, 'Catálogo de productos — Esfenix');
    assert.equal(headingText.nodeValue, 'Calidad ');
    assert.equal(emphasisText.nodeValue, 'premium');
    assert.equal(meta.getAttribute('content'), 'es_US');

    listeners.get('click')({ target: button });
    assert.equal(linkText.nodeValue, 'Catalog');
    assert.equal(nav.getAttribute('aria-label'), 'Primary');
    assert.equal(titleText.nodeValue, 'Product Catalog — Esfenix');
    assert.equal(headingText.nodeValue, 'Premium ');
    assert.equal(emphasisText.nodeValue, 'Quality');
    assert.equal(storage.get('esfenix-language'), 'en');

    listeners.get('click')({ target: spanishButton });
    const dynamic = new Element('p');
    const dynamicText = new TextNode('2 products match');
    dynamic.append(dynamicText);
    body.append(dynamic);
    observer([{ type: 'childList', addedNodes: [dynamic] }]);
    assert.equal(dynamicText.nodeValue, '2 productos coinciden');
  } finally {
    delete globalThis.Node;
    delete globalThis.NodeFilter;
    delete globalThis.CustomEvent;
    delete globalThis.MutationObserver;
    delete globalThis.document;
    delete globalThis.window;
  }
});
