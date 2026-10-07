import { readFileSync } from 'fs';
import { resolve } from 'path';
import { HandoffService } from './handoff.service';
import { POLICY_LABELS } from './handoff-policy-classifier';

/**
 * The evaluation set behind the refund / return / discount handoff: messages the
 * reviews found wrong at some point, in Spanish, Portuguese, French and English,
 * each with the label a good reader gives it and whether it must reach a person.
 *
 *  - The rules (the fallback when the model is unavailable) are scored, with a floor
 *    that catches a regression but does not pretend they are perfect.
 *  - The routing is scored with a model that gives the expected label: every message
 *    must then end exactly where it should, which proves the gate (which messages
 *    reach the model) and the mapping (what each label does) are complete.
 *
 * Run against a real model with a key for a test route, the same fixture measures
 * the model; no such key is configured in this repository, so it is not part of CI.
 */
interface EvalRow { text: string; lang: string; expected: string; expected_handoff: boolean; note?: string; triggers?: string[] }
const rows: EvalRow[] = JSON.parse(readFileSync(resolve(__dirname, '__fixtures__', 'handoff-policy-eval.json'), 'utf8'));

const service = (label?: string): any => {
    const s: any = Object.create(HandoffService.prototype);
    s.logger = { warn: jest.fn() };
    s.llmRouter = { execute: jest.fn().mockResolvedValue({ content: JSON.stringify({ label }) }) };
    return s;
};
const config = (row: EvalRow) => ({ behavior: { handoffTriggers: row.triggers || [] } }) as any;
const conversation = { metadata: {} };

describe('handoff policy evaluation set', () => {
    it('is well formed and covers every label and the four languages', () => {
        expect(rows.length).toBeGreaterThanOrEqual(130);
        for (const row of rows) {
            expect(typeof row.text).toBe('string');
            expect(['es', 'pt', 'fr', 'en']).toContain(row.lang);
            expect((POLICY_LABELS as readonly string[])).toContain(row.expected);
            expect(typeof row.expected_handoff).toBe('boolean');
            expect(row.expected_handoff).toBe(['personal_case', 'negotiation', 'complaint'].includes(row.expected));
        }
        for (const label of POLICY_LABELS) expect(rows.some((r) => r.expected === label)).toBe(true);
        for (const lang of ['es', 'pt', 'fr', 'en']) expect(rows.some((r) => r.lang === lang)).toBe(true);
        expect(new Set(rows.map((r) => r.text.toLowerCase())).size).toBe(rows.length);
    });

    it('scores the rules alone (the fallback), per label', () => {
        const rules = service();
        const byLabel: Record<string, { ok: number; n: number }> = {};
        let ok = 0;
        for (const row of rows) {
            const handoff = !!rules.shouldHandoff(row.text, conversation, config(row));
            const entry = (byLabel[row.expected] ||= { ok: 0, n: 0 });
            entry.n++;
            if (handoff === row.expected_handoff) { ok++; entry.ok++; }
        }
        // eslint-disable-next-line no-console
        console.info(`[handoff-policy-eval] rules only: ${ok}/${rows.length} (${(100 * ok / rows.length).toFixed(1)}%) ${JSON.stringify(byLabel)}`);
        expect(ok / rows.length).toBeGreaterThanOrEqual(0.88);
    });

    it('routes every message to the right outcome when the model gives the expected label', async () => {
        const wrong: string[] = [];
        for (const row of rows) {
            const handoff = !!(await service(row.expected).decideHandoff(row.text, conversation, config(row), undefined, 't'));
            if (handoff !== row.expected_handoff) wrong.push(`${row.expected} | ${row.text}`);
        }
        expect(wrong).toEqual([]);
    });

    it('falls back to the same score as the rules when the model answers nothing usable', async () => {
        let same = 0;
        for (const row of rows) {
            const rules = !!service().shouldHandoff(row.text, conversation, config(row));
            const lost = service();
            lost.llmRouter.execute = jest.fn().mockResolvedValue({ content: 'no idea' });
            if (!!(await lost.decideHandoff(row.text, conversation, config(row), undefined, 't')) === rules) same++;
        }
        expect(same).toBe(rows.length);
    });
});
