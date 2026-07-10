---
name: Tariff matcher confidence engine
description: How match_confidence, exact_match eligibility, and manualReviewRequired are computed in the China–Indonesia tariff mapper.
---

The confidence score is a transparent weighted sum, not a calibrated probability — field is named `match_confidence`, and every match returns the 4 underlying components in a `reasoning` object: `hs_anchor_strength` (0.45), `description_similarity` (0.35), `national_extension_evidence` (0.10), `source_completeness` (0.10).

`exact_match` is only reachable when: the source code resolved via an exact verified lookup, there is exactly one *verified* target national code under the shared HS6 anchor, description similarity between source and target descriptions is >=0.85, and the entry has a source citation. A clean code lookup alone is never enough.

**Why:** an earlier version labeled results "exact match" purely because the source code parsed cleanly, even when the target side was ambiguous or unverified — misleading for a customs tool where false confidence has real compliance cost.

**How to apply:** when touching `tariffMatcher.ts`, keep confidence caps and `manualReviewRequired` triggers as first-class, independently-checkable conditions (ambiguous target extensions, thin/vague query, unverified source lookup, top-two candidates within 0.08, no verified candidate) rather than folding them into the base formula — this is what a code review previously caught as under-enforced (e.g. secondary/description-only candidates skipping the ambiguity cap, or "exact_match" not requiring the *verified* target count). Unverified tariffRate must always render as `NOT_AVAILABLE_RATE` ("Not available in current source data"), never null or a placeholder number.
