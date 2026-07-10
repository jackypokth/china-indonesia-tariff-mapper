---
name: Tariff confidence engine
description: How match_confidence is computed for the China-Indonesia tariff mapper, and how the exclusion/cap rule and GPT wording layer interact with it.
---

`match_confidence` uses an attribute-first, hierarchical formula (superseding an earlier text-similarity-dominant version):

`0.40*product_type_match + 0.25*function_match + 0.15*attribute_match + 0.10*text_semantic_similarity + 0.10*national_extension_specificity`

**Why:** raw text overlap let broad/generic headings (e.g. "household articles of stainless steel") outrank narrower, correct headings (e.g. "kitchen knives") just by sharing material/use words. Product type and function must dominate.

**How to apply:** `product_type_match`/`function_match`/`attribute_match` come from cross-referencing an LLM-extracted "product facts" object against each `ClassificationRule`'s taxonomy fields (`positiveProductTypes`, `primaryFunctions`, `supportingAttributes`, `exclusions`), with a deterministic keyword-based fallback when the LLM is unavailable. A candidate whose product type conflicts with an `exclusions` entry on another matched rule is either hard-excluded (never shown) or capped at confidence ≤0.39 — this cap/exclusion is computed server-side and cannot be bypassed by LLM scoring output.

GPT is used only as a **wording layer**: it phrases a backend-built, evidence-only object into `explanation`/`ambiguity_note`/`tariff_commentary` text for the top-5 matches. It never sets confidence/label/status. Validation rejects invented codes, prohibited certainty words, and any percentage claim that isn't null-tariff-safe or doesn't match the exact sourced rate; falls back to a deterministic template on failure. All OpenAI calls in this pipeline use an explicit request timeout (8s) so a slow upstream call can't stall a search — always add `{ timeout }` as the second arg to `openai.chat.completions.create` for latency-sensitive request paths.
