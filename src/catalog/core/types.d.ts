/**
 * Catalog domain model.
 *
 * The runtime is plain JavaScript; these declarations exist so editors and
 * `tsc --checkJs` can verify the shapes the modules document with JSDoc.
 *
 * There is deliberately no price, stemPrice, bunchPrice, unitPrice, total,
 * subtotal, currency, pricingLocation or discount in this public model. The
 * catalog is a quote-request tool, not a store; internal price metadata used
 * to enforce the minimum order remains outside these declarations and payloads.
 */

export type ProductCategory = 'roses' | 'other-flowers' | 'foliage' | 'supplies';

export type MeasureType = 'stem' | 'bunch' | 'box' | 'unit' | 'pack';

/** Id of a location the visitor can pick in the location selector. */
export type LocationId = 'houston' | 'the-woodlands' | 'seattle' | 'dmv' | 'other';

/** The branch that will handle the request. */
export type ServiceCenter = 'HOUSTON' | 'THE_WOODLANDS' | 'SEATTLE' | 'DMV';

/**
 * Id of a product list. Several locations can share one: The Woodlands and
 * "Other U.S. location" are both served from the Houston catalog.
 */
export type CatalogSource = 'houston' | 'seattle' | 'dmv';

export interface ProductImage {
  id: string;
  src: string | null;
  alt: string;
  isPrimary?: boolean;
  isFallback?: boolean;
}

export interface ProductAttachment {
  id: string;
  name: string;
  type: string;
  size?: number | null;
  isImage: boolean;
  url: string | null;
  src?: string | null;
  alt?: string;
}

export interface ProductVariant {
  id: string;
  sourceProductId?: string | null;
  sourceProductIds?: string[];
  /** Exact task name supplied by the Fresa catalog. */
  sourceProductName?: string | null;
  /** Exact SKU supplied by the Fresa catalog for this variant. */
  sku?: string | null;

  variety?: string | null;
  color?: string | null;
  lengthCm?: number | null;

  availableMeasures?: MeasureType[];

  attributes?: Record<string, string | number | boolean>;
  images?: ProductImage[];
  files?: ProductAttachment[];
}

export interface ProductLocationData {
  /** A CatalogSource id — the product list this availability belongs to. */
  location: string;
  catalogAvailable: boolean;
  variants: ProductVariant[];
}

export interface Product {
  id: string;
  slug: string;
  name: string;

  category: ProductCategory;

  /**
   * Sub-grouping inside a category, taken from the source data's `category`
   * column: Ecuadorian Roses, Garden Roses, Dyed Roses, Other Flowers,
   * Greenery. Drives the category sidebar on the product page.
   */
  group?: string | null;
  groupLabel?: string | null;

  variety?: string | null;
  description?: string | null;

  images: ProductImage[];
  files?: ProductAttachment[];
  sourceProductIds?: string[];

  isNew: boolean;
  createdAt?: string | null;

  /** Fresa list used to classify this product when the catalog has one list. */
  listName?: string;
  position?: number;
  /** Editorial position from the printed product catalogue. */
  catalogOrder?: number;

  /** Confirmed origin only. Never inferred. */
  origin?: string | null;

  locations: ProductLocationData[];

  relatedProductIds?: string[];
}

export interface QuoteItem {
  id: string;

  productId: string;
  /** Exact Fresa task backing the selected catalog variant. */
  sourceProductId?: string | null;
  /** Exact task name backing the selected catalog variant. */
  sourceProductName?: string | null;
  /** Exact Fresa SKU backing the selected catalog variant. */
  sku?: string | null;
  productName: string;
  category: ProductCategory;

  selectedLocation: string;
  serviceCenter: string;

  variety?: string | null;
  color?: string | null;
  lengthCm?: number | null;

  measure?: MeasureType | null;
  quantity: number;
}

/** A location the visitor can select, and how it is served. */
export interface LocationConfig {
  id: LocationId;
  label: string;
  serviceCenter: ServiceCenter;
  catalogSource: CatalogSource;
  /** "Other U.S. location" asks for state, city and ZIP code. */
  requiresShippingDestination: boolean;
  note?: string | null;
}

/** Where the order ships. Separate from selectedLocation and serviceCenter. */
export interface ShippingDestination {
  state: string;
  city: string;
  zipCode: string;
}

/** The active filter selection. Empty arrays mean "no constraint". */
export interface FilterState {
  category: ProductCategory[];
  variety: string[];
  color: string[];
  lengthCm: number[];
  measure: MeasureType[];
}

/** One selectable value of a filter, with how many products it would match. */
export interface FacetOption {
  value: string | number;
  label: string;
  count: number;
  selected: boolean;
}

export interface Facet {
  id: keyof FilterState;
  label: string;
  options: FacetOption[];
}

/** The payload handed to the quote integration. Contains no pricing. */
export interface QuotePayload {
  source: string;
  selectedLocation: string;
  serviceCenter: string;
  email: string;
  vip: boolean;
  contact?: {
    firstName: string;
    lastName: string;
    phone: string;
    company: string;
  };
  products: Array<{
    productId: string;
    productName: string;
    category: ProductCategory;
    variety: string | null;
    color: string | null;
    lengthCm: number | null;
    quantity: number;
    measure: MeasureType | null;
  }>;
  orderType: string | null;
  deliveryDateTime?: string;
  deliveryTimeZone?: string;
  deliverySlot?: {
    date: string;
    start: string;
    end: string;
    capacity: number;
  };
  delivery: {
    address: string;
    city: string;
    state: string;
    zipCode: string;
    timeZone?: string;
    slot?: {
      date: string;
      start: string;
      end: string;
      capacity: number;
    };
  };
  notes: string;
}
