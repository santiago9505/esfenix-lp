/**
 * Internal multi-step quote form.
 *
 * This is intentionally a screen, not a modal. The catalog selection remains
 * the source of truth for products while the form keeps contact data only in
 * memory until the quote adapter receives the final payload.
 *
 * One step is visible at a time, centered, with nothing around it but the way
 * back to the catalog and the progress dots: the visitor should only ever have
 * one thing to answer. The portrait above the step comes from the selected
 * location (see data/advisors.js).
 */

import { findActiveClient } from '../core/fresa-clients.js';
import { buildQuotePayload } from '../core/quote-payload.js';
import { describeQuoteItem } from '../core/format.js';
import { maskPhoneForDisplay, maskTextForDisplay } from '../core/privacy.js';
import { getCategoryLabel } from '../data/categories.js';
import { resolveAdvisor } from '../data/advisors.js';
import { resolveLocation } from '../data/locations.js';
import { el, firstUsableImage, productMedia, replaceChildren } from './dom.js';
import { locationSelect } from './location-select.js';
import { NO_PAYMENT_NOTE } from './states.js';

const STEPS = [
  'Email',
  'Contact information',
  'Select your products',
  'Type of order',
  'Delivery information',
  'Other details',
];

// The client directory may need more than one request when Fresa paginates
// the active-client list, and a failed page is retried once. Keep the lookup
// bounded, but do not classify a known email as a new contact while the list
// is still being read.
const CLIENT_LOOKUP_TIMEOUT_MS = 12_000;

/**
 * @param {ReturnType<typeof import('../app.js').createApp>['ctx']} ctx
 * @param {{
 *   onBack: () => void,
 *   onSubmit: (payload: ReturnType<typeof buildQuotePayload>, options: { targetWindow: Window|null }) => Promise<any>,
 * }} options
 */
export function renderQuoteFormView(ctx, options) {
  const existingDestination = ctx.locationStore.getShippingDestination() ?? {};
  const state = {
    step: 0,
    email: '',
    recognized: false,
    contact: { firstName: '', lastName: '', phone: '', company: '' },
    orderType: 'Delivery',
    delivery: {
      dateTime: '',
      address: '',
      city: existingDestination.city ?? '',
      state: existingDestination.state ?? '',
      zipCode: existingDestination.zipCode ?? '',
    },
    notes: '',
    lookupPending: false,
    clientLookup: 'idle',
    submitPending: false,
    error: '',
    result: null,
  };

  const screen = el('section', { class: 'cat-quote-screen', 'aria-labelledby': 'cat-quote-title' });
  const formHost = el('div', { class: 'cat-quote-form-host' });
  const topBack = el('button', {
    type: 'button',
    class: 'cat-quote-back',
    onClick: handleTopBack,
  });
  const railSteps = STEPS.map(railStep);
  const rail = el('nav', { class: 'cat-quote-rail', 'aria-label': 'Quote progress' }, [
    el('ol', { class: 'cat-quote-rail-list' }, railSteps.map((entry) => entry.item)),
  ]);
  const layout = el('div', { class: 'cat-quote-layout' }, [rail, formHost]);
  let renderedStep = state.step;

  replaceChildren(screen, [
    el('div', { class: 'cat-quote-topbar' }, [
      topBack,
    ]),
    layout,
    el('p', { class: 'cat-quote-screen-note', text: NO_PAYMENT_NOTE }),
  ]);

  render(true);
  return { head: null, body: [screen] };

  function render(shouldFocus = false) {
    // Only a real step change animates. Re-rendering after, say, a quantity
    // edit must not slide the whole step back in under the visitor's cursor.
    const moved = state.step !== renderedStep;
    const direction = moved ? (state.step < renderedStep ? 'backward' : 'forward') : null;
    const isCatalogExit = state.result || state.step === 0;
    topBack.textContent = isCatalogExit ? '← Back to catalog' : '← Back';
    topBack.setAttribute('aria-label', isCatalogExit ? 'Back to catalog' : 'Back to previous question');

    screen.classList.toggle('is-wide', !state.result && state.step === 2);
    layout.classList.toggle('is-done', Boolean(state.result));
    updateRail();

    replaceChildren(formHost, [state.result ? successStep() : currentStep(direction)]);
    renderedStep = state.step;
    if (shouldFocus) {
      window.setTimeout(() => formHost.querySelector('input, select, textarea, button')?.focus(), 0);
    }
  }

  function handleTopBack() {
    if (state.result || state.step === 0) {
      options.onBack();
      return;
    }
    state.step -= 1;
    state.error = '';
    render(true);
  }

  /**
   * A rail entry is built once and only has its state updated afterwards, so
   * moving between steps transitions the mark and the connector instead of
   * replacing them mid-animation.
   */
  function railStep(label, index) {
    const mark = el('span', { class: 'cat-quote-rail-mark', 'aria-hidden': 'true', text: String(index + 1) });
    const button = el('button', {
      type: 'button',
      class: 'cat-quote-rail-button',
      onClick: () => {
        if (index >= state.step) return;
        state.step = index;
        state.error = '';
        render(true);
      },
    }, [mark, el('span', { class: 'cat-quote-rail-label', text: label })]);

    return { item: el('li', { class: 'cat-quote-rail-item' }, [button]), button, mark };
  }

  function updateRail() {
    railSteps.forEach((entry, index) => {
      const status = index === state.step ? 'current' : index < state.step ? 'complete' : 'upcoming';
      entry.item.dataset.state = status;
      entry.mark.textContent = status === 'complete' ? '✓' : String(index + 1);
      // Only already-answered steps are reachable; the current one is where
      // the visitor already is.
      entry.button.disabled = index >= state.step || state.submitPending;
      if (status === 'current') entry.button.setAttribute('aria-current', 'step');
      else entry.button.removeAttribute('aria-current');
    });
  }

  function currentStep(direction) {
    const config = [
      ['What’s the best email for you?', ''],
      ['Tell us a little about you', state.recognized ? 'We found your Esfenix profile and filled in your contact details.' : 'These details help our team get your quote right.'],
      ['Select your products', 'Review the products you selected and tell us where the request should be handled.'],
      ['How would you like to receive it?', 'Choose delivery or pickup so we can plan the next step.'],
      ['Where should we deliver?', 'Choose a preferred date and give us the information our team needs.'],
      ['Anything else we should know?', 'Add the details that will help us prepare the best quote.'],
    ][state.step];

    return el('div', { class: `cat-quote-step ${state.step === 2 ? 'is-wide' : ''} ${direction ? `is-entering is-${direction}` : ''}` }, [
      advisorPortrait(state.step === 0),
      el('div', { class: 'cat-quote-step-heading' }, [
        el('h2', { id: 'cat-quote-title', text: config[0] }),
        config[1] ? el('p', { class: 'cat-quote-step-description', text: config[1] }) : null,
      ]),
      state.error ? el('p', { class: 'cat-quote-form-error', role: 'alert', text: state.error }) : null,
      stepBody(),
    ]);
  }

  /**
   * The location's face. Shown large on the first step — where the visitor is
   * being asked for something before anything has been given back — and small
   * afterwards so the flow keeps the same host without repeating itself.
   *
   * @param {boolean} large
   */
  function advisorPortrait(large) {
    const advisor = resolveAdvisor(ctx.locationId);
    return el('div', { class: `cat-quote-advisor ${large ? 'is-large' : ''}` }, [
      el('img', {
        class: 'cat-quote-advisor-photo',
        src: advisor.src,
        alt: advisor.alt,
        width: large ? 96 : 56,
        height: large ? 96 : 56,
        decoding: 'async',
      }),
      large ? el('p', { class: 'cat-quote-advisor-caption', text: `Your ${advisor.locationLabel} team` }) : null,
    ]);
  }

  function stepBody() {
    switch (state.step) {
      case 0:
        return emailStep();
      case 1:
        return contactStep();
      case 2:
        return productsStep();
      case 3:
        return orderTypeStep();
      case 4:
        return deliveryStep();
      default:
        return detailsStep();
    }
  }

  function emailStep() {
    const button = el('button', {
      type: 'submit',
      class: 'btn btn-primary cat-quote-submit',
      disabled: state.lookupPending,
      text: state.lookupPending ? 'Looking for you…' : 'Let’s do this',
    });

    return el('form', {
      class: 'cat-quote-step-form',
      onSubmit: async (event) => {
        event.preventDefault();
        const input = event.currentTarget.querySelector('input[name="email"]');
        if (!event.currentTarget.checkValidity()) {
          event.currentTarget.reportValidity();
          return;
        }
        state.email = input.value.trim();
        state.lookupPending = true;
        state.clientLookup = 'checking';
        // A visitor can go back and submit a different email. Clear the
        // previous profile before looking up the new one so contact and
        // shipping data from two people can never be mixed.
        clearProfileData();
        button.disabled = true;
        button.textContent = 'Looking for you…';

        let profile = null;
        let lookupFailed = false;
        try {
          profile = await withTimeout(findActiveClient(state.email), CLIENT_LOOKUP_TIMEOUT_MS);
        } catch {
          lookupFailed = true;
          profile = null;
        }

        state.lookupPending = false;
        state.clientLookup = lookupFailed ? 'unavailable' : profile ? 'found' : 'not-found';
        // `findActiveClient` only returns a profile after the normalized email
        // matched an active Fresa record. The email match is the source of
        // truth; contact fields may be absent in an otherwise valid record.
        state.recognized = Boolean(profile);
        if (profile) {
          state.contact = profile;
          state.delivery = {
            ...state.delivery,
            address: profile.shipping?.address || '',
            city: profile.shipping?.city || existingDestination.city || '',
            state: profile.shipping?.state || existingDestination.state || '',
            zipCode: profile.shipping?.zipCode || '',
          };
        }
        state.step = 1;
        state.error = '';
        render(true);
      },
    }, [
      field({
        label: 'Email address',
        name: 'email',
        type: 'email',
        value: state.email,
        placeholder: 'you@example.com',
        autocomplete: 'email',
        required: true,
      }),
      el('div', { class: 'cat-quote-form-actions' }, [
        button,
      ]),
    ]);
  }

  function contactStep() {
    const welcomeName = [state.contact.firstName, state.contact.lastName]
      .filter(Boolean)
      .map(maskTextForDisplay)
      .join(' ');
    const fields = [
      state.recognized
        ? el('div', { class: 'cat-quote-recognized' }, [
            el('span', { class: 'cat-quote-recognized-icon', text: '✓' }),
            el('div', {}, [
              el('strong', { text: welcomeName ? `Welcome back, ${welcomeName}!` : 'Welcome back!' }),
              el('p', { text: 'We found your active client profile and filled in your contact details.' }),
            ]),
          ])
        : el('div', { class: 'cat-quote-recognized cat-quote-not-recognized' }, [
            el('span', { class: 'cat-quote-recognized-icon', text: 'i' }),
            el('div', {}, [
              el('strong', { text: state.clientLookup === 'unavailable' ? 'We could not verify this email yet' : 'We could not find this email in active clients' }),
              el('p', { text: state.clientLookup === 'unavailable' ? 'Please enter your contact details below and continue with your quote.' : 'Please enter your contact details below to request a quote.' }),
            ]),
          ]),
      field({
        label: 'Email address',
        name: 'email',
        type: 'email',
        value: state.email,
        autocomplete: 'email',
        readonly: true,
      }),
      state.recognized
        ? el('p', { class: 'cat-quote-email-confirmed', text: 'Some profile details are masked for your privacy.' })
        : null,
      el('div', { class: 'cat-quote-field-grid' }, [
        contactField('First name', 'firstName', 'given-name', true),
        contactField('Last name', 'lastName', 'family-name', true),
      ]),
      el('div', { class: 'cat-quote-field-grid' }, [
        contactField('Phone number', 'phone', 'tel', true, 'tel'),
        contactField('Company', 'company', 'organization', false, 'text', 'Optional'),
      ]),
    ].filter(Boolean);

    return el('form', {
      class: 'cat-quote-step-form',
      onSubmit: (event) => {
        event.preventDefault();
        if (!event.currentTarget.checkValidity()) {
          event.currentTarget.reportValidity();
          return;
        }
        readContact(event.currentTarget);
        state.step = 2;
        state.error = '';
        render(true);
      },
    }, [
      ...fields,
      stepActions('Continue to products'),
    ]);
  }

  function clearProfileData() {
    state.recognized = false;
    state.contact = { firstName: '', lastName: '', phone: '', company: '' };
    state.delivery = {
      ...state.delivery,
      address: '',
      city: existingDestination.city ?? '',
      state: existingDestination.state ?? '',
      zipCode: '',
    };
  }

  function contactField(label, name, autocomplete, required, type = 'text', help) {
    const value = state.contact[name] ?? '';
    const masksText = ['firstName', 'lastName', 'company'].includes(name);
    const displayValue = state.recognized && value
      ? name === 'phone'
        ? maskPhoneForDisplay(value)
        : masksText
          ? maskTextForDisplay(value)
          : value
      : value;
    return field({
      label,
      name,
      type,
      value: displayValue,
      autocomplete: state.recognized && value ? 'off' : autocomplete,
      required,
      help,
      // Known values are displayed as a confirmation of what Fresa returned.
      // Empty values remain editable so an incomplete Fresa record does not
      // prevent the visitor from finishing the quote.
      readonly: state.recognized && Boolean(value),
    });
  }

  function productsStep() {
    const items = ctx.quoteStore.getItems();
    const productRows = items.length > 0
      ? el('ul', { class: 'cat-quote-product-list' }, items.map(productRow))
      : el('div', { class: 'cat-quote-empty-products' }, [
          el('span', { class: 'cat-quote-empty-products-icon', text: '＋' }),
          el('strong', { text: 'No products selected yet' }),
          el('p', { text: 'You can still request a quote and describe what you need in the last step.' }),
        ]);

    return el('form', {
      class: 'cat-quote-step-form',
      onSubmit: (event) => {
        event.preventDefault();
        state.step = 3;
        state.error = '';
        render(true);
      },
    }, [
      el('div', { class: 'cat-quote-form-section' }, [
        locationSelect({
          locationId: ctx.locationId,
          label: 'Location',
          describeServiceCenter: true,
          onRequestChange: (next) => ctx.requestLocationChange(next, { onCancel: () => render() }),
        }),
      ]),
      el('div', { class: 'cat-quote-form-section' }, [
        el('div', { class: 'cat-quote-section-label' }, [
          el('span', { text: 'Products' }),
          el('span', { class: 'cat-quote-section-count', text: `${items.length} selected` }),
        ]),
        productRows,
        el('button', { type: 'button', class: 'cat-linkbtn cat-quote-add-products', text: '+ Add or edit products in catalog', onClick: options.onBack }),
      ]),
      stepActions('Continue to order type'),
    ]);
  }

  function productRow(item) {
    const product = ctx.products.find((entry) => entry.id === item.productId);
    const selectedVariant = product?.variants?.find((variant) =>
      (variant.variety ?? null) === item.variety &&
      (variant.color ?? null) === item.color &&
      (variant.lengthCm ?? null) === item.lengthCm,
    );
    const image = firstUsableImage(selectedVariant?.images) ?? firstUsableImage(product?.images);
    const quantity = el('input', {
      type: 'number',
      min: '1',
      step: '1',
      class: 'cat-quote-product-quantity',
      value: String(item.quantity),
      'aria-label': `Quantity for ${item.productName}`,
      onChange: (event) => {
        const value = Number.parseInt(event.currentTarget.value, 10);
        if (Number.isInteger(value) && value > 0) ctx.quoteStore.setQuantity(item.id, value);
        else event.currentTarget.value = String(item.quantity);
        render();
      },
    });

    return el('li', { class: 'cat-quote-product-row' }, [
      productMedia(image, { label: item.productName, className: 'cat-quote-product-thumb', width: 96, height: 96 }),
      el('div', { class: 'cat-quote-product-copy' }, [
        el('span', { class: 'cat-quote-item-cat', text: getCategoryLabel(item.category) }),
        el('strong', { text: item.productName }),
        el('p', { class: 'cat-quote-product-detail', text: describeQuoteItem(item) || 'Standard selection' }),
      ]),
      el('div', { class: 'cat-quote-product-controls' }, [
        quantity,
        el('button', { type: 'button', class: 'cat-linkbtn cat-linkbtn-danger', text: 'Remove', onClick: () => { ctx.quoteStore.removeItem(item.id); render(); } }),
      ]),
    ]);
  }

  function orderTypeStep() {
    return el('form', {
      class: 'cat-quote-step-form',
      onSubmit: (event) => {
        event.preventDefault();
        // The choice is radio buttons, which already write to state.orderType
        // as they change; there is nothing left to read here.
        state.step = 4;
        state.error = '';
        render(true);
      },
    }, [
      el('div', { class: 'cat-quote-choice-list' }, [
        choice('Delivery', 'We’ll deliver to the address you provide.'),
        choice('Pickup', 'You’ll collect the flowers from our team.'),
      ]),
      stepActions('Continue to delivery information'),
    ]);
  }

  function choice(value, description) {
    const id = `cat-order-${value.toLowerCase()}`;
    return el('label', { class: `cat-quote-choice ${state.orderType === value ? 'is-selected' : ''}` }, [
      el('input', {
        type: 'radio',
        name: 'orderType',
        value,
        checked: state.orderType === value,
        onChange: () => {
          state.orderType = value;
          render();
        },
        id,
      }),
      el('span', { class: 'cat-quote-choice-mark' }),
      el('span', {}, [el('strong', { text: value }), el('small', { text: description })]),
    ]);
  }

  function deliveryStep() {
    const deliveryRequired = state.orderType === 'Delivery';
    const hasSavedShipping = state.recognized && [
      state.delivery.address,
      state.delivery.city,
      state.delivery.state,
      state.delivery.zipCode,
    ].some(Boolean);
    return el('form', {
      class: 'cat-quote-step-form',
      onSubmit: (event) => {
        event.preventDefault();
        if (!event.currentTarget.checkValidity()) {
          event.currentTarget.reportValidity();
          return;
        }
        readDelivery(event.currentTarget);
        state.step = 5;
        state.error = '';
        render(true);
      },
    }, [
      field({ label: 'Preferred date and time', name: 'dateTime', type: 'datetime-local', value: state.delivery.dateTime, required: true, help: 'We’ll confirm availability with you.' }),
      state.orderType === 'Delivery'
        ? el('div', { class: 'cat-quote-delivery-fields' }, [
            hasSavedShipping
              ? el('p', { class: 'cat-quote-email-confirmed', text: 'We filled in your saved delivery address. You can edit any missing details.' })
              : null,
            deliveryField('Address', 'address', 'street-address', deliveryRequired),
            el('div', { class: 'cat-quote-field-grid' }, [
              deliveryField('City', 'city', 'address-level2', deliveryRequired),
              deliveryField('State', 'state', 'address-level1', deliveryRequired),
            ]),
            deliveryField('ZIP code', 'zipCode', 'postal-code', deliveryRequired, 'text', 'numeric'),
          ])
        : el('div', { class: 'cat-quote-info-note' }, [
            el('strong', { text: 'Pickup selected' }),
            el('p', { text: 'We’ll confirm the pickup location and available time with you after reviewing your request.' }),
          ]),
      stepActions('Continue to other details'),
    ]);
  }

  function deliveryField(label, name, autocomplete, required, type = 'text', inputmode) {
    const value = state.delivery[name] ?? '';
    return field({
      label,
      name,
      type,
      value,
      autocomplete,
      inputmode,
      required,
      readonly: state.recognized && Boolean(value),
    });
  }

  function detailsStep() {
    const button = el('button', {
      type: 'submit',
      class: 'btn btn-primary cat-quote-submit',
      disabled: state.submitPending,
      text: state.submitPending ? 'Sending request…' : 'Request my quote',
    });

    return el('form', {
      class: 'cat-quote-step-form',
      onSubmit: async (event) => {
        event.preventDefault();
        state.notes = event.currentTarget.querySelector('textarea[name="notes"]').value.trim();
        const targetWindow = reserveQuoteWindow();
        state.submitPending = true;
        button.disabled = true;
        button.textContent = 'Sending request…';
        state.error = '';

        const payload = buildQuotePayload({
          locationId: ctx.locationId,
          items: ctx.quoteStore.getItems(),
          email: state.email,
          contact: state.contact,
          orderType: state.orderType,
          delivery: state.delivery,
          shippingDestination: ctx.locationStore.getShippingDestination(),
          notes: state.notes,
        });

        try {
          const result = await options.onSubmit(payload, { targetWindow });
          if (result?.ok) {
            state.result = result;
          } else {
            targetWindow?.close?.();
            state.error = result?.error || 'We could not send your quote request. Please try again.';
          }
        } catch {
          targetWindow?.close?.();
          state.error = 'We could not send your quote request. Please try again.';
        } finally {
          state.submitPending = false;
          render(true);
        }
      },
    }, [
      el('div', { class: 'cat-quote-notes-field' }, [
        el('label', { for: 'cat-quote-notes', text: 'Notes for the seller' }),
        el('textarea', { id: 'cat-quote-notes', name: 'notes', rows: '6', placeholder: 'Tell us anything important about your request…' }, state.notes),
      ]),
      reviewSummary(),
      el('div', { class: 'cat-quote-form-actions' }, [
        button,
      ]),
    ]);
  }

  function reviewSummary() {
    const items = ctx.quoteStore.getItems();
    return el('div', { class: 'cat-quote-review' }, [
      el('div', { class: 'cat-quote-section-label' }, [el('span', { text: 'Ready to send' }), el('span', { class: 'cat-quote-section-count', text: `${items.length} product${items.length === 1 ? '' : 's'}` })]),
      el('p', { text: `${state.email} · ${resolveLocation(ctx.locationId).label} · ${state.orderType}` }),
      el('p', { class: 'cat-note', text: 'Your request contains no payment or pricing information.' }),
    ]);
  }

  function successStep() {
    return el('div', { class: 'cat-quote-success' }, [
      el('div', { class: 'cat-quote-success-icon', text: '✓' }),
      el('p', { class: 'cat-quote-step-count', text: 'Request received' }),
      el('h2', { id: 'cat-quote-title', text: 'Your quote request is on its way.' }),
      el('p', { text: 'We opened the next step in a new tab. You can return to the catalog whenever you’re ready.' }),
    ]);
  }

  function stepActions(nextLabel) {
    return el('div', { class: 'cat-quote-form-actions' }, [
      el('button', { type: 'submit', class: 'btn btn-primary cat-quote-submit', text: nextLabel }),
    ]);
  }

  function field(config) {
    const id = `cat-quote-field-${config.name}`;
    return el('div', { class: 'cat-quote-field' }, [
      el('label', { for: id, text: config.label }),
      el('input', {
        id,
        name: config.name,
        type: config.type ?? 'text',
        value: config.value ?? '',
        placeholder: config.placeholder,
        autocomplete: config.autocomplete,
        inputmode: config.inputmode,
        required: config.required,
        readonly: config.readonly,
        onInput: (event) => {
          if (config.name === 'firstName') state.contact.firstName = event.currentTarget.value;
          if (config.name === 'lastName') state.contact.lastName = event.currentTarget.value;
          if (config.name === 'phone') state.contact.phone = event.currentTarget.value;
          if (config.name === 'company') state.contact.company = event.currentTarget.value;
          if (config.name === 'email') state.email = event.currentTarget.value;
          if (config.name === 'dateTime') state.delivery.dateTime = event.currentTarget.value;
          if (config.name === 'address') state.delivery.address = event.currentTarget.value;
          if (config.name === 'city') state.delivery.city = event.currentTarget.value;
          if (config.name === 'state') state.delivery.state = event.currentTarget.value;
          if (config.name === 'zipCode') state.delivery.zipCode = event.currentTarget.value;
        },
      }),
      config.help ? el('small', { text: config.help }) : null,
    ]);
  }

  function readContact(root) {
    const fields = ['firstName', 'lastName', 'phone', 'company'];
    fields.forEach((name) => {
      const input = root.querySelector(`[name="${name}"]`);
      // A recognized value may be masked in the input. Keep the original value
      // in state and only read fields that the visitor was allowed to edit.
      if (input && !input.readOnly) state.contact[name] = input.value.trim();
    });
  }

  function readDelivery(root) {
    state.delivery.dateTime = root.querySelector('[name="dateTime"]').value;
    state.delivery.address = root.querySelector('[name="address"]')?.value.trim() ?? '';
    state.delivery.city = root.querySelector('[name="city"]')?.value.trim() ?? '';
    state.delivery.state = root.querySelector('[name="state"]')?.value.trim() ?? '';
    state.delivery.zipCode = root.querySelector('[name="zipCode"]')?.value.trim() ?? '';
  }
}

/** @param {Promise<any>} promise @param {number} timeoutMs */
function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => window.setTimeout(() => reject(new Error('Client lookup timed out.')), timeoutMs)),
  ]);
}

function reserveQuoteWindow() {
  try {
    const target = window.open('', '_blank');
    if (target) target.opener = null;
    return target;
  } catch {
    return null;
  }
}
