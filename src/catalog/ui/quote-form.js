/**
 * Internal multi-step quote form.
 *
 * This is intentionally a screen, not a modal. The catalog selection remains
 * the source of truth for products while the form keeps a local draft until
 * the quote adapter receives the final payload.
 *
 * One step is visible at a time, centered, with nothing around it but the way
 * back to the catalog and the progress dots: the visitor should only ever have
 * one thing to answer. The optional portrait above the step is currently
 * disabled; the original block is kept commented below for later use.
 */

import { getDeliverySlots, normalizeDeliveryDate, normalizeDeliveryValue } from '../core/delivery-schedule.js';
import { buildQuotePayload } from '../core/quote-payload.js';
import { clearQuoteDraft, readQuoteDraft, writeQuoteDraft } from '../core/quote-draft.js';
import { getQuotePricing, quotePricingKey } from '../core/pricing.js';
import { describeQuoteItem } from '../core/format.js';
import { resolveSeason } from '../core/season.js';
import { getCategoryLabel } from '../data/categories.js';
// Temporarily disabled with the advisor portrait block below.
// import { resolveAdvisor } from '../data/advisors.js';
import { US_STATE_OPTIONS } from '../data/us-states.js';
import {
  DEFAULT_COUNTRY,
  COUNTRY_CALLING_CODES,
  dialCodeForCountry,
  formatInternationalPhone,
  splitPhoneNumber,
} from '../data/country-calling-codes.js';
import { resolveLocation } from '../data/locations.js';
import { el, firstUsableImage, productMedia, replaceChildren } from './dom.js';
import { deliverySchedulePicker } from './delivery-schedule.js';
import { shippingDestinationFields } from './location-select.js';
import { NO_PAYMENT_NOTE } from './states.js';
import { openVariantPicker } from './variant-picker.js';

const STEPS = [
  'Email',
  'Contact information',
  'Select your products',
  'Type of order',
  'Delivery information',
  'Other details',
];

/** The step whose rail label follows the chosen order type. */
const DELIVERY_STEP_INDEX = 4;

/**
 * @param {ReturnType<typeof import('../app.js').createApp>['ctx']} ctx
 * @param {{
 *   onBack: () => void,
 *   onOpenProductPicker?: (options?: { onClose?: () => void }) => void,
 *   onLookupClient?: (email: string) => Promise<any>,
 *   onCheckDeliveryEligibility?: (payload: ReturnType<typeof buildQuotePayload>) => Promise<any>,
 *   onSubmit: (payload: ReturnType<typeof buildQuotePayload>) => Promise<any>,
 * }} options
 */
export function renderQuoteFormView(ctx, options) {
  const existingDestination = ctx.locationStore.getShippingDestination() ?? {};
  const savedDraft = readQuoteDraft();
  const savedContact = savedDraft?.contact ?? {
    firstName: '',
    lastName: '',
    phone: '',
    company: '',
    socialMediaProfiles: '',
  };
  const savedPhone = splitPhoneNumber(
    savedContact.phone,
    savedDraft?.phoneCountry ? dialCodeForCountry(savedDraft.phoneCountry) : undefined,
  );
  const state = {
    step: savedDraft?.step ?? 0,
    email: savedDraft?.email ?? '',
    recognized: savedDraft?.recognized === true,
    vip: savedDraft?.vip === true,
    clientLookup: savedDraft?.clientLookup ?? 'idle',
    phoneCountry: savedDraft?.phoneCountry ?? savedPhone.countryCode,
    contact: { ...savedContact, phone: savedPhone.nationalNumber },
    orderType: savedDraft?.orderType ?? 'Delivery',
    delivery: {
      dateTime: '',
      address: '',
      city: existingDestination.city ?? '',
      state: existingDestination.state ?? '',
      zipCode: existingDestination.zipCode ?? '',
      ...savedDraft?.delivery,
    },
    editingShippingAddress: false,
    notes: savedDraft?.notes ?? '',
    submitPending: false,
    pricing: null,
    pricingKey: '',
    pricingPending: false,
    pricingPromise: null,
    error: '',
    result: null,
  };

  const screen = el('section', { class: 'cat-quote-screen', 'aria-labelledby': 'cat-quote-title' });
  screen.addEventListener('input', (event) => {
    if (event.target?.name !== 'notes') return;
    state.notes = event.target.value;
    persistDraft();
  });
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
  return {
    head: null,
    body: [screen],
    refresh() {
      if (state.submitPending) return;
      render();
    },
  };

  function render(shouldFocus = false) {
    // Only a real step change animates. Re-rendering after, say, a quantity
    // edit must not slide the whole step back in under the visitor's cursor.
    const moved = state.step !== renderedStep;
    const direction = moved ? (state.step < renderedStep ? 'backward' : 'forward') : null;
    const isCatalogExit = state.result || state.step === 0;
    if (!state.result) {
      enforceSeasonalOrderType();
      persistDraft();
    }
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

  function persistDraft() {
    writeQuoteDraft({
      ...state,
      phoneCountry: state.phoneCountry,
      contact: {
        ...state.contact,
        phone: formatInternationalPhone(dialCodeForCountry(state.phoneCountry), state.contact.phone),
      },
    });
  }

  function enforceSeasonalOrderType() {
    if (state.orderType !== 'Delivery' || resolveSeason(state.delivery.dateTime).type !== 'HIGH') return;
    // A saved or tampered Delivery selection must not survive a render during
    // a high-season window. Pickup remains valid for the same date.
    state.orderType = 'Pickup';
    state.delivery.slot = undefined;
  }

  /**
   * A rail entry is built once and only has its state updated afterwards, so
   * moving between steps transitions the mark and the connector instead of
   * replacing them mid-animation.
   */
  function railStep(label, index) {
    const mark = el('span', { class: 'cat-quote-rail-mark', 'aria-hidden': 'true', text: String(index + 1) });
    const name = el('span', { class: 'cat-quote-rail-label', text: label });
    const button = el('button', {
      type: 'button',
      class: 'cat-quote-rail-button',
      onClick: () => {
        if (index >= state.step) return;
        state.step = index;
        state.error = '';
        render(true);
      },
    }, [mark, name]);

    return { item: el('li', { class: 'cat-quote-rail-item' }, [button]), button, mark, name };
  }

  function updateRail() {
    // The fifth step asks for a delivery address or only for a pickup day, so
    // the rail says which one the visitor is in.
    railSteps[DELIVERY_STEP_INDEX].name.textContent = state.orderType === 'Delivery'
      ? 'Delivery information'
      : 'Pickup information';
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
      ['Tell us a little about you', 'These details help our team get your quote right.'],
      ['Select your products', 'Review the products selected from your catalog location.'],
      ['How would you like to receive it?', 'Choose delivery or pickup so we can plan the next step.'],
      state.orderType === 'Delivery'
        ? ['Where should we deliver?', 'Choose a preferred date and confirm the shipping address for this request.']
        : ['When should we have it ready?', 'Choose the day you’ll collect your order and we’ll take it from there.'],
      ['Anything else we should know?', 'Add the details that will help us prepare the best quote.'],
    ][state.step];

    return el('div', { class: `cat-quote-step ${state.step === 2 ? 'is-wide' : ''} ${direction ? `is-entering is-${direction}` : ''}` }, [
      // Temporarily hidden: no portrait or location label should appear here.
      // advisorPortrait(state.step === 0),
      el('div', { class: 'cat-quote-step-heading' }, [
        el('h2', { id: 'cat-quote-title', text: config[0] }),
        config[1] ? el('p', { class: 'cat-quote-step-description', text: config[1] }) : null,
      ]),
      state.error ? el('p', { class: 'cat-quote-form-error', role: 'alert', text: state.error }) : null,
      stepBody(),
    ]);
  }

  // Temporarily disabled: keep the advisor portrait and location label ready
  // to restore without rendering either one in the quote flow.
  // /**
  //  * The location's face. Shown large on the first step and small afterwards.
  //  *
  //  * @param {boolean} large
  //  */
  // function advisorPortrait(large) {
  //   const advisor = resolveAdvisor(ctx.locationId);
  //   return el('div', { class: `cat-quote-advisor ${large ? 'is-large' : ''}` }, [
  //     el('img', {
  //       class: 'cat-quote-advisor-photo',
  //       src: advisor.src,
  //       alt: advisor.alt,
  //       width: large ? 96 : 56,
  //       height: large ? 96 : 56,
  //       decoding: 'async',
  //     }),
  //     large ? el('p', { class: 'cat-quote-advisor-caption', text: `Your ${advisor.locationLabel} team` }) : null,
  //   ]);
  // }

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
      disabled: state.submitPending,
      text: 'Let’s do this',
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
        // A visitor can go back and submit a different email. Clear the
        // previous contact data so two people can never be mixed.
        clearProfileData();
        state.submitPending = true;
        state.clientLookup = 'checking';
        button.disabled = true;
        button.textContent = 'Continuing…';
        const lookup = options.onLookupClient
          ? await options.onLookupClient(state.email)
          : { ok: true, found: false, vip: false, profile: {} };
        state.submitPending = false;
        if (!lookup?.ok) {
          state.clientLookup = 'unavailable';
          state.error = 'We could not continue with this email. Please try again.';
          render(true);
          return;
        }
        state.recognized = lookup.found === true;
        state.vip = lookup.vip === true;
        state.clientLookup = lookup.found ? 'found' : 'not-found';
        if (lookup.found) applyLookupProfile(lookup.profile);
        persistDraft();
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
        maxlength: '254',
        required: true,
      }),
      el('div', { class: 'cat-quote-form-actions' }, [
        button,
      ]),
    ]);
  }

  function contactStep() {
    const fields = [
      field({
        label: 'Email address',
        name: 'email',
        type: 'email',
        value: state.email,
        autocomplete: 'email',
        maxlength: '254',
        required: true,
        readonly: true,
      }),
      el('div', { class: 'cat-quote-field-grid' }, [
        contactField('First name', 'firstName', 'given-name', true),
        contactField('Last name', 'lastName', 'family-name', true),
      ]),
      el('div', { class: 'cat-quote-field-grid' }, [
        phoneField(),
        contactField('Company', 'company', 'organization', false),
      ]),
      contactField('Social media profiles (business)', 'socialMediaProfiles', 'off', false),
    ];

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
    const currentDestination = ctx.locationStore.getShippingDestination() ?? {};
    state.recognized = false;
    state.vip = false;
    state.clientLookup = 'idle';
    state.phoneCountry = DEFAULT_COUNTRY;
    state.contact = {
      firstName: '',
      lastName: '',
      phone: '',
      company: '',
      socialMediaProfiles: '',
    };
    state.delivery = {
      ...state.delivery,
      address: '',
      city: currentDestination.city ?? '',
      state: currentDestination.state ?? '',
      zipCode: currentDestination.zipCode ?? '',
    };
    state.editingShippingAddress = false;
  }

  function applyLookupProfile(profile = {}) {
    const value = (...labels) => {
      for (const label of labels) {
        const found = profile[label];
        if (found !== null && found !== undefined && String(found).trim()) return String(found).trim();
      }
      return '';
    };
    state.contact = {
      firstName: value('First Name'),
      lastName: value('Last Name'),
      phone: value('Phone Number', 'Phone'),
      company: value('Company'),
      socialMediaProfiles: value(
        'Social media profiles (business)',
        'Social Media Profiles (Business)',
        'Social Media Profiles',
      ),
    };
    state.delivery = {
      ...state.delivery,
      address: value('Address'),
      city: value('City'),
      state: value('State'),
      zipCode: value('Zip Code', 'ZIP Code'),
    };
  }

  function contactField(label, name, autocomplete, required, type = 'text') {
    const value = state.contact[name] ?? '';
    return field({
      label,
      name,
      type,
      value,
      autocomplete,
      maxlength: name === 'company' ? '120' : name === 'socialMediaProfiles' ? '500' : '80',
      required,
      optional: !required,
    });
  }

  function phoneField() {
    const rawValue = state.contact.phone ?? '';
    const phone = splitPhoneNumber(rawValue, dialCodeForCountry(state.phoneCountry));
    const displayValue = phone.nationalNumber;
    const knownPhone = false;
    const countryCode = el('span', {
      class: 'cat-quote-country-trigger-code',
      text: dialCodeForCountry(state.phoneCountry),
    });
    const hiddenCountry = el('input', {
      type: 'hidden',
      name: 'phoneCountry',
      value: state.phoneCountry,
    });
    let isOpen = false;

    const countryOptions = COUNTRY_CALLING_CODES.map((country) => el('button', {
      type: 'button',
      class: 'cat-quote-country-option',
      role: 'option',
      'aria-selected': String(country.code === state.phoneCountry),
      onClick: () => selectCountry(country.code),
    }, [
      el('span', { class: 'cat-quote-country-option-name', text: country.name }),
      el('span', { class: 'cat-quote-country-option-code', text: country.dialCode }),
    ]));
    const countryMenu = el('div', {
      id: 'cat-quote-field-phone-country-menu',
      class: 'cat-quote-country-menu',
      role: 'listbox',
      'aria-label': 'Country calling codes',
      hidden: true,
      onKeydown: handleCountryMenuKeydown,
    }, countryOptions);
    const countryTrigger = el('button', {
      type: 'button',
      class: 'cat-quote-country-trigger',
      'aria-label': 'Country calling code',
      'aria-controls': 'cat-quote-field-phone-country-menu',
      'aria-expanded': 'false',
      'aria-haspopup': 'listbox',
      disabled: knownPhone,
      onClick: () => setCountryMenuOpen(!isOpen),
      onKeydown: (event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        setCountryMenuOpen(true);
        focusCountryOption(0);
      },
    }, [
      countryCode,
      el('span', { class: 'cat-quote-country-trigger-chevron', 'aria-hidden': 'true' }),
    ]);
    const countryPicker = el('div', {
      class: `cat-quote-country-picker${knownPhone ? ' is-readonly' : ''}`,
      onFocusout: (event) => {
        if (!countryPicker.contains(event.relatedTarget)) setCountryMenuOpen(false);
      },
    }, [countryTrigger, countryMenu, hiddenCountry]);

    function setCountryMenuOpen(open) {
      isOpen = open && !knownPhone;
      countryMenu.hidden = !isOpen;
      countryTrigger.setAttribute('aria-expanded', String(isOpen));
      countryPicker.classList.toggle('is-open', isOpen);
    }

    function focusCountryOption(offset) {
      const active = countryOptions.indexOf(document.activeElement);
      const current = active >= 0
        ? active
        : countryOptions.findIndex((option) => option.getAttribute('aria-selected') === 'true');
      const next = Math.min(Math.max(current + offset, 0), countryOptions.length - 1);
      countryOptions[next]?.focus();
    }

    function handleCountryMenuKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setCountryMenuOpen(false);
        countryTrigger.focus();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        focusCountryOption(event.key === 'ArrowUp' ? -1 : 1);
      }
    }

    function selectCountry(code) {
      state.phoneCountry = code;
      hiddenCountry.value = code;
      countryCode.textContent = dialCodeForCountry(code);
      countryOptions.forEach((option, index) => {
        const selected = COUNTRY_CALLING_CODES[index].code === code;
        option.setAttribute('aria-selected', String(selected));
      });
      persistDraft();
      setCountryMenuOpen(false);
      countryTrigger.focus();
    }

    return el('div', { class: 'cat-quote-field cat-quote-phone-field' }, [
      el('label', { for: 'cat-quote-field-phone', text: 'Phone number *' }),
      el('div', { class: 'cat-quote-phone-control' }, [
        countryPicker,
        el('input', {
          id: 'cat-quote-field-phone',
          name: 'phone',
          type: 'tel',
          value: displayValue,
          placeholder: state.phoneCountry === DEFAULT_COUNTRY ? '(555) 123-4567' : 'Phone number',
          autocomplete: knownPhone ? 'off' : 'tel-national',
          inputmode: 'tel',
          maxlength: '40',
          required: true,
          readonly: knownPhone,
          onInput: (event) => {
            state.contact.phone = event.currentTarget.value;
            persistDraft();
          },
        }),
      ]),
    ]);
  }

  function productsStep() {
    syncShippingDestination();
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
        selectedLocationContext(),
        ctx.location.requiresShippingDestination
          ? shippingDestinationFields({
              destination: ctx.locationStore.getShippingDestination() ?? {
                city: state.delivery.city,
                state: state.delivery.state,
                zipCode: state.delivery.zipCode,
              },
              includeZipCode: true,
              required: true,
              stateOptions: US_STATE_OPTIONS,
              onChange: (value) => {
                ctx.locationStore.setShippingDestination(value);
                syncShippingDestination(value);
                persistDraft();
              },
            })
          : null,
      ]),
      el('div', { class: 'cat-quote-form-section' }, [
        el('div', { class: 'cat-quote-section-label' }, [
          el('span', { text: 'Products' }),
          el('span', { class: 'cat-quote-section-count', text: `${items.length} selected` }),
        ]),
        productRows,
        el('button', {
          type: 'button',
          class: 'cat-linkbtn cat-quote-add-products',
          text: '+ Add or edit products in catalog',
          onClick: () => {
            if (options.onOpenProductPicker) {
              options.onOpenProductPicker({ onClose: () => render() });
            } else {
              options.onBack();
            }
          },
        }),
      ]),
      stepActions('Continue to order type'),
    ]);
  }

  /** The catalog location is intentionally not editable after products load. */
  function selectedLocationContext() {
    const location = resolveLocation(ctx.locationId);
    return el('div', { class: 'cat-quote-location-context', role: 'status' }, [
      el('div', { class: 'cat-quote-location-context-copy' }, [
        el('span', { class: 'cat-quote-location-context-label', text: 'Catalog location' }),
        el('strong', { text: location.label }),
        el('p', { text: 'Products and availability are based on this location.' }),
      ]),
      el('button', {
        type: 'button',
        class: 'cat-linkbtn',
        text: 'Change in catalog',
        onClick: options.onBack,
      }),
    ]);
  }

  /** Keep the later delivery step in sync with the location asked for here. */
  function syncShippingDestination(destination = ctx.locationStore.getShippingDestination()) {
    // A recognized client's profile can already contain these values before
    // the destination is written to the session store. Keep that prefill
    // visible until the visitor edits it instead of replacing it with blanks.
    if (!destination) return;
    state.delivery.city = destination.city ?? '';
    state.delivery.state = destination.state ?? '';
    state.delivery.zipCode = destination.zipCode ?? '';
  }

  function productRow(item) {
    const product = ctx.products.find((entry) => entry.id === item.productId);
    const selectedVariant = product?.variants?.find((variant) =>
      (variant.variety ?? null) === item.variety &&
      (variant.color ?? null) === item.color &&
      (variant.lengthCm ?? null) === item.lengthCm,
    );
    const image = firstUsableImage(selectedVariant?.images) ?? firstUsableImage(product?.images);
    const quantity = el('div', {
      class: 'cat-qty cat-qty-sm cat-quote-product-quantity-control',
      role: 'group',
      'aria-label': `Quantity for ${item.productName}`,
    }, [
      el('button', {
        type: 'button',
        class: 'cat-qty-btn',
        'aria-label': `Decrease quantity for ${item.productName}`,
        disabled: item.quantity <= 1,
        text: '-',
        onClick: () => {
          ctx.quoteStore.setQuantity(item.id, Math.max(1, item.quantity - 1));
          render();
        },
      }),
      el('input', {
        type: 'number',
        min: '1',
        max: '10000',
        step: '1',
        inputmode: 'numeric',
        class: 'cat-qty-input',
        value: String(item.quantity),
        'aria-label': `Quantity for ${item.productName}`,
        onChange: (event) => {
          const value = Number.parseInt(event.currentTarget.value, 10);
          if (Number.isInteger(value) && value > 0) ctx.quoteStore.setQuantity(item.id, value);
          else event.currentTarget.value = String(item.quantity);
          render();
        },
      }),
      el('button', {
        type: 'button',
        class: 'cat-qty-btn',
        'aria-label': `Increase quantity for ${item.productName}`,
        text: '+',
        onClick: () => {
          ctx.quoteStore.setQuantity(item.id, item.quantity + 1);
          render();
        },
      }),
    ]);

    return el('li', { class: 'cat-quote-product-row' }, [
      productMedia(image, { label: item.productName, className: 'cat-quote-product-thumb', width: 96, height: 96 }),
      el('div', { class: 'cat-quote-product-copy' }, [
        el('span', { class: 'cat-quote-item-cat', text: getCategoryLabel(item.category) }),
        el('strong', { text: item.productName }),
        el('p', { class: 'cat-quote-product-detail', text: describeQuoteItem(item) || 'Standard selection' }),
      ]),
      el('div', { class: 'cat-quote-product-controls' }, [
        quantity,
        product
          ? el('button', {
              type: 'button',
              class: 'cat-linkbtn',
              text: 'Edit',
              onClick: () => editProduct(item, product),
            })
          : null,
        el('button', { type: 'button', class: 'cat-linkbtn cat-linkbtn-danger', text: 'Remove', onClick: () => { ctx.quoteStore.removeItem(item.id); render(); } }),
      ]),
    ]);
  }

  /** Reuses the catalog's validated variant picker for an existing quote line. */
  function editProduct(item, product) {
    openVariantPicker({
      product,
      initial: {
        variety: item.variety,
        color: item.color,
        lengthCm: item.lengthCm,
        measure: item.measure,
        quantity: item.quantity,
      },
      onAdd(selection) {
        ctx.quoteStore.removeItem(item.id);
        ctx.quoteStore.addItem(product, selection);
        render();
      },
    });
  }

  function orderTypeStep() {
    const selectedSeason = resolveSeason(state.delivery.dateTime);
    const pricing = currentQuotePricing();
    scheduleQuotePricingRefresh();
    if (
      !state.pricingPending
      && selectedSeason.type !== 'HIGH'
      && state.orderType === 'Delivery'
      && !isDeliveryAllowed(pricing)
    ) {
      state.orderType = 'Pickup';
      persistDraft();
    }
    const deliveryBlocked = selectedSeason.type === 'HIGH' || !isDeliveryAllowed(pricing);
    return el('form', {
      class: 'cat-quote-step-form',
      onSubmit: (event) => {
        event.preventDefault();
        // The choice is radio buttons, which already write to state.orderType
        // as they change; there is nothing left to read here.
        const latestPricing = currentQuotePricing();
        if (selectedSeason.type === 'HIGH' || !isDeliveryAllowed(latestPricing)) {
          state.orderType = 'Pickup';
        }
        state.step = 4;
        state.error = '';
        render(true);
      },
    }, [
      deliveryEligibilityNote(pricing, selectedSeason.type === 'HIGH' ? selectedSeason : null),
      el('div', { class: 'cat-quote-choice-list' }, [
        choice(
          'Delivery',
          selectedSeason.type === 'HIGH'
            ? `Unavailable during ${selectedSeason.label}.`
            : deliveryBlocked
              ? 'Available once the $150 minimum order is met.'
              : 'We’ll deliver to the address you provide.',
          deliveryBlocked,
        ),
        choice('Pickup', 'You’ll collect the flowers from our team.'),
      ]),
      stepActions('Continue to delivery information'),
    ]);
  }

  function currentQuotePricing() {
    const items = ctx.quoteStore.getItems();
    const key = quotePricingKey(items);
    return state.pricing && state.pricingKey === key
      ? state.pricing
      : getQuotePricing(items, ctx.products);
  }

  function isDeliveryAllowed(pricing = currentQuotePricing()) {
    return state.vip || pricing.deliveryAllowed;
  }

  function scheduleQuotePricingRefresh() {
    if (state.vip || state.pricingPending || !options.onCheckDeliveryEligibility) return;
    const items = ctx.quoteStore.getItems();
    const key = quotePricingKey(items);
    if (state.pricing && state.pricingKey === key) return;

    state.pricingKey = key;
    state.pricingPending = true;
    const payload = buildQuotePayload({
      locationId: ctx.locationId,
      items,
      vip: state.vip,
    });
    const request = Promise.resolve(options.onCheckDeliveryEligibility(payload));
    state.pricingPromise = request;
    request
      .then((result) => {
        if (state.pricingKey !== key) return;
        if (result?.ok === true) {
          state.pricing = {
            hasUnknownPricing: result.hasUnknownPricing === true,
            unknownItems: [],
            deliveryProgress: Number.isInteger(result.deliveryProgress)
              ? result.deliveryProgress
              : 0,
            deliveryAllowed: result.deliveryAllowed === true,
          };
        } else {
          // Cache the safe local result for this selection so a failed Fresa
          // check does not create a render/retry loop.
          state.pricing = getQuotePricing(items, ctx.products);
        }
      })
      .catch(() => {
        // If Fresa cannot confirm the minimum, cache the safe local result:
        // Pickup remains available and Delivery stays disabled.
        if (state.pricingKey === key) state.pricing = getQuotePricing(items, ctx.products);
      })
      .finally(() => {
        if (state.pricingPromise !== request) return;
        state.pricingPending = false;
        state.pricingPromise = null;
        if (state.step === 3 && !state.result) render();
      });
  }

  async function refreshQuotePricing({ force = false } = {}) {
    const items = ctx.quoteStore.getItems();
    const key = quotePricingKey(items);
    if (!force && state.pricing && state.pricingKey === key) return state.pricing;
    if (state.pricingPending && state.pricingKey === key && state.pricingPromise) {
      await state.pricingPromise;
      return currentQuotePricing();
    }
    if (!options.onCheckDeliveryEligibility) return currentQuotePricing();

    state.pricingKey = key;
    state.pricingPending = true;
    const payload = buildQuotePayload({ locationId: ctx.locationId, items, vip: state.vip });
    const request = Promise.resolve(options.onCheckDeliveryEligibility(payload));
    state.pricingPromise = request;
    try {
      const result = await request;
      if (state.pricingKey !== key || result?.ok !== true) {
        throw new Error(result?.error || 'Delivery eligibility is unavailable.');
      }
      state.pricing = {
        hasUnknownPricing: result.hasUnknownPricing === true,
        unknownItems: [],
        deliveryProgress: Number.isInteger(result.deliveryProgress) ? result.deliveryProgress : 0,
        deliveryAllowed: result.deliveryAllowed === true,
      };
      return state.pricing;
    } finally {
      if (state.pricingPromise === request) {
        state.pricingPending = false;
        state.pricingPromise = null;
      }
    }
  }

  function deliveryEligibilityNote(pricing, blockedSeason = null) {
    const seasonBlocked = blockedSeason?.type === 'HIGH';
    const eligible = !seasonBlocked && isDeliveryAllowed(pricing);
    const progress = state.vip ? 100 : pricing.deliveryProgress;
    const description = seasonBlocked
      ? `Pickup is available during ${blockedSeason.label}.`
      : state.pricingPending && !state.vip
        ? 'Checking this selection against the $150 Delivery minimum…'
        : pricing.hasUnknownPricing
          ? 'Delivery will be available once the selected product measures and prices can be confirmed.'
          : eligible
            ? 'Delivery is available for this selection.'
            : `Your selection is ${progress}% toward the $150 minimum for Delivery.`;

    return el('div', {
      class: `cat-quote-delivery-eligibility ${eligible ? 'is-available' : ''}`,
      role: 'status',
      'aria-live': 'polite',
    }, [
      el('div', { class: 'cat-quote-delivery-eligibility-head' }, [
        el('strong', { text: seasonBlocked
          ? 'Delivery unavailable during high season'
          : state.pricingPending && !state.vip
            ? 'Checking delivery'
            : state.vip
              ? 'VIP delivery available'
              : 'Delivery progress' }),
        el('span', {
          class: 'cat-quote-delivery-eligibility-percent',
          text: `${progress}% complete`,
        }),
      ]),
      el('p', { text: description }),
      el('div', {
        class: 'cat-quote-delivery-progress',
        role: 'progressbar',
        'aria-label': 'Delivery eligibility progress',
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'aria-valuenow': String(progress),
      }, [el('span', { class: 'cat-quote-delivery-progress-bar', style: `width:${progress}%` })]),
    ]);
  }

  function choice(value, description, disabled = false) {
    const id = `cat-order-${value.toLowerCase()}`;
    return el('label', { class: `cat-quote-choice ${state.orderType === value ? 'is-selected' : ''} ${disabled ? 'is-disabled' : ''}` }, [
      el('input', {
        type: 'radio',
        name: 'orderType',
        value,
        checked: state.orderType === value,
        disabled,
        onChange: () => {
          if (disabled) return;
          state.orderType = value;
          persistDraft();
          render();
        },
        id,
      }),
      el('span', { class: 'cat-quote-choice-mark' }),
      el('span', {}, [el('strong', { text: value }), el('small', { text: description })]),
    ]);
  }

  function deliveryStep() {
    const isDelivery = state.orderType === 'Delivery';
    const clientTimeZone = ctx.clientTimeZone ?? 'UTC';
    const isDateAllowed = (dateKey) => !isDelivery || resolveSeason(dateKey).type !== 'HIGH';
    // Delivery windows are preferences only in the static plan; the team
    // confirms availability after reviewing the request. High-season dates
    // remain available to Pickup but are not valid for Delivery.
    const scheduleOptions = {
      now: new Date(),
      timeZone: clientTimeZone,
      mode: isDelivery ? 'delivery' : 'pickup',
      isDateAllowed,
    };
    const validValue = isDelivery
      ? normalizeDeliveryValue(state.delivery.dateTime, scheduleOptions)
      : normalizeDeliveryDate(state.delivery.dateTime, scheduleOptions);
    state.delivery.dateTime = validValue;
    state.delivery.slot = isDelivery && validValue
      ? getDeliverySlots(validValue.slice(0, 10), scheduleOptions).find((slot) => slot.value === validValue)
      : undefined;
    const hasSavedShipping = state.clientLookup === 'found' && Boolean(
      state.delivery.address
      && state.delivery.city
      && state.delivery.state
      && state.delivery.zipCode,
    );
    const shippingAddressNotice = el('div', { class: 'cat-quote-info-note cat-quote-shipping-address-note' }, [
      el('strong', { text: 'Shipping address' }),
      el('p', {
        text: hasSavedShipping
          ? state.editingShippingAddress
            ? 'Update the saved address below for this delivery.'
            : 'We filled in your saved shipping address for this delivery.'
          : 'Enter the address where this order should be delivered.',
      }),
      hasSavedShipping && !state.editingShippingAddress
        ? el('button', {
            type: 'button',
            class: 'btn btn-light cat-quote-edit-address',
            text: 'Update shipping address',
            onClick: () => {
              state.editingShippingAddress = true;
              state.error = '';
              render();
              window.setTimeout(() => formHost.querySelector('[name="address"]')?.focus(), 0);
            },
          })
        : null,
    ]);
    const scheduleInput = el('input', {
      type: 'hidden',
      name: 'dateTime',
      value: state.delivery.dateTime,
      required: true,
    });
    const seasonNotice = el('div', {
      class: 'cat-quote-info-note cat-quote-season-notice',
      role: 'status',
      'aria-live': 'polite',
    });
    const updateSeasonNotice = (value) => {
      const season = resolveSeason(value);
      const isHighSeason = season.type === 'HIGH';
      replaceChildren(seasonNotice, isHighSeason ? [
        el('strong', { text: `High season — ${season.label}` }),
        el('p', { text: season.customerMessage ?? 'Availability may vary during this period.' }),
      ] : []);
      seasonNotice.hidden = !isHighSeason;
    };
    updateSeasonNotice(state.delivery.dateTime);
    const scheduleField = el('div', { class: 'cat-quote-field cat-quote-schedule-field' }, [
      el('div', { class: 'cat-quote-schedule-label' }, [
        el('label', { text: `${isDelivery ? 'Preferred delivery date and time' : 'Preferred pickup date'} *` }),
        el('span', { text: isDelivery ? 'Mon–Fri · 8:00 AM–4:00 PM; Sat–Sun · 8:00 AM–12:00 PM' : 'Mon–Sun · 24-hour notice' }),
      ]),
      deliverySchedulePicker({
        value: state.delivery.dateTime,
        timeZone: clientTimeZone,
        mode: isDelivery ? 'window' : 'date',
        isDateAllowed,
        availabilityProvider: null,
        onChange: (selection) => {
          state.delivery.dateTime = selection.dateTime;
          state.delivery.slot = selection.slot;
          scheduleInput.value = selection.dateTime;
          updateSeasonNotice(selection.dateTime);
          state.error = '';
          persistDraft();
        },
      }),
      scheduleInput,
      seasonNotice,
      el('small', {
        text: isDelivery
          ? 'Pick a preferred two-hour window. Our team will confirm the final delivery time.'
          : 'Pick the day you’d like to collect your order. We’ll agree the exact time with you.',
      }),
    ]);
    return el('form', {
      class: 'cat-quote-step-form',
      onSubmit: (event) => {
        event.preventDefault();
        const currentScheduleOptions = {
          now: new Date(),
          timeZone: clientTimeZone,
          mode: isDelivery ? 'delivery' : 'pickup',
          isDateAllowed,
        };
        const validValue = isDelivery
          ? normalizeDeliveryValue(state.delivery.dateTime, currentScheduleOptions)
          : normalizeDeliveryDate(state.delivery.dateTime, currentScheduleOptions);
        state.delivery.dateTime = validValue;
        if (!validValue) {
          state.error = isDelivery
            ? 'Choose an available delivery date and time window to continue.'
            : 'Choose an available pickup date at least 24 hours ahead.';
          render(true);
          return;
        }
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
      scheduleField,
      isDelivery
        ? el('div', { class: 'cat-quote-delivery-fields' }, [
            shippingAddressNotice,
            deliveryField('Shipping address', 'address', 'street-address', true),
            el('div', { class: 'cat-quote-field-grid' }, [
              deliveryField('City', 'city', 'address-level2', true),
              deliveryField('State', 'state', 'address-level1', true),
            ]),
            deliveryField('ZIP code', 'zipCode', 'postal-code', true, 'text', 'numeric'),
          ])
        : el('div', { class: 'cat-quote-info-note' }, [
            el('strong', { text: 'Pickup selected' }),
            el('p', { text: 'We’ll confirm the pickup address with you after reviewing your request.' }),
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
      maxlength: name === 'address' ? '160' : name === 'zipCode' ? '20' : '80',
      required,
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
        persistDraft();

        const orderType = state.orderType === 'Delivery' ? 'Delivery' : 'Pickup';
        if (orderType === 'Delivery' && resolveSeason(state.delivery.dateTime).type === 'HIGH') {
          state.orderType = 'Pickup';
          state.delivery.slot = undefined;
          state.error = 'Delivery is not available during high season. Please choose Pickup instead.';
          state.step = 3;
          render(true);
          return;
        }
        const isDateAllowed = (dateKey) => orderType !== 'Delivery' || resolveSeason(dateKey).type !== 'HIGH';
        const currentScheduleOptions = {
          now: new Date(),
          timeZone: ctx.clientTimeZone ?? 'UTC',
          mode: orderType === 'Delivery' ? 'delivery' : 'pickup',
          isDateAllowed,
        };
        const validDateTime = orderType === 'Delivery'
          ? normalizeDeliveryValue(state.delivery.dateTime, currentScheduleOptions)
          : normalizeDeliveryDate(state.delivery.dateTime, currentScheduleOptions);
        if (!validDateTime) {
          state.orderType = orderType;
          state.delivery.dateTime = '';
          state.error = orderType === 'Delivery'
            ? 'Please choose an available delivery date and time window again.'
            : 'Please choose an available pickup date at least 24 hours ahead again.';
          state.step = 4;
          render(true);
          return;
        }
        state.delivery.dateTime = validDateTime;
        state.delivery.slot = orderType === 'Delivery'
          ? getDeliverySlots(validDateTime.slice(0, 10), currentScheduleOptions)
            .find((slot) => slot.value === validDateTime)
          : undefined;
        if (orderType === 'Delivery' && !state.delivery.slot) {
          state.orderType = orderType;
          state.delivery.dateTime = '';
          state.error = 'Please choose an available delivery date and time window again.';
          state.step = 4;
          render(true);
          return;
        }

        state.submitPending = true;
        button.disabled = true;
        button.textContent = 'Sending request…';
        state.error = '';

        state.orderType = orderType;

        // Re-check at the final boundary so a quantity or measure change
        // cannot submit Delivery below the $150 minimum.
        if (orderType === 'Delivery') {
          let finalPricing = currentQuotePricing();
          try {
            finalPricing = await refreshQuotePricing({ force: true });
          } catch {
            // Keep the safe local result. Delivery is not sent unless the
            // minimum can be confirmed.
          }
          if (!isDeliveryAllowed(finalPricing)) {
            state.orderType = 'Pickup';
            state.error = finalPricing.hasUnknownPricing
              ? 'Delivery eligibility could not be confirmed. Please choose Pickup or try again.'
              : 'This selection does not meet the $150 Delivery minimum. Please update it or choose Pickup.';
            state.step = 3;
            return;
          }
        }

        const payload = buildQuotePayload({
          locationId: ctx.locationId,
          items: ctx.quoteStore.getItems(),
          email: state.email,
          contact: state.contact,
          phoneCountryCode: dialCodeForCountry(state.phoneCountry),
          vip: state.vip,
          orderType,
          delivery: {
            ...state.delivery,
            timeZone: ctx.clientTimeZone ?? 'UTC',
          },
          shippingDestination: ctx.locationStore.getShippingDestination(),
          notes: state.notes,
        });

        try {
          const result = await options.onSubmit(payload);
          if (result?.ok) {
            ctx.quoteStore.clear();
            clearQuoteDraft();
            state.result = result;
          } else {
            if (result?.code === 'SLOT_FULL') {
              state.delivery.dateTime = '';
              state.delivery.slot = undefined;
              state.step = 4;
            }
            state.error = result?.error || 'We could not send your quote request. Please try again.';
          }
        } catch {
          state.error = 'We could not send your quote request. Please try again.';
        } finally {
          state.submitPending = false;
          render(true);
        }
      },
    }, [
      el('div', { class: 'cat-quote-notes-field' }, [
        el('label', { for: 'cat-quote-notes', text: 'Notes for the seller (Optional)' }),
        el('textarea', { id: 'cat-quote-notes', name: 'notes', rows: '6', maxlength: '2000', placeholder: 'Tell us anything important about your request…' }, state.notes),
      ]),
      reviewSummary(),
      el('div', { class: 'cat-quote-form-actions' }, [
        button,
      ]),
    ]);
  }

  function reviewSummary() {
    const items = ctx.quoteStore.getItems();
    const season = resolveSeason(state.delivery.dateTime);
    return el('div', { class: 'cat-quote-review' }, [
      el('div', { class: 'cat-quote-section-label' }, [el('span', { text: 'Ready to send' }), el('span', { class: 'cat-quote-section-count', text: `${items.length} product${items.length === 1 ? '' : 's'}` })]),
      el('p', { text: `${state.email} · ${resolveLocation(ctx.locationId).label} · ${state.orderType}` }),
      el('p', { text: season.type === 'HIGH' ? `Season type: HIGH — ${season.label}` : 'Season type: LOW' }),
      el('p', { class: 'cat-note', text: NO_PAYMENT_NOTE }),
    ]);
  }

  function successStep() {
    return el('div', { class: 'cat-quote-success' }, [
      el('div', { class: 'cat-quote-success-icon', text: '✓' }),
      el('p', { class: 'cat-quote-step-count', text: 'Request received' }),
      el('h2', { id: 'cat-quote-title', text: 'Your quote request is on its way.' }),
      el('p', { text: 'Your request was recorded. You can return to the catalog whenever you’re ready.' }),
    ]);
  }

  function stepActions(nextLabel) {
    return el('div', { class: 'cat-quote-form-actions' }, [
      el('button', { type: 'submit', class: 'btn btn-primary cat-quote-submit', text: nextLabel }),
    ]);
  }

  function field(config) {
    const id = `cat-quote-field-${config.name}`;
    const label = config.required === true
      ? `${config.label} *`
      : config.optional === true
        ? `${config.label} (Optional)`
        : config.label;
    return el('div', { class: 'cat-quote-field' }, [
      el('label', { for: id, text: label }),
      el('input', {
        id,
        name: config.name,
        type: config.type ?? 'text',
        value: config.value ?? '',
        placeholder: config.placeholder,
        autocomplete: config.autocomplete,
        inputmode: config.inputmode,
        maxlength: config.maxlength,
        required: config.required,
        readonly: config.readonly,
        onInput: (event) => {
          if (config.name === 'firstName') state.contact.firstName = event.currentTarget.value;
          if (config.name === 'lastName') state.contact.lastName = event.currentTarget.value;
          if (config.name === 'phone') state.contact.phone = event.currentTarget.value;
          if (config.name === 'company') state.contact.company = event.currentTarget.value;
          if (config.name === 'socialMediaProfiles') state.contact.socialMediaProfiles = event.currentTarget.value;
          if (config.name === 'email') state.email = event.currentTarget.value;
          if (config.name === 'address') state.delivery.address = event.currentTarget.value;
          if (config.name === 'city') state.delivery.city = event.currentTarget.value;
          if (config.name === 'state') state.delivery.state = event.currentTarget.value;
          if (config.name === 'zipCode') state.delivery.zipCode = event.currentTarget.value;
          persistDraft();
        },
      }),
      config.help ? el('small', { text: config.help }) : null,
    ]);
  }

  function readContact(root) {
    const fields = ['firstName', 'lastName', 'phone', 'company', 'socialMediaProfiles'];
    fields.forEach((name) => {
      const input = root.querySelector(`[name="${name}"]`);
      if (input && !input.readOnly) state.contact[name] = input.value.trim();
    });
    const country = root.querySelector('[name="phoneCountry"]');
    if (country && !country.disabled) state.phoneCountry = country.value;
  }

  function readDelivery(root) {
    state.delivery.dateTime = root.querySelector('[name="dateTime"]').value;
    for (const name of ['address', 'city', 'state', 'zipCode']) {
      const input = root.querySelector(`[name="${name}"]`);
      if (input) state.delivery[name] = input.value.trim();
    }
    saveShippingDestination();
  }

  /** Keep the destination entered by a new customer available for later steps. */
  function saveShippingDestination() {
    if (!ctx.location.requiresShippingDestination) return;
    ctx.locationStore.setShippingDestination({
      city: state.delivery.city,
      state: state.delivery.state,
      zipCode: state.delivery.zipCode,
    });
  }
}
