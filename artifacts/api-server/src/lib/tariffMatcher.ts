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
export type MatchBasis =
  | "shared_hs_digits"
  | "semantic_description_similarity"
  | "tariff_book_structure"
  | "exact_code_lookup";

export interface MatchExplanation {
  basis: MatchBasis;
  detail: string;
}

export interface TariffMatch {
  code: string;
  country: Country;
  description: string;
  confidence: number;
  matchLabel: MatchLabel;
  explanation: MatchExplanation;
  tariffRate: string | null;
  tariffNote: string | null;
  source: string;
}

export interface TariffSearchResult {
  query: string;
  queryType: QueryType;
  direction: Direction;
  anchorHsCode: string | null;
  manualReviewRequired: boolean;
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

/**
 * Identify the most likely HS 6-digit anchor for the given query, searching
 * within the source country's entries first (for hs_code / local_code lookups)
 * and falling back to description similarity across all entries.
 */
function identifyAnchor(
  query: string,
  queryType: QueryType,
  sourceCountry: Country,
): { anchor: string | null; basis: MatchBasis; detail: string } {
  if (queryType === "hs_code") {
    const digits = normalizeCode(query).replace(/[^0-9]/g, "");
    if (digits.length >= 6) {
      const anchor = digits.slice(0, 6);
      const known = TARIFF_CODE_ENTRIES.some((e) => e.hsAnchor === anchor);
      if (known) {
        return {
          anchor,
          basis: "exact_code_lookup",
          detail: `Interpreted "${query}" as HS heading ${anchor} (first 6 digits).`,
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
      };
    }
  }

  // description fallback: score against every entry's description, take the best anchor
  const queryTokens = tokenize(query);
  let bestScore = 0;
  let bestEntry: TariffCodeEntry | null = null;
  for (const entry of TARIFF_CODE_ENTRIES) {
    const score = jaccardSimilarity(queryTokens, tokenize(entry.description));
    if (score > bestScore) {
      bestScore = score;
      bestEntry = entry;
    }
  }
  if (bestEntry && bestScore > 0.08) {
    return {
      anchor: bestEntry.hsAnchor,
      basis: "semantic_description_similarity",
      detail: `"${query}" is most similar in wording to "${bestEntry.description}" (HS ${bestEntry.hsAnchor}).`,
    };
  }

  return {
    anchor: null,
    basis: "semantic_description_similarity",
    detail: `No reference description in the dataset shares enough wording with "${query}" to anchor a classification.`,
  };
}

function labelForConfidence(confidence: number): MatchLabel {
  if (confidence >= 0.9) return "exact_match";
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

  const { anchor, basis, detail } = identifyAnchor(
    query,
    queryType,
    sourceCountry,
  );

  if (!anchor) {
    return {
      query,
      queryType,
      direction,
      anchorHsCode: null,
      manualReviewRequired: true,
      matches: [],
    };
  }

  const targetEntries = entriesForCountry(targetCountry).filter(
    (entry) => entry.hsAnchor === anchor,
  );

  const candidates: TariffMatch[] = [];
  // True when the anchor splits into multiple target-country extensions with no
  // way (yet) to tell them apart from the query alone — used to force manual
  // review even if the raw confidence numbers look reassuring.
  const hasUnresolvedAmbiguity = targetEntries.length > 1;

  if (targetEntries.length > 0) {
    // Direct anchor match: confidence depends on how the anchor itself was found
    // and whether the target country has a single unambiguous extension or several.
    const isAmbiguous = targetEntries.length > 1;
    const baseConfidence =
      basis === "exact_code_lookup" ? 0.97 : basis === "tariff_book_structure" ? 0.8 : 0.72;

    for (const entry of targetEntries) {
      const perEntryPenalty = isAmbiguous ? 0.12 : 0;
      const confidence = Math.max(
        0.3,
        Math.min(0.99, baseConfidence - perEntryPenalty),
      );
      candidates.push({
        code: entry.code,
        country: entry.country,
        description: entry.description,
        confidence: Number(confidence.toFixed(2)),
        matchLabel: labelForConfidence(confidence),
        explanation: {
          basis: isAmbiguous ? "tariff_book_structure" : basis,
          detail: isAmbiguous
            ? `HS heading ${anchor} splits into ${targetEntries.length} national extensions in ${targetCountry}; "${entry.code}" is one of several plausible sub-classifications, so manual confirmation of the exact product attribute (e.g. size, use, material) is recommended.`
            : detail,
        },
        tariffRate: entry.tariffRate,
        tariffNote: entry.tariffNote,
        source: entry.source,
      });
    }
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
    const confidence = Math.max(0.2, Math.min(0.65, score * 1.4));
    candidates.push({
      code: entry.code,
      country: entry.country,
      description: entry.description,
      confidence: Number(confidence.toFixed(2)),
      matchLabel: labelForConfidence(confidence),
      explanation: {
        basis: "semantic_description_similarity",
        detail: `Description "${entry.description}" shares notable wording with the query, independent of the identified HS anchor — worth reviewing as a secondary candidate.`,
      },
      tariffRate: entry.tariffRate,
      tariffNote: entry.tariffNote,
      source: entry.source,
    });
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  const matches = candidates.slice(0, 5);
  const manualReviewRequired =
    matches.length === 0 ||
    matches.every((m) => m.matchLabel === "manual_review_required") ||
    hasUnresolvedAmbiguity;

  return {
    query,
    queryType,
    direction,
    anchorHsCode: anchor,
    manualReviewRequired,
    matches,
  };
}

export function listTariffCodes(country?: Country): TariffCodeEntry[] {
  if (!country) return TARIFF_CODE_ENTRIES;
  return TARIFF_CODE_ENTRIES.filter((entry) => entry.country === country);
}
