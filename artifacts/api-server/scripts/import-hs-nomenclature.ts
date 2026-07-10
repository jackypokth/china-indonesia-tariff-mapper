/**
 * Refresh the full WCO HS 6-digit nomenclature used as the anchor set for the
 * China–Indonesia tariff crosswalk.
 *
 * This pulls the UN Comtrade "classificationHS" reference (which aggregates
 * WCO Harmonized System headings across HS revisions) and writes the
 * deduplicated list of 6-digit HS anchors + descriptions to
 * `src/lib/data/hs6-nomenclature.json`. That file is the base layer consumed
 * by `src/lib/tariffData.ts`, which layers curated China/Indonesia national
 * extensions (real tariff lines with representative rates) on top of it and
 * auto-generates placeholder national entries for every other anchor so the
 * dataset covers the full nomenclature rather than a small demo subset.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server exec tsx scripts/import-hs-nomenclature.ts
 *
 * This does NOT fetch national tariff rates for China or Indonesia — those
 * require licensed/official customs schedule data sources. To add real rates
 * for a heading, add or edit an entry in `TARIFF_ANCHORS` in tariffData.ts;
 * curated anchors always take precedence over the auto-generated ones.
 */

const SOURCE_URL = "https://comtrade.un.org/Data/cache/classificationHS.json";
const OUTPUT_PATH = new URL(
  "../src/lib/data/hs6-nomenclature.json",
  import.meta.url,
);

interface ComtradeClassificationEntry {
  id: string;
  text: string;
  parent: string;
}

interface ComtradeClassificationResponse {
  results: ComtradeClassificationEntry[];
}

async function main() {
  const res = await fetch(SOURCE_URL);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch HS nomenclature from ${SOURCE_URL}: ${res.status} ${res.statusText}`,
    );
  }
  const payload = (await res.json()) as ComtradeClassificationResponse;

  const byCode = new Map<string, string>();
  for (const entry of payload.results) {
    if (!/^\d{6}$/.test(entry.id)) continue; // keep only 6-digit HS headings
    const description = entry.text.replace(/^\d{6}\s*-\s*/, "").trim();
    const existing = byCode.get(entry.id);
    // Multiple HS revisions (HS92, HS02, HS12, HS17...) can describe the same
    // 6-digit code; keep the most descriptive (usually most recent) wording.
    if (!existing || description.length > existing.length) {
      byCode.set(entry.id, description);
    }
  }

  const entries = Array.from(byCode.entries()).sort((a, b) =>
    a[0].localeCompare(b[0]),
  );

  if (entries.length < 5000) {
    throw new Error(
      `Sanity check failed: only found ${entries.length} HS6 headings, expected several thousand. Aborting write to avoid clobbering the dataset with a bad fetch.`,
    );
  }

  const fs = await import("node:fs/promises");
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(entries), "utf8");
  console.log(
    `Wrote ${entries.length} HS6 anchors to ${OUTPUT_PATH.pathname}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
