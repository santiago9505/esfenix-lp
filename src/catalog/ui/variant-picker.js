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

import { capitalize } from '../core/format.js';
import { el, firstUsableImage, productMedia, replaceChildren } from './dom.js';
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

const VARIETY_SEARCH_THRESHOLD = 12;

/**
 * Quantity belongs to one configured quote line. Keep it while refining the
 * same variety, but start a different variety from one so quantities from two
 * selections cannot be carried into each other.
 *
 * @param {string|null|undefined} currentVariety
 * @param {string|null|undefined} nextVariety
 * @param {number} quantity
 */
export function quantityAfterVarietyChange(currentVariety, nextVariety, quantity) {
  const changesExistingVariety = currentVariety !== null
    && currentVariety !== undefined
    && nextVariety !== currentVariety;
  return changesExistingVariety ? 1 : quantity;
}

/**
 * Rose families use colour to describe a variety, not as a second decision.
 * When every named variety maps to at most one colour, colour can safely act
 * as a browsing filter while selecting the variety still pins the real value.
 *
 * @param {ProductVariant[]} variants
 */
export function usesColorAsVarietyFilter(variants) {
  const colors = optionsFor(variants, 'color');
  if (colors.length < 2) return false;

  const colorsByVariety = new Map();
  for (const variant of variants) {
    if (!variant.variety) continue;
    if (!colorsByVariety.has(variant.variety)) colorsByVariety.set(variant.variety, new Set());
    if (variant.color) colorsByVariety.get(variant.variety).add(variant.color);
  }

  return colorsByVariety.size > 0
    && [...colorsByVariety.values()].every((varietyColors) => varietyColors.size <= 1);
}

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
 *   splitVariety?: boolean,
 *   onValidityChange?: (valid: boolean) => void,
 *   onSelectionChange?: (state: {
 *     variant: ProductVariant|null,
 *     variety: string|null,
 *     color: string|null,
 *     lengthCm: number|null,
 *     measure: string|null,
 *     quantity: number,
 *   }) => void,
 * }} [options]
 */
export function variantForm(product, options = {}) {
  const colorFiltersVariety = usesColorAsVarietyFilter(product.variants);
  const dimensions = presentDimensions(product.variants).filter(
    (dimension) => !(colorFiltersVariety && dimension.key === 'color'),
  );

  /** @type {Record<string, any>} */
  const choice = {
    variety: options.initial?.variety ?? null,
    color: options.initial?.color ?? null,
    lengthCm: options.initial?.lengthCm ?? null,
    measure: options.initial?.measure ?? null,
    quantity: options.initial?.quantity ?? 1,
  };
  const browseFilters = { variety: '', color: null };
  let selectedVariantId = null;

  const hasVariety = dimensions.some((dimension) => dimension.key === 'variety');
  const varietyContainer = el('div', { class: 'cat-variant-section cat-variant-section-variety' });
  const configurationContainer = el('div', { class: 'cat-variant-section cat-variant-section-configuration' });
  const container = el('div', { class: 'cat-variant-form' }, [
    !options.splitVariety && hasVariety ? varietyContainer : null,
    configurationContainer,
  ]);
  const errorList = el('ul', { class: 'cat-field-errors', role: 'alert', hidden: true });

  const formSections = [varietyContainer, configurationContainer];
  const queryForm = (selector) => formSections
    .map((section) => section.querySelector(selector))
    .find(Boolean) ?? null;
  const queryFormAll = (selector) => formSections.flatMap((section) => [...section.querySelectorAll(selector)]);

  /** @returns {ProductVariant|null} */
  function currentVariant() {
    const matches = narrow(product.variants, choice);

    // A gallery image can identify an exact Fresa task even when several
    // variants share the same variety, colour and photograph. Keep that id
    // until the visitor changes a form dimension instead of falling back to
    // the first matching variant.
    if (selectedVariantId) {
      return matches.find((variant) => variant.id === selectedVariantId) ?? null;
    }

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

  function syncColorFromVariety() {
    if (!colorFiltersVariety) return;
    if (!choice.variety) {
      choice.color = null;
      return;
    }

    const colors = optionsFor(
      product.variants.filter((variant) => variant.variety === choice.variety),
      'color',
    );
    choice.color = colors.length === 1 ? colors[0] : null;
  }

  function notifySelection() {
    const variant = currentVariant();
    options.onValidityChange?.(variant !== null);
    options.onSelectionChange?.({
      variant,
      variety: choice.variety ?? null,
      color: choice.color ?? null,
      lengthCm: choice.lengthCm ?? null,
      measure: choice.measure ?? null,
      quantity: choice.quantity,
    });
  }

  function captureViewState() {
    const active = document.activeElement;
    const activeControl = active instanceof HTMLElement && formSections.some((section) => section.contains(active))
      ? {
          control: active.dataset.variantControl ?? null,
          value: active.dataset.variantValue ?? null,
        }
      : null;

    return {
      pageX: window.scrollX,
      pageY: window.scrollY,
      varietyScrollTop: queryForm('.cat-variety-grid')?.scrollTop ?? 0,
      colorScrollLeft: queryForm('.cat-variety-color-options')?.scrollLeft ?? 0,
      activeControl,
    };
  }

  function restoreViewState(state) {
    if (!state) return;

    const restore = () => {
      const varietyList = queryForm('.cat-variety-grid');
      if (varietyList) varietyList.scrollTop = state.varietyScrollTop;
      const colorList = queryForm('.cat-variety-color-options');
      if (colorList) colorList.scrollLeft = state.colorScrollLeft;

      if (state.activeControl?.control) {
        const target = queryFormAll('[data-variant-control]').find((candidate) =>
          candidate.dataset.variantControl === state.activeControl.control
          && (state.activeControl.value === null || candidate.dataset.variantValue === state.activeControl.value),
        );
        target?.focus?.({ preventScroll: true });
      }

      window.scrollTo(state.pageX, state.pageY);
    };

    restore();
    window.requestAnimationFrame?.(restore);
  }

  function render({ preservePosition = false } = {}) {
    const viewState = preservePosition ? captureViewState() : null;
    const varietyRows = [];
    const configurationRows = [];
    let step = 1;

    for (const [dimensionIndex, dimension] of dimensions.entries()) {
      const prerequisite = dimensions[dimensionIndex - 1];
      const canChoose = dimensions
        .slice(0, dimensionIndex)
        .every((previous) => choice[previous.key] !== null && choice[previous.key] !== undefined);

      if (!canChoose) {
        const row = selectRow({
          label: dimension.label,
          step: step++,
          value: null,
          options: [],
          disabled: true,
          placeholder: `Choose ${prerequisite?.label.toLowerCase() ?? 'the previous option'} first`,
          control: dimension.key,
          onChange() {},
        });
        (dimension.key === 'variety' ? varietyRows : configurationRows).push(row);
        continue;
      }

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
      if (dimension.key === 'variety') syncColorFromVariety();

      const optionConfig = {
        label: dimension.label,
        step: step++,
        value: choice[dimension.key],
        options: values.map((value) => ({
          value,
          label: dimension.key === 'lengthCm' ? `${value} cm` : String(value),
          color: dimension.key === 'variety'
            ? optionsFor(product.variants.filter((variant) => variant.variety === value), 'color')[0] ?? null
            : null,
          image: dimension.key === 'variety'
            ? firstUsableImage(
                product.variants
                  .filter((variant) => variant.variety === value)
                  .flatMap((variant) => variant.images ?? []),
              )
            : null,
        })),
        disabled: values.length === 1,
        control: dimension.key,
        onChange(value) {
          selectedVariantId = null;
          const nextValue = dimension.key === 'lengthCm' ? Number(value) : value;
          if (dimension.key === 'variety') {
            choice.quantity = quantityAfterVarietyChange(choice.variety, nextValue, choice.quantity);
          }
          choice[dimension.key] = nextValue;
          if (dimension.key === 'variety') syncColorFromVariety();
          // Keep later choices when the new value still supports them. The
          // render pass below clears only values that are no longer reachable.
          render({ preservePosition: true });
        },
      };

      const row = dimension.key === 'variety' && values.length > 1
          ? searchableVarietyRow({
              ...optionConfig,
              searchTerm: browseFilters.variety,
              colorFilter: browseFilters.color,
              colors: colorFiltersVariety ? optionsFor(product.variants, 'color') : [],
              onSearch(value) {
                browseFilters.variety = value;
              },
              onColorFilter(value) {
                browseFilters.color = value;
              },
            })
          : selectRow(optionConfig);
      (dimension.key === 'variety' ? varietyRows : configurationRows).push(row);
    }

    const variant = currentVariant();
    const allMeasureValues = [...new Set(product.variants.flatMap((candidate) => candidate.availableMeasures ?? []))];
    const measureValues = variant ? measures() : allMeasureValues;
    if (measureValues.length > 0) {
      if (variant && measureValues.length === 1) choice.measure = measureValues[0];
      else if (variant && choice.measure && !measureValues.includes(choice.measure)) choice.measure = null;
    }

    const finalSteps = [quantityRow(choice, notifySelection, step++, !variant)];
    if (measureValues.length > 0) {
      finalSteps.push(measureRow(choice, measureValues, notifySelection, step++, !variant));
    }
    configurationRows.push(el('div', { class: 'cat-variant-final-steps' }, finalSteps));
    configurationRows.push(errorList);

    replaceChildren(varietyContainer, varietyRows);
    replaceChildren(configurationContainer, configurationRows);
    notifySelection();
    restoreViewState(viewState);
  }

  render();

  return {
    element: container,
    varietyElement: varietyContainer,
    hasVariety,

    /** @returns {{ variantId: string|null, measure: string|null, quantity: number }} */
    read() {
      const variant = currentVariant();
      return {
        variantId: variant?.id ?? null,
        measure: choice.measure ?? null,
        quantity: choice.quantity,
      };
    },

    /** Selects a variety from an external visual control such as the gallery. */
    selectVariety(variety) {
      if (!dimensions.some((dimension) => dimension.key === 'variety')) return;

      const available = optionsFor(product.variants, 'variety');
      if (variety !== null && variety !== undefined && !available.includes(variety)) return;

      selectedVariantId = null;
      choice.quantity = quantityAfterVarietyChange(choice.variety, variety, choice.quantity);
      choice.variety = variety ?? null;
      syncColorFromVariety();
      // Preserve compatible color, length and measure choices. Quantity is
      // intentionally reset above when this starts a different quote line.
      render({ preservePosition: true });
    },

    /** Selects the exact variant represented by an external visual control. */
    selectVariant(variant) {
      const exact = product.variants.find((candidate) => candidate.id === variant?.id);
      if (!exact) return;

      selectedVariantId = exact.id;
      choice.quantity = quantityAfterVarietyChange(choice.variety, exact.variety, choice.quantity);
      for (const dimension of DIMENSIONS) {
        choice[dimension.key] = exact[dimension.key] ?? null;
      }
      render({ preservePosition: true });
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
 *   placeholder?: string,
 *   control?: string,
 *   onChange: (value: any) => void,
 * }} config
 */
function selectRow(config) {
  const id = `cat-variant-${++rowId}`;
  return el('div', { class: 'cat-field' }, [
    stepLabel(config.step, config.label, id),
    el('div', { class: 'cat-select-wrap' }, [
      el(
        'select',
        {
          id,
          class: 'cat-select',
          dataset: { variantControl: config.control ?? '' },
          disabled: config.disabled === true,
          onChange: (event) => config.onChange(event.currentTarget.value),
        },
        [
          config.value === null || config.value === undefined
            ? el('option', {
                value: '',
                selected: true,
                text: config.placeholder ?? `Select ${config.label.toLowerCase()}`,
              })
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
 * A long variety list is a decision aid, not a giant native select. Search
 * keeps EC Roses and Garden Roses scannable while the selected option remains
 * visible and the rest of the product form keeps its compact rhythm.
 *
 * @param {{
 *   label: string,
 *   step: number,
 *   value: any,
 *   options: Array<{ value: any, label: string, color?: string|null, image?: any }>,
 *   searchTerm: string,
 *   colorFilter: string|null,
 *   colors: string[],
 *   onSearch: (value: string) => void,
 *   onColorFilter: (value: string|null) => void,
 *   onChange: (value: any) => void,
 * }} config
 */
function searchableVarietyRow(config) {
  const id = `cat-variant-search-${++rowId}`;
  const listId = `${id}-list`;
  const list = el('div', {
    class: 'cat-option-list cat-variety-grid',
    id: listId,
    role: 'listbox',
    'aria-label': config.label,
  });
  const empty = el('p', { class: 'cat-option-empty', hidden: true, text: 'No varieties match that search.' });
  const count = el('span', { class: 'cat-option-count' });
  let activeColor = config.colorFilter;

  const renderOptions = (term = config.searchTerm) => {
    const normalized = term.trim().toLocaleLowerCase();
    const visible = config.options.filter((option) => {
      const matchesSearch = String(option.label).toLocaleLowerCase().includes(normalized);
      const matchesColor = !activeColor || option.color === activeColor;
      return matchesSearch && matchesColor;
    });

    replaceChildren(
      list,
      visible.map((option) => {
        const selected = String(option.value) === String(config.value);
        return el('button', {
          type: 'button',
          class: `cat-variety-option ${selected ? 'is-selected' : ''}`,
          role: 'option',
          'aria-selected': String(selected),
          title: option.image
            ? (option.color ? `${option.label} — ${option.color}` : option.label)
            : `${option.label}${option.color ? ` — ${option.color}` : ''}; photo pending`,
          dataset: { variantControl: 'variety', variantValue: String(option.value) },
          onClick() {
            config.onChange(option.value);
          },
        }, [
          option.image
            ? productMedia(option.image, {
                label: option.label,
                className: 'cat-variety-option-media',
                width: 160,
                height: 160,
              })
            : el('span', {
                class: `cat-variety-option-media cat-variety-option-placeholder ${colorClass(option.color)}`,
                'aria-hidden': 'true',
              }),
          el('span', { class: 'cat-variety-option-copy' }, [
            el('strong', { text: option.label }),
            option.color || !option.image
              ? el('small', {
                  text: option.image
                    ? option.color
                    : [option.color, 'Photo pending'].filter(Boolean).join(' · '),
                })
              : null,
          ]),
          el('span', { class: 'cat-variety-option-check', 'aria-hidden': 'true', text: '✓' }),
        ]);
      }),
    );
    empty.hidden = visible.length > 0;
    count.textContent = `${visible.length} of ${config.options.length}`;
  };

  const search = config.options.length > VARIETY_SEARCH_THRESHOLD
    ? el('input', {
        id,
        type: 'search',
        class: 'cat-variant-search',
        dataset: { variantControl: 'variety-search' },
        value: config.searchTerm,
        placeholder: 'Search by variety',
        autocomplete: 'off',
        'aria-controls': listId,
        onInput(event) {
          const value = event.currentTarget.value;
          config.onSearch(value);
          renderOptions(value);
        },
      })
    : null;

  const colorOptions = el('div', { class: 'cat-variety-color-options' }, [
    colorFilterButton(null, 'All', !activeColor),
    ...config.colors.map((color) => colorFilterButton(color, color, activeColor === color)),
  ]);
  const scrollColors = (direction) => () => {
    colorOptions.scrollBy({
      left: direction * Math.max(160, colorOptions.clientWidth * 0.75),
      behavior: 'smooth',
    });
  };

  const colorFilter = config.colors.length > 1
    ? el('div', { class: 'cat-variety-color-filter', role: 'group', 'aria-label': 'Filter varieties by color' }, [
        el('span', { class: 'cat-variety-filter-label', text: 'Filter by color' }),
        el('div', { class: 'cat-variety-color-carousel' }, [
          el('button', {
            type: 'button',
            class: 'cat-color-carousel-button',
            'aria-label': 'Previous colors',
            text: '‹',
            onClick: scrollColors(-1),
          }),
          colorOptions,
          el('button', {
            type: 'button',
            class: 'cat-color-carousel-button',
            'aria-label': 'Next colors',
            text: '›',
            onClick: scrollColors(1),
          }),
        ]),
      ])
    : null;

  function colorFilterButton(value, label, selected) {
    return el('button', {
      type: 'button',
      class: `cat-color-filter ${selected ? 'is-selected' : ''}`,
      'aria-pressed': String(selected),
      title: value ? `Show ${label} varieties` : 'Show all varieties',
      onClick(event) {
        activeColor = value;
        config.onColorFilter(value);
        for (const button of event.currentTarget.parentElement.querySelectorAll('.cat-color-filter')) {
          const isSelected = button === event.currentTarget;
          button.classList.toggle('is-selected', isSelected);
          button.setAttribute('aria-pressed', String(isSelected));
        }
        renderOptions(search?.value ?? config.searchTerm);
      },
    }, [
      value ? el('span', { class: `cat-color-dot ${colorClass(value)}`, 'aria-hidden': 'true' }) : null,
      el('span', { text: label }),
    ]);
  }

  renderOptions();
  return el('div', { class: 'cat-field cat-variety-field' }, [
    el('div', { class: 'cat-option-label-row' }, [
      stepLabel(config.step, config.label, search ? id : null),
      count,
    ]),
    colorFilter,
    search
      ? el('div', { class: 'cat-variant-search-wrap' }, [
          el('span', { class: 'cat-variant-search-icon', 'aria-hidden': 'true', text: '⌕' }),
          search,
        ])
      : null,
    list,
    empty,
  ]);
}

function stepLabel(step, label, forId = null) {
  return el(forId ? 'label' : 'div', { class: 'cat-step-label', for: forId }, [
    el('span', { class: 'cat-step-number', text: String(step), 'aria-hidden': 'true' }),
    el('span', { text: label }),
  ]);
}

function colorClass(color) {
  const value = String(color ?? '')
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-');
  return value ? `is-${value}` : 'is-neutral';
}

/**
 * @param {Record<string, any>} choice
 * @param {() => void} onChange
 * @param {number} stepNumber
 * @param {boolean} disabled
 */
function quantityRow(choice, onChange, stepNumber, disabled = false) {
  const id = `cat-variant-qty-${++rowId}`;
  let decreaseButton;
  const input = el('input', {
    id,
    type: 'number',
    min: '1',
    step: '1',
    inputmode: 'numeric',
    class: 'cat-qty-input',
    dataset: { variantControl: 'quantity' },
    value: String(choice.quantity),
    disabled,
    'aria-label': 'Quantity',
    onInput(event) {
      const parsed = Number.parseInt(event.currentTarget.value, 10);
      choice.quantity = Number.isFinite(parsed) ? parsed : Number.NaN;
      onChange();
    },
  });

  const step = (delta) => () => {
    const next = Math.max(1, (Number.isFinite(choice.quantity) ? choice.quantity : 1) + delta);
    choice.quantity = next;
    input.value = String(next);
    decreaseButton.disabled = disabled || next <= 1;
    onChange();
  };

  decreaseButton = el('button', {
    type: 'button',
    class: 'cat-qty-btn',
    dataset: { variantControl: 'quantity-decrease' },
    'aria-label': 'Decrease quantity',
    disabled: disabled || choice.quantity <= 1,
    text: '−',
    onClick: step(-1),
  });

  return el('div', { class: 'cat-field cat-field-qty cat-variant-quantity-row' }, [
    stepLabel(stepNumber, 'Quantity', id),
    el('div', { class: 'cat-qty cat-qty-product', role: 'group', 'aria-label': 'Quantity controls' }, [
      decreaseButton,
      input,
      el('button', {
        type: 'button',
        class: 'cat-qty-btn',
        dataset: { variantControl: 'quantity-increase' },
        'aria-label': 'Increase quantity',
        disabled,
        text: '+',
        onClick: step(1),
      }),
    ]),
  ]);
}

/**
 * Keeps the measure close to quantity without giving it the visual weight of
 * another full-width product option.
 *
 * @param {Record<string, any>} choice
 * @param {string[]} measureValues
 * @param {() => void} onChange
 */
function measureRow(choice, measureValues, onChange, stepNumber, disabled = false) {
  const id = `cat-variant-measure-${++rowId}`;
  const label = MEASURE_LABELS[choice.measure] ?? capitalize(choice.measure ?? '');
  return el('div', { class: 'cat-field cat-variant-measure-control' }, [
    stepLabel(stepNumber, 'Unit', id),
    measureValues.length === 1
      ? el('span', {
          class: `cat-variant-measure-value ${disabled ? 'is-disabled' : ''}`,
          text: disabled ? 'Choose stem length first' : label,
          id,
        })
      : el('div', { class: 'cat-variant-measure-select-wrap' }, [
          el('select', {
            id,
            class: 'cat-variant-measure-select',
            dataset: { variantControl: 'measure' },
            value: choice.measure ?? '',
            disabled,
            'aria-label': 'Unit',
            onChange: (event) => {
              choice.measure = event.currentTarget.value || null;
              onChange();
            },
          }, [
            el('option', {
              value: '',
              selected: !choice.measure,
              text: disabled ? 'Choose stem length first' : 'Select unit',
            }),
            ...measureValues.map((measure) => el('option', {
              value: measure,
              selected: measure === choice.measure,
              text: MEASURE_LABELS[measure] ?? capitalize(measure),
            })),
          ]),
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
