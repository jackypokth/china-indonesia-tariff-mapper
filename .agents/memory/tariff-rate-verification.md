---
name: Tariff rate verification (China/Indonesia TRQ direction)
description: Lesson from cross-checking curated tariff anchors against official schedules — TRQ in-quota vs out-of-quota rates are easy to transpose.
---

When verifying tariff-rate-quota (TRQ) commodities (rice, sugar, wheat, wool, cotton, fertilizer for China), the official MOF quota schedule lists three columns: general (non-MFN) rate, MFN rate, and quota rate. The **quota rate is the low in-quota preferential rate**; the **MFN rate is the higher out-of-quota rate**. It's easy to accidentally write these backwards (e.g. treating the higher number as "within-quota").

**Why:** During a verification pass, China rice (HS 100630) and sugar (HS 170199) entries in `artifacts/api-server/src/lib/tariffData.ts` had exactly this reversal, plus the sugar out-of-quota figure was wrong outright.

**How to apply:** When adding or checking any TRQ line, cite the specific quota-schedule row (e.g. MOF 关税配额商品税目税率表) and record all three rates if available, labeling clearly which is in-quota vs out-of-quota — don't infer direction from which number "sounds more like a normal tariff."
