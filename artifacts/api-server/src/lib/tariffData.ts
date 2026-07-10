/**
 * Illustrative prototype reference dataset for China–Indonesia tariff code
 * crosswalks. This is NOT a live customs feed and must not be treated as
 * legally binding. HS 6-digit anchors are real World Customs Organization
 * headings, spanning ~50 headings across agriculture/food, textiles &
 * footwear, electronics, machinery, chemicals, metals, vehicles, and
 * consumer goods; national extensions and tariff rates below are
 * representative examples assembled for demo purposes, loosely informed by
 * publicly published China customs tariff schedules and Indonesia's
 * BTKI/AHTN structure, and should be reviewed against the official
 * schedules before any real use.
 *
 * Growing this into a production-grade reference set (the full ~5,000+ HS6
 * headings, with accurate national tariff-line extensions and current
 * rates) requires importing from an authoritative source rather than
 * hand-authoring more entries here — e.g. China's MOFCOM/Customs tariff
 * schedule and Indonesia's official BTKI publication (or a licensed trade
 * data provider covering both). To wire in a real feed:
 *   1. Write an importer that maps the source records into
 *      `TariffCodeEntry[]` (see the shape below) — one entry per national
 *      tariff line, tagged with its 6-digit HS anchor.
 *   2. Replace `buildEntries()`'s in-memory `TARIFF_ANCHORS` construction
 *      with a load from that imported dataset (e.g. a JSON file or a
 *      database table), keeping the same `TariffCodeEntry` shape so
 *      `tariffMatcher.ts` and the API layer require no changes.
 *   3. Update `CHINA_SOURCE` / `INDONESIA_SOURCE` (or set `source`
 *      per-entry) to cite the real publication and date.
 */

export type Country = "china" | "indonesia";

export interface TariffCodeEntry {
  code: string;
  country: Country;
  hsAnchor: string;
  description: string;
  tariffRate: string | null;
  tariffNote: string | null;
  source: string;
}

const CHINA_SOURCE =
  "China Customs Import and Export Tariff (illustrative excerpt, general trade)";
const INDONESIA_SOURCE =
  "Indonesia BTKI (Buku Tarif Kepabeanan Indonesia) / AHTN excerpt (illustrative)";

/**
 * Each anchor groups: the shared HS6 heading + description, and the national
 * extensions for both countries that fall under it. Some anchors intentionally
 * have more than one entry per country to model one-to-many mappings and
 * national divergence beyond the 6-digit level.
 */
export const TARIFF_ANCHORS: {
  hsAnchor: string;
  baseDescription: string;
  china: Array<Omit<TariffCodeEntry, "country" | "hsAnchor" | "source">>;
  indonesia: Array<Omit<TariffCodeEntry, "country" | "hsAnchor" | "source">>;
}[] = [
  {
    hsAnchor: "851712",
    baseDescription: "Telephones for cellular networks (smartphones)",
    china: [
      {
        code: "8517120010",
        description: "Smartphones, cellular network telephones",
        tariffRate: "0% MFN",
        tariffNote: "Zero MFN duty; subject to 13% VAT on import.",
      },
    ],
    indonesia: [
      {
        code: "8517.12.00",
        description: "Telephones for cellular networks or for other wireless networks",
        tariffRate: "0% (ATIGA) / 5% MFN",
        tariffNote:
          "Preferential rate under ASEAN trade agreements may apply; subject to PPN (VAT) and PPh Article 22.",
      },
    ],
  },
  {
    hsAnchor: "851830",
    baseDescription: "Headphones and earphones",
    china: [
      {
        code: "8518300090",
        description: "Headphones and earphones, whether or not combined with microphone",
        tariffRate: "0% MFN",
        tariffNote: "Zero MFN duty; 13% import VAT applies.",
      },
    ],
    indonesia: [
      {
        code: "8518.30.10",
        description: "Headphones and earphones, wired",
        tariffRate: "5% MFN",
        tariffNote: "Wired variants classified separately from wireless.",
      },
      {
        code: "8518.30.90",
        description: "Headphones and earphones, other (including wireless)",
        tariffRate: "5% MFN",
        tariffNote: "Covers wireless/Bluetooth variants not elsewhere specified.",
      },
    ],
  },
  {
    hsAnchor: "610910",
    baseDescription: "T-shirts, singlets, cotton, knitted or crocheted",
    china: [
      {
        code: "6109100010",
        description: "Cotton T-shirts, knitted, for men or boys",
        tariffRate: "14% MFN",
        tariffNote: "Textile export commonly subject to VAT export rebate schedules.",
      },
      {
        code: "6109100020",
        description: "Cotton T-shirts, knitted, for women or girls",
        tariffRate: "14% MFN",
        tariffNote: "Textile export commonly subject to VAT export rebate schedules.",
      },
    ],
    indonesia: [
      {
        code: "6109.10.00",
        description: "T-shirts, singlets and other vests, of cotton, knitted or crocheted",
        tariffRate: "20% MFN",
        tariffNote: "Higher tariff tier applied to finished apparel imports.",
      },
    ],
  },
  {
    hsAnchor: "640399",
    baseDescription: "Footwear with rubber/plastic soles and leather uppers, other",
    china: [
      {
        code: "6403999000",
        description: "Leather-upper footwear with rubber or plastic soles, other, not covering ankle",
        tariffRate: "10% MFN",
        tariffNote: null,
      },
    ],
    indonesia: [
      {
        code: "6403.99.10",
        description: "Leather-upper footwear, other, for sports use",
        tariffRate: "15% MFN",
        tariffNote: "Sports-use footwear separated from general footwear.",
      },
      {
        code: "6403.99.90",
        description: "Leather-upper footwear, other, not elsewhere specified",
        tariffRate: "25% MFN",
        tariffNote: "Higher default tier for non-sports leather footwear.",
      },
    ],
  },
  {
    hsAnchor: "847130",
    baseDescription: "Portable automatic data processing machines (laptops), <= 10kg",
    china: [
      {
        code: "8471300000",
        description: "Portable digital automatic data processing machines, weight <= 10 kg",
        tariffRate: "0% MFN",
        tariffNote: "Zero MFN duty under ITA (Information Technology Agreement).",
      },
    ],
    indonesia: [
      {
        code: "8471.30.00",
        description: "Portable automatic data processing machines, weight not exceeding 10 kg",
        tariffRate: "0% MFN",
        tariffNote: "Zero MFN duty under ITA commitments.",
      },
    ],
  },
  {
    hsAnchor: "854231",
    baseDescription: "Electronic integrated circuits: processors and controllers",
    china: [
      {
        code: "8542310000",
        description: "Processors and controllers, whether or not combined with memory",
        tariffRate: "0% MFN",
        tariffNote: "Zero MFN duty under ITA commitments.",
      },
    ],
    indonesia: [
      {
        code: "8542.31.00",
        description: "Processors and controllers, integrated circuits",
        tariffRate: "0% MFN",
        tariffNote: "Zero MFN duty under ITA commitments.",
      },
    ],
  },
  {
    hsAnchor: "392690",
    baseDescription: "Other articles of plastics, not elsewhere specified",
    china: [
      {
        code: "3926909090",
        description: "Other articles of plastics, not elsewhere specified or included",
        tariffRate: "6.5% MFN",
        tariffNote: "Broad residual plastics category; frequent source of ambiguous classification.",
      },
    ],
    indonesia: [
      {
        code: "3926.90.10",
        description: "Articles of plastics for technical use, other",
        tariffRate: "10% MFN",
        tariffNote: "Technical-use subheading; requires end-use documentation.",
      },
      {
        code: "3926.90.99",
        description: "Other articles of plastics, not elsewhere specified",
        tariffRate: "15% MFN",
        tariffNote: "Residual catch-all; commonly flagged for manual review.",
      },
    ],
  },
  {
    hsAnchor: "940360",
    baseDescription: "Other wooden furniture",
    china: [
      {
        code: "9403600000",
        description: "Other furniture of wood, not elsewhere specified",
        tariffRate: "0% MFN",
        tariffNote: null,
      },
    ],
    indonesia: [
      {
        code: "9403.60.00",
        description: "Other wooden furniture",
        tariffRate: "5% MFN",
        tariffNote: null,
      },
    ],
  },
  {
    hsAnchor: "210690",
    baseDescription: "Food preparations not elsewhere specified (incl. supplements, extracts)",
    china: [
      {
        code: "2106909090",
        description: "Other food preparations, not elsewhere specified or included",
        tariffRate: "15% MFN",
        tariffNote: "Subject to additional food-safety registration requirements.",
      },
    ],
    indonesia: [
      {
        code: "2106.90.99",
        description: "Other food preparations, not elsewhere specified",
        tariffRate: "30% MFN",
        tariffNote: "Subject to BPOM food registration prior to import.",
      },
    ],
  },
  {
    hsAnchor: "300490",
    baseDescription: "Medicaments, other, packaged for retail sale",
    china: [
      {
        code: "3004909099",
        description: "Other medicaments, packaged for retail sale, not elsewhere specified",
        tariffRate: "3% MFN (varies by product registration)",
        tariffNote: "Actual rate depends on active ingredient and drug registration status.",
      },
    ],
    indonesia: [
      {
        code: "3004.90.99",
        description: "Other medicaments, packaged for retail sale",
        tariffRate: "5% MFN (varies by product registration)",
        tariffNote: "Requires BPOM registration; rate varies by therapeutic category.",
      },
    ],
  },
  {
    hsAnchor: "870323",
    baseDescription: "Motor cars, spark-ignition engine 1500-3000cc",
    china: [
      {
        code: "8703231000",
        description: "Passenger cars, spark-ignition, cylinder capacity 1500-2500cc",
        tariffRate: "25% MFN (bound rate)",
        tariffNote: "Additional consumption tax applies domestically.",
      },
      {
        code: "8703232000",
        description: "Passenger cars, spark-ignition, cylinder capacity 2500-3000cc",
        tariffRate: "25% MFN (bound rate)",
        tariffNote: "Additional consumption tax applies domestically.",
      },
    ],
    indonesia: [
      {
        code: "8703.23.19",
        description: "Passenger cars, spark-ignition, cylinder capacity 1500-3000cc, other",
        tariffRate: "40% MFN (plus luxury goods sales tax, PPnBM)",
        tariffNote: "PPnBM (luxury tax) tier depends on engine size and emissions.",
      },
    ],
  },
  {
    hsAnchor: "090111",
    baseDescription: "Coffee, not roasted, not decaffeinated",
    china: [
      {
        code: "0901110000",
        description: "Coffee beans, not roasted, not decaffeinated",
        tariffRate: "8% MFN",
        tariffNote: null,
      },
    ],
    indonesia: [
      {
        code: "0901.11.00",
        description: "Coffee, not roasted, not decaffeinated",
        tariffRate: "5% MFN",
        tariffNote: "Indonesia is also a major exporter of this heading; export duty rules may apply outbound.",
      },
    ],
  },
  {
    hsAnchor: "180100",
    baseDescription: "Cocoa beans, whole or broken, raw or roasted",
    china: [
      {
        code: "1801000000",
        description: "Cocoa beans, whole or broken, raw or roasted",
        tariffRate: "8% MFN",
        tariffNote: null,
      },
    ],
    indonesia: [
      {
        code: "1801.00.00",
        description: "Cocoa beans, whole or broken, raw or roasted",
        tariffRate: "0% MFN",
        tariffNote: "Indonesia applies export levies on raw cocoa to encourage domestic processing.",
      },
    ],
  },
  {
    hsAnchor: "740811",
    baseDescription: "Copper wire, refined copper, max cross-section > 6mm",
    china: [
      {
        code: "7408110000",
        description: "Refined copper wire, max cross-sectional dimension exceeding 6mm",
        tariffRate: "2% MFN",
        tariffNote: null,
      },
    ],
    indonesia: [
      {
        code: "7408.11.00",
        description: "Refined copper wire, max cross-sectional dimension exceeding 6mm",
        tariffRate: "5% MFN",
        tariffNote: null,
      },
    ],
  },
  {
    hsAnchor: "854370",
    baseDescription: "Electrical machines and apparatus with individual functions, n.e.s.",
    china: [
      {
        code: "8543709900",
        description: "Other electrical machines and apparatus, individual functions, not elsewhere specified",
        tariffRate: "8% MFN",
        tariffNote: "Broad residual electronics category; frequent source of ambiguous classification.",
      },
    ],
    indonesia: [
      {
        code: "8543.70.90",
        description: "Other electrical machines and apparatus, individual functions, not elsewhere specified",
        tariffRate: "10% MFN",
        tariffNote: "Residual catch-all; commonly flagged for manual review.",
      },
    ],
  },
  {
    hsAnchor: "020130",
    baseDescription: "Bovine meat, fresh or chilled, boneless",
    china: [
      {
        code: "0201300000",
        description: "Boneless bovine meat, fresh or chilled",
        tariffRate: "12% MFN",
        tariffNote: "Subject to CIQ inspection and quarantine certificates.",
      },
    ],
    indonesia: [
      {
        code: "0201.30.00",
        description: "Boneless bovine meat, fresh or chilled",
        tariffRate: "5% MFN",
        tariffNote: "Requires halal certification and BPOM/Ministry of Agriculture import permit.",
      },
    ],
  },
  {
    hsAnchor: "030617",
    baseDescription: "Frozen shrimps and prawns",
    china: [
      {
        code: "0306179000",
        description: "Frozen shrimps and prawns, other",
        tariffRate: "5% MFN",
        tariffNote: null,
      },
    ],
    indonesia: [
      {
        code: "0306.17.00",
        description: "Frozen shrimps and prawns",
        tariffRate: "0% MFN",
        tariffNote: "Indonesia is a major shrimp exporter; export documentation rules may apply outbound.",
      },
    ],
  },
  {
    hsAnchor: "100630",
    baseDescription: "Semi-milled or wholly milled rice",
    china: [
      {
        code: "1006300000",
        description: "Semi-milled or wholly milled rice",
        tariffRate: "65% within-quota / higher out-of-quota (TRQ product)",
        tariffNote: "Subject to tariff-rate quota administration.",
      },
    ],
    indonesia: [
      {
        code: "1006.30.30",
        description: "Semi-milled or wholly milled rice, aromatic (e.g. fragrant varieties)",
        tariffRate: "0% MFN (import restricted to state trading enterprise)",
        tariffNote: "Rice imports are tightly controlled; commercial imports require Bulog/government authorization.",
      },
      {
        code: "1006.30.90",
        description: "Semi-milled or wholly milled rice, other",
        tariffRate: "0% MFN (import restricted to state trading enterprise)",
        tariffNote: "Rice imports are tightly controlled; commercial imports require Bulog/government authorization.",
      },
    ],
  },
  {
    hsAnchor: "170199",
    baseDescription: "Refined cane or beet sugar, other",
    china: [
      {
        code: "1701999000",
        description: "Refined cane or beet sugar, solid, other",
        tariffRate: "50% within-quota / 90% out-of-quota (TRQ product)",
        tariffNote: null,
      },
    ],
    indonesia: [
      {
        code: "1701.99.00",
        description: "Refined cane or beet sugar, other",
        tariffRate: "5% MFN plus specific import duty",
        tariffNote: "Sugar import licenses issued by Ministry of Trade; quota-managed commodity.",
      },
    ],
  },
  {
    hsAnchor: "220830",
    baseDescription: "Whiskies",
    china: [
      {
        code: "2208300000",
        description: "Whiskies",
        tariffRate: "10% MFN",
        tariffNote: "Also subject to consumption tax on import.",
      },
    ],
    indonesia: [
      {
        code: "2208.30.00",
        description: "Whiskies",
        tariffRate: "150% MFN",
        tariffNote: "High specific + ad valorem excise on alcoholic beverages applies in addition to import duty.",
      },
    ],
  },
  {
    hsAnchor: "240220",
    baseDescription: "Cigarettes containing tobacco",
    china: [
      {
        code: "2402200000",
        description: "Cigarettes containing tobacco",
        tariffRate: "State trading commodity; import via authorized enterprises only",
        tariffNote: "Tobacco monopoly restrictions apply.",
      },
    ],
    indonesia: [
      {
        code: "2402.20.90",
        description: "Cigarettes containing tobacco, other",
        tariffRate: "Specific excise (cukai) plus import duty",
        tariffNote: "Subject to tobacco excise stamps (pita cukai) and strict licensing.",
      },
    ],
  },
  {
    hsAnchor: "271019",
    baseDescription: "Petroleum oils, other than crude, and preparations n.e.s.",
    china: [
      {
        code: "2710199900",
        description: "Other petroleum oils and preparations, not elsewhere specified",
        tariffRate: "6% MFN (varies by specific fraction)",
        tariffNote: "Rate varies significantly by sub-fraction (diesel, lubricants, etc.).",
      },
    ],
    indonesia: [
      {
        code: "2710.19.99",
        description: "Other petroleum oils and preparations, not elsewhere specified",
        tariffRate: "0-5% MFN (varies by specific fraction)",
        tariffNote: "Energy products often carry additional non-tariff licensing (e.g. from BPH Migas).",
      },
    ],
  },
  {
    hsAnchor: "310420",
    baseDescription: "Potassium chloride (fertilizer)",
    china: [
      {
        code: "3104200000",
        description: "Potassium chloride, mineral or chemical fertilizer",
        tariffRate: "1% MFN",
        tariffNote: null,
      },
    ],
    indonesia: [
      {
        code: "3104.20.00",
        description: "Potassium chloride, mineral or chemical fertilizer",
        tariffRate: "0% MFN",
        tariffNote: "Fertilizer imports may require Ministry of Agriculture recommendation letters.",
      },
    ],
  },
  {
    hsAnchor: "330300",
    baseDescription: "Perfumes and toilet waters",
    china: [
      {
        code: "3303000000",
        description: "Perfumes and toilet waters",
        tariffRate: "10% MFN plus consumption tax",
        tariffNote: "Cosmetics subject to consumption tax in addition to customs duty.",
      },
    ],
    indonesia: [
      {
        code: "3303.00.00",
        description: "Perfumes and toilet waters",
        tariffRate: "10% MFN",
        tariffNote: "Requires BPOM cosmetic notification/registration prior to import.",
      },
    ],
  },
  {
    hsAnchor: "340111",
    baseDescription: "Soap and organic surface-active products, toilet use",
    china: [
      {
        code: "3401110000",
        description: "Soap and organic surface-active products, in bars, for toilet use",
        tariffRate: "6.5% MFN",
        tariffNote: null,
      },
    ],
    indonesia: [
      {
        code: "3401.11.00",
        description: "Soap and organic surface-active products, in bars, for toilet use",
        tariffRate: "5% MFN",
        tariffNote: "Requires BPOM registration as a cosmetic/personal-care product.",
      },
    ],
  },
  {
    hsAnchor: "401110",
    baseDescription: "New pneumatic tires, of rubber, for motor cars",
    china: [
      {
        code: "4011100000",
        description: "New pneumatic rubber tires, for passenger motor cars",
        tariffRate: "10% MFN",
        tariffNote: null,
      },
    ],
    indonesia: [
      {
        code: "4011.10.00",
        description: "New pneumatic rubber tires, for passenger motor cars",
        tariffRate: "15% MFN",
        tariffNote: "Subject to SNI (national standard) mandatory certification.",
      },
    ],
  },
  {
    hsAnchor: "420221",
    baseDescription: "Handbags with outer surface of leather",
    china: [
      {
        code: "4202210000",
        description: "Handbags, outer surface of leather or composition leather",
        tariffRate: "10% MFN",
        tariffNote: null,
      },
    ],
    indonesia: [
      {
        code: "4202.21.00",
        description: "Handbags, outer surface of leather or composition leather",
        tariffRate: "15% MFN",
        tariffNote: null,
      },
    ],
  },
  {
    hsAnchor: "480256",
    baseDescription: "Uncoated paper for printing, weighing 40-150 g/m2",
    china: [
      {
        code: "4802569000",
        description: "Uncoated writing/printing paper, 40-150 g/m2, other",
        tariffRate: "5% MFN",
        tariffNote: null,
      },
    ],
    indonesia: [
      {
        code: "4802.56.00",
        description: "Uncoated writing/printing paper, 40-150 g/m2",
        tariffRate: "5% MFN",
        tariffNote: null,
      },
    ],
  },
  {
    hsAnchor: "490199",
    baseDescription: "Printed books, other",
    china: [
      {
        code: "4901990000",
        description: "Printed books, brochures and similar printed matter, other",
        tariffRate: "0% MFN",
        tariffNote: "Content subject to separate import censorship/approval, independent of tariff rate.",
      },
    ],
    indonesia: [
      {
        code: "4901.99.00",
        description: "Printed books, brochures and similar printed matter, other",
        tariffRate: "0% MFN",
        tariffNote: null,
      },
    ],
  },
  {
    hsAnchor: "520942",
    baseDescription: "Denim fabric, cotton, woven",
    china: [
      {
        code: "5209420000",
        description: "Denim, cotton, woven, weighing more than 200 g/m2",
        tariffRate: "8% MFN",
        tariffNote: null,
      },
    ],
    indonesia: [
      {
        code: "5209.42.00",
        description: "Denim, cotton, woven, weighing more than 200 g/m2",
        tariffRate: "10% MFN",
        tariffNote: null,
      },
    ],
  },
  {
    hsAnchor: "570320",
    baseDescription: "Carpets and textile floor coverings, tufted, of nylon",
    china: [
      {
        code: "5703200000",
        description: "Tufted carpets and floor coverings, of nylon or other polyamides",
        tariffRate: "12.5% MFN",
        tariffNote: null,
      },
    ],
    indonesia: [
      {
        code: "5703.20.00",
        description: "Tufted carpets and floor coverings, of nylon or other polyamides",
        tariffRate: "15% MFN",
        tariffNote: null,
      },
    ],
  },
  {
    hsAnchor: "610462",
    baseDescription: "Women's trousers and shorts, cotton, knitted",
    china: [
      {
        code: "6104620010",
        description: "Cotton trousers, knitted, women's",
        tariffRate: "16% MFN",
        tariffNote: null,
      },
      {
        code: "6104620020",
        description: "Cotton shorts, knitted, women's",
        tariffRate: "16% MFN",
        tariffNote: null,
      },
    ],
    indonesia: [
      {
        code: "6104.62.00",
        description: "Women's trousers, bib and brace overalls, breeches and shorts, cotton, knitted",
        tariffRate: "20% MFN",
        tariffNote: null,
      },
    ],
  },
  {
    hsAnchor: "620342",
    baseDescription: "Men's trousers and shorts, cotton, not knitted",
    china: [
      {
        code: "6203420000",
        description: "Men's trousers and shorts, cotton, woven",
        tariffRate: "16% MFN",
        tariffNote: null,
      },
    ],
    indonesia: [
      {
        code: "6203.42.00",
        description: "Men's trousers, bib and brace overalls, breeches and shorts, cotton, woven",
        tariffRate: "20% MFN",
        tariffNote: null,
      },
    ],
  },
  {
    hsAnchor: "640419",
    baseDescription: "Footwear with rubber/plastic soles and textile uppers, other",
    china: [
      {
        code: "6404199000",
        description: "Footwear with outer soles of rubber/plastics and textile uppers, other",
        tariffRate: "16.4% MFN",
        tariffNote: null,
      },
    ],
    indonesia: [
      {
        code: "6404.19.00",
        description: "Footwear with outer soles of rubber/plastics and textile uppers, other",
        tariffRate: "25% MFN",
        tariffNote: null,
      },
    ],
  },
  {
    hsAnchor: "690722",
    baseDescription: "Ceramic tiles, glazed, water absorption 0.5-10%",
    china: [
      {
        code: "6907220000",
        description: "Glazed ceramic flooring/wall tiles, water absorption 0.5-10%",
        tariffRate: "9% MFN",
        tariffNote: null,
      },
    ],
    indonesia: [
      {
        code: "6907.22.00",
        description: "Glazed ceramic flooring/wall tiles, water absorption 0.5-10%",
        tariffRate: "15% MFN plus antidumping duty on selected origins",
        tariffNote: "Indonesia has applied trade remedy measures on ceramic tile imports from certain origins.",
      },
    ],
  },
  {
    hsAnchor: "701090",
    baseDescription: "Glass containers for packing (bottles, jars), other",
    china: [
      {
        code: "7010900000",
        description: "Glass bottles, jars and similar containers, other",
        tariffRate: "8% MFN",
        tariffNote: null,
      },
    ],
    indonesia: [
      {
        code: "7010.90.00",
        description: "Glass bottles, jars and similar containers, other",
        tariffRate: "5% MFN",
        tariffNote: null,
      },
    ],
  },
  {
    hsAnchor: "721049",
    baseDescription: "Flat-rolled steel, plated or coated with zinc, other",
    china: [
      {
        code: "7210490000",
        description: "Flat-rolled iron/steel, zinc-coated, other",
        tariffRate: "0-6% MFN (subject to export tax rebate policy changes)",
        tariffNote: "China periodically adjusts export VAT rebates on steel products.",
      },
    ],
    indonesia: [
      {
        code: "7210.49.00",
        description: "Flat-rolled iron/steel, zinc-coated, other",
        tariffRate: "12.5% MFN plus safeguard duty on selected origins",
        tariffNote: "Indonesia has applied safeguard measures on certain flat steel imports.",
      },
    ],
  },
  {
    hsAnchor: "760612",
    baseDescription: "Aluminum plates/sheets, rectangular, alloyed",
    china: [
      {
        code: "7606129000",
        description: "Aluminum plates, sheets and strip, rectangular, alloyed, other",
        tariffRate: "5% MFN",
        tariffNote: null,
      },
    ],
    indonesia: [
      {
        code: "7606.12.00",
        description: "Aluminum plates, sheets and strip, rectangular, alloyed",
        tariffRate: "5% MFN plus antidumping duty on selected origins",
        tariffNote: null,
      },
    ],
  },
  {
    hsAnchor: "820712",
    baseDescription: "Rock drilling/earth boring tools, interchangeable",
    china: [
      {
        code: "8207120000",
        description: "Interchangeable rock drilling or earth boring tools",
        tariffRate: "7% MFN",
        tariffNote: null,
      },
    ],
    indonesia: [
      {
        code: "8207.12.00",
        description: "Interchangeable rock drilling or earth boring tools",
        tariffRate: "5% MFN",
        tariffNote: null,
      },
    ],
  },
  {
    hsAnchor: "841381",
    baseDescription: "Pumps for liquids, other",
    china: [
      {
        code: "8413819000",
        description: "Pumps for liquids, other, not elsewhere specified",
        tariffRate: "6% MFN",
        tariffNote: null,
      },
    ],
    indonesia: [
      {
        code: "8413.81.00",
        description: "Pumps for liquids, other",
        tariffRate: "5% MFN",
        tariffNote: null,
      },
    ],
  },
  {
    hsAnchor: "841911",
    baseDescription: "Instantaneous gas water heaters",
    china: [
      {
        code: "8419110000",
        description: "Instantaneous gas water heaters",
        tariffRate: "8% MFN",
        tariffNote: null,
      },
    ],
    indonesia: [
      {
        code: "8419.11.00",
        description: "Instantaneous gas water heaters",
        tariffRate: "5% MFN",
        tariffNote: null,
      },
    ],
  },
  {
    hsAnchor: "845121",
    baseDescription: "Clothes dryers, electric, household",
    china: [
      {
        code: "8451210000",
        description: "Electric clothes dryers, capacity <= 10 kg dry weight",
        tariffRate: "10% MFN",
        tariffNote: null,
      },
    ],
    indonesia: [
      {
        code: "8451.21.00",
        description: "Electric clothes dryers, capacity <= 10 kg dry weight",
        tariffRate: "10% MFN",
        tariffNote: null,
      },
    ],
  },
  {
    hsAnchor: "850440",
    baseDescription: "Static converters (power adapters, inverters)",
    china: [
      {
        code: "8504409900",
        description: "Static converters, other (power adapters, inverters)",
        tariffRate: "0% MFN",
        tariffNote: "Zero MFN duty under ITA commitments for many sub-items.",
      },
    ],
    indonesia: [
      {
        code: "8504.40.90",
        description: "Static converters, other (power adapters, inverters)",
        tariffRate: "0-5% MFN (varies by end use)",
        tariffNote: null,
      },
    ],
  },
  {
    hsAnchor: "850760",
    baseDescription: "Lithium-ion batteries",
    china: [
      {
        code: "8507600000",
        description: "Lithium-ion accumulators (batteries)",
        tariffRate: "0% MFN",
        tariffNote: "Subject to dangerous-goods transport documentation on export.",
      },
    ],
    indonesia: [
      {
        code: "8507.60.00",
        description: "Lithium-ion accumulators (batteries)",
        tariffRate: "0% MFN",
        tariffNote: "Subject to dangerous-goods import handling and labeling rules.",
      },
    ],
  },
  {
    hsAnchor: "852872",
    baseDescription: "Television reception apparatus, color",
    china: [
      {
        code: "8528729000",
        description: "Color television reception apparatus, other",
        tariffRate: "30% MFN (bound rate; applied rate often lower via agreements)",
        tariffNote: null,
      },
    ],
    indonesia: [
      {
        code: "8528.72.00",
        description: "Color television reception apparatus",
        tariffRate: "0-5% MFN under ASEAN agreements / higher MFN otherwise",
        tariffNote: "TKDN (local content) requirements may apply to qualify for incentives.",
      },
    ],
  },
  {
    hsAnchor: "852990",
    baseDescription: "Parts for TV/radio transmission-reception apparatus",
    china: [
      {
        code: "8529909090",
        description: "Parts for transmission/reception apparatus, other, not elsewhere specified",
        tariffRate: "Varies widely by specific part (0-10% MFN)",
        tariffNote: "Broad residual electronics parts category; frequent source of ambiguous classification.",
      },
    ],
    indonesia: [
      {
        code: "8529.90.90",
        description: "Parts for transmission/reception apparatus, other, not elsewhere specified",
        tariffRate: "Varies widely by specific part (0-10% MFN)",
        tariffNote: "Residual catch-all; commonly flagged for manual review.",
      },
    ],
  },
  {
    hsAnchor: "870120",
    baseDescription: "Road tractors for semi-trailers",
    china: [
      {
        code: "8701200000",
        description: "Road tractors for semi-trailers",
        tariffRate: "10% MFN",
        tariffNote: null,
      },
    ],
    indonesia: [
      {
        code: "8701.20.00",
        description: "Road tractors for semi-trailers",
        tariffRate: "5% MFN",
        tariffNote: null,
      },
    ],
  },
  {
    hsAnchor: "871200",
    baseDescription: "Bicycles, non-motorized",
    china: [
      {
        code: "8712009000",
        description: "Bicycles, non-motorized, other",
        tariffRate: "13% MFN",
        tariffNote: null,
      },
    ],
    indonesia: [
      {
        code: "8712.00.90",
        description: "Bicycles, non-motorized, other",
        tariffRate: "25-40% MFN (tiered by type; higher for e-bikes)",
        tariffNote: "Rate tier depends on wheel diameter and bicycle type.",
      },
    ],
  },
  {
    hsAnchor: "900490",
    baseDescription: "Spectacles, goggles and similar, other",
    china: [
      {
        code: "9004909000",
        description: "Spectacles, goggles and similar corrective/protective eyewear, other",
        tariffRate: "8% MFN",
        tariffNote: null,
      },
    ],
    indonesia: [
      {
        code: "9004.90.00",
        description: "Spectacles, goggles and similar corrective/protective eyewear, other",
        tariffRate: "10% MFN",
        tariffNote: null,
      },
    ],
  },
  {
    hsAnchor: "910211",
    baseDescription: "Wristwatches, electrically operated, display only",
    china: [
      {
        code: "9102110000",
        description: "Wristwatches, electrically operated, mechanical display only",
        tariffRate: "11% MFN",
        tariffNote: null,
      },
    ],
    indonesia: [
      {
        code: "9102.11.00",
        description: "Wristwatches, electrically operated, mechanical display only",
        tariffRate: "10% MFN",
        tariffNote: null,
      },
    ],
  },
  {
    hsAnchor: "950300",
    baseDescription: "Toys, including tricycles, dolls, and other toys",
    china: [
      {
        code: "9503009000",
        description: "Toys, not elsewhere specified or included",
        tariffRate: "6% MFN",
        tariffNote: "Export subject to toy safety certification (e.g. CCC where applicable).",
      },
    ],
    indonesia: [
      {
        code: "9503.00.90",
        description: "Toys, not elsewhere specified or included",
        tariffRate: "5-15% MFN (tiered by toy type)",
        tariffNote: "Requires SNI toy safety certification prior to import.",
      },
    ],
  },
  {
    hsAnchor: "950691",
    baseDescription: "Articles and equipment for general physical exercise",
    china: [
      {
        code: "9506919000",
        description: "Exercise equipment and articles, other",
        tariffRate: "6.5% MFN",
        tariffNote: null,
      },
    ],
    indonesia: [
      {
        code: "9506.91.00",
        description: "Exercise equipment and articles",
        tariffRate: "10% MFN",
        tariffNote: null,
      },
    ],
  },
];

function buildEntries(): TariffCodeEntry[] {
  const entries: TariffCodeEntry[] = [];
  for (const anchor of TARIFF_ANCHORS) {
    for (const cn of anchor.china) {
      entries.push({
        ...cn,
        country: "china",
        hsAnchor: anchor.hsAnchor,
        source: CHINA_SOURCE,
      });
    }
    for (const id of anchor.indonesia) {
      entries.push({
        ...id,
        country: "indonesia",
        hsAnchor: anchor.hsAnchor,
        source: INDONESIA_SOURCE,
      });
    }
  }
  return entries;
}

export const TARIFF_CODE_ENTRIES: TariffCodeEntry[] = buildEntries();
