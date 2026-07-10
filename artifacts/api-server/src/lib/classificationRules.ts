/**
 * Small demo `classification_rules` table (item 10 of the UX/scoring spec).
 *
 * Each rule covers a handful of real HS6 anchors in the dataset that split
 * into multiple national extensions, and names the product attribute(s) that
 * actually distinguish those extensions. This is used for two things only:
 *   1. Explaining *why* an anchor is ambiguous in human terms (rather than
 *      just "N national lines exist").
 *   2. Producing `required_attributes` for the shared "Improve classification
 *      precision" panel and for the dynamic structured-details form — so the
 *      questions asked are specific to the product family, not generic
 *      boilerplate.
 *
 * This table intentionally does NOT feed into `match_confidence` — it is a
 * UX/explanation layer over the existing anchor + national-extension scoring,
 * never a second scoring path.
 */
export interface ClassificationRule {
  id: string;
  label: string;
  /** HS6 anchors this rule applies to. */
  hsAnchors: string[];
  /** Keywords used to opportunistically detect this family from free-text
   * queries, for the structured-details form's "inferred product family". */
  keywords: string[];
  /** Attributes that distinguish the national extensions under these anchors. */
  requiredAttributes: string[];
  /** Suggested answer options per attribute, for the structured-details form. */
  attributeOptions: Record<string, string[]>;
  /** One-line explanation of what the attributes are used to decide. */
  distinguishes: string;

  // --- Attribute-first hierarchical scoring taxonomy ---
  // These fields drive `product_type_match` / `function_match` /
  // `attribute_match` in the new candidate-scoring workflow. They are the
  // deterministic fallback (and a guardrail on the LLM scorer) — text
  // similarity to a broad heading's description must never outrank a
  // narrower, product-type-correct heading just because it shares more
  // words with a generic query (e.g. "stainless steel kitchen knives set"
  // sharing "stainless steel" + "kitchen" with HS 7323's household-articles
  // description, when the actual product type is a knife, HS 8211).
  /** Canonical product-type phrases this anchor family positively covers.
   * A query whose extracted `primary_product_type`/`key_attributes` matches
   * one of these earns a high `product_type_match`. */
  positiveProductTypes: string[];
  /** Canonical primary-function phrases this anchor family covers. */
  primaryFunctions: string[];
  /** Material/attribute keywords that SUPPORT classification here but must
   * never, by themselves, be enough to win product-type matching (e.g.
   * "stainless steel" alone doesn't make something a knife). */
  supportingAttributes: string[];
  /** HS6 anchors belonging to OTHER rules that this rule's product type
   * conflicts with/excludes — e.g. a knife is explicitly excluded from the
   * generic "household articles of base metal" heading. Used to force a
   * confidence cap/exclusion on the excluded anchor when this rule's
   * product type is the one actually detected in the query. */
  exclusions: string[];
}

export const CLASSIFICATION_RULES: ClassificationRule[] = [
  {
    id: "audio-headsets",
    label: "Headphones & earphones",
    hsAnchors: ["851830"],
    keywords: ["headphone", "earphone", "earbud", "headset"],
    requiredAttributes: ["connection type"],
    attributeOptions: { "connection type": ["wired", "wireless / Bluetooth"] },
    distinguishes:
      "Indonesia splits this heading by connection type: wired vs. wireless/Bluetooth are separate national tariff lines.",
    positiveProductTypes: ["headphones", "earphones", "earbuds", "headset"],
    primaryFunctions: ["audio listening", "audio playback"],
    supportingAttributes: ["wired", "wireless", "bluetooth", "microphone"],
    exclusions: [],
  },
  {
    id: "knit-apparel",
    label: "Knitted cotton apparel",
    hsAnchors: ["610910", "610462", "620342"],
    keywords: ["t-shirt", "tshirt", "shirt", "trousers", "shorts", "apparel", "garment", "clothing"],
    requiredAttributes: ["intended wearer", "fibre composition"],
    attributeOptions: {
      "intended wearer": ["men or boys", "women or girls", "unisex"],
      "fibre composition": ["100% cotton", "cotton blend", "synthetic"],
    },
    distinguishes:
      "China splits several knitted-apparel headings by intended wearer (men/boys vs. women/girls); fibre composition also affects which HS6 heading applies at all.",
    positiveProductTypes: ["t-shirt", "shirt", "trousers", "shorts", "garment", "apparel"],
    primaryFunctions: ["clothing/wear"],
    supportingAttributes: ["cotton", "synthetic", "knit"],
    exclusions: [],
  },
  {
    id: "household-plastics",
    label: "Household plastic articles",
    hsAnchors: ["392690"],
    keywords: ["plastic", "container", "household item", "storage"],
    requiredAttributes: ["intended use", "set or single item"],
    attributeOptions: {
      "intended use": ["household/kitchen use", "industrial/technical use", "packaging"],
      "set or single item": ["single item", "set of assorted articles"],
    },
    distinguishes:
      "Indonesia splits \"other articles of plastics\" by intended use — household items are classified separately from technical/industrial plastic articles.",
    positiveProductTypes: ["plastic container", "plastic household article", "storage box"],
    primaryFunctions: ["household storage", "food storage"],
    supportingAttributes: ["plastic", "household", "storage"],
    exclusions: [],
  },
  {
    id: "milled-rice",
    label: "Milled rice",
    hsAnchors: ["100630"],
    keywords: ["rice"],
    requiredAttributes: ["quota status"],
    attributeOptions: { "quota status": ["within tariff-rate quota", "outside quota (MFN)"] },
    distinguishes:
      "Indonesia's rice tariff line depends on whether the shipment falls within the announced tariff-rate quota (TRQ) or is imported outside it at the MFN rate.",
    positiveProductTypes: ["rice", "milled rice"],
    primaryFunctions: ["food/staple grain"],
    supportingAttributes: ["quota", "mfn"],
    exclusions: [],
  },
  {
    id: "cutlery-hand-tools",
    label: "Cutlery & hand tools",
    hsAnchors: ["820712", "821110", "821191"],
    keywords: ["knife", "knives", "cutlery", "hand tool", "blade"],
    requiredAttributes: ["material", "set or single item", "intended use"],
    attributeOptions: {
      material: ["stainless steel", "carbon steel", "other/mixed material"],
      "set or single item": ["single item", "boxed set"],
      "intended use": ["kitchen/table use", "industrial/interchangeable tool", "other"],
    },
    distinguishes:
      "Cutlery and hand-tool headings diverge by blade material, whether the item is sold as a set, and whether it's a kitchen article vs. an interchangeable tool component.",
    // Product type/function must dominate here: a knife stays HS 8211 (or
    // 8207/8211.10 subheadings) regardless of blade material or whether it's
    // boxed as a set — it must never lose to the generic "household articles
    // of base metal" heading (7323) just because both descriptions mention
    // "stainless steel" and "kitchen".
    positiveProductTypes: ["knife", "knives", "knife set", "cutlery", "hand tool", "blade"],
    primaryFunctions: ["cutting", "food preparation", "interchangeable tool component"],
    supportingAttributes: ["stainless steel", "carbon steel", "boxed set"],
    exclusions: ["732393"],
  },
  {
    id: "household-base-metal-articles",
    label: "Household articles of base metal (non-cutlery)",
    hsAnchors: ["732393"],
    keywords: ["household article", "tableware", "kitchenware", "cookware", "housewares"],
    requiredAttributes: ["material", "set or single item"],
    attributeOptions: {
      material: ["stainless steel", "iron/steel (non-stainless)", "other/mixed material"],
      "set or single item": ["single item", "boxed set"],
    },
    distinguishes:
      "\"Table, kitchen or other household articles of stainless steel\" (7323) is a generic base-metal-article heading — it must yield to a more specific product-type heading (e.g. knives, 8211) whenever the item's primary function is that of the more specific article, not just generic tableware/housewares.",
    // Deliberately generic and function-light: this heading covers items
    // whose primary function IS being a generic household/kitchen article
    // (bowls, pots, trays, jars) — not items with a more specific dominant
    // function such as cutting (knives) that happen to share the same
    // material and setting.
    positiveProductTypes: ["bowl", "pot", "pan", "tray", "jar", "household article", "kitchenware"],
    primaryFunctions: ["general household use", "food storage", "serving"],
    supportingAttributes: ["stainless steel", "kitchen", "boxed set"],
    exclusions: [],
  },
];

export function findRuleForAnchor(hsAnchor: string | null): ClassificationRule | null {
  if (!hsAnchor) return null;
  return CLASSIFICATION_RULES.find((rule) => rule.hsAnchors.includes(hsAnchor)) ?? null;
}

export function detectRuleFromQuery(query: string): ClassificationRule | null {
  const lower = query.toLowerCase();
  return (
    CLASSIFICATION_RULES.find((rule) => rule.keywords.some((kw) => lower.includes(kw))) ?? null
  );
}
