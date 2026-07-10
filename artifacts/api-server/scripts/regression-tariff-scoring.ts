/**
 * Regression test for the attribute-first, hierarchical scoring workflow.
 *
 * Query: "stainless steel kitchen knives set"
 * Must resolve HS 8211 (knives) above HS 7323 (generic stainless-steel
 * household articles), with the explanation reflecting product type/function
 * as the driver and material/kitchen-use as supporting signals only.
 *
 * Run with: pnpm --filter @workspace/api-server exec tsx scripts/regression-tariff-scoring.ts
 */
import { searchTariffMatches } from "../src/lib/tariffMatcher";

async function main() {
  const result = await searchTariffMatches(
    "stainless steel kitchen knives set",
    "description",
    "china_to_indonesia",
  );

  const knifeIndex = result.matches.findIndex((m) => m.hs6_anchor === "821191");
  const householdIndex = result.matches.findIndex((m) => m.hs6_anchor === "732393");

  console.log("Matches (anchor, code, confidence, product_type_match, function_match):");
  for (const m of result.matches) {
    console.log(
      ` ${m.hs6_anchor} ${m.matched_code} conf=${m.match_confidence} pt=${m.reasoning.product_type_match} fn=${m.reasoning.function_match}`,
    );
  }

  const failures: string[] = [];

  if (knifeIndex === -1) {
    failures.push("HS 8211 (knife) did not appear in the top-5 matches at all.");
  }

  // The household-articles heading (7323) is expected to be excluded
  // outright by the deterministic exclusion rule, which trivially satisfies
  // "8211 ranks above 7323" — but also assert it explicitly in case it does
  // surface (e.g. taxonomy tuning changes later).
  if (householdIndex !== -1 && knifeIndex !== -1 && householdIndex < knifeIndex) {
    failures.push("HS 7323 ranked above HS 8211 — attribute-first scoring regressed.");
  }

  if (knifeIndex !== -1) {
    const knifeMatch = result.matches[knifeIndex];
    if (knifeMatch.reasoning.product_type_match < 0.9) {
      failures.push(`Knife candidate product_type_match too low: ${knifeMatch.reasoning.product_type_match}`);
    }
    const explanation = knifeMatch.reasoning.explanation.toLowerCase();
    const mentionsTypeOrFunction = explanation.includes("product type") || explanation.includes("function");
    if (!mentionsTypeOrFunction) {
      failures.push("Explanation does not reference product type/function as the driver of the ranking.");
    }
  }

  if (householdIndex !== -1) {
    console.log(`Note: HS 7323 appeared in results at rank ${householdIndex + 1} (expected: excluded entirely).`);
  } else {
    console.log("HS 7323 correctly excluded from results (product-type conflict with the knife family).");
  }

  if (failures.length > 0) {
    console.error("\nREGRESSION TEST FAILED:");
    for (const f of failures) console.error(` - ${f}`);
    process.exit(1);
  }

  console.log("\nREGRESSION TEST PASSED.");
}

main().catch((err) => {
  console.error("Regression test crashed:", err);
  process.exit(1);
});
