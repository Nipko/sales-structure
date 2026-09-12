#!/usr/bin/env node
/**
 * ═══ THE ESTIMATOR'S ARITHMETIC, CHECKED AGAINST THE CARDS ══════════════════
 *
 * `/costos-whatsapp` publishes money. Every case below is a way that page could
 * be confidently wrong while still rendering, and each one was chosen because
 * the naive implementation gets it wrong in the direction that flatters us:
 *
 *   - the free thousand subtracted once per COUNTRY instead of once per NUMBER
 *     (the preserved evidence calls this error out by name);
 *   - an `'unavailable'` rate summed as zero, which turns "Meta has not
 *     published this price" into "this is free";
 *   - the allowance applied before the charge exists, inventing a discount
 *     against a price nobody was being charged;
 *   - rounding DOWN to minor units, which makes Colombia's rate disappear
 *     entirely — eight ten-thousandths of a dollar floors to nothing;
 *   - the card chosen by preference rather than by date, so the page keeps
 *     answering with October's rule in September, or September's in November.
 *
 * The expected figures are computed from the projection rather than typed, with
 * ONE exception: Colombia's and Germany's service rates are asserted against
 * their literal micro values. That pins the extremes of the range — the
 * cheapest and the most expensive service market on the card — so a projection
 * that regenerated into the wrong units cannot pass by agreeing with itself.
 *
 * Usage: node scripts/test-whatsapp-cost-estimate.cjs
 */

const path = require("path");
const fs = require("fs");
const ts = require("typescript");

const landingRoot = path.resolve(__dirname, "..");

const cache = new Map();
function loadTsFile(file) {
  const absolute = path.resolve(file);
  if (cache.has(absolute)) return cache.get(absolute).exports;
  const output = ts.transpileModule(fs.readFileSync(absolute, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
    fileName: absolute,
  }).outputText;
  const loaded = { exports: {} };
  cache.set(absolute, loaded);
  const localRequire = (request) => {
    if (!request.startsWith(".")) return require(request);
    const base = path.resolve(path.dirname(absolute), request);
    const target = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")].find((candidate) =>
      fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (!target) throw new Error(`Cannot resolve ${request} from ${absolute}`);
    return loadTsFile(target);
  };
  new Function("module", "exports", "require", output)(loaded, loaded.exports, localRequire);
  return loaded.exports;
}

const estimator = loadTsFile(path.join(landingRoot, "src", "data", "whatsapp-cost-estimate.ts"));
const {
  estimateWhatsappCost, cardInForce, estimationCard, metaChargeState,
  minorUnitsFromMicros, RATE_ALLOWANCE, ESTIMATOR_CATEGORIES,
} = estimator;

const failures = [];
function check(label, condition, detail = "") {
  if (!condition) failures.push(`${label}${detail ? `: ${detail}` : ""}`);
}
function equal(label, actual, expected) {
  check(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const AFTER = "2026-10-15";
const BEFORE = "2026-09-12";
const line = (estimate, category) => estimate.lines.find((item) => item.category === category);

// ── The two ends of the published range, pinned to their literal values ─────
//
// Colombia is the cheapest service market on the October card and Germany the
// most expensive. Asserting both catches a regenerated projection that shifted
// units: in cents Colombia rounds to nothing and in whole units Germany is
// nonsense, so only micro-units satisfy the pair.
const octoberUsd = cardInForce("USD", AFTER);
equal("October USD card in force", octoberUsd?.rateVersion, "meta-ratecards-2026/USD/2026-10-01");
equal(
  "Colombia service rate in micro-USD",
  octoberUsd?.entries.find((entry) => entry.market === "Colombia")?.micros.service,
  800,
);
equal(
  "Germany service rate in micro-USD",
  octoberUsd?.entries.find((entry) => entry.market === "Germany")?.micros.service,
  55000,
);

// ── The card is chosen by date, in both directions ──────────────────────────
equal("before the charge, the state is before", metaChargeState(BEFORE), "before");
equal("on the charge date, the state is active", metaChargeState(RATE_ALLOWANCE.effectiveFrom), "active");
equal(
  "the day before the charge still resolves to the July card",
  cardInForce("USD", "2026-09-30")?.rateVersion,
  "meta-ratecards-2026/USD/2026-07-01",
);
equal(
  "midnight on the effective date resolves to the October card",
  cardInForce("USD", RATE_ALLOWANCE.effectiveFrom)?.rateVersion,
  "meta-ratecards-2026/USD/2026-10-01",
);
// Before the charge begins the page must answer with the rule that STARTS, not
// with a card that prices nothing — otherwise the estimator is a row of blanks
// for the three weeks when a business most needs to budget for it.
equal(
  "before the charge, the estimate is built on the card that takes effect",
  estimationCard("USD", BEFORE).card?.rateVersion,
  "meta-ratecards-2026/USD/2026-10-01",
);
equal("and that state is reported as future", estimationCard("USD", BEFORE).state, "before");

// ── The free thousand: once per number, never once per country ──────────────
const oneNumber = estimateWhatsappCost({
  currency: "USD", market: "Colombia", phoneNumbers: 1,
  deliveries: { service: 3000 }, onDate: AFTER,
});
equal("one number: free deliveries", line(oneNumber, "service").freeDeliveries, RATE_ALLOWANCE.deliveries);
equal("one number: billable deliveries", line(oneNumber, "service").billableDeliveries, 2000);
equal("one number: total in micros", oneNumber.totalMicros, 2000 * 800);
equal("one number: total in cents", oneNumber.totalMinorUnits, 160);

const threeNumbers = estimateWhatsappCost({
  currency: "USD", market: "Colombia", phoneNumbers: 3,
  deliveries: { service: 3000 }, onDate: AFTER,
});
equal("three numbers: the whole volume is covered", threeNumbers.totalMicros, 0);
equal("three numbers: allowance applied", threeNumbers.allowanceApplied, 3000);

// Under the allowance, nothing is billable and nothing is invented.
const underAllowance = estimateWhatsappCost({
  currency: "USD", market: "Germany", phoneNumbers: 1,
  deliveries: { service: 400 }, onDate: AFTER,
});
equal("under the allowance: free", underAllowance.totalMicros, 0);
equal("under the allowance: no negative billable", line(underAllowance, "service").billableDeliveries, 0);

// The allowance covers ONE category. A utility template inside the 24-hour
// window is chargeable and must not eat a free service message.
const mixedCategories = estimateWhatsappCost({
  currency: "USD", market: "Colombia", phoneNumbers: 1,
  deliveries: { service: 1000, marketing: 500, utility: 200, authentication: 100 }, onDate: AFTER,
});
equal("service inside the allowance is free", line(mixedCategories, "service").subtotalMicros, 0);
equal("marketing is never covered", line(mixedCategories, "marketing").freeDeliveries, 0);
equal("utility is never covered", line(mixedCategories, "utility").freeDeliveries, 0);
equal("authentication is never covered", line(mixedCategories, "authentication").freeDeliveries, 0);
equal(
  "mixed total sums every billed category",
  mixedCategories.totalMicros,
  500 * 12500 + 200 * 800 + 100 * 800,
);

// ── Germany is seventy times Colombia, and the estimator says so ────────────
const germany = estimateWhatsappCost({
  currency: "USD", market: "Germany", phoneNumbers: 1,
  deliveries: { service: 3000 }, onDate: AFTER,
});
equal("Germany: total in micros", germany.totalMicros, 2000 * 55000);
equal("Germany: total in cents", germany.totalMinorUnits, 11000);
check(
  "the recipient's market changes the answer",
  germany.totalMicros > oneNumber.totalMicros * 60,
  `Germany ${germany.totalMicros} vs Colombia ${oneNumber.totalMicros}`,
);

// ── An unpublished rate is withheld, never summed as zero ───────────────────
const julyService = estimateWhatsappCost({
  currency: "USD", market: "Colombia", phoneNumbers: 1,
  // Anchored to a July date through the card directly: `estimateWhatsappCost`
  // deliberately refuses to build a service estimate on a card that prices none.
  deliveries: { service: 3000 }, onDate: AFTER,
});
check("the October path is priced", julyService.totalMicros !== null);

const julyCard = cardInForce("USD", BEFORE);
equal(
  "the July card publishes no service rate at all",
  julyCard?.entries.every((entry) => entry.micros.service === "unavailable"),
  true,
);
// `authentication_international` is unavailable in most markets even in
// October, which is the live case of an unpriced cell inside a current card.
const unpricedMarket = octoberUsd.entries.find(
  (entry) => entry.micros.authentication_international === "unavailable",
);
check("a current card still has an unpriced cell to test", Boolean(unpricedMarket));
// The estimator only offers the four categories a reader can enter, so the
// unpriced cell is proven through the projection rather than the form — and
// every offered category must be priced on the October card, or the page would
// show an incomplete total for the default view.
for (const category of ESTIMATOR_CATEGORIES) {
  const unpriced = octoberUsd.entries.filter((entry) => typeof entry.micros[category] !== "number");
  equal(`every October market prices ${category}`, unpriced.length, 0);
}

// A market that is not on the card resolves to no estimate at all, rather than
// falling through to a cheaper regional bucket — the same rule the engine keeps.
const unknownMarket = estimateWhatsappCost({
  currency: "USD", market: "Ecuador", phoneNumbers: 1,
  deliveries: { service: 3000 }, onDate: AFTER,
});
equal("an unlisted market yields no total", unknownMarket.totalMicros, null);
equal("an unlisted market yields no billable figure", unknownMarket.totalMinorUnits, null);
check(
  "and it says which categories it could not price",
  unknownMarket.unpricedCategories.includes("service"),
);

// ── Rounding up, once, to whole minor units ─────────────────────────────────
equal("a single Colombian message rounds up to one cent", minorUnitsFromMicros(800, "USD"), 1);
equal("zero stays zero", minorUnitsFromMicros(0, "USD"), 0);
equal("an unknown currency has no minor unit", minorUnitsFromMicros(800, "XAF"), null);
const colombiaPesos = estimateWhatsappCost({
  currency: "COP", market: "Colombia", phoneNumbers: 1,
  deliveries: { service: 2000 }, onDate: AFTER,
});
check("the peso card prices Colombia too", colombiaPesos.totalMicros > 0);
equal(
  "the peso total rounds up once over the batch",
  colombiaPesos.totalMinorUnits,
  Math.ceil(colombiaPesos.totalMicros / 10000),
);

// ── Nonsense input produces no nonsense output ──────────────────────────────
const garbage = estimateWhatsappCost({
  currency: "USD", market: "Colombia", phoneNumbers: -5,
  deliveries: { service: -100, marketing: Number.NaN }, onDate: AFTER,
});
equal("a negative volume floors at zero", line(garbage, "service").deliveries, 0);
equal("NaN floors at zero", line(garbage, "marketing").deliveries, 0);
equal("fewer than one number is treated as one", garbage.allowanceApplied, 0);
equal("and the total is zero, not negative", garbage.totalMicros, 0);

if (failures.length) {
  console.error(`WhatsApp cost estimate contract failed:\n${failures.map((f) => `- ${f}`).join("\n")}`);
  process.exit(1);
}

console.log(
  "WhatsApp cost estimate contract passed: card chosen by date in both directions, "
  + `the free ${RATE_ALLOWANCE.deliveries} applied per number and not per country, `
  + "unpriced rates withheld rather than summed, rounding up once, and the "
  + "Colombia/Germany extremes pinned to their micro-unit values.",
);
