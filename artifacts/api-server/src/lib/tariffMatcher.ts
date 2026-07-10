import {
  TARIFF_CODE_ENTRIES,
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
export type SourceStatus =
  | "official tariff schedule"
  | "public nomenclature source"
  | "tariff data pending"
  | "source unavailable";
export type TariffStatus = "available" | "not available in current source data" | "not applicable";

/**
 * Transparent breakdown of the classification-only confidence formula:
 *   match_confidence =
 *     0.50 * hs_anchor_strength +
 *     0.30 * description_compatibility +
 *     0.20 * national_extension_specificity
 * This is computed EXCLUSIVELY from classification evidence. It must never be
 * blended with, or capped by, tariff-source verification/completeness — a
 * classification can be 100% certain while the tariff rate itself is still
 * pending import, and the two facts are surfaced through separate fields
 * (`tariff_status` / `source_status`) instead of dragging confidence down.
 */
export interface MatchReasoning {
  hs_anchor_strength: number;
  description_compatibility: number;
  national_extension_specificity: number;
  /** Human-readable explanation generated only from the three components above. */
  explanation: string;
}

export interface TariffMatch {
  matched_code: string;
  hs6_anchor: string;
  country: Country;
  description: string;
  /** Heuristic 0-1 score, NOT an empirically calibrated probability, and NOT
   * influenced by tariff-source completeness. */
  match_confidence: number;
  match_label: MatchLabel;
  /** True only when classification evidence itself is ambiguous/insufficient —
   * never true merely because a tariff rate hasn't been imported yet. */
  manual_review_required: boolean;
  /** Product attributes that would help disambiguate this specific candidate. */
  missing_attributes: string[];
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
   * at all, or every candidate individually requires manual review. Prefer
   * each match's own `manual_review_required` for per-candidate decisions. */
  manualReviewRequired: boolean;
  /** Union of every candidate's `missing_attributes`, for a single top-of-page hint. */
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
  /** Text to use as the "source side" description for similarity scoring
   * against target candidates — the source entry's own description when the
   * query resolved via a code lookup, otherwise the raw query text. */
  comparisonText: string;
  /** 0-1: how strongly the source query pins down this HS6 anchor, per the
   * fixed tiers in the spec (1.0 exact code, 0.85 strong description match,
   * lower for fuzzy/prefix). */
  hsAnchorStrength: number;
  /** True only when the query resolved via an EXACT, non-fuzzy code lookup to
   * a real classification entry — this is about classification certainty,
   * never about whether that entry's tariff rate has been verified. */
  sourceResolutionVerified: boolean;
  /** True when a second, meaningfully different anchor is nearly as
   * plausible as the chosen one — an ambiguous-classification signal. */
  multiplePlausibleAnchors: boolean;
  /** True when the input code/text could not be resolved to any known
   * classification at all (invalid/not-found code). */
  invalidOrNotFound: boolean;
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
          comparisonText: knownEntry.description,
          hsAnchorStrength: 1,
          sourceResolutionVerified: true,
          multiplePlausibleAnchors: false,
          invalidOrNotFound: false,
        };
      }
    }
    return {
      anchor: null,
      comparisonText: query,
      hsAnchorStrength: 0,
      sourceResolutionVerified: false,
      multiplePlausibleAnchors: false,
      invalidOrNotFound: true,
    };
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
        comparisonText: exact.description,
        hsAnchorStrength: 1,
        sourceResolutionVerified: true,
        multiplePlausibleAnchors: false,
        invalidOrNotFound: false,
      };
    }
    // Try prefix match against source country national codes — a genuine
    // fuzzy/partial match, so it earns a reduced anchor strength, never 1.0.
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
      const ratio = clamp01(bestPrefixLen / normalizedQuery.length);
      return {
        anchor: bestPrefix.hsAnchor,
        comparisonText: bestPrefix.description,
        hsAnchorStrength: clamp01(ratio * 0.75),
        sourceResolutionVerified: false,
        multiplePlausibleAnchors: false,
        invalidOrNotFound: false,
      };
    }
    return {
      anchor: null,
      comparisonText: query,
      hsAnchorStrength: 0,
      sourceResolutionVerified: false,
      multiplePlausibleAnchors: false,
      invalidOrNotFound: true,
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
    // Tiered anchor strength per spec: 0.85 for a strong description match,
    // scaled lower for weaker (but still credible) fuzzy matches.
    let hsAnchorStrength: number;
    if (best.score >= 0.35) hsAnchorStrength = 0.85;
    else if (best.score >= 0.2) hsAnchorStrength = 0.65;
    else hsAnchorStrength = 0.45;
    return {
      anchor: best.entry.hsAnchor,
      comparisonText: query,
      hsAnchorStrength,
      sourceResolutionVerified: false,
      multiplePlausibleAnchors,
      invalidOrNotFound: false,
    };
  }

  return {
    anchor: null,
    comparisonText: query,
    hsAnchorStrength: 0,
    sourceResolutionVerified: false,
    multiplePlausibleAnchors: false,
    invalidOrNotFound: true,
  };
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
 * Builds the human-readable explanation strictly from the three classification
 * reasoning components — never from tariff/source verification state — so the
 * explanation can never say more than the classification evidence justifies.
 */
function buildExplanation(
  reasoning: Omit<MatchReasoning, "explanation">,
  targetLineCount: number,
): string {
  const parts = [
    `HS anchor identification: ${strengthTier(reasoning.hs_anchor_strength)} (${Math.round(reasoning.hs_anchor_strength * 100)}%).`,
    `Description compatibility with the target entry: ${strengthTier(reasoning.description_compatibility)} (${Math.round(reasoning.description_compatibility * 100)}%).`,
    targetLineCount > 1
      ? `National extension specificity: this HS heading splits into ${targetLineCount} national lines and the input does not distinguish between them (${Math.round(reasoning.national_extension_specificity * 100)}%).`
      : `National extension specificity: a single national line is uniquely supported (${Math.round(reasoning.national_extension_specificity * 100)}%).`,
  ];
  return parts.join(" ");
}

function sourceStatusFor(entry: TariffCodeEntry): SourceStatus {
  if (entry.verified) return "official tariff schedule";
  // An unverified entry that already carries a placeholder/staged rate is
  // one step further along than a bare nomenclature anchor: the rate is
  // known to be coming, just not yet curated from an official schedule.
  if (entry.source && entry.tariffRate) return "tariff data pending";
  if (entry.source) return "public nomenclature source";
  return "source unavailable";
}

function tariffStatusFor(entry: TariffCodeEntry): TariffStatus {
  return entry.verified && entry.tariffRate ? "available" : "not available in current source data";
}

function missingAttributesFor(params: {
  isAmbiguous: boolean;
  descriptionCompatibility: number;
}): string[] {
  const { isAmbiguous, descriptionCompatibility } = params;
  const attrs = new Set<string>();
  if (isAmbiguous) {
    attrs.add("intended use");
    attrs.add("technical specification");
  }
  if (descriptionCompatibility < 0.5) {
    attrs.add("material");
    attrs.add("technical specification");
  }
  return [...attrs];
}

function labelForMatch(params: {
  confidence: number;
  sourceResolutionVerified: boolean;
  uniqueTargetLine: boolean;
  descriptionCompatibility: number;
}): MatchLabel {
  const { confidence, sourceResolutionVerified, uniqueTargetLine, descriptionCompatibility } = params;
  if (
    confidence >= 0.9 &&
    sourceResolutionVerified &&
    uniqueTargetLine &&
    descriptionCompatibility >= 0.85
  ) {
    return "exact_match";
  }
  if (confidence >= 0.7) return "likely_match";
  if (confidence >= 0.4) return "partial_match";
  return "manual_review_required";
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
  const { anchor, hsAnchorStrength, comparisonText, sourceResolutionVerified, multiplePlausibleAnchors, invalidOrNotFound } =
    anchorResolution;

  if (!anchor) {
    return {
      query,
      queryType,
      direction,
      anchorHsCode: null,
      manualReviewRequired: true,
      missing_attributes: invalidOrNotFound
        ? []
        : ["material", "intended use", "technical specification"],
      matches: [],
    };
  }

  const targetEntries = entriesForCountry(targetCountry).filter(
    (entry) => entry.hsAnchor === anchor,
  );
  // True when the anchor splits into multiple target-country extensions with
  // no way (yet) to tell them apart from the input alone — a genuine
  // classification-ambiguity signal, independent of tariff-data completeness.
  const isAmbiguous = targetEntries.length > 1;
  const nationalExtensionSpecificity = isAmbiguous
    ? targetEntries.length === 2
      ? 0.5
      : 0.35
    : 1;

  const candidates: TariffMatch[] = [];

  for (const entry of targetEntries) {
    const descriptionCompatibility = clamp01(
      jaccardSimilarity(tokenize(comparisonText), tokenize(entry.description)),
    );

    const confidence = clamp01(
      0.5 * hsAnchorStrength + 0.3 * descriptionCompatibility + 0.2 * nationalExtensionSpecificity,
    );

    const matchLabel = labelForMatch({
      confidence,
      sourceResolutionVerified,
      uniqueTargetLine: !isAmbiguous,
      descriptionCompatibility,
    });

    const reasoningCore = {
      hs_anchor_strength: Number(hsAnchorStrength.toFixed(2)),
      description_compatibility: Number(descriptionCompatibility.toFixed(2)),
      national_extension_specificity: Number(nationalExtensionSpecificity.toFixed(2)),
    };

    // Manual review is driven ONLY by classification ambiguity — never by
    // tariff-rate or source-verification completeness. A multi-line anchor
    // only counts as ambiguous when nothing in the input distinguishes the
    // candidates (i.e. description compatibility is too weak to pick a
    // clear winner among them) — a specific, well-matched description can
    // still land on a single confident candidate.
    const extensionAmbiguityUnresolved = isAmbiguous && descriptionCompatibility < 0.7;
    const manual_review_required =
      matchLabel === "manual_review_required" || extensionAmbiguityUnresolved || multiplePlausibleAnchors;

    const missing_attributes = missingAttributesFor({
      isAmbiguous: extensionAmbiguityUnresolved,
      descriptionCompatibility,
    });

    candidates.push({
      matched_code: entry.code,
      hs6_anchor: entry.hsAnchor,
      country: entry.country,
      description: entry.description,
      match_confidence: Number(confidence.toFixed(2)),
      match_label: matchLabel,
      manual_review_required,
      missing_attributes,
      reasoning: {
        ...reasoningCore,
        explanation: buildExplanation(reasoningCore, targetEntries.length),
      },
      tariff_rate: entry.verified ? entry.tariffRate : null,
      tariff_note: entry.tariffNote,
      tariff_status: tariffStatusFor(entry),
      source_status: sourceStatusFor(entry),
      source_references: [entry.source, entry.citation].filter((s): s is string => !!s),
    });
  }

  // Supplement with description-similarity candidates from the target country,
  // in case they surface additional plausible one-to-many matches, or as the
  // only source of candidates when the anchor itself has no direct entries.
  const queryTokens = tokenize(query);
  const targetCountryEntries = entriesForCountry(targetCountry);
  const seenCodes = new Set(candidates.map((c) => c.matched_code));

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
    const descriptionCompatibility = clamp01(score);
    // Secondary candidates don't share the resolved anchor, so their anchor
    // strength is inherently weaker — a fuzzy signal, never full strength.
    const secondaryAnchorStrength = clamp01(hsAnchorStrength * 0.5);
    const secondaryNationalExtensionSpecificity = 0.3; // not reached via the shared anchor

    const confidence = clamp01(
      0.5 * secondaryAnchorStrength +
        0.3 * descriptionCompatibility +
        0.2 * secondaryNationalExtensionSpecificity,
    );

    const matchLabel = labelForMatch({
      confidence,
      sourceResolutionVerified: false,
      uniqueTargetLine: false,
      descriptionCompatibility,
    });

    const reasoningCore = {
      hs_anchor_strength: Number(secondaryAnchorStrength.toFixed(2)),
      description_compatibility: Number(descriptionCompatibility.toFixed(2)),
      national_extension_specificity: Number(secondaryNationalExtensionSpecificity.toFixed(2)),
    };

    const missing_attributes = missingAttributesFor({
      isAmbiguous: true,
      descriptionCompatibility,
    });

    candidates.push({
      matched_code: entry.code,
      hs6_anchor: entry.hsAnchor,
      country: entry.country,
      description: entry.description,
      match_confidence: Number(confidence.toFixed(2)),
      match_label: matchLabel,
      // Secondary candidates never resolved through a verified anchor, so a
      // weak fuzzy anchor signal is itself a "no credible anchor" trigger —
      // not a blanket true regardless of evidence strength.
      manual_review_required: matchLabel === "manual_review_required" || secondaryAnchorStrength < 0.5,
      missing_attributes,
      reasoning: {
        ...reasoningCore,
        explanation: buildExplanation(reasoningCore, 2),
      },
      tariff_rate: entry.verified ? entry.tariffRate : null,
      tariff_note: entry.tariffNote,
      tariff_status: tariffStatusFor(entry),
      source_status: sourceStatusFor(entry),
      source_references: [entry.source, entry.citation].filter((s): s is string => !!s),
    });
  }

  candidates.sort((a, b) => b.match_confidence - a.match_confidence);
  const matches = candidates.slice(0, 5);

  // Two close top candidates is itself a classification-ambiguity signal
  // (requirement #3 of the manual-review trigger list) — flag both.
  if (matches.length >= 2 && matches[0].match_confidence - matches[1].match_confidence <= 0.08) {
    matches[0].manual_review_required = true;
    matches[1].manual_review_required = true;
  }

  const manualReviewRequired = matches.length === 0 || matches.every((m) => m.manual_review_required);
  const missing_attributes = [...new Set(matches.flatMap((m) => m.missing_attributes))];

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
