---
name: Tariff precision panel gating
description: How missing_attributes and improvement_panel_visible are computed for the tariff mapper's "Improve classification precision" panel.
---

`missing_attributes` = union of `classification_rules.requiredAttributes` across up to 3 distinct top-ranked competing HS6 anchors, minus attributes already answered by the free-text query and/or extracted `ProductFacts`.

**Why:** naive per-word OR-matching against multi-word option labels (e.g. "stainless steel" vs "carbon steel") both match on the shared word "steel", making the query look ambiguous about material even when it clearly said "stainless". Also, only checking the single top anchor's rule missed decision-relevant attributes belonging to a close second candidate from a different product family.

**How to apply:** attribute-option matching must strip words shared across all options for that attribute down to each option's *distinctive* keywords before doing OR-matching (see `distinctiveKeywordsByOption` in `tariffMatcher.ts`), and must check both raw query text and a flattened text blob of the extracted `ProductFacts` (materials, intended_use, key_attributes, is_retail_set) so synonyms/normalized values count as answered. `improvement_panel_visible` is true only when `manualReviewRequired`, OR (>=2 plausible distinct-anchor candidates AND top1-top2 confidence margin < 0.08 AND `missing_attributes` non-empty) — never shown for a single clear winner, a well-separated top match, or when the only issue is unavailable tariff/source data.
