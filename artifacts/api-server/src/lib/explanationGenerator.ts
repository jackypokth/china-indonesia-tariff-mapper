/**
 * GPT explanation layer (workflow steps 1-10 of the "explanations" spec).
 *
 * GPT here is a CONTROLLED WORDING LAYER ONLY: the backend first computes
 * and stores a structured evidence object per candidate (this is the single
 * source of truth), then asks GPT to phrase that evidence into 1-2 short,
 * non-binding sentences. GPT is explicitly forbidden from inferring any
 * code, rate, legal status, source, exclusion, or fact beyond the evidence
 * object; its output is validated before being shown, and a deterministic
 * template is used whenever GPT is unavailable or its output fails
 * validation. match_confidence / match_label / source_status / tariff_status
 * are computed entirely by the backend and are never touched by GPT.
 */
import { createHash } from "node:crypto";
import { openai } from "@workspace/integrations-openai-ai-server";
import type { AmbiguityLevel, SourceStatus, TariffStatus } from "./tariffMatcher";

export interface ExplanationEvidence {
  query: string;
  candidate_code: string;
  candidate_description: string;
  hs_anchor: string;
  product_type_match: number;
  function_match: number;
  attribute_match: number;
  text_semantic_similarity: number;
  national_extension_specificity: number;
  match_confidence: number;
  conflicts: string[];
  sibling_line_count: number;
  ambiguity_level: AmbiguityLevel;
  missing_attributes: string[];
  tariff_rate: string | null;
  tariff_status: TariffStatus;
  source_status: SourceStatus;
}

export interface GeneratedExplanation {
  explanation: string;
  ambiguity_note: string;
  /** Maps to the spec's "tariff_note" field name in the strict GPT JSON
   * contract; renamed on the TS side to avoid colliding with the existing,
   * dataset-sourced `TariffMatch.tariff_note` field (curated source
   * commentary, unrelated to this GPT wording layer). */
  tariff_commentary: string;
  source: "gpt" | "template";
}

const PROHIBITED_TERMS = ["definitely", "guaranteed", "official", "legally binding"];

const cache = new Map<string, GeneratedExplanation>();

function hashEvidence(evidence: ExplanationEvidence): string {
  return createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

function cacheKey(query: string, candidateCode: string, evidence: ExplanationEvidence): string {
  return `${normalizeQuery(query)}::${candidateCode}::${hashEvidence(evidence)}`;
}

function containsPercentClaim(text: string): boolean {
  return /\d+(\.\d+)?\s?%/.test(text);
}

function containsProhibitedTerm(text: string): boolean {
  const lower = text.toLowerCase();
  return PROHIBITED_TERMS.some((term) => new RegExp(`\\b${term}\\b`, "i").test(lower));
}

/** Any 4+ digit run not already present in the evidence (candidate code,
 * anchor) is treated as a fabricated code/number GPT was not given. */
function containsUnsuppliedCode(text: string, evidence: ExplanationEvidence): boolean {
  const allowedDigits = new Set<string>([
    evidence.candidate_code.replace(/[^0-9]/g, ""),
    evidence.hs_anchor.replace(/[^0-9]/g, ""),
  ]);
  const found = text.match(/\d{4,}/g) ?? [];
  return found.some((run) => !allowedDigits.has(run) && ![...allowedDigits].some((a) => a.includes(run) || run.includes(a)));
}

function templateExplanation(evidence: ExplanationEvidence): GeneratedExplanation {
  const typeStrong = evidence.product_type_match >= 0.7;
  const funcStrong = evidence.function_match >= 0.5;
  const explanationParts = [
    typeStrong && funcStrong
      ? "Product type and primary function both align with this heading."
      : "Product type and/or primary function evidence for this heading is limited.",
  ];
  if (evidence.attribute_match > 0) {
    explanationParts.push(
      `Supporting attributes ${evidence.attribute_match >= 0.6 ? "reinforce" : "only partially support"} this classification.`,
    );
  }
  if (evidence.conflicts.length > 0) {
    explanationParts.push(`Note: ${evidence.conflicts[0]}`);
  }
  const explanation = explanationParts.join(" ");

  const ambiguity_note =
    evidence.sibling_line_count > 1
      ? `This heading has ${evidence.sibling_line_count} national tariff lines; ${evidence.missing_attributes.length > 0 ? "additional detail is needed to pick between them" : "the supplied detail narrows this to the shown line"}.`
      : evidence.ambiguity_level === "high"
        ? "Multiple candidate headings are closely scored; manual review is recommended."
        : "No material national-extension ambiguity for this line.";

  const tariff_commentary =
    evidence.tariff_rate === null
      ? "No verified tariff rate is available for this line in the current source data."
      : `A sourced tariff rate is on file for this line (${evidence.source_status}).`;

  return { explanation, ambiguity_note, tariff_commentary, source: "template" };
}

/** Extract every "N%" or "N.N%" token from text. */
function percentClaims(text: string): string[] {
  return (text.match(/\d+(\.\d+)?\s?%/g) ?? []).map((m) => m.replace(/\s/g, ""));
}

function validate(evidence: ExplanationEvidence, candidate: { explanation: string; ambiguity_note: string; tariff_note: string }): boolean {
  const allText = `${candidate.explanation} ${candidate.ambiguity_note} ${candidate.tariff_note}`;
  if (containsProhibitedTerm(allText)) return false;
  if (evidence.tariff_rate === null && containsPercentClaim(allText)) return false;
  if (evidence.tariff_rate !== null) {
    // Any rate GPT states must be the exact, sourced rate — never a
    // different or invented figure.
    const claimed = percentClaims(allText);
    const sourcedNormalized = evidence.tariff_rate.replace(/\s/g, "");
    if (claimed.some((c) => !sourcedNormalized.includes(c))) return false;
  }
  if (containsUnsuppliedCode(allText, evidence)) return false;
  if (candidate.explanation.trim().length === 0) return false;
  // 1-2 sentences guardrail, loosely enforced.
  const sentenceCount = (candidate.explanation.match(/[.!?]/g) ?? []).length;
  if (sentenceCount > 3) return false;
  return true;
}

async function callGpt(evidence: ExplanationEvidence): Promise<GeneratedExplanation | null> {
  try {
    const response = await openai.chat.completions.create(
      {
        model: "gpt-5-mini",
        max_completion_tokens: 350,
        messages: [
        {
          role: "system",
          content:
            "You write short, non-binding classification explanations from a supplied evidence JSON object. " +
            "You MUST use ONLY the evidence given — never infer or state any HS code, tariff rate, legal " +
            "status, data source, exclusion, or fact not present in the evidence. Never use the words: " +
            "definitely, guaranteed, official, legally binding. If tariff_rate is null, never state or imply " +
            "any percentage or tariff figure. Return strict JSON only: " +
            '{"explanation": "1-2 sentences on product type/function/attribute evidence and any conflicts", ' +
            '"ambiguity_note": "1 sentence on national-extension or cross-candidate ambiguity, if present", ' +
            '"tariff_note": "1 sentence on tariff-data availability only, no rate claims unless tariff_rate is set"}',
        },
        { role: "user", content: `Evidence:\n${JSON.stringify(evidence)}\n\nReturn the JSON only.` },
        ],
      },
      // Force the deterministic template fallback (caught below) rather
      // than letting a slow upstream call stall the search request.
      { timeout: 8000 },
    );
    const raw = response.choices[0]?.message?.content ?? "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as { explanation?: string; ambiguity_note?: string; tariff_note?: string };
    const candidate = {
      explanation: String(parsed.explanation ?? ""),
      ambiguity_note: String(parsed.ambiguity_note ?? ""),
      tariff_note: String(parsed.tariff_note ?? ""),
    };
    if (!validate(evidence, candidate)) return null;
    return {
      explanation: candidate.explanation,
      ambiguity_note: candidate.ambiguity_note,
      tariff_commentary: candidate.tariff_note,
      source: "gpt",
    };
  } catch {
    return null;
  }
}

/**
 * Generate the wording-layer explanation for a single candidate. Cached by
 * normalized query + candidate code + a hash of the evidence fields, so
 * identical (query, candidate, evidence) triples never re-call the LLM.
 */
export async function generateExplanation(
  query: string,
  evidence: ExplanationEvidence,
): Promise<GeneratedExplanation> {
  const key = cacheKey(query, evidence.candidate_code, evidence);
  const cached = cache.get(key);
  if (cached) return cached;

  const gptResult = await callGpt(evidence);
  const result = gptResult ?? templateExplanation(evidence);
  cache.set(key, result);
  return result;
}
