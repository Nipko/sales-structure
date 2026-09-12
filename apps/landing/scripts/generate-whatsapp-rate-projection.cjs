#!/usr/bin/env node
/**
 * ═══ THE LANDING'S COPY OF META'S RATE CARDS, DERIVED NOT TYPED ═════════════
 *
 * `/costos-whatsapp` now carries an estimator, and an estimator needs rates.
 * There were three ways to give it rates and only one of them survives contact
 * with the next revision of Meta's cards:
 *
 *   1. type the numbers into the landing. This is what the frozen claim rule
 *      "hard-coded Meta per-message rate" exists to stop: a sub-cent figure
 *      typed into copy is wrong at the next revision and right for almost
 *      nobody in between, and nothing turns red when it rots;
 *   2. import `apps/api/.../whatsapp-rate-table.generated.ts` straight into the
 *      page. Correct in principle, and Next's compiler does not transpile
 *      TypeScript from outside the app root, so the static export would break;
 *   3. DERIVE a projection into the landing, and make the build fail when it
 *      drifts from the table the engine actually prices against.
 *
 * This is (3). The generator reads the API's generated table — itself derived
 * from preserved official cards with verified SHA-256s — and writes
 * `src/data/whatsapp-rate-projection.generated.ts`. `check:claims` re-derives
 * the projection in memory and asserts it equals the file on disk, so editing
 * the projection by hand, or letting it fall behind a regenerated rate table,
 * turns the build red rather than shipping a stale price.
 *
 * Regenerate:  node scripts/generate-whatsapp-rate-projection.cjs
 * Verify:      node scripts/generate-whatsapp-rate-projection.cjs --check
 *
 * WHAT IS DELIBERATELY DROPPED: `sourceUrl`. Meta serves the cards from signed
 * CDN links that expire, so publishing one would put a dead link on a public
 * page. The file name and the SHA-256 stay, which is what an argument about a
 * price actually needs, and the page links Meta's stable pricing page instead.
 */

const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const landingRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(landingRoot, "..", "..");

const RATE_TABLE = path.join(
  repoRoot, "apps", "api", "src", "modules", "billing", "whatsapp-rates",
  "whatsapp-rate-table.generated.ts",
);
const OUTPUT = path.join(landingRoot, "src", "data", "whatsapp-rate-projection.generated.ts");

/** Transpile-and-run one TypeScript module with no dependencies of its own. */
function loadTsFile(file) {
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
    fileName: file,
  }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", "require", output)(loaded, loaded.exports, require);
  return loaded.exports;
}

/**
 * Markets Meta names as an aggregate rather than a country.
 *
 * A reader in Bogotá understands "Colombia" in any language; "Rest of Latin
 * America" is a bucket, and leaving it in English on the Spanish page makes the
 * one row most tenants land on the least legible. These get an i18n key; every
 * other market renders its proper noun verbatim, which is also the row a
 * dispute with Meta has to point at.
 */
const AGGREGATE_MARKET_KEYS = Object.freeze({
  "North America": "northAmerica",
  "Rest of Africa": "restOfAfrica",
  "Rest of Asia Pacific": "restOfAsiaPacific",
  "Rest of Central & Eastern Europe": "restOfCentralEasternEurope",
  "Rest of Latin America": "restOfLatinAmerica",
  "Rest of Middle East": "restOfMiddleEast",
  "Rest of Western Europe": "restOfWesternEurope",
  Other: "other",
});

function quote(value) {
  return `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function renderMicros(micros, categories) {
  const parts = categories.map((category) => {
    const value = micros[category];
    return `${category}: ${typeof value === "number" ? value : quote(value)}`;
  });
  return `{ ${parts.join(", ")} }`;
}

function build() {
  const table = loadTsFile(RATE_TABLE);
  const categories = [...(table.WHATSAPP_MESSAGE_CATEGORIES || [])];
  const allowance = table.WHATSAPP_FREE_SERVICE_ALLOWANCE;
  const cards = [...(table.WHATSAPP_RATE_CARDS || [])];

  if (!categories.length) throw new Error("rate table exported no categories");
  if (!cards.length) throw new Error("rate table exported no cards");
  if (!allowance) throw new Error("rate table exported no free allowance");

  const lines = [];
  lines.push("/*");
  lines.push(" * DERIVED FILE — do not edit by hand.");
  lines.push(" *");
  lines.push(" * Regenerate:  node scripts/generate-whatsapp-rate-projection.cjs");
  lines.push(" * Verify:      node scripts/generate-whatsapp-rate-projection.cjs --check");
  lines.push(" *");
  lines.push(" * Projected from apps/api/src/modules/billing/whatsapp-rates/");
  lines.push(" * whatsapp-rate-table.generated.ts — the same table the engine prices");
  lines.push(" * against — so a rate on the public page cannot disagree with a rate on an");
  lines.push(" * invoice. `check:claims` fails when this file and that table diverge.");
  lines.push(" *");
  lines.push(" * Prices are integer MICRO-UNITS: millionths of one whole unit of the card's");
  lines.push(" * currency. `'unavailable'` is what the card printed as n/a — a rate that could");
  lines.push(" * not be established, which is NOT zero and must never be summed as zero.");
  lines.push(" */");
  lines.push("");
  lines.push("/** A price the card did not state. Never coerce this to a number. */");
  lines.push("export type UnavailableRate = 'unavailable';");
  lines.push("");
  lines.push(`export type WhatsAppMessageCategory =\n${categories.map((c) => `    | '${c}'`).join("\n")};`);
  lines.push("");
  lines.push("export interface ProjectedRateEntry {");
  lines.push("    /** Meta's own market name. The row a dispute has to point at. */");
  lines.push("    readonly market: string;");
  lines.push("    /** i18n key under `whatsappCosts.market.*` when Meta names a bucket. */");
  lines.push("    readonly aggregateKey?: string;");
  lines.push("    readonly locator: string;");
  lines.push("    readonly micros: Readonly<Record<WhatsAppMessageCategory, number | UnavailableRate>>;");
  lines.push("}");
  lines.push("");
  lines.push("export interface ProjectedRateCard {");
  lines.push("    readonly rateVersion: string;");
  lines.push("    /** Currency of the WhatsApp account BEING BILLED, not of the recipient. */");
  lines.push("    readonly currency: string;");
  lines.push("    /** Applies from midnight of this date IN THE WABA'S OWN TIME ZONE. */");
  lines.push("    readonly effectiveFrom: string;");
  lines.push("    readonly sourceFile: string;");
  lines.push("    readonly sourceSha256: string;");
  lines.push("    readonly headerLocator: string;");
  lines.push("    readonly entries: readonly ProjectedRateEntry[];");
  lines.push("}");
  lines.push("");
  lines.push("export const WHATSAPP_RATE_PROJECTION = Object.freeze({");
  lines.push(`    rateTableVersion: ${quote(table.WHATSAPP_RATE_TABLE_VERSION)},`);
  lines.push(`    microsPerUnit: ${table.MICROS_PER_UNIT},`);
  lines.push(`    categories: Object.freeze([${categories.map(quote).join(", ")}] as const),`);
  lines.push("    allowance: Object.freeze({");
  lines.push(`        deliveries: ${allowance.deliveries},`);
  lines.push(`        scope: ${quote(allowance.scope)} as const,`);
  lines.push(`        rollsOver: ${allowance.rollsOver === true},`);
  lines.push(`        category: ${quote(allowance.category)} as const,`);
  lines.push(`        effectiveFrom: ${quote(allowance.effectiveFrom)},`);
  lines.push("    }),");
  lines.push("    currencyMinorExponent: Object.freeze({");
  for (const [currency, exponent] of Object.entries(table.CURRENCY_MINOR_EXPONENT || {})) {
    lines.push(`        ${currency}: ${exponent},`);
  }
  lines.push("    }),");
  lines.push("    cards: Object.freeze<readonly ProjectedRateCard[]>([");
  for (const card of cards) {
    lines.push("        Object.freeze({");
    lines.push(`            rateVersion: ${quote(card.rateVersion)},`);
    lines.push(`            currency: ${quote(card.currency)},`);
    lines.push(`            effectiveFrom: ${quote(card.effectiveFrom)},`);
    lines.push(`            sourceFile: ${quote(card.sourceFile)},`);
    lines.push(`            sourceSha256: ${quote(card.sourceSha256)},`);
    lines.push(`            headerLocator: ${quote(card.headerLocator)},`);
    lines.push("            entries: Object.freeze([");
    for (const entry of card.entries) {
      const aggregate = AGGREGATE_MARKET_KEYS[entry.market];
      const aggregatePart = aggregate ? `aggregateKey: ${quote(aggregate)}, ` : "";
      lines.push(
        `                Object.freeze({ market: ${quote(entry.market)}, ${aggregatePart}`
        + `locator: ${quote(entry.locator)}, micros: Object.freeze(`
        + `${renderMicros(entry.micros, categories)}) }),`,
      );
    }
    lines.push("            ]),");
    lines.push("        }),");
  }
  lines.push("    ]),");
  lines.push("});");
  lines.push("");
  return `${lines.join("\n")}`;
}

const generated = build();

if (process.argv.includes("--check")) {
  const current = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, "utf8") : "";
  if (current !== generated) {
    process.stderr.write(
      "whatsapp-rate-projection.generated.ts is stale or hand-edited.\n"
      + "Run: node scripts/generate-whatsapp-rate-projection.cjs\n",
    );
    process.exit(1);
  }
  process.stdout.write("whatsapp rate projection matches the engine's rate table\n");
} else {
  fs.writeFileSync(OUTPUT, generated);
  process.stdout.write(`wrote ${path.relative(landingRoot, OUTPUT)}\n`);
}
