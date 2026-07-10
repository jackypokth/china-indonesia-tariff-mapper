/**
 * Attribute-first candidate scoring (workflow steps 3-6).
 *
 * Given the extracted ProductFacts and a shortlist of 5-10 retrieved HS6
 * candidates, produce, PER CANDIDATE:
 *   product_type_match, function_match, attribute_match,
 *   text_semantic_similarity, conflicts[], rationale
 *
 * The LLM is asked to score the supplied candidates ONLY — it cannot invent
 * a candidate outside the list. Its numeric scores are informative, but the
 * exclusion/cap rule (step 5) and the deterministic taxonomy fallback (used
 * whenever the LLM is unavailable, fails, or a candidate has no taxonomy
 * coverage) are computed in this module too, so a hallucinated or overly
 * generous LLM score can never bypass an explicit product-type exclusion.
 */
import { openai } from "@workspace/integrations-openai-ai-server";
import type { ProductFacts } from "./productFacts";
import { CLASSIFICATION_RULES, findRuleForAnchor, type ClassificationRule } from "./classificationRules";

export interface ScoredCandidate {
  hsAnchor: string;
  description: string;
  product_type_match: number;
  function_match: number;
  attribute_match: number;
  text_semantic_similarity: number;
  conflicts: string[];
  rationale: string;
  /** True when this candidate is excluded outright (never shown), as
   * opposed to merely capped at <=0.39. Set only by the deterministic
   * exclusion rule, never by the LLM. */
  excluded: boolean;
}

function phraseHit(text: string, phrases: string[]): boolean {
  const lower = text.toLowerCase();
  return phrases.some((p) => lower.includes(p.toLowerCase()));
}

function textSimilarity(a: string, b: string): number {
  const tokensA = new Set(a.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2));
  const tokensB = new Set(b.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const t of tokensA) if (tokensB.has(t)) intersection += 1;
  const union = tokensA.size + tokensB.size - intersection;
  return union <= 0 ? 0 : intersection / union;
}

/** Facts text used for product-type/function matching: the structured
 * fields the LLM extracted, joined — not the raw query — so scoring is
 * attribute-first rather than full-text-first. */
function factsSignalText(facts: ProductFacts): string {
  return [facts.primary_product_type, facts.primary_function, ...facts.key_attributes, facts.intended_use].join(" ");
}

/**
 * Deterministic taxonomy-based score for one candidate. Used as the
 * fallback when the LLM is unavailable, and as the source of truth for the
 * exclusion rule regardless of what the LLM said.
 */
function taxonomyScore(
  facts: ProductFacts,
  rawQuery: string,
  candidate: { hsAnchor: string; description: string },
): ScoredCandidate {
  const rule = findRuleForAnchor(candidate.hsAnchor);
  const signalText = `${rawQuery} ${factsSignalText(facts)}`;
  const text_semantic_similarity = textSimilarity(rawQuery, candidate.description);
  const conflicts: string[] = [];

  if (!rule) {
    // No taxonomy coverage for this anchor — fall back to a text-similarity
    // derived, deliberately capped estimate. Never allow an uncovered
    // anchor to look more certain on product-type/function than a covered,
    // taxonomy-matched one with real evidence.
    const capped = Math.min(0.6, text_semantic_similarity);
    return {
      hsAnchor: candidate.hsAnchor,
      description: candidate.description,
      product_type_match: capped,
      function_match: capped,
      attribute_match: capped,
      text_semantic_similarity,
      conflicts,
      rationale: "No classification-rule taxonomy coverage for this heading; score derived from text similarity only.",
      excluded: false,
    };
  }

  const product_type_match = phraseHit(signalText, rule.positiveProductTypes) ? 1 : 0.3;
  // Function is rarely stated literally in a short product description
  // ("knives" implies "cutting" without saying so) — when the product type
  // itself is a confident match for this family, treat function as
  // substantially (not fully) corroborated rather than falling back to the
  // same low default used for a genuinely uncertain product type.
  const function_match = phraseHit(signalText, rule.primaryFunctions)
    ? 1
    : product_type_match >= 0.9
      ? 0.6
      : 0.3;
  const matchedAttrs = rule.supportingAttributes.filter((a) => signalText.toLowerCase().includes(a.toLowerCase()));
  const attribute_match = rule.supportingAttributes.length === 0
    ? 0.5
    : Math.min(1, matchedAttrs.length / rule.supportingAttributes.length + 0.2);

  // Exclusion/cap rule (step 5): does another rule whose product type/function
  // IS detected in the query explicitly exclude this candidate's anchor?
  let excluded = false;
  for (const otherRule of CLASSIFICATION_RULES) {
    if (otherRule.id === rule.id) continue;
    if (!otherRule.exclusions.includes(candidate.hsAnchor)) continue;
    const otherTypeHit = phraseHit(signalText, otherRule.positiveProductTypes);
    const otherFunctionHit = phraseHit(signalText, otherRule.primaryFunctions);
    if (otherTypeHit || otherFunctionHit) {
      conflicts.push(
        `Query matches "${otherRule.label}" product type/function, which explicitly excludes this heading.`,
      );
      // A strong, explicit exclusion match (product type itself detected)
      // is excluded outright rather than merely capped — this is the case
      // the spec's regression test targets (knife query vs. generic
      // household-article heading).
      if (otherTypeHit) excluded = true;
    }
  }

  return {
    hsAnchor: candidate.hsAnchor,
    description: candidate.description,
    product_type_match,
    function_match,
    attribute_match,
    text_semantic_similarity,
    conflicts,
    rationale: rule
      ? `Product type ${product_type_match >= 1 ? "matches" : "does not clearly match"} "${rule.label}"; function ${function_match >= 1 ? "matches" : "is uncertain"}.`
      : "Text-similarity fallback.",
    excluded,
  };
}

/** Merge an LLM-returned numeric score with the deterministic taxonomy
 * score: the LLM's numbers are used for nuance, but conflicts/exclusion
 * always come from the deterministic pass, never from the LLM alone. */
function mergeWithLlmScore(
  base: ScoredCandidate,
  llm: Partial<{
    product_type_match: number;
    function_match: number;
    attribute_match: number;
    text_semantic_similarity: number;
    conflicts: string[];
    rationale: string;
  }>,
): ScoredCandidate {
  const clamp01 = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null);
  return {
    ...base,
    product_type_match: clamp01(llm.product_type_match) ?? base.product_type_match,
    function_match: clamp01(llm.function_match) ?? base.function_match,
    attribute_match: clamp01(llm.attribute_match) ?? base.attribute_match,
    text_semantic_similarity: clamp01(llm.text_semantic_similarity) ?? base.text_semantic_similarity,
    // Union, never replace: the deterministic exclusion list must always be
    // present even if the LLM didn't notice the conflict.
    conflicts: [...new Set([...base.conflicts, ...(llm.conflicts ?? [])])],
    rationale: llm.rationale || base.rationale,
  };
}

/**
 * Score every retrieved candidate. Tries the LLM once for the whole batch
 * (cheaper than one call per candidate); on any failure, every candidate
 * falls back to the deterministic taxonomy score alone.
 */
export async function scoreCandidates(
  rawQuery: string,
  facts: ProductFacts,
  candidates: { hsAnchor: string; description: string }[],
): Promise<ScoredCandidate[]> {
  const deterministic = candidates.map((c) => taxonomyScore(facts, rawQuery, c));
  if (candidates.length === 0) return deterministic;

  try {
    const candidateList = candidates
      .map((c, i) => `${i + 1}. HS6 ${c.hsAnchor}: ${c.description}`)
      .join("\n");
    const response = await openai.chat.completions.create(
      {
        model: "gpt-5-mini",
        max_completion_tokens: 900,
        messages: [
          {
            role: "system",
            content:
              "You score how well a product matches each candidate HS6 heading. Product type and primary " +
              "function must dominate — shared material or use words are only supporting evidence and must " +
              "never make a broad/generic heading outrank a narrower, product-type-correct heading. Score ONLY " +
              "the candidates given; never invent a candidate. Return strict JSON only: " +
              '{"scores": [{"hs6_anchor": "<code>", "product_type_match": 0-1, "function_match": 0-1, ' +
              '"attribute_match": 0-1, "text_semantic_similarity": 0-1, "conflicts": ["<short reason>"], ' +
              '"rationale": "<one sentence>"}]}',
          },
          {
            role: "user",
            content:
              `Product description: "${rawQuery}"\n` +
              `Extracted facts: ${JSON.stringify(facts)}\n\nCandidates:\n${candidateList}\n\nReturn the JSON only.`,
          },
        ],
      },
      // Force the deterministic taxonomy fallback (caught below) rather
      // than letting a slow upstream call stall the search request.
      { timeout: 8000 },
    );
    const raw = response.choices[0]?.message?.content ?? "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return deterministic;
    const parsed = JSON.parse(jsonMatch[0]) as {
      scores?: Array<{ hs6_anchor?: string } & Record<string, unknown>>;
    };
    const byAnchor = new Map((parsed.scores ?? []).map((s) => [String(s.hs6_anchor ?? "").replace(/[^0-9]/g, ""), s]));
    return deterministic.map((base) => {
      const llmEntry = byAnchor.get(base.hsAnchor);
      return llmEntry ? mergeWithLlmScore(base, llmEntry as any) : base;
    });
  } catch {
    return deterministic;
  }
}

export type { ClassificationRule };
