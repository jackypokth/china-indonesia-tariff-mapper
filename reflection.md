# Project Reflection — China–Indonesia Tariff Mapper

---

## 1. What Worked Best

### Hybrid Retrieval Pipeline
The fusion of BM25 keyword search and character 3-gram TF-IDF cosine similarity inside `hybridRetrieval.ts` proved to be the most reliable foundation for the system. BM25 handles exact and near-exact terminology well (e.g., "polypropylene film"), while the n-gram layer catches morphological variants and partial matches (e.g., "polyprop" or "pp film"). Combining both via Reciprocal Rank Fusion at a 0.6/0.4 split allowed the retrieval stage to consistently surface the correct HS6 anchor in the top-5 candidates.

### Attribute-First Confidence Formula
Weighting product type (0.40) and function (0.25) above free-text similarity (0.10) prevented a common failure mode: keyword-heavy queries pulling in adjacent headings. For example, a query containing "stainless steel blade" could match both heading 8211 (knives) and 7326 (other articles of steel) on text alone. The attribute-first weighting, combined with the `CONFLICT_CONFIDENCE_CAP` of 0.39, ensured the more specific heading won while visibly flagging the conflict.

### Hard-Capped Conflict Detection
Any candidate whose taxonomy explicitly excludes the query's product type is capped at confidence 0.39, which automatically triggers the `manual_review_required` label. This is a safe failure — the system never silently returns a wrong answer at high confidence.

### Layered Dataset Architecture
Importing the full HS6 nomenclature as a base layer and overlaying curated national rates (which always take precedence) meant that even product categories without curated data still returned a valid heading and description, with a clearly visible data-pending flag rather than an empty result.

### OpenAPI-Driven Type Safety
Using a single OpenAPI YAML as the source of truth — with Orval generating both the React client hooks and the Zod validation schemas — meant that every API contract change propagated to both the frontend and backend simultaneously. This eliminated an entire class of runtime mismatch bugs.

---

## 2. Where Ambiguity or Weak Matching Appeared

### Narrow Candidate Margin
When the confidence gap between the top-two candidates (`candidate_margin`) falls below 0.15, the system cannot reliably distinguish between headings. This is most common in:
- **Multi-use goods** (e.g., a "steel mesh" that could be construction material or filtration equipment).
- **Composite products** (e.g., a product that is simultaneously a container and a pump).
- **Vague queries** (e.g., "plastic part for machinery") where product type is clear but function and application are not stated.

### National Extension Specificity Collapse
Indonesia's tariff schedule uses 8- and 10-digit national extensions beneath HS6 headings. When more than two sibling lines exist under a single HS6 anchor, `national_extension_specificity` drops to 0.35. This significantly reduces overall confidence even when the HS6 heading itself is correct — the system knows the chapter but not which national line applies.

### Anchors Outside `classification_rules.ts`
Product categories not yet covered by explicit taxonomy rules fall back to text-similarity scoring only, capped at 0.60. This affects niche industrial goods, chemical intermediates, and newer product types. These results are identifiable because they return with no `required_attributes` surfaced and a relatively flat score.

### LLM Fact Extraction Reliability
The `extractProductFacts` step sends the raw query to GPT and parses structured attributes from the response. Short or poorly-worded queries produce sparse fact sets, which means the confidence formula has less to work with. The system compensates by triggering the precision panel, but the quality of the final result still depends on the richness of the original query.

### TRQ Rate Direction
Tariff Rate Quota items have two rates: in-quota and out-of-quota. These are easy to transpose during data entry and difficult to verify without the original quota schedule. Any TRQ entry is a specific point of verification risk.

---

## 3. What Would Be Improved in the Next Version

### Replace N-gram Fallback with Real Embeddings
The character n-gram TF-IDF is a pragmatic stand-in for semantic embeddings, chosen because Replit's managed OpenAI proxy does not expose the `/embeddings` endpoint. In the next version, either use a self-hosted embedding model (e.g., `bge-small-en` via ONNX) or switch to a provider that exposes embeddings. Real sentence embeddings would significantly improve retrieval for paraphrased or cross-language queries.

### Expand `classification_rules.ts` Coverage
The taxonomy rules currently cover major traded goods categories. Expanding coverage to niche industrial, chemical, and agricultural headings would eliminate the text-similarity fallback for a large portion of real-world queries and bring more results into the deterministic scoring path.

### Structured Data Entry for National Rates
Currently, curated national rates are maintained as code-level data structures. A structured admin interface with field-level validation, TRQ direction labels, and a mandatory source-citation field would reduce data entry errors and make verification auditable.

### Confidence Score Calibration
The current weights (0.40 / 0.25 / 0.15 / 0.10 / 0.10) were set by reasoning rather than by empirical calibration against a labelled dataset. Building a ground-truth test set of 200–300 product queries with known correct HS codes would allow the weights to be tuned using logistic regression or a simple grid search.

### Persistent Query History and Feedback Loop
There is currently no mechanism for analysts to flag incorrect results. Adding a thumbs-down / correct-code feedback widget would create a labelled dataset over time and expose systematic failure modes.

---

## 4. How to Verify the Accuracy of Each Data Point

### Tariff Rates (MFN, FTA, TRQ)
| Source | How to verify |
|---|---|
| China MFN rates | Cross-check against GACC/MOFCOM published tariff schedule for the current year |
| Indonesia MFN rates | Cross-check against the Indonesian Ministry of Finance PMK tariff regulation |
| ACFTA preferential rates | Verify against the ASEAN–China FTA annex for Indonesia (Annex 2, Form E origin criteria) |
| TRQ in-quota rates | Confirm quota volume and in-quota rate against the specific quota-schedule row in the national regulation; label direction (in vs. out) explicitly |

**Red flags to check manually:**
- Any rate that is `0%` on a product category that is strategically sensitive (semiconductors, agricultural staples).
- Any TRQ entry where in-quota and out-of-quota rates are numerically close — these are the most common transposition points.
- Rates marked `PENDING_RATE_NOTE` in `tariffData.ts` — these have no curated data and fall back to base nomenclature only.

### HS Code to Description Mapping
- Confirm the 6-digit heading text against the WCO HS 2022 nomenclature.
- Confirm 8/10-digit national extensions against the Harmonized System decree published by each country's customs authority.
- Where the system shows a description that differs from the official text, the official text always takes precedence.

---

## 5. How to Verify the Accuracy of Each Reference Data Source

### WCO HS Nomenclature (`hs6-nomenclature.json`)
- **Primary source:** WCO HS 2022 edition — downloadable from wcoomd.org.
- **Verification step:** Run a diff between the JSON heading descriptions and the WCO published text for any heading that returns unexpected results.
- **Update cadence:** HS nomenclature is revised every five years. The next edition is HS 2027. The dataset should be refreshed at that point.

### Indonesian National Tariff Schedule
- **Primary source:** Peraturan Menteri Keuangan (PMK) in force — accessible via jdih.kemenkeu.go.id.
- **Verification step:** For any specific 10-digit line, confirm the PMK article and annex row number. The system's `tariffData.ts` entries should carry this citation.
- **Common error:** Indonesia sometimes publishes mid-year amendments to specific chapter rates. Check for amendment PMKs issued after the base regulation.

### ACFTA Rates
- **Primary source:** ASEAN Secretariat tariff finder — asean.org/asean-economic-community/asean-trade-in-goods-agreement-atiga.
- **Verification step:** Confirm that the Form E (Certificate of Origin) origin criterion for the product is met before applying the preferential rate — the rate is only valid with compliant origin documentation.

### China MFN / Export Duties
- **Primary source:** MOFCOM tariff lookup tool — english.mofcom.gov.cn, or the Customs Tariff Commission announcements.
- **Verification step:** For any rate that appears unusually low, check for active safeguard measures or anti-dumping duties that may apply on top of the MFN rate.

---

## 6. How to Search for an HS Code by Description

The system supports two search modes:

### Free-Text Description Search
1. Enter a plain-English product description in the search bar (e.g., "polypropylene woven sack", "lithium-ion battery cell", "frozen shrimp").
2. The query is processed through the **hybrid retrieval pipeline**:
   - **BM25 (60% weight):** Tokenises and stems the description; scores candidate headings by term frequency against the HS nomenclature corpus.
   - **N-gram TF-IDF (40% weight):** Converts the description to character 3-grams; computes cosine similarity against pre-indexed heading vectors. This catches morphological variants and abbreviations.
   - **Reciprocal Rank Fusion:** Merges both ranked lists into a single score and returns the top candidates.
3. The top candidates are passed to the LLM-augmented scoring step, which applies taxonomy rules and returns a ranked result with confidence scores.

**Tips for better results:**
- Include the material, primary function, and end use (e.g., "woven polypropylene fabric bag for agricultural use" is better than "bag").
- Avoid brand names or internal product codes — use the generic product description.
- If the first result shows `manual_review_required`, open the precision panel and answer the clarifying attributes it requests.

### Direct HS Code Lookup
1. Enter a 6-, 8-, or 10-digit HS code directly.
2. The system performs exact/prefix matching via `resolveCode` in `tariffMatcher.ts` and returns all national lines under that heading with their rates and status.

---

## 7. How to Ensure the Accuracy of the Result — Notes and Conflict Detection

### Match Labels
Every result carries one of four labels:

| Label | Meaning |
|---|---|
| `exact_match` | Confidence ≥ 0.85; taxonomy rules confirm the heading without ambiguity |
| `likely_match` | Confidence 0.65–0.84; strong indicator but one or more attributes unconfirmed |
| `partial_match` | Confidence 0.40–0.64; heading is plausible but significant attributes are missing |
| `manual_review_required` | Confidence < 0.40, or a conflict rule was triggered (cap applied) |

### Conflict Detection
A conflict is raised when the query matches a rule that explicitly excludes the candidate heading — for example, a query about "kitchen knives" matching the generic "household articles of stainless steel" heading. When this occurs:
- The conflicting candidate's confidence is hard-capped at **0.39**.
- A conflict note is shown in the result card explaining which rule triggered and which heading it points toward instead.
- The result is automatically labelled `manual_review_required`.

### Source Status Flags
Each rate cell in the result shows one of:
- **Official tariff schedule** — rate is from a curated, source-cited entry.
- **Tariff data pending** — the HS6 heading exists in the nomenclature but no curated national rate has been entered yet; the rate shown is a placeholder.
- **Source unavailable** — the national extension could not be resolved; the heading-level rate applies.

Always treat any result flagged as "tariff data pending" as unverified. Do not use it for duty calculation without consulting the primary source directly.

---

## 8. How the Precision Panel Works Technically

### Trigger Conditions
The precision panel becomes visible (`improvement_panel_visible = true`) when any of the following is true:
1. `manualReviewRequired` is `true` — the top result is below the confidence threshold or has a conflict.
2. `candidate_margin < 0.08` — the score gap between the first and second ranked candidate is too small to distinguish them reliably.
3. `required_attributes` is non-empty — the scoring engine determined that at least one attribute, if known, would materially change the ranking.

### Attribute Selection Logic (`requiredAttributesFor`)
The function in `tariffMatcher.ts` determines which attributes to surface by:
1. Fetching the `classification_rules` entry for the top candidate heading.
2. Comparing the rule's required discriminating attributes against the facts already extracted by `extractProductFacts`. ("material":"stainless","carbon")
4. Using **synonym-aware matching** with **distinct-anchor competition** to determine which attributes are genuinely unresolved. A fact is considered resolved only if a synonym-normalized value matches an expected attribute anchor unambiguously. If two different anchors compete for the same extracted fact, the attribute is treated as unresolved and surfaced.
5. Returning only the attributes that are both (a) required by the rule and (b) not yet pinned down by the query text or extracted facts.

This means the panel asks exactly the missing questions — it does not ask for attributes the user already provided, even if they were phrased differently from the canonical terms.

### What Happens After the User Answers
When the user selects an attribute value in the panel:
1. The selected facts are merged with the original extracted fact set.
2. The scoring pipeline reruns with the enriched facts.
3. The candidate ranked list updates; if the margin or confidence now exceeds the threshold, the panel closes automatically and the result is promoted to `likely_match` or `exact_match`.

### Why Raw Keyword Matching Was Insufficient
An earlier approach used simple OR-matching to check whether any attribute keyword appeared in the query string. This caused two problems:
- A query containing "steel" was incorrectly marking the "material" attribute as resolved, even when "steel" referred to a component rather than the primary material of the product.
- Two competing attribute anchors (e.g., "refined" vs "crude" for an oil product) could both match, leaving the ambiguity unresolved but the attribute marked as answered.

The synonym-aware matching with distinct-anchor competition was introduced to fix both cases: an attribute is only marked resolved when exactly one anchor wins without competition.

---

*Document prepared July 2026 — China–Indonesia Tariff Mapper v1.*
