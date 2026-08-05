/**
 * Choosing which version of a product to add to the quote list.
 *
 * Renders only the dimensions the product actually has — a product with no
 * colours shows no colour control — and narrows each dimension by the ones
 * chosen before it, so every reachable combination corresponds to a variant
 * that really exists in this location's catalog. An ambiguous variant can
 * therefore never be added.
 *
 * Used as a dialog from the catalog cards, and inline on the product page.
 */

import { describeAttribute, capitalize } from '../core/format.js';
import { el, replaceChildren } from './dom.js';
import { openModal } from './modal.js';
import { validateSelection } from '../core/quote-store.js';

/**
 * @typedef {import('../core/repository').LocationProduct} LocationProduct
 * @typedef {import('../core/types').ProductVariant} ProductVariant
 */

const MEASURE_LABELS = { stem: 'Stem', bunch: 'Bunch', unit: 'Unit', pack: 'Pack', box: 'Box' };

/** Ordered so each dimension narrows the next. */
const DIMENSIONS = [
  { key: 'variety', label: 'Variety' },
  { key: 'color', label: 'Color' },
  { key: 'lengthCm', label: 'Stem length' },
];

/** @param {ProductVariant[]} variants */
function presentDimensions(variants) {
  return DIMENSIONS.filter((dimension) =>
    variants.some((variant) => variant[dimension.key] !== null && variant[dimension.key] !== undefined),
  );
}

/**
 * Variants still reachable given the choices made for dimensions before `upTo`.
 * @param {ProductVariant[]} variants
 * @param {Record<string, any>} choice
 * @param {string} [upTo]
 */
function narrow(variants, choice, upTo) {
  return variants.filter((variant) => {
    for (const dimension of DIMENSIONS) {
      if (dimension.key === upTo) break;
      const chosen = choice[dimension.key];
      if (chosen === undefined || chosen === null) continue;
      if ((variant[dimension.key] ?? null) !== chosen) return false;
    }
    return true;
  });
}

/**
 * @param {ProductVariant[]} variants
 * @param {string} key
 */
function optionsFor(variants, key) {
  const values = new Set();
  for (const variant of variants) {
    const value = variant[key];
    if (value !== null && value !== undefined) values.add(value);
  }
  const list = [...values];
  return key === 'lengthCm' ? list.sort((a, b) => a - b) : list.sort((a, b) => String(a).localeCompare(String(b)));
}

/**
 * Builds the picker's form. Returns the element plus a `read()` that resolves
 * the current selection, so both the dialog and the product page can use it.
 *
 * @param {LocationProduct} product
 * @param {{
 *   initial?: Record<string, any>,
 *   onValidityChange?: (valid: boolean) => void,
 *   onSelectionChange?: (state: { variant: ProductVariant|null }) => void,
 * }} [options]
 */
export function variantForm(product, options = {}) {
  const dimensions = presentDimensions(product.variants);

  /** @type {Record<string, any>} */
  const choice = {
    variety: options.initial?.variety ?? null,
    color: options.initial?.color ?? null,
    lengthCm: options.initial?.lengthCm ?? null,
    measure: options.initial?.measure ?? null,
    quantity: options.initial?.quantity ?? 1,
  };

  const container = el('div', { class: 'cat-variant-form' });
  const errorList = el('ul', { class: 'cat-field-errors', role: 'alert', hidden: true });

  /** @returns {ProductVariant|null} */
  function currentVariant() {
    const matches = narrow(product.variants, choice);
    // Every present dimension must be pinned before a variant is unambiguous.
    for (const dimension of dimensions) {
      if (choice[dimension.key] === null || choice[dimension.key] === undefined) return null;
    }
    return matches[0] ?? null;
  }

  function measures() {
    const variant = currentVariant();
    if (variant) return variant.availableMeasures ?? [];
    // Before the variant is pinned, offer the union of what is still reachable.
    const set = new Set();
    for (const candidate of narrow(product.variants, choice)) {
      for (const measure of candidate.availableMeasures ?? []) set.add(measure);
    }
    return [...set];
  }

  function render() {
    const rows = [];

    for (const dimension of dimensions) {
      const reachable = narrow(product.variants, choice, dimension.key);
      const values = optionsFor(reachable, dimension.key);
      if (values.length === 0) continue;

      // A dimension with one possible value is decided, not a question.
      if (values.length === 1 && choice[dimension.key] !== values[0]) {
        choice[dimension.key] = values[0];
      }
      if (choice[dimension.key] !== null && !values.includes(choice[dimension.key])) {
        choice[dimension.key] = values.length === 1 ? values[0] : null;
      }

      rows.push(
        selectRow({
          label: dimension.label,
          value: choice[dimension.key],
          options: values.map((value) => ({
            value,
            label: dimension.key === 'lengthCm' ? `${value} cm` : String(value),
          })),
          disabled: values.length === 1,
          onChange(value) {
            choice[dimension.key] = dimension.key === 'lengthCm' ? Number(value) : value;
            // Anything chosen further down may no longer be reachable.
            let past = false;
            for (const other of dimensions) {
              if (past) choice[other.key] = null;
              if (other.key === dimension.key) past = true;
            }
            choice.measure = null;
            render();
          },
        }),
      );
    }

    const measureValues = measures();
    if (measureValues.length > 0) {
      if (measureValues.length === 1) choice.measure = measureValues[0];
      else if (choice.measure && !measureValues.includes(choice.measure)) choice.measure = null;

      rows.push(
        selectRow({
          label: 'Available as',
          value: choice.measure,
          options: measureValues.map((measure) => ({
            value: measure,
            label: MEASURE_LABELS[measure] ?? capitalize(measure),
          })),
          disabled: measureValues.length === 1,
          onChange(value) {
            choice.measure = value;
            render();
          },
        }),
      );
    }

    const variant = currentVariant();
    const attributes = Object.entries(variant?.attributes ?? {});
    if (attributes.length > 0) {
      rows.push(
        el('p', {
          class: 'cat-variant-attrs',
          text: attributes.map(([key, value]) => describeAttribute(key, value)).join(' · '),
        }),
      );
    }

    rows.push(quantityRow(choice, render));
    rows.push(errorList);

    replaceChildren(container, rows);
    options.onValidityChange?.(currentVariant() !== null);
    options.onSelectionChange?.({ variant: currentVariant() });
  }

  render();

  return {
    element: container,

    /** @returns {{ variantId: string|null, measure: string|null, quantity: number }} */
    read() {
      const variant = currentVariant();
      return {
        variantId: variant?.id ?? null,
        measure: choice.measure ?? null,
        quantity: choice.quantity,
      };
    },

    /** @param {string[]} errors */
    showErrors(errors) {
      replaceChildren(
        errorList,
        errors.map((error) => el('li', { text: error })),
      );
      errorList.hidden = errors.length === 0;
    },
  };
}

let rowId = 0;

/**
 * @param {{
 *   label: string,
 *   value: any,
 *   options: Array<{ value: any, label: string }>,
 *   disabled?: boolean,
 *   onChange: (value: any) => void,
 * }} config
 */
function selectRow(config) {
  const id = `cat-variant-${++rowId}`;
  return el('div', { class: 'cat-field' }, [
    el('label', { for: id, text: config.label }),
    el('div', { class: 'cat-select-wrap' }, [
      el(
        'select',
        {
          id,
          class: 'cat-select',
          disabled: config.disabled === true,
          onChange: (event) => config.onChange(event.currentTarget.value),
        },
        [
          config.value === null || config.value === undefined
            ? el('option', { value: '', selected: true, text: `Select ${config.label.toLowerCase()}` })
            : null,
          ...config.options.map((option) =>
            el('option', {
              value: option.value,
              selected: String(option.value) === String(config.value),
              text: option.label,
            }),
          ),
        ],
      ),
    ]),
  ]);
}

/**
 * @param {Record<string, any>} choice
 * @param {() => void} rerender
 */
function quantityRow(choice, rerender) {
  const id = `cat-variant-qty-${++rowId}`;
  const input = el('input', {
    id,
    type: 'number',
    min: '1',
    step: '1',
    inputmode: 'numeric',
    class: 'cat-qty-input',
    value: String(choice.quantity),
    onInput(event) {
      const parsed = Number.parseInt(event.currentTarget.value, 10);
      choice.quantity = Number.isFinite(parsed) ? parsed : Number.NaN;
    },
  });

  const step = (delta) => () => {
    const next = Math.max(1, (Number.isFinite(choice.quantity) ? choice.quantity : 1) + delta);
    choice.quantity = next;
    input.value = String(next);
    rerender();
  };

  return el('div', { class: 'cat-field cat-field-qty' }, [
    el('label', { for: id, text: 'Quantity' }),
    el('div', { class: 'cat-qty' }, [
      el('button', {
        type: 'button',
        class: 'cat-qty-btn',
        'aria-label': 'Decrease quantity',
        text: '−',
        onClick: step(-1),
      }),
      input,
      el('button', {
        type: 'button',
        class: 'cat-qty-btn',
        'aria-label': 'Increase quantity',
        text: '+',
        onClick: step(1),
      }),
    ]),
  ]);
}

/**
 * Opens the picker as a dialog. Used from the catalog cards, where there is no
 * room to choose inline.
 *
 * @param {{
 *   product: LocationProduct,
 *   onAdd: (selection: { variantId: string, measure: string|null, quantity: number }) => void,
 *   initial?: Record<string, any>,
 * }} options
 */
export function openVariantPicker(options) {
  const form = variantForm(options.product, { initial: options.initial });

  const submit = el('button', {
    type: 'button',
    class: 'btn btn-primary',
    text: 'Add to quote',
    onClick() {
      const selection = form.read();
      const result = validateSelection(options.product, selection);
      if (!result.ok) {
        form.showErrors(result.errors);
        return;
      }
      form.showErrors([]);
      modal.close();
      options.onAdd(selection);
    },
  });

  const modal = openModal({
    title: options.product.name,
    description: 'Choose the options you need, then add this product to your quote list.',
    content: form.element,
    footer: [submit],
    variant: 'sheet',
  });

  return modal;
}
