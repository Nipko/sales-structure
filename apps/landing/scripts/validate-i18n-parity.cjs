#!/usr/bin/env node
/**
 * ═══ THE FOUR LOCALES SAY THE SAME THINGS, OR THE BUILD STOPS ═══════════════
 *
 * There was no parity check. Parity was asserted in a commit message and
 * measured by hand, which means the next person to add a section in Spanish and
 * forget French shipped a French page with a raw key on it — next-intl renders
 * the key path itself when a message is missing, so the failure is silent at
 * build time and loud in front of a reader.
 *
 * Five properties are checked, and each one has already been a real defect
 * somewhere in a four-language site:
 *
 *   1. SAME KEYS. Every leaf in every locale exists in all four. Missing and
 *      extra are reported separately: a missing key renders a key path, an
 *      extra key is dead weight that makes the next diff harder to read.
 *   2. SAME SHAPE. A path that is a string in one locale and an object in
 *      another throws at render time rather than degrading.
 *   3. NO EMPTY STRINGS, and no PROSE string that is still the Spanish source
 *      text in a non-Spanish file — the specific way "translated" work arrives
 *      untranslated. Short strings are exempt: agent names, industry tags and
 *      model years are identical in all four by design.
 *   4. SAME ICU PLACEHOLDERS. `{card}` dropped from one translation produces a
 *      sentence missing its subject; `{crad}` produces a runtime error. Both
 *      are caught by comparing the placeholder SETS, not the counts.
 *   5. es-AR IS AN OVERLAY, NOT A FIFTH LOCALE. Every key it carries must exist
 *      in `es`, and every value must actually DIFFER from the es value — an
 *      overlay entry identical to its base is a string that will silently stop
 *      tracking future edits to the Spanish copy.
 *
 * Usage: node scripts/validate-i18n-parity.cjs
 */

const fs = require("fs");
const path = require("path");

const landingRoot = path.resolve(__dirname, "..");
const messagesDir = path.join(landingRoot, "messages");
const LOCALES = ["es", "en", "pt", "fr"];
const BASE = "es";
const OVERLAY = "es-AR";

const failures = [];
function fail(message) {
  failures.push(message);
}

function load(locale) {
  return JSON.parse(fs.readFileSync(path.join(messagesDir, `${locale}.json`), "utf8"));
}

/**
 * Every leaf path mapped to its string value. Containers are recorded as shapes.
 *
 * Arrays are walked by INDEX rather than treated as one leaf: the plan feature
 * lists are arrays, and comparing them as opaque values would pass a locale
 * that dropped the last two bullets.
 */
function flatten(node, prefix = "", out = { leaves: new Map(), objects: new Set() }) {
  const entries = Array.isArray(node)
    ? node.map((value, index) => [String(index), value])
    : Object.entries(node);
  for (const [key, value] of entries) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") {
      out.objects.add(dotted);
      flatten(value, dotted, out);
    } else {
      out.leaves.set(dotted, value);
    }
  }
  return out;
}

/** ICU argument names, ignoring whatever formatting follows them. */
function placeholders(text) {
  const found = new Set();
  for (const match of String(text).matchAll(/\{\s*([A-Za-z0-9_]+)\s*(?:,[^}]*)?\}/g)) {
    found.add(match[1]);
  }
  return found;
}

/**
 * Only PROSE is required to differ between locales.
 *
 * Agent names, product names, industry tags and model years are identical in
 * all four by design — "Coach", "Web + Android", "Mazda CX-5 2023" — and
 * demanding a French version of them would bury the real finding in noise and
 * get the rule switched off. Six words is the floor: a sentence that long and
 * still byte-identical to the Spanish has not been translated.
 */
const PROSE_WORD_FLOOR = 6;

function isProse(value) {
  return String(value).trim().split(/\s+/).filter((word) => /\p{L}/u.test(word)).length
    >= PROSE_WORD_FLOOR;
}

/**
 * Namespaces whose strings are deliberately blank.
 *
 * Testimonials fail closed: the copy is emptied and the section is not imported
 * until registered evidence and consent exist, which
 * `validate-marketing-claims.cjs` enforces from the other direction. Treating
 * that as a translation gap would pressure somebody into inventing a quote.
 */
const INTENTIONALLY_EMPTY = [/^testimonials\./];

function intentionallyEmpty(key) {
  return INTENTIONALLY_EMPTY.some((pattern) => pattern.test(key));
}

// ── 1 & 2: same keys, same shape ────────────────────────────────────────────
const flat = new Map(LOCALES.map((locale) => [locale, flatten(load(locale))]));
const base = flat.get(BASE);

for (const locale of LOCALES) {
  if (locale === BASE) continue;
  const other = flat.get(locale);
  for (const key of base.leaves.keys()) {
    if (!other.leaves.has(key)) {
      fail(
        other.objects.has(key)
          ? `${locale}: ${key} is an object here and a string in ${BASE}`
          : `${locale}: missing key ${key}`,
      );
    }
  }
  for (const key of other.leaves.keys()) {
    if (!base.leaves.has(key)) {
      fail(
        base.objects.has(key)
          ? `${locale}: ${key} is a string here and an object in ${BASE}`
          : `${locale}: extra key ${key} (absent from ${BASE})`,
      );
    }
  }
}

// ── 3 & 4: real prose, and the same ICU arguments ───────────────────────────
for (const locale of LOCALES) {
  for (const [key, value] of flat.get(locale).leaves) {
    if (typeof value !== "string") {
      fail(`${locale}: ${key} is ${typeof value}, expected a string`);
      continue;
    }
    if (value.trim().length === 0) {
      if (!intentionallyEmpty(key)) fail(`${locale}: ${key} is empty`);
      continue;
    }
    const baseValue = base.leaves.get(key);
    if (
      locale !== BASE
      && typeof baseValue === "string"
      && value.trim() === baseValue.trim()
      && isProse(value)
    ) {
      fail(`${locale}: ${key} is still the ${BASE} text ("${value.slice(0, 48)}…")`);
    }
    if (typeof baseValue === "string") {
      const mine = placeholders(value);
      const theirs = placeholders(baseValue);
      const missing = [...theirs].filter((name) => !mine.has(name));
      const unknown = [...mine].filter((name) => !theirs.has(name));
      if (missing.length) fail(`${locale}: ${key} drops placeholder(s) ${missing.join(", ")}`);
      if (unknown.length) fail(`${locale}: ${key} invents placeholder(s) ${unknown.join(", ")}`);
    }
  }
}

// ── 5: the overlay is an overlay ────────────────────────────────────────────
const overlay = flatten(load(OVERLAY));
for (const [key, value] of overlay.leaves) {
  if (!base.leaves.has(key)) {
    fail(`${OVERLAY}: ${key} has no ${BASE} base — an overlay may only override existing copy`);
    continue;
  }
  if (String(value).trim() === String(base.leaves.get(key)).trim()) {
    fail(`${OVERLAY}: ${key} is identical to ${BASE}; drop it rather than freezing a copy`);
  }
  const mine = placeholders(value);
  const theirs = placeholders(base.leaves.get(key));
  const missing = [...theirs].filter((name) => !mine.has(name));
  if (missing.length) fail(`${OVERLAY}: ${key} drops placeholder(s) ${missing.join(", ")}`);
}

if (failures.length) {
  process.stderr.write(`i18n parity: ${failures.length} problem(s)\n`);
  for (const message of failures.slice(0, 80)) process.stderr.write(`  - ${message}\n`);
  if (failures.length > 80) process.stderr.write(`  … and ${failures.length - 80} more\n`);
  process.exit(1);
}

process.stdout.write(
  `i18n parity: ${base.leaves.size} keys identical across ${LOCALES.join(", ")}; `
  + `${overlay.leaves.size} overlay keys in ${OVERLAY}, all overriding an ${BASE} base\n`,
);
