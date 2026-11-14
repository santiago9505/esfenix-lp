import { translateText } from './translations.js';

const STORAGE_KEY = 'esfenix-language';
const TRANSLATABLE_ATTRIBUTES = ['alt', 'aria-label', 'aria-description', 'aria-roledescription', 'placeholder', 'title', 'data-label', 'data-description'];
const nodeSources = new WeakMap();
const attributeSources = new WeakMap();
let initialized = false;
let observer = null;

function initialLanguage() {
  if (typeof window === 'undefined') return 'en';
  const requested = new URLSearchParams(window.location.search).get('lang');
  if (requested === 'en' || requested === 'es') return requested;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'es' ? 'es' : 'en';
  } catch {
    return 'en';
  }
}

let language = initialLanguage();

export function getLanguage() {
  return language;
}

export function t(source) {
  return language === 'es' ? translateText(source) : source;
}

function localized(source) {
  if (language === 'en') return source;
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(source);
  return match[1] + translateText(match[2]) + match[3];
}

function updateText(node) {
  if (!node.nodeValue?.trim()) return;
  const tag = node.parentElement?.tagName;
  if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return;
  const current = node.nodeValue;
  const saved = nodeSources.get(node);
  const source = saved && current === saved.rendered ? saved.source : current;
  const override = node.parentElement?.getAttribute('data-i18n-es');
  const rendered = language === 'es' && override != null
    ? source.match(/^\s*/)[0] + override + source.match(/\s*$/)[0]
    : localized(source);
  nodeSources.set(node, { source, rendered });
  if (rendered !== current) node.nodeValue = rendered;
}

function updateAttribute(node, name) {
  if (!node.hasAttribute(name)) return;
  const current = node.getAttribute(name);
  if (!current?.trim()) return;
  let sources = attributeSources.get(node);
  if (!sources) {
    sources = new Map();
    attributeSources.set(node, sources);
  }
  const saved = sources.get(name);
  const source = saved && current === saved.rendered ? saved.source : current;
  const rendered = localized(source);
  sources.set(name, { source, rendered });
  if (rendered !== current) node.setAttribute(name, rendered);
}

function updateElement(node) {
  for (const name of TRANSLATABLE_ATTRIBUTES) updateAttribute(node, name);
  if (node.tagName === 'META') {
    const key = node.getAttribute('name') ?? node.getAttribute('property');
    if (['description', 'og:title', 'og:description', 'og:image:alt', 'twitter:title', 'twitter:description', 'twitter:image:alt'].includes(key)) {
      updateAttribute(node, 'content');
    }
  }
}

function translateTree(root) {
  if (root.nodeType === Node.TEXT_NODE) {
    updateText(root);
    return;
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
  if (root.nodeType === Node.ELEMENT_NODE) updateElement(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.nodeType === Node.TEXT_NODE) updateText(node);
    else updateElement(node);
  }
}

function paintLanguage() {
  document.documentElement.lang = language;
  document.documentElement.dataset.lang = language;
  for (const button of document.querySelectorAll('[data-lang-switch]')) {
    button.setAttribute('aria-pressed', String(button.dataset.langSwitch === language));
  }
  const ogLocale = document.querySelector('meta[property="og:locale"]');
  if (ogLocale) ogLocale.content = language === 'es' ? 'es_US' : 'en_US';
  const manifest = document.querySelector('link[rel="manifest"]');
  if (manifest) manifest.href = language === 'es' ? '/site.es.webmanifest' : '/site.webmanifest';
  translateTree(document.documentElement);
  for (const field of document.querySelectorAll('input[name="socialMediaProfiles"]')) {
    if (field.validity?.customError) field.setCustomValidity(t('Enter a valid website or social media link.'));
  }
}

export function setLanguage(next) {
  if (next !== 'en' && next !== 'es') return;
  if (language === next && initialized) return;
  language = next;
  try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* Storage may be disabled. */ }
  paintLanguage();
  window.dispatchEvent(new CustomEvent('site-language-change', { detail: { language: next } }));
}

export function initLanguage() {
  if (initialized) return;
  initialized = true;
  try { window.localStorage.setItem(STORAGE_KEY, language); } catch { /* Storage may be disabled. */ }
  paintLanguage();
  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-lang-switch]');
    if (button) setLanguage(button.dataset.langSwitch);
  });
  observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'characterData') updateText(record.target);
      else if (record.type === 'attributes') updateAttribute(record.target, record.attributeName);
      else for (const node of record.addedNodes) translateTree(node);
    }
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...TRANSLATABLE_ATTRIBUTES, 'content'],
  });
}
