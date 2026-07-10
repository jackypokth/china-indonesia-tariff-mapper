# China–Indonesia Tariff Mapper

Cross-references trade product descriptions (or HS/local tariff codes) between China and Indonesia, returning a scored classification with tariff rate, source citation, and an explanation of how confident the match is — and why.

## What's in this repo

| Artifact | Path | Purpose |
|---|---|---|
| **API Server** | `artifacts/api-server` | Express backend — tariff dataset, matching engine, `/api/tariff/*` routes |
| **China–Indonesia Tariff Mapper** | `artifacts/tariff-mapper` | React + Vite frontend — search UI, reference table, improvement panel |
| **Canvas / mockup sandbox** | `artifacts/mockup-sandbox` | Design/prototyping sandbox (not part of the shipped product) |

Shared API contract lives in `lib/api-spec/openapi.yaml`; running its codegen regenerates the typed client (`lib/api-client-react`) and Zod schemas (`lib/api-zod`) used by the frontend.

## How a search works (end to end)

1. **User submits a query** — either a free-text product description, an HS6+ code, or a local national tariff code — plus a trade direction (China→Indonesia or Indonesia→China).
2. **Anchor identification** (`identifyAnchor` in `tariffMatcher.ts`) resolves the query to a 6-digit HS heading:
   - Exact/prefix code lookups are deterministic.
   - Free-text descriptions go through **hybrid retrieval**: real BM25 keyword scoring + a local character-n-gram TF-IDF cosine score (a documented stand-in for embeddings — see [Model notes](#model-notes) below) are fused into a candidate shortlist, then an LLM (`gpt-5-mini`) picks the best anchor from that shortlist only. Any anchor the LLM names outside the shortlist is treated as a hallucination and discarded in favor of the top retrieval candidate.
3. **Per-candidate scoring** — every national tariff line under the resolved heading gets an absolute, independent `match_confidence`:

   ```
   match_confidence = 0.50 × hs_anchor_strength
                     + 0.30 × description_compatibility
                     + 0.20 × national_extension_specificity
   ```

   - `hs_anchor_strength` — how certain the heading-level resolution itself was (1.0 for an exact code, ~0.85 down to ~0.45 for retrieval-based matches, reduced if a competing heading was nearly as plausible).
   - `description_compatibility` — text similarity to the candidate line's description, adjusted up/down when the query explicitly states a distinguishing attribute (e.g. "wireless") that the candidate's own description agrees with or contradicts.
   - `national_extension_specificity` — how many sibling national lines share this heading (1.0 for a single line, 0.5 for two, 0.35 for three+), reflecting how much residual guessing is needed even after the heading is right.

   This score is **never** rank-normalized against other candidates, and **never** blended with tariff-rate or source-verification status.
4. **Ambiguity signal** — after all candidates are scored and sorted, `candidate_margin` (top score − runner-up score) drives `ambiguity_level` (`low` / `medium` / `high`). This is a separate signal from confidence, used purely to decide whether to ask the user for more detail.
5. **Improvement panel** — a single shared "Improve classification precision" panel (not per-candidate suggestions) appears only when `manual_review_required`, or `ambiguity_level` is `high`, or the matched product family has unanswered distinguishing attributes. Attributes the query already answers (e.g. "wireless bluetooth" answers "connection type") are never re-asked — see `classification_rules` in `classificationRules.ts` for the demo product families this covers (headphones, knit apparel, household plastics, milled rice, cutlery/hand tools).
6. **Tariff/source data is strictly separate** — `tariff_status` / `source_status` / `tariff_rate` describe data completeness and provenance only, and never influence `match_confidence` or `manual_review_required`. A confidently-classified item with no imported rate yet still shows high confidence and a `null` rate — never a fabricated placeholder number.

## How the dataset is built

`artifacts/api-server/src/lib/tariffData.ts` merges two layers at load time:

- **Base layer** — the full WCO HS 6-digit nomenclature, imported from UN Comtrade's classification reference. Headings without curated data get an auto-generated placeholder national code (rate = `null`, flagged as pending).
- **Curated overlay** — hand-verified national tariff lines with real rates, citations, and source references for a subset of headings. Curated entries always take precedence over the auto-generated placeholder for the same heading.

This lets the matcher operate over the entire nomenclature immediately, while accurate rates are added incrementally without touching the generated base data.

## Version history / how the scoring model evolved

The matching engine went through several rounds of correction as issues surfaced. Recorded here so the reasoning isn't lost:

1. **Initial build** — small ~16-anchor demo dataset, single blended confidence score.
2. **Full nomenclature expansion** — layered in the complete HS6 base dataset (see above) so any real-world code/description could resolve to *something*, with curated data overlaid for accuracy where available.
3. **Confidence/manual-review separation** — an early version let tariff-source completeness leak into `match_confidence` and `manual_review_required` (a fully-certain classification could show ~30% confidence just because its rate hadn't been imported yet). Fixed by making confidence and manual review classification-evidence-only, with tariff/source completeness reported in entirely separate fields.
4. **TRQ rate correction** — a verification pass against official China/Indonesia quota schedules caught reversed in-quota vs. out-of-quota rates for rice and sugar; corrected and re-cited.
5. **12-point UX/scoring overhaul** — introduced the current architecture: absolute per-candidate confidence, `candidate_margin`/`ambiguity_level` as a distinct ambiguity signal, hybrid BM25 + local-semantic retrieval with LLM-constrained anchor selection (replacing pure keyword matching), the `classification_rules` table for demo product families, and the single shared improvement panel (replacing noisy per-candidate suggestions).
6. **Attribute-aware scoring fix** — plain word-overlap similarity couldn't tell contradictory attribute values apart (e.g. "wired" vs. "wireless" share no common words, so a wired candidate scored nearly as high as the correct wireless one). Fixed by detecting when a query text unambiguously states a `classification_rules` attribute value, then rewarding/penalizing candidates whose description agrees or contradicts it — and using that same detection to stop the improvement panel from re-asking questions the query already answered.
7. **Ambiguity-forcing correction** — manual review was previously forced onto a candidate merely because a sibling national line or a weak alternate heading existed, even when one candidate was a clear winner. Fixed so manual review is driven only by a candidate's own match label plus the overall `candidate_margin`, never by the mere existence of a weaker alternative.
8. **Keyword-matching hardening** — the attribute-detection keyword check initially used plain substring matching, which false-positived on short keywords (e.g. "men" matching inside "women"). Fixed with word-boundary-safe matching.

## Model notes

Replit's managed OpenAI integration proxy does not expose an embeddings endpoint. "Semantic similarity" in the hybrid retriever is therefore a **local character n-gram TF-IDF cosine score**, not a true embedding — a deliberate, documented stand-in, fused with real BM25 keyword scoring. This is adequate for the current reference dataset size; a production system with a much larger catalog would benefit from a real embeddings provider.

## Running locally

- `pnpm --filter @workspace/api-server run dev` — API server
- `pnpm --filter @workspace/tariff-mapper run dev` — frontend
- `pnpm --filter @workspace/api-spec run codegen` — regenerate typed client/schemas after editing `lib/api-spec/openapi.yaml`
- `pnpm run typecheck` — typecheck all packages
