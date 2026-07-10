import {
  TARIFF_CODE_ENTRIES,
  NOT_AVAILABLE_RATE,
  type Country,
  type TariffCodeEntry,
} from "./tariffData";

export type QueryType = "description" | "hs_code" | "local_code";
export type Direction = "china_to_indonesia" | "indonesia_to_china";
export type MatchLabel =
  | "exact_match"
  | "likely_match"
  | "partial_match"
  | "manual_review_required";
export type MatchBasis =
  | "shared_hs_digits"
  | "semantic_description_similarity"
  | "tariff_book_structure"
  | "exact_code_lookup";

export interface MatchExplanation {
  basis: MatchBasis;
  detail: string;
}

/**
 * Transparent breakdown of the weighted confidence formula:
 *   match_confidence =
 *     0.45 * hs_anchor_strength +
 *     0.35 * description_similarity +
 *     0.10 * national_extension_evidence +
 *     0.10 * source_completeness
 * Every component is 0-1 and independently inspectable — nothing about the
 * final score is hidden in a fixed lookup table.
 */
export interface MatchReasoning {
  hs_anchor_strength: number;
  description_similarity: number;
  national_extension_evidence: number;
  source_completeness: number;
}

export interface TariffMatch {
  code: string;
  country: Country;
  description: string;
  /** Heuristic 0-1 score, NOT an empirically calibrated probability. */
  match_confidence: number;
  matchLabel: MatchLabel;
  explanation: MatchExplanation;
  reasoning: MatchReasoning;
  tariffRate: string | null;
  tariffNote: string | null;
  source: string;
  verified: boolean;
}

export interface TariffSearchResult {
  query: string;
  queryType: QueryType;
  direction: Direction;
  anchorHsCode: string | null;
  manualReviewRequired: boolean;
  missing_attributes: string[];
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
    // Partial credit for token stems that share a long common prefix
    // (catches near-misses the stemmer didn't normalize, e.g. "phone"/"phones").
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

interface AnchorResolution {
  anchor: string | null;
  basis: MatchBasis;
  detail: string;
  /** 0-1: how strongly the source query pins down this HS6 anchor. */
  hsAnchorStrength: number;
  /** Text to use as the "source side" description for similarity scoring
   * against target candidates — the source entry's own description when the
   * query resolved via a code lookup, otherwise the raw query text. */
  comparisonText: string;
  /** True when the query is exact-code-verified against a real entry — a
   * precondition for exact_match eligibility. */
  exactVerifiedSourceLookup: boolean;
  /** True when a second, meaningfully different anchor is nearly as
   * plausible as the chosen one — an ambiguous-classification signal. */
  multiplePlausibleAnchors: boolean;
}

/**
 * Identify the most likely HS 6-digit anchor for the given query, searching
 * within the source country's entries first (for hs_code / local_code lookups)
 * and falling back to description similarity across all entries.
 */
function identifyAnchor(
  query: string,
  queryType: QueryType,
  sourceCountry: Country,
): AnchorResolution {
  if (queryType === "hs_code") {
    const digits = normalizeCode(query).replace(/[^0-9]/g, "");
    if (digits.length >= 6) {
      const anchor = digits.slice(0, 6);
      const knownEntry = TARIFF_CODE_ENTRIES.find((e) => e.hsAnchor === anchor);
      if (knownEntry) {
        return {
          anchor,
          basis: "exact_code_lookup",
          detail: `Interpreted "${query}" as HS heading ${anchor} (first 6 digits).`,
          hsAnchorStrength: 1,
          comparisonText: knownEntry.description,
          exactVerifiedSourceLookup: knownEntry.verified,
          multiplePlausibleAnchors: false,
        };
      }
    }
    // fall through to description-style fuzzy match on the raw digits/text
  }

  if (queryType === "local_code") {
    const normalizedQuery = normalizeCode(query);
    const sourceEntries = entriesForCountry(sourceCountry);
    const exact = sourceEntries.find(
      (entry) => normalizeCode(entry.code) === normalizedQuery,
    );
    if (exact) {
      return {
        anchor: exact.hsAnchor,
        basis: "exact_code_lookup",
        detail: `Matched "${query}" exactly to national code ${exact.code} (${sourceCountry}), anchored at HS ${exact.hsAnchor}.`,
        hsAnchorStrength: 1,
        comparisonText: exact.description,
        exactVerifiedSourceLookup: exact.verified,
        multiplePlausibleAnchors: false,
      };
    }
    // Try prefix match against source country national codes
    let bestPrefix: TariffCodeEntry | null = null;
    let bestPrefixLen = 0;
    for (const entry of sourceEntries) {
      const code = normalizeCode(entry.code);
      let len = 0;
      while (
        len < code.length &&
        len < normalizedQuery.length &&
        code[len] === normalizedQuery[len]
      ) {
        len += 1;
      }
      if (len > bestPrefixLen && len >= 4) {
        bestPrefixLen = len;
        bestPrefix = entry;
      }
    }
    if (bestPrefix) {
      return {
        anchor: bestPrefix.hsAnchor,
        basis: "tariff_book_structure",
        detail: `"${query}" partially matches national code ${bestPrefix.code} (${sourceCountry}) on its first ${bestPrefixLen} characters; using its HS anchor ${bestPrefix.hsAnchor}.`,
        hsAnchorStrength: clamp01(bestPrefixLen / normalizedQuery.length),
        comparisonText: bestPrefix.description,
        exactVerifiedSourceLookup: false,
        multiplePlausibleAnchors: false,
      };
    }
    return {
      anchor: null,
      basis: "exact_code_lookup",
      detail: `"${query}" does not match any known national code in ${sourceCountry}. The source code could not be verified.`,
      hsAnchorStrength: 0,
      comparisonText: query,
      exactVerifiedSourceLookup: false,
      multiplePlausibleAnchors: false,
    };
  }

  // description fallback: score against every entry's description, take the
  // best anchor, and track the runner-up to detect ambiguous wording.
  const queryTokens = tokenize(query);
  const bestByAnchor = new Map<string, { score: number; entry: TariffCodeEntry }>();
  for (const entry of TARIFF_CODE_ENTRIES) {
    const score = jaccardSimilarity(queryTokens, tokenize(entry.description));
    const current = bestByAnchor.get(entry.hsAnchor);
    if (!current || score > current.score) {
      bestByAnchor.set(entry.hsAnchor, { score, entry });
    }
  }
  const ranked = [...bestByAnchor.values()].sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const runnerUp = ranked[1];

  if (best && best.score > 0.08) {
    // Ambiguous if a distinct anchor scores nearly as well as the winner.
    const multiplePlausibleAnchors =
      !!runnerUp && runnerUp.score > 0 && best.score - runnerUp.score < 0.1;
    return {
      anchor: best.entry.hsAnchor,
      basis: "semantic_description_similarity",
      detail: `"${query}" is most similar in wording to "${best.entry.description}" (HS ${best.entry.hsAnchor}).`,
      hsAnchorStrength: clamp01(best.score),
      comparisonText: query,
      exactVerifiedSourceLookup: false,
      multiplePlausibleAnchors,
    };
  }

  return {
    anchor: null,
    basis: "semantic_description_similarity",
    detail: `No reference description in the dataset shares enough wording with "${query}" to anchor a classification.`,
    hsAnchorStrength: 0,
    comparisonText: query,
    exactVerifiedSourceLookup: false,
    multiplePlausibleAnchors: false,
  };
}

function labelForConfidence(confidence: number): MatchLabel {
  if (confidence >= 0.9) return "exact_match";
  if (confidence >= 0.7) return "likely_match";
  if (confidence >= 0.4) return "partial_match";
  return "manual_review_required";
}

/** Is the query text itself too thin to carry much classification signal? */
function isVagueQuery(query: string, queryType: QueryType): boolean {
  if (queryType !== "description") return false;
  const tokens = tokenize(query);
  return tokens.size < 2;
}

/** Word tier for a 0-1 reasoning component, used only for human-readable text. */
function strengthTier(value: number): string {
  if (value >= 0.85) return "strong";
  if (value >= 0.6) return "moderate";
  if (value >= 0.3) return "weak";
  return "very weak";
}

/**
 * Builds the human-readable explanation strictly from the four reasoning
 * components — never from the raw query text or anchor descriptions — so the
 * explanation can never say more than the numbers themselves justify.
 */
function buildExplanationDetail(reasoning: MatchReasoning, isAmbiguous: boolean): string {
  const parts = [
    `HS anchor identification: ${strengthTier(reasoning.hs_anchor_strength)} (${Math.round(reasoning.hs_anchor_strength * 100)}%).`,
    `Description compatibility with the target entry: ${strengthTier(reasoning.description_similarity)} (${Math.round(reasoning.description_similarity * 100)}%).`,
    isAmbiguous
      ? `National extension evidence: weak — this HS heading splits into multiple national codes and the query does not distinguish between them (${Math.round(reasoning.national_extension_evidence * 100)}%).`
      : `National extension evidence: ${strengthTier(reasoning.national_extension_evidence)} (${Math.round(reasoning.national_extension_evidence * 100)}%).`,
    reasoning.source_completeness >= 1
      ? "Source: verified national tariff row with a checkable citation."
      : "Source: not yet verified — pending import from an official schedule.",
  ];
  return parts.join(" ");
}

function missingAttributesFor(params: {
  isAmbiguous: boolean;
  isVague: boolean;
  descriptionSimilarity: number;
}): string[] {
  const { isAmbiguous, isVague, descriptionSimilarity } = params;
  const attrs = new Set<string>();
  if (isAmbiguous) {
    attrs.add("intended use");
    attrs.add("technical specification");
  }
  if (isVague || descriptionSimilarity < 0.5) {
    attrs.add("material");
    attrs.add("technical specification");
  }
  if (attrs.size === 0) return [];
  return [...attrs];
}

export function searchTariffMatches(
  rawQuery: string,
  queryType: QueryType,
  direction: Direction,
): TariffSearchResult {
  const query = rawQuery.trim();
  const sourceCountry = sourceCountryFor(direction);
  const targetCountry = targetCountryFor(direction);

  const anchorResolution = identifyAnchor(query, queryType, sourceCountry);
  const { anchor, basis, detail, hsAnchorStrength, comparisonText } = anchorResolution;
  const isVague = isVagueQuery(query, queryType);

  if (!anchor) {
    return {
      query,
      queryType,
      direction,
      anchorHsCode: null,
      manualReviewRequired: true,
      missing_attributes: ["material", "intended use", "technical specification"],
      matches: [],
    };
  }

  const targetEntries = entriesForCountry(targetCountry).filter(
    (entry) => entry.hsAnchor === anchor,
  );
  // True when the anchor splits into multiple target-country extensions with no
  // way (yet) to tell them apart from the query alone — used to force manual
  // review even if the raw confidence numbers look reassuring.
  const isAmbiguous = targetEntries.length > 1;
  const verifiedTargetEntries = targetEntries.filter((entry) => entry.verified);
  // Exact-match requires exactly one *verified* target extension — a single
  // extension that happens to still be pending import does not qualify.
  const hasSingleVerifiedTarget = verifiedTargetEntries.length === 1;
  // The source code resolved, but only via a fuzzy/prefix path, or the lookup
  // itself hit an unverified row — either way the source side isn't solid.
  const sourceLookupUnverified =
    queryType !== "description" && !anchorResolution.exactVerifiedSourceLookup;

  const candidates: (TariffMatch & { _isAnchorCandidate: boolean })[] = [];

  for (const entry of targetEntries) {
    const descriptionSimilarity = clamp01(
      jaccardSimilarity(tokenize(comparisonText), tokenize(entry.description)),
    );
    const nationalExtensionEvidence = isAmbiguous ? 0.4 : 1;
    const sourceCompleteness = entry.verified ? 1 : 0;

    let confidence =
      0.45 * hsAnchorStrength +
      0.35 * descriptionSimilarity +
      0.1 * nationalExtensionEvidence +
      0.1 * sourceCompleteness;

    // Confidence caps — applied after the weighted score so the reasoning
    // components above stay an honest, uncapped record of the evidence.
    if (isAmbiguous) confidence = Math.min(confidence, 0.84);
    if (queryType === "description") confidence = Math.min(confidence, 0.79);
    if (isVague || anchorResolution.multiplePlausibleAnchors) confidence = Math.min(confidence, 0.59);
    if (!entry.verified) confidence = Math.min(confidence, 0.39);
    confidence = clamp01(confidence);

    // Exact match is only reachable through a narrow, explicit gate — never
    // just because a source code happened to resolve cleanly.
    const exactMatchEligible =
      anchorResolution.exactVerifiedSourceLookup &&
      hasSingleVerifiedTarget &&
      entry.verified &&
      descriptionSimilarity >= 0.85 &&
      !!entry.source;

    const matchLabel = exactMatchEligible
      ? "exact_match"
      : labelForConfidence(Math.min(confidence, 0.89));

    const reasoning: MatchReasoning = {
      hs_anchor_strength: Number(hsAnchorStrength.toFixed(2)),
      description_similarity: Number(descriptionSimilarity.toFixed(2)),
      national_extension_evidence: Number(nationalExtensionEvidence.toFixed(2)),
      source_completeness: Number(sourceCompleteness.toFixed(2)),
    };

    candidates.push({
      code: entry.code,
      country: entry.country,
      description: entry.description,
      match_confidence: Number(confidence.toFixed(2)),
      matchLabel,
      explanation: {
        basis: isAmbiguous ? "tariff_book_structure" : basis,
        detail: buildExplanationDetail(reasoning, isAmbiguous),
      },
      reasoning,
      tariffRate: entry.verified ? entry.tariffRate : NOT_AVAILABLE_RATE,
      tariffNote: entry.tariffNote,
      source: entry.source,
      verified: entry.verified,
      _isAnchorCandidate: true,
    });
  }

  // Supplement with description-similarity candidates from the target country,
  // in case they surface additional plausible one-to-many matches, or as the
  // only source of candidates when the anchor itself has no direct entries.
  const queryTokens = tokenize(query);
  const targetCountryEntries = entriesForCountry(targetCountry);
  const seenCodes = new Set(candidates.map((c) => c.code));

  const scored = targetCountryEntries
    .filter((entry) => !seenCodes.has(entry.code))
    .map((entry) => ({
      entry,
      score: jaccardSimilarity(queryTokens, tokenize(entry.description)),
    }))
    .filter(({ score }) => score > 0.15)
    .sort((a, b) => b.score - a.score);

  for (const { entry, score } of scored) {
    if (candidates.length >= 5) break;
    const descriptionSimilarity = clamp01(score);
    const nationalExtensionEvidence = 0; // not reached via the shared anchor
    const sourceCompleteness = entry.verified ? 1 : 0;

    let confidence =
      0.45 * (hsAnchorStrength * 0.5) + // secondary candidate, anchor not shared
      0.35 * descriptionSimilarity +
      0.1 * nationalExtensionEvidence +
      0.1 * sourceCompleteness;
    confidence = Math.min(confidence, 0.65);
    // Secondary candidates never share the anchor, so they carry the same
    // ambiguity/vagueness caps as primary candidates — an unresolved anchor
    // or thin query undermines every candidate equally.
    if (isAmbiguous) confidence = Math.min(confidence, 0.84);
    if (queryType === "description") confidence = Math.min(confidence, 0.79);
    if (isVague || anchorResolution.multiplePlausibleAnchors) confidence = Math.min(confidence, 0.59);
    if (!entry.verified) confidence = Math.min(confidence, 0.39);
    confidence = clamp01(confidence);

    const reasoning: MatchReasoning = {
      hs_anchor_strength: Number((hsAnchorStrength * 0.5).toFixed(2)),
      description_similarity: Number(descriptionSimilarity.toFixed(2)),
      national_extension_evidence: 0,
      source_completeness: Number(sourceCompleteness.toFixed(2)),
    };

    candidates.push({
      code: entry.code,
      country: entry.country,
      description: entry.description,
      match_confidence: Number(confidence.toFixed(2)),
      matchLabel: labelForConfidence(Math.min(confidence, 0.89)),
      explanation: {
        basis: "semantic_description_similarity",
        detail: buildExplanationDetail(reasoning, isAmbiguous),
      },
      reasoning,
      tariffRate: entry.verified ? entry.tariffRate : NOT_AVAILABLE_RATE,
      tariffNote: entry.tariffNote,
      source: entry.source,
      verified: entry.verified,
      _isAnchorCandidate: false,
    });
  }

  candidates.sort((a, b) => b.match_confidence - a.match_confidence);
  const topFive = candidates.slice(0, 5);
  const matches: TariffMatch[] = topFive.map(({ _isAnchorCandidate, ...m }) => m);

  const topTwoWithinMargin =
    matches.length >= 2 && matches[0].match_confidence - matches[1].match_confidence <= 0.08;
  const noVerifiedCandidate = matches.length === 0 || matches.every((m) => !m.verified);
  const targetExtensionsDivergeBeyondHs6 = isAmbiguous;

  const manualReviewRequired =
    matches.length === 0 ||
    matches.every((m) => m.matchLabel === "manual_review_required") ||
    topTwoWithinMargin ||
    targetExtensionsDivergeBeyondHs6 ||
    noVerifiedCandidate ||
    anchorResolution.multiplePlausibleAnchors ||
    sourceLookupUnverified;

  const bestDescriptionSimilarity = matches.length
    ? Math.max(...matches.map((m) => m.reasoning.description_similarity))
    : 0;
  const missing_attributes = missingAttributesFor({
    isAmbiguous: targetExtensionsDivergeBeyondHs6,
    isVague,
    descriptionSimilarity: bestDescriptionSimilarity,
  });

  return {
    query,
    queryType,
    direction,
    anchorHsCode: anchor,
    manualReviewRequired,
    missing_attributes,
    matches,
  };
}

export function listTariffCodes(country?: Country): TariffCodeEntry[] {
  if (!country) return TARIFF_CODE_ENTRIES;
  return TARIFF_CODE_ENTRIES.filter((entry) => entry.country === country);
}
