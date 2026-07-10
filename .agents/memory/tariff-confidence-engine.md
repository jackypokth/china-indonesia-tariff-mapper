---
name: Tariff confidence engine
description: How match_confidence, manual_review_required, and tariff/source status are kept strictly separate in the tariff mapper's matching engine.
---

The matcher separates four concepts that must never bleed into each other:
- `match_confidence` — classification evidence only: `0.50*hs_anchor_strength + 0.30*description_compatibility + 0.20*national_extension_specificity`. No tariff/source term, no post-hoc caps.
- `manual_review_required` (per match) — true only for classification-ambiguity reasons: no credible anchor, competing anchors close in score, a multi-line national anchor whose extensions the description doesn't distinguish (`descriptionCompatibility < 0.7`), or invalid/not-found input. Never true merely because a tariff rate is unpublished.
- `source_status` / `tariff_status` — separate fields for data provenance/availability (`official tariff schedule` / `tariff data pending` / `public nomenclature source` / `source unavailable`; `available` / `not available in current source data`). `tariff_rate` is `null`, never a placeholder string, when unsourced.
- `match_label` gating requires confidence + an exact, non-fuzzy code resolution + a unique target line + strong description compatibility for `exact_match` — a fuzzy/prefix or ambiguous-anchor resolution can never reach `exact_match` regardless of confidence value.

**Why:** an earlier version blended tariff-source verification into the confidence score and into manual-review triggers, so a 100%-evidence classification could show ~30% confidence and a false "manual review required" purely because its tariff rate hadn't been imported yet.

**How to apply:** when adding new match signals, ask whether the signal is about "how certain is this classification" (goes into `match_confidence`/`manual_review_required`) or "how complete/verified is the tariff data" (goes into `source_status`/`tariff_status`/`tariff_rate`) — never combine the two in one field. Keep `missing_attributes` and `manual_review_required` driven by the same ambiguity signal so they don't diverge.
