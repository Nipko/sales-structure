import * as fs from "fs";
import * as path from "path";

/**
 * The four locales are one file with four spellings.
 *
 * `next-intl` resolves a missing key by rendering the key path itself, so a
 * translation that never landed ships as `settings.securityPage.twoFactorDesc`
 * in the middle of a card — visible only to whoever reads the product in that
 * language, which for pt and fr is nobody on this side of the repo. The rule
 * has been in CLAUDE.md since the beginning ("every page edit MUST update all 4
 * JSON files"); until now nothing enforced it. The only parity assertion that
 * existed covered ~40 guided-tour keys out of 11k.
 *
 * Spanish is the reference because it is the market the product is written for
 * and the locale every screen is authored in. The check runs in both
 * directions: a key only in `en` is just as broken — it means a translator
 * added copy the source language cannot render, so nobody sees it either.
 */

const MESSAGES = path.join(__dirname, "..", "..", "messages");
const REFERENCE = "es";
const TRANSLATIONS = ["en", "pt", "fr"] as const;

/**
 * Keys allowed to exist in some locales and not others.
 *
 * Empty on purpose, and it should stay that way: there is no such thing as a
 * string one language needs and another does not — a locale-specific *value*
 * (a legal notice that only applies in one country, a date format) still has a
 * key in all four. If you are about to add an entry here, the honest fix is
 * almost always to add the key everywhere and translate the value. Anything
 * listed must carry a comment saying which locales it belongs to and why.
 */
const LOCALE_SPECIFIC_KEYS: readonly string[] = [];

/** How many paths a failure prints before it stops. A 9k-line dump is not a report. */
const MAX_REPORTED = 20;

type Leaf = { path: string; kind: string };

/**
 * Every leaf path with the shape of its value.
 *
 * Arrays are leaves and carry their length: `help.*.tips` is rendered with
 * `t.raw()` and indexed, so a locale with three tips where Spanish has four
 * drops a tip silently rather than failing.
 */
function leaves(value: unknown, prefix: string, out: Map<string, string>): Map<string, string> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        for (const [key, child] of Object.entries(value)) {
            leaves(child, prefix ? `${prefix}.${key}` : key, out);
        }
        return out;
    }
    out.set(prefix, Array.isArray(value) ? `array[${value.length}]` : typeof value);
    return out;
}

function readLocale(locale: string): Map<string, string> {
    const file = path.join(MESSAGES, `${locale}.json`);
    return leaves(JSON.parse(fs.readFileSync(file, "utf8")), "", new Map());
}

const allowed = new Set(LOCALE_SPECIFIC_KEYS);
const reference = readLocale(REFERENCE);
const localized = new Map(TRANSLATIONS.map((locale) => [locale, readLocale(locale)] as const));

/** Bounded, and it says how much it is not showing. */
function report(paths: string[]): string[] {
    if (paths.length <= MAX_REPORTED) return paths;
    return [...paths.slice(0, MAX_REPORTED), `…and ${paths.length - MAX_REPORTED} more`];
}

describe("i18n key parity across es/en/pt/fr", () => {
    it("reads four non-trivial locale files", () => {
        // Guards the guard: a typo in the path would make every assertion below
        // compare two empty sets and pass.
        expect(reference.size).toBeGreaterThan(1000);
        for (const [locale, keys] of localized) {
            expect({ locale, size: keys.size > 1000 }).toEqual({ locale, size: true });
        }
    });

    it.each(TRANSLATIONS)("has every Spanish key in %s", (locale) => {
        const keys = localized.get(locale)!;
        const missing = [...reference.keys()].filter((key) => !keys.has(key) && !allowed.has(key));
        expect({
            locale,
            missing: report(missing),
            hint: missing.length ? `add these ${missing.length} key(s) to messages/${locale}.json` : "",
        }).toEqual({ locale, missing: [], hint: "" });
    });

    it.each(TRANSLATIONS)("has no key in %s that Spanish is missing", (locale) => {
        const keys = localized.get(locale)!;
        const extra = [...keys.keys()].filter((key) => !reference.has(key) && !allowed.has(key));
        expect({
            locale,
            extra: report(extra),
            hint: extra.length ? `add these ${extra.length} key(s) to messages/${REFERENCE}.json` : "",
        }).toEqual({ locale, extra: [], hint: "" });
    });

    it.each(TRANSLATIONS)("keeps the same value shape as Spanish in %s", (locale) => {
        const keys = localized.get(locale)!;
        const mismatched = [...reference.entries()]
            .filter(([key]) => keys.has(key) && !allowed.has(key))
            .filter(([key, kind]) => keys.get(key) !== kind)
            .map(([key, kind]) => `${key}: ${REFERENCE}=${kind} ${locale}=${keys.get(key)}`);
        expect({ locale, mismatched: report(mismatched) }).toEqual({ locale, mismatched: [] });
    });

    it.each([REFERENCE, ...TRANSLATIONS] as const)("has no blank string in %s", (locale) => {
        const keys = locale === REFERENCE ? reference : localized.get(locale as typeof TRANSLATIONS[number])!;
        const source = JSON.parse(fs.readFileSync(path.join(MESSAGES, `${locale}.json`), "utf8"));
        // A blank value renders as nothing, which reads as a layout bug rather
        // than as missing copy — the failure mode a parity check exists to stop.
        const blank = [...keys.entries()]
            .filter(([, kind]) => kind === "string")
            .filter(([key]) => !String(key.split(".").reduce((node: any, part) => node?.[part], source) ?? "").trim())
            .map(([key]) => key);
        expect({ locale, blank: report(blank) }).toEqual({ locale, blank: [] });
    });

    it("keeps the allow-list documented and empty unless deliberately grown", () => {
        // Not a style rule: an allow-list is how a parity check quietly stops
        // checking. If this number changes, the diff has to explain each entry.
        expect(LOCALE_SPECIFIC_KEYS).toEqual([]);
    });
});
