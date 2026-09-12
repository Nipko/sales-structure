import { readFileSync } from 'fs';
import { resolve } from 'path';
import { SPEND_BLOCK_CODES } from './spend-diagnosis';

/**
 * ═══ A REFUSAL THE TENANT CAN READ, IN EVERY LANGUAGE ═══
 *
 * `whatsapp-spend.controller.ts` ships `SPEND_BLOCK_CODES` to the dashboard as
 * `refusalCodes`, and the panel renders one term and one definition per code
 * under "the refusal vocabulary, translated". The controller's own comment says
 * the list is sent from the server "so a code added here cannot silently become
 * an untranslated string on a screen".
 *
 * That mechanism guarantees the code is VISIBLE, not that it is translated —
 * and the panel falls back to the bare token when the key is missing, so the
 * screen shows `recipient_not_addressable` as both the term and its definition.
 * Which is exactly what happened: a code added in this batch reached four
 * locales with no string in any of them, and nothing failed.
 *
 * The project rule is that every page edit updates all four message files. This
 * is that rule, enforced where the codes are defined rather than remembered
 * where they are rendered.
 */
const LOCALES = ['es', 'en', 'pt', 'fr'] as const;
const MESSAGES = resolve(__dirname, '..', '..', '..', '..', '..', 'dashboard', 'messages');

const vocabulary = (locale: string): Record<string, string> => {
    const parsed = JSON.parse(readFileSync(resolve(MESSAGES, `${locale}.json`), 'utf8'));
    return parsed?.whatsappSpend?.code ?? {};
};

describe('every refusal this platform can issue has words in every language', () => {
    it.each(LOCALES)('%s names every code', locale => {
        const codes = vocabulary(locale);
        const missing = SPEND_BLOCK_CODES.filter(code => !codes[code]);
        // Named rather than counted: the point is WHICH code is unreadable.
        expect(missing).toEqual([]);
    });

    it('says something, rather than repeating the code back', () => {
        // The fallback renders the token as its own definition, which looks
        // like a translation and carries nothing. A string equal to the key is
        // the same failure with extra steps.
        for (const locale of LOCALES) {
            const codes = vocabulary(locale);
            for (const code of SPEND_BLOCK_CODES) {
                expect({ locale, code, sameAsKey: codes[code] === code }).toEqual({
                    locale, code, sameAsKey: false,
                });
                expect(String(codes[code]).length).toBeGreaterThan(20);
            }
        }
    });

    it('carries no locale that has drifted apart from the others', () => {
        // A code translated in three languages and not the fourth is the shape
        // this defect took. Comparing the sets catches it whichever way it
        // leans, including a stale key nobody removed.
        const [first, ...rest] = LOCALES.map(locale => Object.keys(vocabulary(locale)).sort());
        for (const other of rest) expect(other).toEqual(first);
    });
});
