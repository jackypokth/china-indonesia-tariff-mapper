/**
 * Hybrid retrieval for description queries (item 8 of the UX/scoring spec).
 *
 * Three retrieval channels feed a small candidate set, then an LLM is asked
 * to pick the single best HS6 anchor *from that candidate set only* — it
 * never invents a code, and its answer is validated against the retrieved
 * list before being trusted.
 *
 *   1. Exact code / prefix lookup — handled separately in tariffMatcher.ts
 *      before this module is ever called (it's already a deterministic,
 *      100%-confidence path and doesn't need retrieval).
 *   2. Keyword retrieval — real BM25 over the tokenized HS6 description
 *      corpus.
 *   3. Semantic retrieval — a lightweight local character-n-gram TF-IDF
 *      cosine score. NOTE: the OpenAI integration available in this project
 *      does not expose the embeddings API, so this is a pragmatic
 *      local stand-in for "embedding similarity" (catches spelling/phrasing
 *      variation that pure word-level BM25 misses), not a true vector
 *      embedding. If/when a real embeddings endpoint is available, swap this
 *      function's internals without touching its callers.
 *
 * The two channels' scores are combined (reciprocal-rank fusion) to produce
 * the retrieved candidate set passed to the LLM.
 */
import { openai } from "@workspace/integrations-openai-ai-server";
import { TARIFF_CODE_ENTRIES, type TariffCodeEntry } from "./tariffData";

export interface RetrievedCandidate {
  hsAnchor: string;
  description: string;
  keywordScore: number;
  semanticScore: number;
  fusedScore: number;
}

export interface HybridRetrievalResult {
  candidates: RetrievedCandidate[];
  /** The anchor the LLM selected from `candidates`, or null if the LLM step
   * was skipped/failed/hallucinated and we fell back to the top fused candidate. */
  llmSelectedAnchor: string | null;
  llmRationale: string | null;
  /** True when the LLM's answer had to be discarded (invalid/hallucinated
   * anchor, request failure, or parse failure) and we fell back to retrieval-only. */
  llmFallbackUsed: boolean;
}

const STOPWORDS = new Set([
  "the", "a", "an", "of", "for", "and", "or", "with", "other", "not", "in", "to",
]);

function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map(stem);
}

function charNGrams(text: string, n = 3): Map<string, number> {
  const clean = text.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
  const grams = new Map<string, number>();
  for (let i = 0; i <= clean.length - n; i++) {
    const gram = clean.slice(i, i + n);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const v of a.values()) normA += v * v;
  for (const v of b.values()) normB += v * v;
  for (const [gram, va] of a) {
    const vb = b.get(gram);
    if (vb) dot += va * vb;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** One representative description per HS6 anchor, deduped across countries. */
function uniqueAnchorCorpus(): { hsAnchor: string; description: string }[] {
  const byAnchor = new Map<string, string>();
  for (const entry of TARIFF_CODE_ENTRIES) {
    if (!byAnchor.has(entry.hsAnchor)) byAnchor.set(entry.hsAnchor, entry.description);
  }
  return [...byAnchor.entries()].map(([hsAnchor, description]) => ({ hsAnchor, description }));
}

/** Real BM25 (k1=1.5, b=0.75) over the tokenized description corpus. */
function bm25Scores(queryTokens: string[], corpus: { hsAnchor: string; description: string }[]): Map<string, number> {
  const k1 = 1.5;
  const b = 0.75;
  const docs = corpus.map((c) => tokenize(c.description));
  const avgLen = docs.reduce((sum, d) => sum + d.length, 0) / Math.max(docs.length, 1);
  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const term of new Set(doc)) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const N = docs.length;
  const scores = new Map<string, number>();
  docs.forEach((doc, i) => {
    const termFreq = new Map<string, number>();
    for (const t of doc) termFreq.set(t, (termFreq.get(t) ?? 0) + 1);
    let score = 0;
    for (const qt of queryTokens) {
      const f = termFreq.get(qt) ?? 0;
      if (f === 0) continue;
      const n = df.get(qt) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + (b * doc.length) / avgLen));
    }
    scores.set(corpus[i].hsAnchor, score);
  });
  return scores;
}

/** Retrieve top-K candidate anchors via BM25 (keyword) + n-gram cosine
 * (semantic stand-in), fused by weighted-sum after min-max normalization. */
export function retrieveCandidates(query: string, topK = 8): RetrievedCandidate[] {
  const corpus = uniqueAnchorCorpus();
  const queryTokens = tokenize(query);
  const keyword = bm25Scores(queryTokens, corpus);
  const queryGrams = charNGrams(query);

  const raw = corpus.map((c) => ({
    hsAnchor: c.hsAnchor,
    description: c.description,
    keywordScore: keyword.get(c.hsAnchor) ?? 0,
    semanticScore: cosineSimilarity(queryGrams, charNGrams(c.description)),
  }));

  const maxKeyword = Math.max(...raw.map((r) => r.keywordScore), 1e-9);
  const maxSemantic = Math.max(...raw.map((r) => r.semanticScore), 1e-9);

  const fused = raw
    .map((r) => ({
      ...r,
      fusedScore: 0.6 * (r.keywordScore / maxKeyword) + 0.4 * (r.semanticScore / maxSemantic),
    }))
    .filter((r) => r.keywordScore > 0 || r.semanticScore > 0.15)
    .sort((a, b) => b.fusedScore - a.fusedScore)
    .slice(0, topK);

  return fused;
}

/**
 * Ask the LLM to pick the single best anchor from the retrieved candidates
 * only. The response is validated against the candidate list — any anchor
 * not present there is treated as a hallucination and discarded in favor of
 * the top retrieval-only candidate.
 */
export async function selectAnchorWithLLM(
  query: string,
  candidates: RetrievedCandidate[],
): Promise<{ selectedAnchor: string | null; rationale: string | null; fallbackUsed: boolean }> {
  if (candidates.length === 0) return { selectedAnchor: null, rationale: null, fallbackUsed: false };

  const candidateList = candidates
    .map((c, i) => `${i + 1}. HS6 ${c.hsAnchor}: ${c.description}`)
    .join("\n");

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 400,
      messages: [
        {
          role: "system",
          content:
            "You classify trade goods to a Harmonized System 6-digit (HS6) heading. " +
            "You MUST choose exactly one hs6_anchor from the numbered candidate list given " +
            "to you — never invent or modify a code. Respond with strict JSON only: " +
            '{"hs6_anchor": "<one of the given codes, digits only>", "rationale": "<one sentence>"}.',
        },
        {
          role: "user",
          content: `Product description: "${query}"\n\nCandidates:\n${candidateList}\n\nReturn the JSON only.`,
        },
      ],
    });
    const raw = response.choices[0]?.message?.content ?? "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { selectedAnchor: null, rationale: null, fallbackUsed: true };
    const parsed = JSON.parse(jsonMatch[0]) as { hs6_anchor?: string; rationale?: string };
    const anchor = (parsed.hs6_anchor ?? "").replace(/[^0-9]/g, "");
    const validCandidate = candidates.find((c) => c.hsAnchor === anchor);
    if (!validCandidate) {
      // The model picked something outside the retrieved set — discard it.
      return { selectedAnchor: null, rationale: null, fallbackUsed: true };
    }
    return { selectedAnchor: anchor, rationale: parsed.rationale ?? null, fallbackUsed: false };
  } catch {
    // Network/API failure — retrieval-only fallback keeps the feature usable
    // even if the LLM call is unavailable.
    return { selectedAnchor: null, rationale: null, fallbackUsed: true };
  }
}

export async function hybridRetrieveAnchor(query: string): Promise<HybridRetrievalResult> {
  const candidates = retrieveCandidates(query);
  if (candidates.length === 0) {
    return { candidates: [], llmSelectedAnchor: null, llmRationale: null, llmFallbackUsed: false };
  }
  const { selectedAnchor, rationale, fallbackUsed } = await selectAnchorWithLLM(query, candidates);
  return {
    candidates,
    llmSelectedAnchor: selectedAnchor ?? candidates[0].hsAnchor,
    llmRationale: rationale,
    llmFallbackUsed: fallbackUsed,
  };
}
