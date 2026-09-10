/*
 * Derive the WhatsApp rate table from the preserved official sources.
 *
 * From 1 October 2026 Meta charges for delivered service messages, and the
 * price depends on the RECIPIENT's market, the ACCOUNT's currency, the message
 * category and the date of delivery. Four of those five things are easy to get
 * wrong quietly, and the fifth — the price — is the one nobody notices until an
 * invoice arrives. So no rate in this codebase is typed by hand: every number
 * in the emitted table is read out of a file whose SHA-256 is checked on the
 * way past, and carries the file and the line or row it came from.
 *
 * What this refuses to do is as important as what it does:
 *
 *   - `n/a` in a rate card becomes `'unavailable'`, never `0`. The source note
 *     says so in as many words ("n/a is unavailable, not zero"), and a rate
 *     that reads as zero is a message that spends invisibly.
 *   - A price that will not fit in micro-units exactly is refused rather than
 *     rounded. Nothing here invents precision and nothing here loses it.
 *   - The column order is asserted against the header of each source. A card
 *     that reorders Utility and Service would otherwise reprice the whole
 *     platform in silence.
 *
 * Run from the repository root:
 *   node apps/api/scripts/generate-whatsapp-rates.cjs
 *   node apps/api/scripts/generate-whatsapp-rates.cjs --check
 *
 * `--check` regenerates in memory and exits non-zero when the checked-in table
 * no longer corresponds to the sources. There is no timestamp in the output, so
 * the comparison is byte-exact: drift cannot hide behind a changing header.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../../..');
const researchDir = path.join(root, 'docs/research/2026-09-10');
const outFile = path.join(
    root,
    'apps/api/src/modules/billing/whatsapp-rates/whatsapp-rate-table.generated.ts',
);

const CHECK = process.argv.includes('--check');

function fail(message) {
    console.error(`generate-whatsapp-rates: ${message}`);
    process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// The shape the sources must have. Asserted, not assumed.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Category → the header text that names its column.
 *
 * Meta publishes one row per market and one column per category, and the only
 * thing tying a number to a meaning is its position — so the position is READ
 * from each card's own header rather than written down here. A card that moves
 * Service from G to H is then read correctly instead of repricing the platform
 * in silence, and a constant claiming Utility is in column E cannot exist to be
 * wrong, because there is no such constant.
 *
 * A mutation run is what asked for this. Utility and Authentication carry
 * identical values in all four preserved cards, so swapping their hardcoded
 * letters changed nothing observable and no check noticed. The class of bug is
 * gone now rather than the one instance of it.
 */
const CATEGORY_HEADER_LABEL = Object.freeze({
    marketing: 'Marketing',
    utility: 'Utility',
    authentication: 'Authentication',
    authentication_international: 'Authentication- International',
    service: 'Service',
});

const CATEGORIES = Object.freeze(Object.keys(CATEGORY_HEADER_LABEL));

/** The two columns that identify a row rather than price it. */
const IDENTITY_HEADER = Object.freeze({ A: 'Market', B: 'Currency' });

/**
 * Market name → ISO 3166-1 alpha-2, for the markets Meta names as countries.
 *
 * This assignment is OURS, not Meta's, which is why it is a separate list that
 * `--check` validates name-by-name against the card rather than a mapping baked
 * into the numbers. Every name here must appear verbatim in the October card.
 *
 * The "Rest of …" and "Other" buckets are deliberately absent. Meta maps
 * countries into them by calling code on a page we did not preserve (the cards
 * link to `#country-calling-codes`), so deciding that, say, Japan belongs in
 * "Rest of Asia Pacific" would be us inventing a membership the sources do not
 * state — and inventing it in the direction of a cheaper bucket. A caller may
 * still name a bucket explicitly; it just cannot be reached by guessing.
 */
const ISO_ALPHA2_BY_MARKET = Object.freeze({
    Argentina: 'AR',
    Bangladesh: 'BD',
    Brazil: 'BR',
    Chile: 'CL',
    Colombia: 'CO',
    Egypt: 'EG',
    France: 'FR',
    Germany: 'DE',
    'Hong Kong': 'HK',
    Hungary: 'HU',
    India: 'IN',
    Indonesia: 'ID',
    Iraq: 'IQ',
    Israel: 'IL',
    Italy: 'IT',
    Kazakhstan: 'KZ',
    Kuwait: 'KW',
    Malaysia: 'MY',
    Mexico: 'MX',
    Morocco: 'MA',
    Nepal: 'NP',
    Netherlands: 'NL',
    Nigeria: 'NG',
    Oman: 'OM',
    Pakistan: 'PK',
    Peru: 'PE',
    Poland: 'PL',
    Qatar: 'QA',
    Romania: 'RO',
    Russia: 'RU',
    'Saudi Arabia': 'SA',
    Singapore: 'SG',
    'South Africa': 'ZA',
    Spain: 'ES',
    'Sri Lanka': 'LK',
    Turkey: 'TR',
    Ukraine: 'UA',
    'United Arab Emirates': 'AE',
    'United Kingdom': 'GB',
});

/**
 * ISO 4217 minor-unit exponents, for the currencies the cards are published in.
 *
 * Only these two. Guessing 2 for an unseen currency is how JPY (0) and KWD (3)
 * become wrong by a factor of a hundred, and the honest answer for a currency
 * nobody published a card in is that we cannot price it.
 */
const CURRENCY_MINOR_EXPONENT = Object.freeze({ USD: 2, COP: 2 });

// ─────────────────────────────────────────────────────────────────────────────
// Exact decimal arithmetic. No float ever touches a price.
// ─────────────────────────────────────────────────────────────────────────────

const MICRO_EXPONENT = 6;

/**
 * A published decimal string → integer micro-units, exactly, or `null`.
 *
 * The October cards came out of a spreadsheet, so the same price appears as
 * `0.0008` in the July CSV and `8.0E-4` in the October XLSX. Both are parsed by
 * digit manipulation over BigInt: `parseFloat` would introduce a binary
 * approximation into a number that ends up on an invoice.
 *
 * Returns `null` when the value carries more precision than micro-units can
 * hold. That is a refusal, not a rounding: the caller records `'unavailable'`.
 */
function decimalStringToMicros(raw) {
    const text = String(raw).trim();
    const match = /^([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(text);
    if (!match) return null;

    const digits = match[1] + (match[2] || '');
    const fractionLength = (match[2] || '').length;
    const exponent = match[3] ? Number.parseInt(match[3], 10) : 0;
    // value = digits × 10^(exponent − fractionLength); micros = value × 10^6.
    const shift = exponent - fractionLength + MICRO_EXPONENT;

    let micros;
    if (shift >= 0) {
        micros = BigInt(digits) * 10n ** BigInt(shift);
    } else {
        const divisor = 10n ** BigInt(-shift);
        const numerator = BigInt(digits);
        if (numerator % divisor !== 0n) return null; // finer than a micro-unit
        micros = numerator / divisor;
    }

    const asNumber = Number(micros);
    if (!Number.isSafeInteger(asNumber)) return null;
    return asNumber;
}

// ─────────────────────────────────────────────────────────────────────────────
// Provenance: which physical line or spreadsheet row each number came from.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal RFC 4180 reader that reports where each record STARTS.
 *
 * The line number is the point of the exercise: the header of the July cards
 * spans two physical lines because "Authentication-\nInternational" contains a
 * newline inside its quotes, so counting records is not the same as counting
 * lines, and a provenance note that is off by two is worse than none.
 */
function readCsvRecords(text) {
    const records = [];
    let field = '';
    let fields = [];
    let line = 1;
    let recordStartLine = 1;
    let quoted = false;
    let started = false;

    const pushField = () => { fields.push(field); field = ''; };
    const pushRecord = () => {
        pushField();
        records.push({ startLine: recordStartLine, fields });
        fields = [];
        started = false;
    };

    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (!started && ch !== '\n' && ch !== '\r') { recordStartLine = line; started = true; }
        if (quoted) {
            if (ch === '"') {
                if (text[i + 1] === '"') { field += '"'; i += 1; } else { quoted = false; }
            } else {
                if (ch === '\n') line += 1;
                field += ch;
            }
            continue;
        }
        if (ch === '"') { quoted = true; started = true; continue; }
        if (ch === ',') { pushField(); continue; }
        if (ch === '\r') continue;
        if (ch === '\n') { line += 1; if (started || fields.length) pushRecord(); continue; }
        field += ch;
    }
    if (started || fields.length || field) pushRecord();
    return records;
}

const COLUMN_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

/** Normalise a header cell so an embedded newline does not fail the comparison. */
const squash = value => String(value ?? '').replace(/\s+/g, ' ').trim();

/**
 * Work out which column holds which category, from the card's own header.
 *
 * Every category must be found exactly once. A card that drops a column, adds a
 * second one with the same name, or renames one stops the generator, because
 * any of those means the shape we know how to read has changed.
 */
function categoryColumnsFromHeader(sourceFile, locator, headerCells) {
    for (const [letter, want] of Object.entries(IDENTITY_HEADER)) {
        const found = squash(headerCells[letter]);
        if (found !== want) {
            fail(`${sourceFile} ${locator}: column ${letter} is "${found}", expected "${want}"`);
        }
    }

    const columns = {};
    for (const category of CATEGORIES) {
        const label = CATEGORY_HEADER_LABEL[category];
        const matches = COLUMN_LETTERS.filter(letter => squash(headerCells[letter]) === label);
        if (matches.length !== 1) {
            fail(`${sourceFile} ${locator}: found ${matches.length} columns headed "${label}", expected exactly one`);
        }
        columns[category] = matches[0];
    }
    return columns;
}

/**
 * Locate every market's physical position in the source file it was read from.
 *
 * CSV cards give a line number; XLSX cards give the spreadsheet row that the
 * preserved extraction recorded. Either way the value in the emitted table is
 * cross-checked against the value at that position, so an extraction that has
 * drifted from its own source cannot pass unnoticed.
 */
function locateCsvCard(card) {
    const raw = fs.readFileSync(path.join(researchDir, card.source_file), 'utf8');
    const records = readCsvRecords(raw);

    const headerIndex = records.findIndex(r => squash(r.fields[0]) === IDENTITY_HEADER.A);
    if (headerIndex < 0) fail(`${card.source_file}: no header record starting with "Market"`);
    const header = records[headerIndex];
    const headerCells = {};
    COLUMN_LETTERS.forEach((letter, column) => { headerCells[letter] = header.fields[column]; });
    const categoryColumns = categoryColumnsFromHeader(
        card.source_file, `line ${header.startLine}`, headerCells,
    );

    const byMarket = new Map();
    for (const record of records.slice(headerIndex + 1)) {
        const market = squash(record.fields[0]);
        if (!market) continue;
        const cells = {};
        COLUMN_LETTERS.forEach((letter, column) => { cells[letter] = squash(record.fields[column]); });
        byMarket.set(market, { locator: `line ${record.startLine}`, cells });
    }
    return { headerLocator: `line ${header.startLine}`, categoryColumns, byMarket };
}

function locateSheetCard(card) {
    const headerRow = card.rows.find(r => squash(r.cells.A) === IDENTITY_HEADER.A);
    if (!headerRow) fail(`${card.source_file}: no sheet row whose column A is "Market"`);
    const categoryColumns = categoryColumnsFromHeader(
        card.source_file, `row ${headerRow.row}`, headerRow.cells,
    );

    const byMarket = new Map();
    for (const row of card.rows) {
        if (row.row <= headerRow.row) continue;
        const market = squash(row.cells.A);
        if (!market || byMarket.has(market)) continue;
        const cells = {};
        for (const letter of COLUMN_LETTERS) cells[letter] = squash(row.cells[letter]);
        byMarket.set(market, { locator: `row ${row.row}`, cells });
    }
    return { headerLocator: `row ${headerRow.row}`, categoryColumns, byMarket };
}

// ─────────────────────────────────────────────────────────────────────────────
// The free service allowance, read out of the evidence rather than remembered.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read the monthly free service allowance from the pricing evidence.
 *
 * Two independent sentences in that document state the figure — the rule
 * ("1.000 entregas gratuitas por número y mes") and the arithmetic a reader is
 * told to do (`max(entregasServicioMes - 1000, 0)`). Both are extracted and
 * required to agree, so a one-sided edit to the evidence fails the check
 * instead of quietly moving a thousand free messages.
 */
function readFreeAllowance() {
    const file = 'meta-official-pricing-evidence.md';
    const lines = fs.readFileSync(path.join(researchDir, file), 'utf8').split(/\r?\n/);

    const findings = [];
    lines.forEach((line, index) => {
        const rule = /1\.000 entregas gratuitas por n[uú]mero y mes/.exec(line);
        if (rule) findings.push({ value: 1000, line: index + 1, quote: 'entregas gratuitas por número y mes' });
        const sum = /entregasServicioMes\s*-\s*([0-9]+)/.exec(line);
        if (sum) findings.push({ value: Number.parseInt(sum[1], 10), line: index + 1, quote: 'max(entregasServicioMes - N, 0)' });
    });

    if (findings.length < 2) fail(`${file}: expected two independent statements of the free allowance, found ${findings.length}`);
    const values = new Set(findings.map(f => f.value));
    if (values.size !== 1) fail(`${file}: the free allowance is stated as ${[...values].join(' and ')} — the evidence disagrees with itself`);

    const noRollover = lines.findIndex(l => /sin acumulaci[oó]n/.test(l));
    if (noRollover < 0) fail(`${file}: no statement that the allowance does not roll over`);

    return {
        deliveries: findings[0].value,
        sourceFile: file,
        sourceLocators: findings.map(f => `line ${f.line}`),
        rollsOver: false,
        rollsOverLocator: `line ${noRollover + 1}`,
    };
}

/**
 * The date the service charge starts, read from the card that introduces it.
 *
 * Derived rather than typed: it is the earliest effective date of any card that
 * publishes a service rate at all.
 */
function readServiceChargeStart(cards) {
    const withService = cards
        .filter(card => card.rates.some(rate => rate.service !== 'n/a'))
        .map(card => card.effective_from)
        .sort();
    if (!withService.length) fail('no preserved card publishes a service rate');
    return withService[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// Build
// ─────────────────────────────────────────────────────────────────────────────

const ratecardsPath = path.join(researchDir, 'meta-ratecards-2026.json');
const ratecardsRaw = fs.readFileSync(ratecardsPath);
const ratecards = JSON.parse(ratecardsRaw.toString('utf8'));
const tableVersion = crypto.createHash('sha256').update(ratecardsRaw).digest('hex').slice(0, 16);

const rateCards = ratecards.cards.filter(card => card.kind === 'rates');
if (!rateCards.length) fail(`${path.basename(ratecardsPath)}: no cards of kind "rates"`);

const unavailableReasons = [];
const built = rateCards.map(card => {
    const onDisk = fs.readFileSync(path.join(researchDir, card.source_file));
    const sha256 = crypto.createHash('sha256').update(onDisk).digest('hex');
    if (sha256 !== card.sha256) {
        fail(`${card.source_file}: sha256 on disk is ${sha256}, the manifest claims ${card.sha256}`);
    }

    const located = card.source_file.endsWith('.csv') ? locateCsvCard(card) : locateSheetCard(card);

    const seen = new Set();
    const entries = card.rates.map(rate => {
        if (seen.has(rate.market)) fail(`${card.source_file}: market "${rate.market}" appears twice`);
        seen.add(rate.market);

        const position = located.byMarket.get(rate.market);
        if (!position) fail(`${card.source_file}: market "${rate.market}" is in the extraction but not in the file`);
        if (squash(rate.currency) !== squash(position.cells.B)) {
            fail(`${card.source_file} ${position.locator}: currency "${position.cells.B}" contradicts "${rate.currency}"`);
        }

        const micros = {};
        for (const [category, letter] of Object.entries(located.categoryColumns)) {
            const extracted = String(rate[category]);
            const inFile = position.cells[letter];
            if (extracted !== inFile) {
                fail(`${card.source_file} ${position.locator} column ${letter}: file says "${inFile}", extraction says "${extracted}"`);
            }
            if (inFile === 'n/a') {
                micros[category] = 'unavailable';
                unavailableReasons.push({ card: card.source_file, market: rate.market, category, why: 'source says n/a' });
                continue;
            }
            const value = decimalStringToMicros(inFile);
            if (value === null) {
                micros[category] = 'unavailable';
                unavailableReasons.push({ card: card.source_file, market: rate.market, category, why: `"${inFile}" is not exactly representable in micro-units` });
                continue;
            }
            micros[category] = value;
        }

        return { market: rate.market, currency: rate.currency, micros, locator: position.locator };
    });

    return {
        rateVersion: `meta-ratecards-2026/${card.currency}/${card.effective_from}`,
        currency: card.currency,
        effectiveFrom: card.effective_from,
        sourceFile: card.source_file,
        sourceSha256: card.sha256,
        sourceUrl: card.source_url,
        headerLocator: located.headerLocator,
        entries,
    };
});

// Every market we assign an ISO code to must exist verbatim in a preserved card.
const knownMarkets = new Set(built.flatMap(card => card.entries.map(e => e.market)));
for (const market of Object.keys(ISO_ALPHA2_BY_MARKET)) {
    if (!knownMarkets.has(market)) fail(`ISO alias for "${market}" names a market no preserved card contains`);
}
const isoValues = Object.values(ISO_ALPHA2_BY_MARKET);
if (new Set(isoValues).size !== isoValues.length) fail('two markets claim the same ISO alpha-2 code');

for (const card of built) {
    if (CURRENCY_MINOR_EXPONENT[card.currency] === undefined) {
        fail(`no ISO 4217 minor-unit exponent recorded for ${card.currency}`);
    }
}

const allowance = readFreeAllowance();
const serviceChargeStart = readServiceChargeStart(rateCards);

// ─────────────────────────────────────────────────────────────────────────────
// Emit
// ─────────────────────────────────────────────────────────────────────────────

const q = value => `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const cell = value => (value === 'unavailable' ? "'unavailable'" : String(value));
const key = name => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : q(name));

const out = [];
out.push('/*');
out.push(' * DERIVED FILE — do not edit by hand.');
out.push(' *');
out.push(' * Regenerate:  node apps/api/scripts/generate-whatsapp-rates.cjs');
out.push(' * Verify:      node apps/api/scripts/generate-whatsapp-rates.cjs --check');
out.push(' *');
out.push(' * Every number below was read from a preserved official rate card whose');
out.push(' * SHA-256 was verified against the manifest, and carries the file and the line');
out.push(' * or spreadsheet row it came from. `\'unavailable\'` is what the card printed as');
out.push(' * `n/a`: a rate that could not be established, which is not the same thing as a');
out.push(' * rate of zero and must never be treated as one.');
out.push(' *');
out.push(' * Prices are integer MICRO-UNITS: millionths of one whole unit of the currency');
out.push(' * (1 USD = 1_000_000 micros). Every published rate has at most four decimal');
out.push(' * places, so micro-units carry all of them exactly with two orders of magnitude');
out.push(' * to spare, and no float is involved at any point.');
out.push(' */');
out.push('');
out.push('/** A price the card did not state. Never coerce this to a number. */');
out.push("export type UnavailableRate = 'unavailable';");
out.push('');
out.push('export type WhatsAppMessageCategory =');
out.push(CATEGORIES.map(c => `    | ${q(c)}`).join('\n') + ';');
out.push('');
out.push('export const WHATSAPP_MESSAGE_CATEGORIES: readonly WhatsAppMessageCategory[] = Object.freeze([');
out.push(CATEGORIES.map(c => `    ${q(c)},`).join('\n'));
out.push(']);');
out.push('');
out.push('/** Micro-units per whole currency unit. The exponent this table is written in. */');
out.push(`export const MICROS_PER_UNIT = ${10 ** MICRO_EXPONENT} as const;`);
out.push('');
out.push('export interface WhatsAppRateCardEntry {');
out.push('    readonly market: string;');
out.push('    /** Micro-units per delivered message, by category. */');
out.push('    readonly micros: Readonly<Record<WhatsAppMessageCategory, number | UnavailableRate>>;');
out.push('    /** Where in the source file this row is, for a dispute later. */');
out.push('    readonly locator: string;');
out.push('}');
out.push('');
out.push('export interface WhatsAppRateCard {');
out.push('    /** Names which card answered, so a price can be argued with. */');
out.push('    readonly rateVersion: string;');
out.push('    /** The currency of the WhatsApp account being billed. */');
out.push('    readonly currency: string;');
out.push('    /** Applies from midnight of this date IN THE WABA TIME ZONE. */');
out.push('    readonly effectiveFrom: string;');
out.push('    readonly sourceFile: string;');
out.push('    readonly sourceSha256: string;');
out.push('    readonly sourceUrl: string;');
out.push('    readonly headerLocator: string;');
out.push('    readonly entries: readonly WhatsAppRateCardEntry[];');
out.push('}');
out.push('');
out.push('/** Identifies the sources this table was derived from, content-addressed. */');
out.push(`export const WHATSAPP_RATE_TABLE_VERSION = ${q(`meta-ratecards-2026@${tableVersion}`)} as const;`);
out.push('');
out.push('export const WHATSAPP_RATE_CARDS: readonly WhatsAppRateCard[] = Object.freeze([');
for (const card of built) {
    out.push('    {');
    out.push(`        rateVersion: ${q(card.rateVersion)},`);
    out.push(`        currency: ${q(card.currency)},`);
    out.push(`        effectiveFrom: ${q(card.effectiveFrom)},`);
    out.push(`        sourceFile: ${q(card.sourceFile)},`);
    out.push(`        sourceSha256: ${q(card.sourceSha256)},`);
    out.push(`        sourceUrl: ${q(card.sourceUrl)},`);
    out.push(`        headerLocator: ${q(card.headerLocator)},`);
    out.push('        entries: Object.freeze([');
    for (const entry of card.entries) {
        const m = entry.micros;
        out.push(`            { market: ${q(entry.market)}, locator: ${q(entry.locator)}, micros: Object.freeze({ `
            + CATEGORIES.map(c => `${key(c)}: ${cell(m[c])}`).join(', ')
            + ' }) },');
    }
    out.push('        ]),');
    out.push('    },');
}
out.push(']);');
out.push('');
out.push('/**');
out.push(' * ISO 3166-1 alpha-2 → Meta market name, for the markets Meta names as');
out.push(' * countries. Ours, not Meta\'s: the generator only guarantees that each market');
out.push(' * named here appears verbatim in a preserved card.');
out.push(' *');
out.push(' * The regional buckets ("Rest of Latin America", "Other", …) are absent on');
out.push(' * purpose. Meta assigns countries to them by calling code, on a page these');
out.push(' * sources link to but do not contain, so routing an unlisted country into a');
out.push(' * bucket would be a guess — and a guess towards a cheaper price.');
out.push(' */');
out.push('export const WHATSAPP_MARKET_BY_ISO_ALPHA2: Readonly<Record<string, string>> = Object.freeze({');
for (const [market, iso] of Object.entries(ISO_ALPHA2_BY_MARKET).sort((a, b) => a[1].localeCompare(b[1]))) {
    out.push(`    ${iso}: ${q(market)},`);
}
out.push('});');
out.push('');
out.push('/**');
out.push(' * ISO 4217 minor-unit exponents for the currencies the cards are published in.');
out.push(' * A currency absent from this map cannot be converted to minor units at all,');
out.push(' * which is the correct answer rather than assuming two decimal places.');
out.push(' */');
out.push('export const CURRENCY_MINOR_EXPONENT: Readonly<Record<string, number>> = Object.freeze({');
for (const [currency, exponent] of Object.entries(CURRENCY_MINOR_EXPONENT)) {
    out.push(`    ${currency}: ${exponent},`);
}
out.push('});');
out.push('');
out.push('/**');
out.push(' * The free service-message allowance, as the preserved evidence states it.');
out.push(' *');
out.push(' * Per NUMBER and per calendar MONTH — not per country, not per contact, not per');
out.push(' * conversation — and it does not roll over. The two locators are two');
out.push(' * independent sentences in the evidence that the generator requires to agree.');
out.push(' */');
out.push('export const WHATSAPP_FREE_SERVICE_ALLOWANCE = Object.freeze({');
out.push(`    deliveries: ${allowance.deliveries},`);
out.push("    scope: 'per_phone_number_per_calendar_month' as const,");
out.push(`    rollsOver: ${allowance.rollsOver},`);
out.push('    /** Applies only to this category. Utility inside the window is charged. */');
out.push("    category: 'service' as const,");
out.push('    /** Nothing before this date is covered: the charge itself starts here. */');
out.push(`    effectiveFrom: ${q(serviceChargeStart)},`);
out.push(`    sourceFile: ${q(allowance.sourceFile)},`);
out.push(`    sourceLocators: Object.freeze([${allowance.sourceLocators.map(q).join(', ')}]),`);
out.push(`    rollsOverLocator: ${q(allowance.rollsOverLocator)},`);
out.push('});');
out.push('');

const next = out.join('\n');

/**
 * Line endings are not content.
 *
 * The repository runs with `core.autocrlf=true` and carries no `.gitattributes`,
 * so a fresh checkout on Windows puts CRLF on disk while this generator writes
 * LF. Comparing bytes would make `--check` fail on every clean clone — a red
 * signal that means nothing, which is the fastest way to teach people to ignore
 * a check. What must not drift is the table.
 */
const sameContent = (a, b) => String(a ?? '').replace(/\r\n/g, '\n') === String(b ?? '').replace(/\r\n/g, '\n');

if (CHECK) {
    const stored = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : null;
    if (stored === null || !sameContent(stored, next)) {
        console.error('generate-whatsapp-rates: the checked-in rate table no longer matches the sources.');
        console.error(`  ${path.relative(root, outFile)}`);
        console.error('  Regenerate with: node apps/api/scripts/generate-whatsapp-rates.cjs');
        process.exit(1);
    }
    console.log(`generate-whatsapp-rates: table matches the sources (${WHATSAPP_SUMMARY()})`);
} else {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, next, 'utf8');
    console.log(JSON.stringify(summary(), null, 2));
}

function summary() {
    return {
        version: `meta-ratecards-2026@${tableVersion}`,
        cards: built.map(c => ({
            rateVersion: c.rateVersion,
            markets: c.entries.length,
            unavailable: c.entries.reduce(
                (n, e) => n + Object.values(e.micros).filter(v => v === 'unavailable').length, 0,
            ),
        })),
        pricesTotal: built.reduce((n, c) => n + c.entries.length * CATEGORIES.length, 0),
        unavailableTotal: unavailableReasons.length,
        isoAliases: Object.keys(ISO_ALPHA2_BY_MARKET).length,
        freeAllowance: allowance.deliveries,
        serviceChargeStart,
    };
}

function WHATSAPP_SUMMARY() {
    const s = summary();
    return `${s.cards.length} cards, ${s.pricesTotal} prices, ${s.unavailableTotal} unavailable`;
}
