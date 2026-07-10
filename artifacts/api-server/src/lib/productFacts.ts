/**
 * Structured product-fact extraction (attribute-first scoring workflow,
 * step 1). The LLM is used ONLY to pull structured facts out of a free-text
 * description query — it never assigns an HS code, a confidence score, or a
 * tariff rate here. Those are computed downstream from these facts by
 * deterministic backend logic + the candidate scorer.
 */
import { openai } from "@workspace/integrations-openai-ai-server";

export interface ProductFacts {
  primary_product_type: string;
  primary_function: string;
  materials: string[];
  intended_use: string;
  is_retail_set: boolean;
  key_attributes: string[];
  uncertain_attributes: string[];
}

const EMPTY_FACTS: ProductFacts = {
  primary_product_type: "",
  primary_function: "",
  materials: [],
  intended_use: "",
  is_retail_set: false,
  key_attributes: [],
  uncertain_attributes: [],
};

const KNOWN_MATERIALS = [
  "stainless steel",
  "carbon steel",
  "steel",
  "aluminum",
  "aluminium",
  "plastic",
  "cotton",
  "wood",
  "wooden",
  "ceramic",
  "glass",
  "leather",
  "rubber",
];

/** Deterministic, LLM-free heuristic fact extraction — used as a fallback
 * when the LLM call is unavailable/fails, so the feature keeps working. */
function heuristicFacts(query: string): ProductFacts {
  const lower = query.toLowerCase();
  const materials = KNOWN_MATERIALS.filter((m) => lower.includes(m));
  const is_retail_set = /\bset\b|\bsets\b/.test(lower);
  // Naive product-type guess: the last noun-ish token, stripped of material
  // and set words — good enough as a last-resort fallback, not a scoring
  // authority (the deterministic taxonomy match in candidateScorer.ts does
  // the real work when this heuristic can't produce a confident answer).
  const words = lower
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !KNOWN_MATERIALS.includes(w) && w !== "set" && w !== "sets");
  const primary_product_type = words.length > 0 ? words[words.length - 1] : "";
  return {
    ...EMPTY_FACTS,
    primary_product_type,
    materials,
    is_retail_set,
    key_attributes: materials,
    uncertain_attributes: [],
  };
}

/**
 * Extract structured product facts from a free-text query via the LLM,
 * constrained to strict JSON. Falls back to a deterministic heuristic on any
 * failure (network error, malformed JSON) so the pipeline never blocks on
 * this step.
 */
export async function extractProductFacts(query: string): Promise<ProductFacts> {
  try {
    const response = await openai.chat.completions.create(
      {
        model: "gpt-5-mini",
        max_completion_tokens: 400,
        messages: [
          {
            role: "system",
            content:
              "You extract structured product facts from a trade-product description for downstream HS " +
              "classification. You do NOT classify the product or assign any code, rate, or confidence. " +
              "Return strict JSON only, with this exact shape: " +
              '{"primary_product_type": "<the core item, e.g. \'knife\'>", ' +
              '"primary_function": "<its main function, e.g. \'cutting\'>", ' +
              '"materials": ["<material keywords>"], ' +
              '"intended_use": "<short phrase, e.g. \'kitchen use\'>", ' +
              '"is_retail_set": <true|false>, ' +
              '"key_attributes": ["<other distinguishing attributes>"], ' +
              '"uncertain_attributes": ["<attributes the text does not make clear>"]}. ' +
              "Do not include any text outside the JSON object.",
          },
          { role: "user", content: `Product description: "${query}"` },
        ],
      },
      // Force the deterministic heuristicFacts() fallback (caught below)
      // rather than letting a slow upstream call stall the search request.
      { timeout: 8000 },
    );
    const raw = response.choices[0]?.message?.content ?? "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return heuristicFacts(query);
    const parsed = JSON.parse(jsonMatch[0]) as Partial<ProductFacts>;
    return {
      primary_product_type: String(parsed.primary_product_type ?? "").toLowerCase(),
      primary_function: String(parsed.primary_function ?? "").toLowerCase(),
      materials: Array.isArray(parsed.materials) ? parsed.materials.map((m) => String(m).toLowerCase()) : [],
      intended_use: String(parsed.intended_use ?? "").toLowerCase(),
      is_retail_set: Boolean(parsed.is_retail_set),
      key_attributes: Array.isArray(parsed.key_attributes)
        ? parsed.key_attributes.map((a) => String(a).toLowerCase())
        : [],
      uncertain_attributes: Array.isArray(parsed.uncertain_attributes)
        ? parsed.uncertain_attributes.map((a) => String(a).toLowerCase())
        : [],
    };
  } catch {
    return heuristicFacts(query);
  }
}
