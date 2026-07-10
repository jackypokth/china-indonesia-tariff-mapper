---
name: Tariff dataset layering
description: How the China–Indonesia tariff reference dataset is structured (full HS6 base + curated overlay), for anyone extending or refreshing it.
---

The tariff reference dataset (`artifacts/api-server/src/lib/tariffData.ts`) is built from two layers merged at module load:

1. **Base layer** — the full WCO HS 6-digit nomenclature (~6,900 anchors), stored as `src/lib/data/hs6-nomenclature.json` and refreshed via `scripts/import-hs-nomenclature.ts` (pulls UN Comtrade's classification reference). Anchors without a curated entry get an auto-generated placeholder national code per country (rate = null, flagged pending import).
2. **Curated overlay** — `TARIFF_ANCHORS` in `tariffData.ts`, hand-authored national extensions with representative rates for a subset of anchors. Curated anchors always win over the auto-generated placeholder for the same HS6 code.

**Why:** the task called for expanding a ~16-anchor demo dataset to cover the full HS nomenclature without breaking `tariffMatcher.ts`, and without access to a licensed/official live customs tariff feed (China/Indonesia national rate schedules aren't freely fetchable). Layering lets the matcher work over the full nomenclature immediately while real rates are added incrementally.

**How to apply:** to add/correct a real tariff rate for a heading, edit or add an entry in `TARIFF_ANCHORS` — do not edit the generated JSON. To pull a newer HS revision list, re-run the import script; it overwrites `hs6-nomenclature.json` only (never touches curated data) and has a sanity check that aborts if the fetch returns implausibly few headings.
