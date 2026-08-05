/**
 * Vocabulary of the Fresa quote form, captured from the live form on
 * 2026-07-31 so the catalog can hand it values it recognises.
 *
 * The form has no colour, variety, length or measure field: length and colour
 * are folded into the product label, and the product list differs per
 * location (Houston, The Woodlands and NATION WIDE share one list; Seattle and
 * DMV have their own, with their own spellings).
 *
 * A JS module rather than JSON so Node and Vite load it the same way.
 * Re-capture it when Esfenix edits the form — see docs/catalog.md.
 */
export const FRESA_FORM = {
  "note": "Vocabulary of the Fresa quote form, captured from the live form so the catalog can hand it values it recognises. Regenerate by re-reading the form if Esfenix changes it; see docs/catalog.md.",
  "formUrl": "https://fresaai.app/f/0578f97716840e34cf5472d5",
  "capturedAt": "2026-07-31",
  "fields": {
    "step1": [
      "Email",
      "First Name",
      "Last Name",
      "Phone Number"
    ],
    "step2": [
      "Ubicacion",
      "Products <location>: Producto",
      "Products <location>: Quantity"
    ],
    "step3": [
      "Type of Order"
    ],
    "step4": [
      "Address",
      "City",
      "State",
      "Zip Code"
    ],
    "step5": [
      "Notes for the seller"
    ]
  },
  "locationOptions": {
    "houston": "TX - HOUSTON",
    "the-woodlands": "TX - THE WOODLANDS",
    "seattle": "WA - SEATTLE",
    "dmv": "DMV",
    "other": "NATION WIDE"
  },
  "productOptions": {
    "houston": [
      "Ecuadorian Roses - 50cm",
      "Ecuadorian Roses - 60cm",
      "Ecuadorian Roses - 70cm",
      "Ecuadorian Roses - 80cm",
      "Ecuadorian Roses - 90cm",
      "Ecuadorian Roses - 100cm",
      "Dyed Roses - 60cm",
      "Garden Roses - 40cm",
      "Garden Roses - 50cm",
      "Garden Roses - 60cm",
      "Cocculus",
      "Dusty Miller",
      "Eucalyptus Baby Blue",
      "Eucalyptus Silver Dollar",
      "Leather leaf (10 stems)",
      "Leather leaf - (20 stems)",
      "Robellini",
      "Ruscus",
      "Shinny Pitt",
      "Alstroemerias",
      "Amaranthus",
      "Ammi Visnaga",
      "Anemones",
      "Bells of Irland (molucella)",
      "Bird of Paradise",
      "Carnation",
      "Campanula",
      "Chrysanthemum - Cremom",
      "Chrysanthemum - Cushion",
      "Chrysanthemum - Button",
      "Chrysanthemum - Daysi",
      "Chrysanthemum - Spider",
      "Craspedias",
      "Delphinium",
      "Dianthus",
      "Gerbera Large",
      "Mini Gerbera",
      "Gerpoms",
      "Gypsophilia Xcelence (Baby's breath)",
      "Hydrangeas Premium - white",
      "Hydrangeas Premium - green",
      "Hydrangeas Premium - blue",
      "Hydrangeas Premium - purple/lavender",
      "Hydrangeas Premium - pink",
      "Hypericum",
      "Lily Asiatic",
      "Lily Oriental",
      "Limonium",
      "Lisianthus (linea 1)",
      "Lisianthus (linea 2)",
      "Mini Callas",
      "Mini Carnation",
      "Ranunculus",
      "Scabiosa",
      "Snapdragon (linea 1)",
      "Snapdragon (linea 2)",
      "Solidago golden glory",
      "Spray Roses",
      "Statice",
      "Stock",
      "Sunflowers",
      "Peony - white",
      "Peony - other colors",
      "Preserved rose Large",
      "Preserved rose Jumbo",
      "Tulip - white",
      "Tulip - other colors"
    ],
    "seattle": [
      "Ecuadorian Roses - 50cm",
      "Ecuadorian Roses - 60cm",
      "Ecuadorian Roses - 70cm",
      "Ecuadorian Roses - 80cm",
      "Ecuadorian Roses - 90cm",
      "Dyed Roses - 60cm",
      "Garden Roses - 40cm",
      "Garden Roses - 50cm",
      "Garden Roses - 60cm",
      "Alstroemerias",
      "Chrysanthemum - Cremom",
      "Chrysanthemum - Cushion",
      "Chrysanthemum - Button",
      "Chrysanthemum - Daisy",
      "Chrysanthemum - Spider",
      "Carnation",
      "Campanula",
      "Delphinium",
      "Gypsophilia Xcelence (Baby's breath)",
      "Hydrangeas Premium - green",
      "Hydrangeas Premium - pink",
      "Hydrangeas Premium - purple",
      "Hydrangeas Premium - shocking",
      "Hydrangeas Premium - white",
      "Lily Asiatic",
      "Lily Oriental",
      "Lisianthus",
      "Solidago",
      "Spray Roses",
      "Snapdragon",
      "Stock",
      "Sunflowers",
      "Ranunculus",
      "Eucalyptus Baby Blue",
      "Eucalyptus Silver Dollar",
      "Leather Leaf",
      "Ruscus",
      "Shiny Pitt Green (Brillantina)"
    ],
    "dmv": [
      "Ecuadorian Roses - 50cm",
      "Ecuadorian Roses - 60cm",
      "Ecuadorian Roses - 70cm",
      "Ecuadorian Roses - 80cm",
      "Carnation",
      "Gypsophilia Xlence (Baby's breath)",
      "Solidago",
      "Spray Roses",
      "Stock",
      "Sunflowers"
    ]
  }
};

export default FRESA_FORM;
