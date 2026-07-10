import {
  TARIFF_CODE_ENTRIES,
  type Country,
  type TariffCodeEntry,
} from "./tariffData";
import { findRuleForAnchor, type ClassificationRule } from "./classificationRules";
import { hybridRetrieveAnchor, type RetrievedCandidate } from "./hybridRetrieval";

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
 * Transparent breakdown of the classification-only confidence formula:
 *   match_confidence =
 *     0.50 * hs_anchor_strength +
 *     0.30 * description_compatibility +
 *     0.20 * national_extension_specificity
 * This is computed EXCLUSIVELY from classification evidence, per-candidate,
 * and is never normalized or ranked against other candidates, and never
 * blended with, or capped by, tariff-source verification/completeness.
 * Cross-candidate ambiguity is instead surfaced separately via
 * `candidate_margin` / `ambiguity_level` on the search result.
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
  /** Absolute, per-candidate heuristic 0-1 score, NOT rank-derived, NOT
   * normalized against other candidates, and NOT influenced by tariff-source
   * completeness. */
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
  /** Present only for description queries resolved via hybrid retrieval —
   * surfaced for transparency/debugging, not used in scoring. */
  retrieval?: {
    candidates: RetrievedCandidate[];
    llmSelectedAnchor: string | null;
    llmRationale: string | null;
    llmFallbackUsed: boolean;
  };
}

/**
 * Identify the most likely HS 6-digit anchor for the given query.
 *  - hs_code / local_code: deterministic exact/prefix lookup (unchanged) —
 *    this is already a retrieval step, just a trivial one.
 *  - description: hybrid retrieval (BM25 keyword + local semantic score) to
 *    build a small candidate set, then an LLM selects the best anchor from
 *    that set only (see hybridRetrieval.ts). Falls back to the top retrieval
 *    candidate if the LLM is unavailable or hallucinates a code outside the
 *    candidate set.
 */
async function identifyAnchor(
  query: string,
  queryType: QueryType,
  sourceCountry: Country,
): Promise<AnchorResolution> {
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

  // description queries: hybrid retrieval (BM25 + local semantic score) +
  // LLM anchor selection constrained to the retrieved set.
  const { candidates, llmSelectedAnchor, llmRationale, llmFallbackUsed } =
    await hybridRetrieveAnchor(query);

  if (candidates.length === 0 || !llmSelectedAnchor) {
    return {
      anchor: null,
      comparisonText: query,
      hsAnchorStrength: 0,
      sourceResolutionVerified: false,
      multiplePlausibleAnchors: false,
      invalidOrNotFound: true,
    };
  }

  const chosen = candidates.find((c) => c.hsAnchor === llmSelectedAnchor) ?? candidates[0];
  const runnerUp = candidates.find((c) => c.hsAnchor !== chosen.hsAnchor);
  // Ambiguous if a distinct retrieved anchor scores nearly as well as the
  // chosen one in the fused retrieval ranking.
  const multiplePlausibleAnchors =
    !!runnerUp && runnerUp.fusedScore > 0 && chosen.fusedScore - runnerUp.fusedScore < 0.1;

  // Tiered anchor strength per spec: 0.85 for a strong retrieval+LLM match,
  // scaled lower for weaker (but still credible) fused retrieval scores.
  let hsAnchorStrength: number;
  if (chosen.fusedScore >= 0.6) hsAnchorStrength = 0.85;
  else if (chosen.fusedScore >= 0.35) hsAnchorStrength = 0.65;
  else hsAnchorStrength = 0.45;

  // Anchor-selection ambiguity (a near-tied competing anchor in retrieval)
  // is itself classification evidence about how strongly the query pins
  // down THIS anchor — so it belongs inside hsAnchorStrength, not as a
  // separate blanket "force manual review" flag. Folding it into the score
  // this way means it still surfaces (lower confidence -> possibly a lower
  // match_label, and a smaller candidate_margin/higher ambiguity_level if
  // the competing anchor's own candidates make it into the result set) even
  // in the edge case where the competing anchor doesn't survive far enough
  // downstream to appear in the final `matches` list itself.
  if (multiplePlausibleAnchors) hsAnchorStrength = clamp01(hsAnchorStrength - 0.15);

  return {
    anchor: chosen.hsAnchor,
    comparisonText: query,
    hsAnchorStrength,
    sourceResolutionVerified: false,
    multiplePlausibleAnchors,
    invalidOrNotFound: false,
    retrieval: { candidates, llmSelectedAnchor, llmRationale, llmFallbackUsed },
  };
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

/**
 * For a classification rule, detect which attributes the raw query text
 * already pins down unambiguously — exactly one option's keywords appear,
 * and no other option's keywords for that same attribute do. Used to:
 *   (a) avoid re-asking a question the user already answered in free text,
 *   (b) reward/penalize candidate descriptions that agree/disagree with the
 *       detected value — a targeted contradiction signal that plain
 *       word-overlap similarity misses entirely (e.g. "wired" and
 *       "wireless" share zero overlapping tokens with each other despite
 *       being direct opposites).
 */
function detectAttributeSignals(
  queryLower: string,
  rule: ClassificationRule,
): Map<string, AttributeSignal> {
  const signals = new Map<string, AttributeSignal>();
  for (const attr of rule.requiredAttributes) {
    const options = rule.attributeOptions[attr] ?? [];
    if (options.length < 2) continue;
    const matchedOptions = options.filter((opt) =>
      attributeOptionKeywords(opt).some((kw) => containsKeyword(queryLower, kw)),
    );
    if (matchedOptions.length !== 1) continue; // no signal, or the query itself is ambiguous
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

/** Bonus/penalty applied to description_compatibility for a single
 * candidate, based on whether its description text agrees or contradicts
 * the attribute values the query already signaled (see detectAttributeSignals).
 * Never applied when the query gave no signal for an attribute. */
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

/** Attributes that would distinguish the top two candidates, sourced from
 * the classification_rules table for the top anchor when covered, else a
 * generic fallback used only while genuinely ambiguous. Attributes the query
 * already answers unambiguously (per `answeredAttributes`) are excluded —
 * the panel should never re-ask a question the free-text query already
 * settled. */
function requiredAttributesFor(params: {
  ambiguityLevel: AmbiguityLevel;
  topAnchor: string | null;
  topDescriptionCompatibility: number;
  answeredAttributes: Set<string>;
}): { rule: ClassificationRule | null; attributes: string[] } {
  const { ambiguityLevel, topAnchor, topDescriptionCompatibility, answeredAttributes } = params;
  if (ambiguityLevel === "low") return { rule: null, attributes: [] };

  const rule = findRuleForAnchor(topAnchor);
  if (rule) {
    return {
      rule,
      attributes: rule.requiredAttributes.filter((attr) => !answeredAttributes.has(attr)),
    };
  }

  // No demo rule covers this anchor — fall back to a generic hint set, but
  // only when there's genuine reason to ask (medium/high ambiguity or a weak
  // description match).
  if (ambiguityLevel === "high" || topDescriptionCompatibility < 0.5) {
    return { rule: null, attributes: ["material", "intended use", "technical specification"] };
  }
  return { rule: null, attributes: [] };
}

export async function searchTariffMatches(
  rawQuery: string,
  queryType: QueryType,
  direction: Direction,
): Promise<TariffSearchResult> {
  const query = rawQuery.trim();
  const sourceCountry = sourceCountryFor(direction);
  const targetCountry = targetCountryFor(direction);

  const anchorResolution = await identifyAnchor(query, queryType, sourceCountry);
  const { anchor, hsAnchorStrength, comparisonText, sourceResolutionVerified, invalidOrNotFound } =
    anchorResolution;

  if (!anchor) {
    return {
      query,
      queryType,
      direction,
      anchorHsCode: null,
      manualReviewRequired: true,
      // Consistent with the "fewer than two candidates" convention used
      // elsewhere: no competing alternative exists, so margin is trivially
      // maximal. ambiguity_level is still forced to "high" here because zero
      // candidates is itself a hard manual-review trigger, independent of margin.
      candidate_margin: 1,
      ambiguity_level: "high",
      required_attributes: invalidOrNotFound ? [] : ["material", "intended use", "technical specification"],
      missing_attributes: invalidOrNotFound ? [] : ["material", "intended use", "technical specification"],
      attribute_options: {},
      improvement_panel_visible: !invalidOrNotFound,
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
  const queryLower = query.toLowerCase();
  const primaryRule = findRuleForAnchor(anchor);
  const primarySignals = primaryRule ? detectAttributeSignals(queryLower, primaryRule) : new Map();

  for (const entry of targetEntries) {
    const descriptionCompatibility = clamp01(
      jaccardSimilarity(tokenize(comparisonText), tokenize(entry.description)) +
        attributeCompatibilityAdjustment(entry.description.toLowerCase(), primarySignals),
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
    // tariff-rate or source-verification completeness. Whether ambiguity
    // (either between sibling national lines, or between competing anchor
    // candidates from retrieval) is actually *unresolved* is a
    // cross-candidate question — is there a clear winner overall? — so it is
    // decided once, after ALL candidates (including cross-anchor ones) are
    // scored and sorted, via candidate_margin/ambiguity_level below. A
    // single candidate's own label/compatibility score in isolation must
    // never force manual review just because a sibling or a weaker
    // alternative anchor also exists — that would flag a clearly-winning
    // top candidate for no real reason.
    const manual_review_required = matchLabel === "manual_review_required";

    candidates.push({
      matched_code: entry.code,
      hs6_anchor: entry.hsAnchor,
      country: entry.country,
      description: entry.description,
      match_confidence: Number(confidence.toFixed(2)),
      match_label: matchLabel,
      manual_review_required,
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
    const secondaryRule = findRuleForAnchor(entry.hsAnchor);
    const secondarySignals = secondaryRule
      ? detectAttributeSignals(queryLower, secondaryRule)
      : new Map();
    const descriptionCompatibility = clamp01(
      score + attributeCompatibilityAdjustment(entry.description.toLowerCase(), secondarySignals),
    );
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

  // Sort by absolute match_confidence — NOT re-normalized, NOT rank-derived.
  candidates.sort((a, b) => b.match_confidence - a.match_confidence);
  const matches = candidates.slice(0, 5);

  const candidate_margin =
    matches.length >= 2 ? Number((matches[0].match_confidence - matches[1].match_confidence).toFixed(2)) : 1;
  const ambiguity_level = ambiguityLevelFor(
    matches[0]?.match_confidence ?? 0,
    candidate_margin,
    matches.length,
  );

  // Close top-two margin is itself a classification-ambiguity signal — flag
  // both candidates for manual review even if each looked fine alone.
  if (matches.length >= 2 && ambiguity_level === "high") {
    matches[0].manual_review_required = true;
    matches[1].manual_review_required = true;
  }

  const topAnchor = matches[0]?.hs6_anchor ?? null;
  const topRule = findRuleForAnchor(topAnchor);
  const topAnsweredAttributes = new Set(
    topRule ? detectAttributeSignals(queryLower, topRule).keys() : [],
  );

  const { rule, attributes: required_attributes } = requiredAttributesFor({
    ambiguityLevel: ambiguity_level,
    topAnchor,
    topDescriptionCompatibility: matches[0]?.reasoning.description_compatibility ?? 0,
    answeredAttributes: topAnsweredAttributes,
  });
  const attribute_options = rule?.attributeOptions ?? {};

  const manualReviewRequired = matches.length === 0 || matches.every((m) => m.manual_review_required);

  // Item 5: the single shared panel shows only when genuinely warranted —
  // never for a clear, high-separation match.
  const improvement_panel_visible =
    manualReviewRequired || ambiguity_level === "high" || required_attributes.length > 0;

  return {
    query,
    queryType,
    direction,
    anchorHsCode: anchor,
    manualReviewRequired,
    candidate_margin,
    ambiguity_level,
    required_attributes,
    // No structured-details answers are merged into this query yet, so
    // everything required is also currently missing.
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
