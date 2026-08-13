# Product catalog

The catalog lives at `/catalog` and `/catalog/<category>/<slug>`. It is a
quote-request tool, not a store: it never shows, stores or transmits a price.

The landing page is untouched apart from three things — a link to the shared
stylesheet, the header/overlay/footer moving into shared partials, and the
"View catalog" button now pointing at `/catalog`.

---

## Contents

1. [Architecture](#architecture)
2. [Files](#files)
3. [Data model](#data-model)
4. [Where the data comes from](#where-the-data-comes-from)
5. [How to…](#how-to)
6. [The quote flows](#the-quote-flows)
7. [Known data issues](#known-data-issues)
8. [Commands](#commands)

---

## Architecture

Same stack as the rest of the site: Vite, plain ES modules, no framework and no
new runtime dependencies. Both catalog routes are served from one HTML entry
and rendered on the client.

```
catalog.html                     one entry for both routes
  └─ src/catalog/main.js
       └─ app.js                 shared state + the flows that cross views
            ├─ catalog-page.js   the /catalog list view
            └─ product-page.js   the product view
```

**State.** Three stores, each with one job:

| Store | Holds | Persisted in |
|---|---|---|
| `location-store.js` | selected location, shipping destination | URL + `localStorage` for the non-personal selection; `sessionStorage` for the destination |
| filters (in `app.js`) | the active facet selection | URL |
| `quote-store.js` | the selected products | `localStorage` |

Resolution order for the location is URL → last stored choice → default, so a
shared link always shows what it promises.

**Rendering** is a full re-render of the view body on every change. The catalog
is a few hundred nodes; this keeps the state model honest and there is no
diffing to reason about.

**Three separate ideas** that are easy to conflate and are kept apart
everywhere, including in the payload:

- `selectedLocation` — what the visitor picked; decides which catalog shows.
- `serviceCenter` — the branch that handles the request.
- `shippingDestination` — the customer's own state, city and ZIP code.

"Other U.S. location" is served by Houston and shows the Houston catalog, but it
is not Houston, and it asks where the order would ship.

---

## Files

### Added

| Path | What it is |
|---|---|
| `catalog.html` | Page shell for both catalog routes |
| `src/styles/base.css` | Tokens and shared primitives, extracted from the Home page |
| `src/partials/{header,overlay,footer}.html` | Shared chrome, included by both pages |
| `src/catalog/main.js` | Entry point |
| `src/catalog/app.js` | Controller: state and cross-view flows |
| `src/catalog/catalog-page.js` | The list view |
| `src/catalog/product-page.js` | The product view |
| `src/catalog/catalog.css` | Catalog styles, built on the shared tokens |
| `src/catalog/core/types.d.ts` | The domain model |
| `src/catalog/core/repository.js` | Product loading and queries |
| `src/catalog/core/fresa-catalog.js` | Build-time Fresa fetch, pagination and normalization |
| `src/catalog/core/facets.js` | Filtering and facet computation |
| `src/catalog/core/quote-store.js` | The quote list and its validation |
| `src/catalog/core/location-store.js` | Selected location and destination |
| `src/catalog/core/url-state.js` | State ⇄ URL |
| `src/catalog/core/quote-payload.js` | Payload construction |
| `src/catalog/core/quote-integration.js` | `quoteIntegrationService` |
| `src/catalog/core/fresa-mapping.js` | Catalog → Fresa form vocabulary |
| `src/catalog/core/{store,storage,format,slug}.js` | Small shared utilities |
| `src/catalog/data/locations.js` | `locationServiceMap` and friends |
| `src/catalog/data/advisors.js` | Location → portrait shown on the quote screen |
| `src/catalog/data/categories.js` | Category configuration |
| `src/catalog/data/product-overrides.js` | Editorial layer (New, copy, images) |
| `src/catalog/data/products.generated.json` | Legacy offline fixture; not used at runtime |
| `src/catalog/data/fresa-form.js` | The quote form's captured vocabulary |
| `src/catalog/data/fresa-product-aliases.js` | Per-product form naming rules |
| `src/catalog/data/quote-config.js` | Form URL and session endpoint |
| `src/catalog/ui/*.js` | Components: cards, filters, modals, quote summary, … |
| `scripts/build-catalog-data.mjs` | Workbooks → seed data |
| `scripts/catalog-source.config.mjs` | How source rows are interpreted |
| `scripts/lib/xlsx-reader.mjs` | Minimal `.xlsx` reader (Node built-ins only) |
| `scripts/check-fresa-map.mjs` | Verifies every product maps to a form option |
| `scripts/vite-plugin-html-partials.mjs` | `<!--#include name-->` support |
| `tests/*.test.mjs` | Automated unit and integration tests with `node --test` |

### Modified

| Path | Change |
|---|---|
| `index.html` | Links `base.css`; header/overlay/footer replaced by includes; the shared CSS block removed; FAB points at `/catalog`. **No design or content change** — verified by comparing computed styles and layout for 55 elements before and after. |
| `vite.config.js` | Multi-page build, partials plugin, dev rewrites for `/catalog/**` |
| `firebase.json` | Rewrites `/catalog` and `/catalog/**` to `catalog.html` before the catch-all |
| `package.json` | `build:catalog-data`, `check:fresa-map`, `test` |
| `.gitignore` | Source workbooks stay out of the repository |

---

## Data model

Defined in `src/catalog/core/types.d.ts`. The shapes match the agreed
interfaces: `Product`, `ProductVariant`, `ProductLocationData`, `ProductImage`,
`QuoteItem`, plus `LocationConfig`, `FilterState` and `QuotePayload`.

Two additions worth knowing about:

- `Product.group` / `groupLabel` — the sub-grouping inside a category
  (Ecuadorian Roses, Garden Roses, Dyed Roses, Greenery…), taken from the source
  data. It drives the category sidebar.
- `ProductVariant.attributes` — for facts that are neither variety, colour nor
  length: `{ stemsPerBunch: 20 }`, `{ origin: 'Canada' }`.

**There is no price field anywhere**, and there are three separate guards
against one appearing:

1. `scripts/catalog-source.config.mjs` reads a strict allow-list of columns, so
   pricing never enters the pipeline.
2. `build-catalog-data.mjs` refuses to write output containing a monetary field
   or a currency amount.
3. `assertNoPricing()` re-checks the payload before it leaves the browser.

A missing attribute is `null`. It is never `""`, `"N/A"` or `"—"`, and the UI
hides the corresponding row and filter rather than showing a placeholder.

---

## Where the data comes from

The browser fetches the checked-in, price-free snapshot:

```text
GET /data/catalog-snapshot.json
```

`npm run snapshot:catalog` is the only step that calls Fresa. It uses the
private `FRESA_CATALOG_API_URL` and `FRESA_CATALOG_API_KEY` from local
environment variables, follows pagination, removes non-approved fields and
prices, and writes the result to `public/data/catalog-snapshot.json`. Those
credentials never enter `dist/`, and production has no catalog proxy or
database to operate.

The generator follows `page.nextOffset` while `hasMore` is true and deduplicates
pages by record id. Fresa may return the products as `catalog.products` or as
top-level `records`; both are normalized to the same internal model. Custom
values are read only through the matching descriptors in `columns[].key` (or
`catalog.columns[].key` in the wrapped response), and the product taxonomy is
validated before the snapshot is written.

Categories come from an authorized Fresa category column or, when the catalog
uses lists as categories, from `listName`:

| Source | Catalog category |
|---|---|
| `Roses` | `roses` |
| `Other Flowers` | `other-flowers` |
| `Greenery` | `foliage` |
| — | `supplies` (no data yet; the category presents itself and offers a CTA) |

The interface keeps the current category presentation and never invents a
missing category. If a new grouping is needed, authorize the corresponding
column or list in Fresa. The snapshot generator also rejects a response that
looks like an unrelated client directory before writing it.

---

## How to…

### Add a product

Products come from Fresa, so the normal route is:

1. Publish or update the product in the authorized Fresa catalog.
2. Run `npm run snapshot:catalog` locally.
3. Run `npm test` and `npm run build`.

The legacy workbook generation scripts are not used by the landing runtime.

If the product needs a photo or file, attach it in Fresa. The landing uses its
temporary `attachment.url` directly. When a product has no usable Fresa image,
the local photography imported into `public/assets/images/flowers-fallback/`
is used by variety where there is an exact match, or by the closest rose
family when Fresa does not expose enough detail; a product with at least one
usable Fresa image never mixes in local fallback photography.

### Modify a location

Everything about locations is in `src/catalog/data/locations.js`. To change a
label, a service centre, or which catalog a location shows, edit its entry:

```js
{
  id: 'the-woodlands',
  label: 'The Woodlands, TX',
  serviceCenter: 'THE_WOODLANDS',   // who handles the request
  catalogSource: 'houston',          // which product list to show
  requiresShippingDestination: false,
  note: 'Served from the Texas product list.',
}
```

To add a location, add an entry here, add its product list to `SOURCE_FILES` in
`scripts/catalog-source.config.mjs` if it has its own, and add its option name to
`locationOptions` in `src/catalog/data/fresa-form.js`. Nothing else hard-codes a
location.

### Add a variant, a colour or a stem length

All three are the same thing: a row in the workbook. A variant is the
combination of variety, colour and length; adding a row with a new colour adds
that colour, and the Color filter picks it up automatically because facets are
computed from the data.

Then `npm run build:catalog-data`.

Filters need no configuration: a facet appears when the current results offer
more than one value for it, and disappears when they do not.

### Mark a product as New

`isNew` is data, never computed in the interface. Set it in
`src/catalog/data/product-overrides.js`:

```js
export const PRODUCT_OVERRIDES = {
  'garden-roses': { isNew: true, createdAt: '2026-08-01' },
};
```

The same file holds descriptions, confirmed origin, extra photography and
curated related products. It is merged on top of the generated data at load
time, so regenerating the seed never wipes editorial content.

### Change the Fresa form

`src/catalog/data/quote-config.js`:

```js
export const QUOTE_FORM_URL = 'https://fresaai.app/f/<new-form-id>';
```

If the new form has a different product list, re-capture its vocabulary into
`src/catalog/data/fresa-form.js` (`locationOptions` and `productOptions` per
catalog source), then run `npm run check:fresa-map` to see what no longer maps.

### Product prefill and client lookup

These features are intentionally disabled in the basic-plan deployment. The
visitor enters contact details in the quote form; no active-client directory,
custom session endpoint, or profile database is queried.

---

## The quote flows

### Without products

The site-wide "Request a quote" buttons, and "Request product availability" in
the empty state, open the internal quote screen at `/catalog/quote`. The screen
starts with the email step and then walks the visitor through contact details,
products, order type, delivery and notes.

One step is on screen at a time, centered, with only the way back to the
catalog and the progress dots around it. Above each step is the portrait of the
team that will receive the request: it comes from the selected location through
`data/advisors.js`, large on the email step and small afterwards. The files
there are illustrated placeholders — dropping real square photography at the
same paths is the whole change.

### With products

The left checkout panel keeps the selected products visible. Its "Continue to
quote form" action opens the internal multi-step screen instead of a modal. The
flow validates every line against the current catalog, asks for the visitor's
email first, and then builds the payload and hands it to
`quoteIntegrationService`. A new or unrecognized email is still allowed to
continue so it can request a quote. The same screen is used by the quote CTA
when no products were selected.

The basic-plan flow does not query an active-client source. The visitor enters
their contact details directly and the completed payload is submitted through
the public Fresa form API. Personal data stays in the current tab draft until
the visitor sends the request; there is no custom session endpoint or profile
database.

The payload keeps the catalog's own representation **and** a `fresa` block
holding the same request in the form's terms:

```json
{
  "source": "esfenix-product-catalog",
  "selectedLocation": "SEATTLE",
  "serviceCenter": "SEATTLE",
  "email": "",
  "products": [ { "productId": "sunflowers", "quantity": 5, "measure": "bunch", … } ],
  "orderType": null,
  "delivery": { "address": "", "city": "", "state": "", "zipCode": "" },
  "notes": "",
  "fresa": {
    "location": "WA - SEATTLE",
    "products": [ { "product": "Sunflowers", "quantity": 5 } ],
    "notes": "Selected from the Esfenix online catalog — Seattle, WA. …",
    "unmappedProducts": []
  }
}
```

**Why the two representations differ.** The form's product rows are
`{Producto, Quantity}` only — there is no colour, variety, measure or length
field. Length and colour are folded into the option label
(`Ecuadorian Roses - 60cm`, `Peony - white`). So:

- Lines that resolve to the same option are merged and their quantities summed.
- Everything the form cannot express — variety, colour, measure — is written
  into "Notes for the seller" instead of being dropped.
- Any product the form has no option for is listed in the notes and reported in
  `unmappedProducts`.

**Field mapping**

| Form step | Field | Source |
|---|---|---|
| 1 Email | Email | the visitor enters it first |
| 2 Contact | First/Last name, Phone, Company | entered by the visitor |
| 3 Products | Location, Producto / Quantity | `fresa.location`, `fresa.products[]` |
| 4 Type of Order | Type of Order | the visitor chooses |
| 5 Delivery | Date/time, Address, City, State, ZIP | `fresa.delivery` |
| 6 Other | Notes for the seller | `fresa.notes` |

**Privacy.** Email, address, ZIP code and the product list travel in the POST
body to Fresa, never in a query string. No application database stores the
request.

**On failure** the selection is never discarded: the quote summary stays open,
shows *"We couldn't open the quote form. Please try again."*, and offers Retry
and a copyable plain-text summary.

### Delivery windows

Delivery dates and two-hour windows are local preferences only. The catalog does
not reserve slots or show persistent capacity. The team confirms availability,
minimum order and the final delivery time after reviewing the request, so this
flow does not require Firestore, Authentication or another backend.

---

## Known data issues

Found while building, worth fixing at the source. None of them break the
catalog.

1. **Seattle hydrangeas — blue vs shocking.** The accounting export lists a
   `Blue` hydrangea for Seattle; the Seattle price list and the Fresa form both
   offer `shocking` and no blue. The catalog shows what the database says, and
   that line is the one product that does not map to a form option. Deciding
   which source is right resolves it.

2. **Duplicated hydrangea rows.** Each colour appears twice per location —
   `Hydrangeas Premium - blue` and `Hydrangeas  blue`. Both price lists and the
   form only carry the Premium line, so the build treats them as the same
   product and reports the collapse. Removing the legacy rows would make the
   export unambiguous.

3. **21 inactive Garden Roses rows** in the Seattle workbook (Cavana, Coqueta,
   Victoria Park and others) are missing `location`, `size_cm` and `sales_unit`.
   They are skipped and listed in the extraction report.

4. **Spelling drift between exports** — `Ranunculos`/`Ranunculus`,
   `Chrysanthemum - Daysi`/`Daisy`, `Shinny Pitt`/`Shiny Pitt Green`. Reconciled
   by `FAMILY_ALIASES` so they do not become duplicate products.

5. **`Bells of Irland`** is spelled that way in every source. Left as-is; worth
   a decision.

6. **Seed photography is incomplete.** The runtime first uses Fresa
   attachments, then the local variety-matched fallback under
   `public/assets/images/flowers-fallback/`; products with neither source keep
   the neutral placeholder.

7. **The Woodlands has no separate product list.** It is served from the Texas
   export while keeping its own service centre, which matches the Fresa form
   (Houston, The Woodlands and NATION WIDE all offer the same 67 products).

---

## Commands

```bash
npm run dev                  # dev server, /catalog works
npm run build                # production build
npm run build:catalog-data   # regenerate seed data from data/sources/*.xlsx
npm run snapshot:catalog     # refresh public/data/catalog-snapshot.json locally
npm run check:fresa-map      # verify every product maps to a form option
npm test                     # unit and integration tests
```
