import {
  TARIFF_CODE_ENTRIES,
  type Country,
  type TariffCodeEntry,
} from "./tariffData";
import { findRuleForAnchor, type ClassificationRule } from "./classificationRules";
import { retrieveCandidates } from "./hybridRetrieval";
import { extractProductFacts, type ProductFacts } from "./productFacts";
import { scoreCandidates, type ScoredCandidate } from "./candidateScorer";
import { generateExplanation, type ExplanationEvidence } from "./explanationGenerator";

export type QueryType = "description" | "hs_code" | "local_code";
export type Direction = "china_to_indonesia" | "indonesia_to_china";
export type MatchLabel =
  | "exact_match"
  | "likely_match"
  | "partial_match"
  | "manual_review_required";
export type SourceStatus =
  | "official tariff schedule"
  | "public nomenclature source"
  | "tariff data pending"
  | "source unavailable";
export type TariffStatus = "available" | "not available in current source data" | "not applicable";
export type AmbiguityLevel = "low" | "medium" | "high";

/**
 * Attribute-first, hierarchical classification-confidence formula:
 *   match_confidence =
 *     0.40 * product_type_match +
 *     0.25 * function_match +
 *     0.15 * attribute_match +
 *     0.10 * text_semantic_similarity +
 *     0.10 * national_extension_specificity
 *
 * Product type and primary function dominate on purpose: a query like
 * "stainless steel kitchen knives set" must resolve to the knife heading
 * (HS 8211) rather than the broader "household articles of stainless steel"
 * heading (HS 7323) even though the latter's description shares more raw
 * words (material + kitchen use) with the query. Material/use terms are
 * SUPPORTING signals (attribute_match, weighted 0.15) and raw text overlap
 * is a minor signal (text_semantic_similarity, weighted 0.10) — neither can
 * dominate product type/function (weighted 0.65 combined).
 *
 * This is computed EXCLUSIVELY from classification evidence, per-candidate,
 * and is never normalized or ranked against other candidates, and never
 * blended with, or capped by, tariff-source verification/completeness.
 * Cross-candidate ambiguity is instead surfaced separately via
 * `candidate_margin` / `ambiguity_level` on the search result.
 */
export interface MatchReasoning {
  product_type_match: number;
  function_match: number;
  attribute_match: number;
  text_semantic_similarity: number;
  national_extension_specificity: number;
  /** Non-empty when the deterministic exclusion/cap rule detected that this
   * candidate's product type or primary function conflicts with a more
   * specific, positively-matched product family. */
  conflicts: string[];
  /** Wording-layer text (GPT-controlled, evidence-grounded — see
   * explanationGenerator.ts — or a deterministic template fallback).
   * Generated only for the final top-5 candidates. */
  explanation: string;
  /** Cross-candidate/national-extension ambiguity note, same wording layer
   * as `explanation`. */
  ambiguity_note: string;
  /** Tariff-data-availability commentary, same wording layer as
   * `explanation`. Distinct from `TariffMatch.tariff_note`, which is
   * curated source commentary from the dataset itself. */
  tariff_commentary: string;
}

export interface TariffMatch {
  matched_code: string;
  hs6_anchor: string;
  country: Country;
  description: string;
  /** Absolute, per-candidate heuristic 0-1 score, NOT rank-derived, NOT
   * normalized against other candidates, and NOT influenced by tariff-source
   * completeness. Capped at <=0.39 when `reasoning.conflicts` is non-empty. */
  match_confidence: number;
  match_label: MatchLabel;
  /** True only when THIS candidate's classification evidence is itself
   * ambiguous/insufficient — never true merely because a tariff rate hasn't
   * been imported yet. */
  manual_review_required: boolean;
  reasoning: MatchReasoning;
  /** Real rate string, or null when no verified dataset row stores one. Never
   * a placeholder number. */
  tariff_rate: string | null;
  tariff_note: string | null;
  tariff_status: TariffStatus;
  source_status: SourceStatus;
  source_references: string[];
}

export interface TariffSearchResult {
  query: string;
  queryType: QueryType;
  direction: Direction;
  anchorHsCode: string | null;
  /** Aggregate convenience flag: true when no candidates could be classified
   * at all, or every candidate individually requires manual review. */
  manualReviewRequired: boolean;
  /** top_1.match_confidence - top_2.match_confidence after sorting by
   * match_confidence. 1 when there is only one (or zero) candidates — a
   * single candidate has no competing alternative to be ambiguous against. */
  candidate_margin: number;
  /** Derived ONLY from candidate_margin (+ top score) — an ambiguity/review
   * signal, never a second confidence score:
   *   margin >= 0.15 and top >= 0.85  -> low  (high separation)
   *   margin in [0.08, 0.15)          -> medium
   *   margin < 0.08                   -> high (competing candidates) */
  ambiguity_level: AmbiguityLevel;
  /** Product attributes that would distinguish the top candidates, sourced
   * from the classification_rules table when the top anchor is covered,
   * else a generic fallback. Empty for clear, unambiguous matches. */
  required_attributes: string[];
  /** Subset of required_attributes not yet supplied by the user via the
   * structured-details form. Equal to required_attributes until answers are
   * merged into the query. */
  missing_attributes: string[];
  /** Suggested answer options for each required attribute, for rendering the
   * structured-details form. */
  attribute_options: Record<string, string[]>;
  /** True only when: manualReviewRequired, OR top-two margin < 0.08, OR
   * required_attributes is non-empty. Never shown for a clear, high-separation
   * match. Drives the single shared "Improve classification precision" panel —
   * per-candidate improvement suggestions have been removed. */
  improvement_panel_visible: boolean;
  matches: TariffMatch[];
}

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "for",
  "and",
  "or",
  "with",
  "other",
  "not",
  "in",
  "to",
]);

/** Very small stemmer: strip common plural/suffix endings so "smartphones"
 * and "smartphone", or "processors" and "processor", overlap. Not linguistically
 * rigorous — good enough for fuzzy matching against a small reference dataset. */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 1 && !STOPWORDS.has(word))
      .map(stem),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) {
      intersection += 1;
      continue;
    }
    for (const other of b) {
      if (
        Math.min(token.length, other.length) >= 4 &&
        (token.startsWith(other) || other.startsWith(token))
      ) {
        intersection += 0.6;
        break;
      }
    }
  }
  const union = a.size + b.size - intersection;
  return union <= 0 ? 0 : intersection / union;
}

function normalizeCode(raw: string): string {
  return raw.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function sourceCountryFor(direction: Direction): Country {
  return direction === "china_to_indonesia" ? "china" : "indonesia";
}

function targetCountryFor(direction: Direction): Country {
  return direction === "china_to_indonesia" ? "indonesia" : "china";
}

function entriesForCountry(country: Country): TariffCodeEntry[] {
  return TARIFF_CODE_ENTRIES.filter((entry) => entry.country === country);
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function sourceStatusFor(entry: TariffCodeEntry): SourceStatus {
  if (entry.verified) return "official tariff schedule";
  if (entry.source && entry.tariffRate) return "tariff data pending";
  if (entry.source) return "public nomenclature source";
  return "source unavailable";
}

function tariffStatusFor(entry: TariffCodeEntry): TariffStatus {
  return entry.verified && entry.tariffRate ? "available" : "not available in current source data";
}

/** Exclusion/cap rule (step 5 of the attribute-first scoring spec): a
 * conflicted candidate is capped at 0.39 confidence — never allowed to look
 * like a credible top match — even if its raw weighted score would be
 * higher. `excluded` candidates never reach here at all (filtered upstream). */
const CONFLICT_CONFIDENCE_CAP = 0.39;

function computeConfidence(reasoning: Omit<MatchReasoning, "explanation" | "ambiguity_note" | "tariff_commentary">): number {
  const raw =
    0.4 * reasoning.product_type_match +
    0.25 * reasoning.function_match +
    0.15 * reasoning.attribute_match +
    0.1 * reasoning.text_semantic_similarity +
    0.1 * reasoning.national_extension_specificity;
  const capped = reasoning.conflicts.length > 0 ? Math.min(raw, CONFLICT_CONFIDENCE_CAP) : raw;
  return clamp01(capped);
}

function labelForMatch(params: {
  confidence: number;
  sourceResolutionVerified: boolean;
  uniqueTargetLine: boolean;
  evidenceStrength: number;
  hasConflicts: boolean;
}): MatchLabel {
  const { confidence, sourceResolutionVerified, uniqueTargetLine, evidenceStrength, hasConflicts } = params;
  if (hasConflicts) return "manual_review_required";
  if (
    confidence >= 0.9 &&
    sourceResolutionVerified &&
    uniqueTargetLine &&
    evidenceStrength >= 0.85
  ) {
    return "exact_match";
  }
  if (confidence >= 0.7) return "likely_match";
  if (confidence >= 0.4) return "partial_match";
  return "manual_review_required";
}

/** Ambiguity level is derived ONLY from candidate_margin (+ the top score) —
 * it is a review/UX signal, never a second confidence calculation. */
function ambiguityLevelFor(topScore: number, margin: number, candidateCount: number): AmbiguityLevel {
  if (candidateCount <= 1) return candidateCount === 0 ? "high" : "low";
  if (margin >= 0.15 && topScore >= 0.85) return "low";
  if (margin >= 0.08) return "medium";
  return "high";
}

/** Split an attribute option label (e.g. "wireless / Bluetooth") into
 * lowercase keyword tokens usable for free-text detection. */
function attributeOptionKeywords(optionLabel: string): string[] {
  return optionLabel
    .toLowerCase()
    .split(/[/,]/)
    .flatMap((part) => part.trim().split(/\s+/))
    .map((word) => word.replace(/[^a-z0-9%]/g, ""))
    .filter((word) => word.length > 2 && !["and", "the", "for", "use"].includes(word));
}

/** Word-boundary-safe substring test — plain `.includes` would let "men"
 * false-positive-match inside "women", or "wire" inside a longer unrelated
 * word. Keywords are matched only as whole words. */
function containsKeyword(text: string, keyword: string): boolean {
  return new RegExp(`(?:^|[^a-z0-9])${keyword}(?:[^a-z0-9]|$)`, "i").test(text);
}

interface AttributeSignal {
  matchedOption: string;
  keywords: string[];
  otherKeywords: string[];
}

/** Words that appear in more than one option for a given attribute are
 * non-discriminating and must be ignored when deciding which option a text
 * matches — e.g. both "stainless steel" and "carbon steel" contain "steel",
 * so plain OR-matching on that word would make the text look like it
 * ambiguously matches both. Stripping shared words down to each option's
 * distinctive keyword(s) ("stainless" vs "carbon") fixes that without
 * requiring every word in a compound option (like "boxed set") to be
 * present verbatim. */
function distinctiveKeywordsByOption(options: string[]): Map<string, string[]> {
  const perOption = options.map((opt) => ({ opt, kws: attributeOptionKeywords(opt) }));
  const freq = new Map<string, number>();
  for (const { kws } of perOption) {
    for (const kw of new Set(kws)) freq.set(kw, (freq.get(kw) ?? 0) + 1);
  }
  const result = new Map<string, string[]>();
  for (const { opt, kws } of perOption) {
    const distinctive = kws.filter((kw) => (freq.get(kw) ?? 0) === 1);
    result.set(opt, distinctive.length > 0 ? distinctive : kws);
  }
  return result;
}

/** Flattens the attributes the LLM already extracted for the query into a
 * plain-text blob usable with the same whole-word keyword matching as raw
 * query text — e.g. a normalized fact of "stainless steel" satisfies the
 * "stainless steel"/"stainless" synonym even when the user only wrote
 * "steel", and a structured `is_retail_set: true` satisfies "set" wording
 * even when the query used a different phrase for it. */
function factsAnswerText(facts: ProductFacts | null): string {
  if (!facts) return "";
  const parts = [
    facts.primary_product_type,
    facts.primary_function,
    facts.intended_use,
    ...facts.materials,
    ...facts.key_attributes,
  ].filter(Boolean);
  if (facts.is_retail_set) parts.push("set boxed set retail set");
  return parts.join(" ").toLowerCase();
}

/**
 * For a classification rule, detect which attributes are already pinned
 * down unambiguously by the raw query text and/or the extracted product
 * facts — exactly one option's distinctive keywords appear, and no other
 * option's distinctive keywords for that same attribute do. Used to:
 *   (a) avoid re-asking a question the user already answered (in free text
 *       or via structured/extracted facts — e.g. materials, is_retail_set),
 *   (b) reward/penalize candidate descriptions that agree/disagree with the
 *       detected value — a targeted contradiction signal within the
 *       attribute_match component (e.g. "wired" and "wireless" share zero
 *       overlapping tokens with each other despite being direct opposites).
 */
function detectAttributeSignals(
  queryLower: string,
  rule: ClassificationRule,
  facts: ProductFacts | null = null,
): Map<string, AttributeSignal> {
  const detectionText = `${queryLower} ${factsAnswerText(facts)}`.trim();
  const signals = new Map<string, AttributeSignal>();
  for (const attr of rule.requiredAttributes) {
    const options = rule.attributeOptions[attr] ?? [];
    if (options.length < 2) continue;
    const distinctiveKeywords = distinctiveKeywordsByOption(options);
    const matchedOptions = options.filter((opt) =>
      (distinctiveKeywords.get(opt) ?? []).some((kw) => containsKeyword(detectionText, kw)),
    );
    if (matchedOptions.length !== 1) continue; // no signal, or the text itself is ambiguous
    const matchedOption = matchedOptions[0];
    signals.set(attr, {
      matchedOption,
      keywords: attributeOptionKeywords(matchedOption),
      otherKeywords: options
        .filter((opt) => opt !== matchedOption)
        .flatMap((opt) => attributeOptionKeywords(opt)),
    });
  }
  return signals;
}

/** Bonus/penalty applied to a candidate's attribute_match for a single
 * sibling national line, based on whether its description text agrees or
 * contradicts the attribute values the query already signaled (see
 * detectAttributeSignals). Never applied when the query gave no signal for
 * an attribute. */
function attributeCompatibilityAdjustment(
  entryDescriptionLower: string,
  signals: Map<string, AttributeSignal>,
): number {
  let adjustment = 0;
  for (const { keywords, otherKeywords } of signals.values()) {
    const matchesChosen = keywords.some((kw) => containsKeyword(entryDescriptionLower, kw));
    const matchesOther = otherKeywords.some((kw) => containsKeyword(entryDescriptionLower, kw));
    if (matchesChosen && !matchesOther) adjustment += 0.25;
    else if (matchesOther && !matchesChosen) adjustment -= 0.3;
  }
  return adjustment;
}

/**
 * missing_attributes = decision_relevant_attributes_for_top_competing_candidates
 *                       minus extracted_product_facts (and free-text query).
 *
 * "Decision-relevant" attributes are pulled from the classification_rules
 * table for every distinct HS6 anchor among the top competing candidates
 * (not just the single top anchor) — when two different product families
 * are both plausible, the panel must ask whatever distinguishes either of
 * them. Falls back to a generic prompt only when none of the competing
 * anchors are covered by a known rule and the match is otherwise weak.
 * Attributes already pinned down — via free text OR structured/extracted
 * product facts (`detectAttributeSignals`, comparing normalized values and
 * synonyms) — are excluded so the panel never re-asks a settled question.
 */
function requiredAttributesFor(params: {
  competingAnchors: string[];
  topEvidenceStrength: number;
  queryLower: string;
  facts: ProductFacts | null;
}): { rules: ClassificationRule[]; attributes: string[]; attributeOptions: Record<string, string[]> } {
  const { competingAnchors, topEvidenceStrength, queryLower, facts } = params;

  const rules = competingAnchors
    .map((anchor) => findRuleForAnchor(anchor))
    .filter((r): r is ClassificationRule => !!r);

  if (rules.length > 0) {
    const answeredAttributes = new Set<string>();
    for (const rule of rules) {
      for (const attr of detectAttributeSignals(queryLower, rule, facts).keys()) {
        answeredAttributes.add(attr);
      }
    }
    const decisionRelevantAttributes = Array.from(
      new Set(rules.flatMap((rule) => rule.requiredAttributes)),
    );
    const attributeOptions: Record<string, string[]> = {};
    for (const rule of rules) {
      for (const [attr, options] of Object.entries(rule.attributeOptions)) {
        if (!attributeOptions[attr]) attributeOptions[attr] = options;
      }
    }
    return {
      rules,
      attributes: decisionRelevantAttributes.filter((attr) => !answeredAttributes.has(attr)),
      attributeOptions,
    };
  }

  if (topEvidenceStrength < 0.5) {
    const fallback = ["material", "intended use", "technical specification"];
    return { rules: [], attributes: fallback, attributeOptions: {} };
  }
  return { rules: [], attributes: [], attributeOptions: {} };
}

function normalizeCodeOnly(raw: string): string {
  return normalizeCode(raw).replace(/[^0-9]/g, "");
}

interface CodeResolution {
  anchor: string | null;
  comparisonEntry: TariffCodeEntry | null;
  /** 1.0 for an exact code match, scaled down for a fuzzy prefix match. */
  anchorCertainty: number;
  sourceResolutionVerified: boolean;
  invalidOrNotFound: boolean;
}

/** Deterministic exact/prefix code resolution (hs_code / local_code query
 * types) — unrelated to the LLM-driven, attribute-first description-query
 * pipeline below, since a valid code already fully determines product
 * type/function. */
function resolveCode(query: string, queryType: "hs_code" | "local_code", sourceCountry: Country): CodeResolution {
  if (queryType === "hs_code") {
    const digits = normalizeCodeOnly(query);
    if (digits.length >= 6) {
      const anchor = digits.slice(0, 6);
      const knownEntry = TARIFF_CODE_ENTRIES.find((e) => e.hsAnchor === anchor);
      if (knownEntry) {
        return { anchor, comparisonEntry: knownEntry, anchorCertainty: 1, sourceResolutionVerified: true, invalidOrNotFound: false };
      }
    }
    return { anchor: null, comparisonEntry: null, anchorCertainty: 0, sourceResolutionVerified: false, invalidOrNotFound: true };
  }

  const normalizedQuery = normalizeCode(query);
  const sourceEntries = entriesForCountry(sourceCountry);
  const exact = sourceEntries.find((entry) => normalizeCode(entry.code) === normalizedQuery);
  if (exact) {
    return { anchor: exact.hsAnchor, comparisonEntry: exact, anchorCertainty: 1, sourceResolutionVerified: true, invalidOrNotFound: false };
  }
  let bestPrefix: TariffCodeEntry | null = null;
  let bestPrefixLen = 0;
  for (const entry of sourceEntries) {
    const code = normalizeCode(entry.code);
    let len = 0;
    while (len < code.length && len < normalizedQuery.length && code[len] === normalizedQuery[len]) len += 1;
    if (len > bestPrefixLen && len >= 4) {
      bestPrefixLen = len;
      bestPrefix = entry;
    }
  }
  if (bestPrefix) {
    const ratio = clamp01(bestPrefixLen / normalizedQuery.length);
    return { anchor: bestPrefix.hsAnchor, comparisonEntry: bestPrefix, anchorCertainty: clamp01(ratio * 0.75), sourceResolutionVerified: false, invalidOrNotFound: false };
  }
  return { anchor: null, comparisonEntry: null, anchorCertainty: 0, sourceResolutionVerified: false, invalidOrNotFound: true };
}

interface BuiltMatch {
  match: TariffMatch;
  siblingLineCount: number;
  ambiguityNoteSeed: string;
}

function buildMatchForEntry(params: {
  entry: TariffCodeEntry;
  productTypeMatch: number;
  functionMatch: number;
  attributeMatchBase: number;
  textSemanticSimilarity: number;
  nationalExtensionSpecificity: number;
  conflicts: string[];
  siblingLineCount: number;
  sourceResolutionVerified: boolean;
  uniqueTargetLine: boolean;
  primaryRule: ClassificationRule | null;
  queryLower: string;
}): TariffMatch {
  const {
    entry,
    productTypeMatch,
    functionMatch,
    attributeMatchBase,
    textSemanticSimilarity,
    nationalExtensionSpecificity,
    conflicts,
    siblingLineCount,
    sourceResolutionVerified,
    uniqueTargetLine,
    primaryRule,
    queryLower,
  } = params;

  const signals = primaryRule ? detectAttributeSignals(queryLower, primaryRule) : new Map<string, AttributeSignal>();
  const attributeMatch = clamp01(
    attributeMatchBase + attributeCompatibilityAdjustment(entry.description.toLowerCase(), signals),
  );

  const reasoningCore = {
    product_type_match: Number(productTypeMatch.toFixed(2)),
    function_match: Number(functionMatch.toFixed(2)),
    attribute_match: Number(attributeMatch.toFixed(2)),
    text_semantic_similarity: Number(textSemanticSimilarity.toFixed(2)),
    national_extension_specificity: Number(nationalExtensionSpecificity.toFixed(2)),
    conflicts,
  };
  const confidence = computeConfidence(reasoningCore);
  const evidenceStrength = (productTypeMatch + functionMatch) / 2;

  const matchLabel = labelForMatch({
    confidence,
    sourceResolutionVerified,
    uniqueTargetLine,
    evidenceStrength,
    hasConflicts: conflicts.length > 0,
  });

  return {
    matched_code: entry.code,
    hs6_anchor: entry.hsAnchor,
    country: entry.country,
    description: entry.description,
    match_confidence: Number(confidence.toFixed(2)),
    match_label: matchLabel,
    manual_review_required: matchLabel === "manual_review_required",
    reasoning: {
      ...reasoningCore,
      // Deterministic placeholders — replaced by the GPT/template wording
      // layer for the final top-5 candidates only (see generateExplanations).
      explanation: "",
      ambiguity_note: "",
      tariff_commentary: "",
    },
    tariff_rate: entry.verified ? entry.tariffRate : null,
    tariff_note: entry.tariffNote,
    tariff_status: tariffStatusFor(entry),
    source_status: sourceStatusFor(entry),
    source_references: [entry.source, entry.citation].filter((s): s is string => !!s),
  };
}

/** Steps 1-6 of the wording-layer spec: build the structured evidence object
 * for a match, call generateExplanation (GPT wording layer, backend-computed
 * evidence only), and write the result into the match's reasoning. Never
 * touches match_confidence/match_label/source_status/tariff_status. */
async function attachExplanation(
  query: string,
  match: TariffMatch,
  context: { siblingLineCount: number; ambiguityLevel: AmbiguityLevel; missingAttributes: string[] },
): Promise<void> {
  const evidence: ExplanationEvidence = {
    query,
    candidate_code: match.matched_code,
    candidate_description: match.description,
    hs_anchor: match.hs6_anchor,
    product_type_match: match.reasoning.product_type_match,
    function_match: match.reasoning.function_match,
    attribute_match: match.reasoning.attribute_match,
    text_semantic_similarity: match.reasoning.text_semantic_similarity,
    national_extension_specificity: match.reasoning.national_extension_specificity,
    match_confidence: match.match_confidence,
    conflicts: match.reasoning.conflicts,
    sibling_line_count: context.siblingLineCount,
    ambiguity_level: context.ambiguityLevel,
    missing_attributes: context.missingAttributes,
    tariff_rate: match.tariff_rate,
    tariff_status: match.tariff_status,
    source_status: match.source_status,
  };
  const generated = await generateExplanation(query, evidence);
  match.reasoning.explanation = generated.explanation;
  match.reasoning.ambiguity_note = generated.ambiguity_note;
  match.reasoning.tariff_commentary = generated.tariff_commentary;
}

export async function searchTariffMatches(
  rawQuery: string,
  queryType: QueryType,
  direction: Direction,
): Promise<TariffSearchResult> {
  const query = rawQuery.trim();
  const queryLower = query.toLowerCase();
  const sourceCountry = sourceCountryFor(direction);
  const targetCountry = targetCountryFor(direction);
  const targetCountryEntries = entriesForCountry(targetCountry);

  let candidateMatches: TariffMatch[] = [];
  const siblingLineCountByAnchor = new Map<string, number>();
  /** Structured facts extracted from the query (description queries only).
   * Used later, alongside the free-text query, to decide which required
   * attributes are already answered — an hs_code/local_code query has no
   * free-text facts to extract, so this stays null for those paths. */
  let facts: ProductFacts | null = null;

  if (queryType === "description") {
    // Attribute-first hierarchical workflow (steps 1-6):
    //   1. Extract structured product facts via the LLM.
    //   2. Retrieve 5-10 candidate HS6 headings (lexical + semantic).
    //   3-5. Score each candidate (LLM + deterministic taxonomy fallback and
    //        exclusion/cap rule), then compute per-national-line confidence.
    facts = await extractProductFacts(query);
    const retrieved = retrieveCandidates(query, 10);
    const scored: ScoredCandidate[] = await scoreCandidates(
      query,
      facts,
      retrieved.map((r) => ({ hsAnchor: r.hsAnchor, description: r.description })),
    );

    for (const candidate of scored) {
      if (candidate.excluded) continue; // step 5: hard exclusion, never surfaced
      const entries = targetCountryEntries.filter((e) => e.hsAnchor === candidate.hsAnchor);
      if (entries.length === 0) continue;
      siblingLineCountByAnchor.set(candidate.hsAnchor, entries.length);
      const nationalExtensionSpecificity = entries.length > 1 ? (entries.length === 2 ? 0.5 : 0.35) : 1;
      const primaryRule = findRuleForAnchor(candidate.hsAnchor);

      for (const entry of entries) {
        const lineTextSimilarity = clamp01(
          jaccardSimilarity(tokenize(query), tokenize(entry.description)),
        );
        candidateMatches.push(
          buildMatchForEntry({
            entry,
            productTypeMatch: candidate.product_type_match,
            functionMatch: candidate.function_match,
            attributeMatchBase: candidate.attribute_match,
            // Blend the anchor-level and line-level text similarity so a
            // sibling line with a closer literal description still edges
            // out one that only matches at the heading level.
            textSemanticSimilarity: clamp01(0.5 * candidate.text_semantic_similarity + 0.5 * lineTextSimilarity),
            nationalExtensionSpecificity,
            conflicts: candidate.conflicts,
            siblingLineCount: entries.length,
            sourceResolutionVerified: false,
            uniqueTargetLine: entries.length <= 1,
            primaryRule,
            queryLower,
          }),
        );
      }
    }
  } else {
    // Deterministic exact/prefix code resolution — product type and function
    // are already fully determined by a valid code, scaled down only by the
    // anchor's own resolution certainty (1.0 exact, lower for fuzzy prefix).
    const resolution = resolveCode(query, queryType, sourceCountry);
    if (resolution.invalidOrNotFound || !resolution.anchor) {
      return {
        query,
        queryType,
        direction,
        anchorHsCode: null,
        manualReviewRequired: true,
        candidate_margin: 1,
        ambiguity_level: "high",
        required_attributes: resolution.invalidOrNotFound ? [] : ["material", "intended use", "technical specification"],
        missing_attributes: resolution.invalidOrNotFound ? [] : ["material", "intended use", "technical specification"],
        attribute_options: {},
        improvement_panel_visible: !resolution.invalidOrNotFound,
        matches: [],
      };
    }

    const entries = targetCountryEntries.filter((e) => e.hsAnchor === resolution.anchor);
    const nationalExtensionSpecificity = entries.length > 1 ? (entries.length === 2 ? 0.5 : 0.35) : 1;
    siblingLineCountByAnchor.set(resolution.anchor, entries.length);
    const primaryRule = findRuleForAnchor(resolution.anchor);
    const comparisonText = resolution.comparisonEntry?.description ?? query;

    for (const entry of entries) {
      const textSemanticSimilarity = clamp01(jaccardSimilarity(tokenize(comparisonText), tokenize(entry.description)));
      candidateMatches.push(
        buildMatchForEntry({
          entry,
          productTypeMatch: resolution.anchorCertainty,
          functionMatch: resolution.anchorCertainty,
          attributeMatchBase: resolution.anchorCertainty,
          textSemanticSimilarity,
          nationalExtensionSpecificity,
          conflicts: [],
          siblingLineCount: entries.length,
          sourceResolutionVerified: resolution.sourceResolutionVerified,
          uniqueTargetLine: entries.length <= 1,
          primaryRule,
          queryLower,
        }),
      );
    }

    // Supplemental description-similarity candidates outside the resolved
    // anchor, for one-to-many code crosswalks.
    const queryTokens = tokenize(query);
    const seenCodes = new Set(candidateMatches.map((c) => c.matched_code));
    const scored = targetCountryEntries
      .filter((entry) => !seenCodes.has(entry.code))
      .map((entry) => ({ entry, score: jaccardSimilarity(queryTokens, tokenize(entry.description)) }))
      .filter(({ score }) => score > 0.15)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    for (const { entry, score } of scored) {
      const secondaryCertainty = clamp01(resolution.anchorCertainty * 0.5);
      siblingLineCountByAnchor.set(entry.hsAnchor, siblingLineCountByAnchor.get(entry.hsAnchor) ?? 2);
      candidateMatches.push(
        buildMatchForEntry({
          entry,
          productTypeMatch: secondaryCertainty,
          functionMatch: secondaryCertainty,
          attributeMatchBase: secondaryCertainty,
          textSemanticSimilarity: clamp01(score),
          nationalExtensionSpecificity: 0.3,
          conflicts: secondaryCertainty < 0.5 ? ["Anchor resolution too weak to confirm product type/function."] : [],
          siblingLineCount: 2,
          sourceResolutionVerified: false,
          uniqueTargetLine: false,
          primaryRule: findRuleForAnchor(entry.hsAnchor),
          queryLower,
        }),
      );
    }
  }

  // Sort by absolute match_confidence — NOT re-normalized, NOT rank-derived.
  candidateMatches.sort((a, b) => b.match_confidence - a.match_confidence);
  const matches = candidateMatches.slice(0, 5);

  const candidate_margin =
    matches.length >= 2 ? Number((matches[0].match_confidence - matches[1].match_confidence).toFixed(2)) : 1;
  const ambiguity_level = ambiguityLevelFor(matches[0]?.match_confidence ?? 0, candidate_margin, matches.length);

  if (matches.length >= 2 && ambiguity_level === "high") {
    matches[0].manual_review_required = true;
    matches[1].manual_review_required = true;
  }

  const topAnchor = matches[0]?.hs6_anchor ?? null;
  const topEvidenceStrength = matches[0]
    ? (matches[0].reasoning.product_type_match + matches[0].reasoning.function_match) / 2
    : 0;

  // "Top competing candidates" — every distinct anchor among the surfaced
  // matches (not just the single top one), since a genuinely close second
  // candidate from a different product family can raise its own
  // decision-relevant attribute (e.g. material) even if the top anchor
  // alone wouldn't have needed to ask about it.
  const competingAnchors: string[] = [];
  for (const m of matches) {
    if (!competingAnchors.includes(m.hs6_anchor)) competingAnchors.push(m.hs6_anchor);
    if (competingAnchors.length >= 3) break;
  }

  const { attributes: missing_attributes, attributeOptions: attribute_options } = requiredAttributesFor({
    competingAnchors,
    topEvidenceStrength,
    queryLower,
    facts,
  });
  const required_attributes = missing_attributes;

  const manualReviewRequired = matches.length === 0 || matches.every((m) => m.manual_review_required);
  // A distinct anchor is "plausible" once it isn't stuck at
  // manual_review_required — used only to gate the shared precision panel,
  // never to alter match_confidence/match_label themselves.
  const plausibleAnchorCount = new Set(
    matches.filter((m) => m.match_label !== "manual_review_required").map((m) => m.hs6_anchor),
  ).size;
  const improvement_panel_visible =
    manualReviewRequired ||
    (plausibleAnchorCount >= 2 && candidate_margin < 0.08 && missing_attributes.length > 0);

  // Wording layer (GPT-controlled, evidence-only) for the final top-5 only.
  await Promise.all(
    matches.map((match) =>
      attachExplanation(query, match, {
        siblingLineCount: siblingLineCountByAnchor.get(match.hs6_anchor) ?? 1,
        ambiguityLevel: ambiguity_level,
        missingAttributes: required_attributes,
      }),
    ),
  );

  return {
    query,
    queryType,
    direction,
    anchorHsCode: topAnchor,
    manualReviewRequired,
    candidate_margin,
    ambiguity_level,
    required_attributes,
    missing_attributes: required_attributes,
    attribute_options,
    improvement_panel_visible,
    matches,
  };
}

export function listTariffCodes(country?: Country): TariffCodeEntry[] {
  if (!country) return TARIFF_CODE_ENTRIES;
  return TARIFF_CODE_ENTRIES.filter((entry) => entry.country === country);
}
