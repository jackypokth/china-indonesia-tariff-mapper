# China–Indonesia Tariff Mapper

Cross-references trade product descriptions (or HS/local tariff codes) between China and Indonesia, returning a scored classification with tariff rate, source citation, and an explanation of how confident the match is — and why.

---

## Repository Structure

| Path | Purpose |
|---|---|
| `artifacts/api-server` | Express backend — tariff dataset, matching engine, `/api/tariff/*` routes |
| `artifacts/tariff-mapper` | React + Vite frontend — search UI, reference table, improvement panel |
| `artifacts/mockup-sandbox` | Design/prototyping sandbox (not part of the shipped product) |
| `lib/api-spec/openapi.yaml` | Single source of truth for the API contract |
| `lib/api-client-react` | Auto-generated typed React hooks (from OpenAPI via Orval) |
| `lib/api-zod` | Auto-generated Zod schemas (from OpenAPI via Orval) |
| `lib/db` | Drizzle ORM schema and migrations |
| `reflection.md` | Project reflection — what worked, limitations, and improvement roadmap |
| `chat_logs/` | Chat session logs — manually add prompt logs here for reference |
| `attached_assets/` | Uploaded reference files and prompt documents |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript 5.9 (monorepo-wide) |
| Monorepo | pnpm Workspaces |
| Backend | Node.js 24, Express 5 |
| Frontend | React 19, Vite 7, Tailwind CSS v4 |
| State / Data fetching | TanStack Query v5 |
| UI Components | Radix UI, Lucide React, Framer Motion |
| Database | PostgreSQL + Drizzle ORM |
| Validation | Zod (v4), drizzle-zod |
| API codegen | Orval (from OpenAPI spec) |
| LLM | OpenAI gpt-4o-mini (via Replit managed proxy) |

---

## How a Search Works (End to End)

1. **User submits a query** — either a free-text product description, an HS6+ code, or a local national tariff code — plus a trade direction (China→Indonesia or Indonesia→China).

2. **Anchor identification** (`identifyAnchor` in `tariffMatcher.ts`) resolves the query to a 6-digit HS heading:
   - Exact/prefix code lookups are deterministic.
   - Free-text descriptions go through **hybrid retrieval**: BM25 keyword scoring + a local character n-gram TF-IDF cosine score are fused into a candidate shortlist, then an LLM picks the best anchor from that shortlist only. Any anchor named outside the shortlist is treated as a hallucination and discarded.

3. **Per-candidate scoring** — every national tariff line under the resolved heading gets an absolute, independent `match_confidence` using an attribute-first, hierarchical formula:

   ```
   match_confidence = 0.40 × product_type_match
                     + 0.25 × function_match
                     + 0.15 × attribute_match
                     + 0.10 × text_semantic_similarity
                     + 0.10 × national_extension_specificity
   ```

   - `product_type_match` — whether the query's product type maps to this heading. Weighted highest to prevent material/usage keywords from pulling in adjacent headings (e.g. "stainless steel table knives" must resolve to HS 8211, not the broader HS 7323 even though it shares more words).
   - `function_match` — whether the candidate's primary function matches the query's stated purpose.
   - `attribute_match` — supporting signal for distinguishing attributes (material, form, use). Cannot dominate product type or function.
   - `text_semantic_similarity` — raw text overlap between query and candidate description. Minor signal only.
   - `national_extension_specificity` — how many sibling national lines share the heading (1.0 for one line, 0.5 for two, 0.35 for three+). Reflects residual guessing needed even after the heading is correct.

   This score is **never** rank-normalised against other candidates and **never** blended with tariff-rate or source-verification status.

4. **Ambiguity signal** — after all candidates are scored, `candidate_margin` (top score − runner-up) drives `ambiguity_level` (`low` / `medium` / `high`). Separate from confidence — used only to decide whether to prompt the user for more detail.

5. **Improvement panel** — appears only when `manual_review_required`, or `ambiguity_level` is `high`, or the matched product family has unanswered distinguishing attributes. Attributes the query already answers are never re-asked. See `classificationRules.ts` for the product families covered (headphones, knit apparel, household plastics, milled rice, cutlery/hand tools).

6. **Tariff/source data is strictly separate** — `tariff_status`, `source_status`, and `tariff_rate` describe data completeness and provenance only. They never influence `match_confidence` or `manual_review_required`. A confidently-classified item with no imported rate shows high confidence and a `null` rate — never a fabricated placeholder.

---

## How the Dataset Is Built

`artifacts/api-server/src/lib/tariffData.ts` merges two layers at load time:

- **Base layer** — the full WCO HS 6-digit nomenclature (UN Comtrade classification reference). Headings without curated data get an auto-generated placeholder (rate = `null`, flagged as pending).
- **Curated overlay** — hand-verified national tariff lines with real rates, citations, and source references. Curated entries always take precedence over auto-generated placeholders for the same heading.

This lets the matcher operate over the entire nomenclature immediately, while accurate rates are added incrementally.

---

## Scoring Model — Version History

| Version | Change |
|---|---|
| v1 | Initial build — small ~16-anchor demo dataset, single blended confidence score |
| v2 | Full HS6 nomenclature expansion with curated overlay |
| v3 | Confidence/manual-review separation — tariff-source completeness removed from match confidence |
| v4 | TRQ rate correction — reversed in-quota vs. out-of-quota rates fixed for rice and sugar |
| v5 | 12-point UX/scoring overhaul — absolute per-candidate confidence, `candidate_margin`/`ambiguity_level`, hybrid BM25 + local-semantic retrieval, single shared improvement panel |
| v6 | Attribute-aware scoring — contradictory attribute values (e.g. "wired" vs. "wireless") now reward/penalise candidates; improvement panel no longer re-asks answered attributes |
| v7 | Ambiguity-forcing fix — manual review now driven only by a candidate's own match label + `candidate_margin`, never by the existence of weaker alternatives |
| v8 | Keyword-matching hardening — word-boundary-safe matching replaces plain substring matching |

---

## Model Notes

Replit's managed OpenAI proxy does not expose an embeddings endpoint. "Semantic similarity" in the hybrid retriever is therefore a **local character n-gram TF-IDF cosine score**, not a true embedding — a deliberate, documented stand-in fused with real BM25 keyword scoring. A production system with a larger catalog would benefit from a real embeddings provider.

---

## Running Locally

```bash
# API server
pnpm --filter @workspace/api-server run dev

# Frontend
pnpm --filter @workspace/tariff-mapper run dev

# Regenerate typed client and Zod schemas after editing the OpenAPI spec
pnpm --filter @workspace/api-spec run codegen

# Push DB schema changes (dev only)
pnpm --filter @workspace/db run push

# Typecheck all packages
pnpm run typecheck
```

**Required environment variable:** `DATABASE_URL` — PostgreSQL connection string.

---

## Documentation

- [`reflection.md`](./reflection.md) — full project reflection covering what worked, where ambiguity appeared, improvement roadmap, how to verify tariff data accuracy, how the precision panel works technically, and more.
- [`chat_logs/`](./chat_logs/) — session-by-session prompt and conversation logs.
- [`attached_assets/`](./attached_assets/) — reference documents and uploaded prompt files.
