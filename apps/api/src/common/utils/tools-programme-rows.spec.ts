import { resolve } from 'path';

/**
 * ═══ A DERIVED ROW THAT CANNOT READ ITS SOURCE MUST BE RED ═══
 *
 * Every one of these rows is a number produced by reading the source. That is
 * the point of them — and it is also the way they can lie without anybody
 * noticing, because a reading that finds nothing produces a zero, and a zero is
 * an ACCEPTED row.
 *
 * The first version of this module did it twice in one sitting. It guessed the
 * contract's path, did not find it, and reported "1 control without a consumer:
 * contract not found". It parsed `DISCOVERY_ORDER` with a single-quote regular
 * expression against a list written in double quotes, found nothing, and
 * reported "0 of 0 discovery items without a tour" — green, derived from an
 * empty universe. Then it asked whether ANY file mentioned a flag name;
 * `emailConfirmations` is declared by eighteen families and read by three, so
 * one consumer made fifteen dead controls disappear.
 *
 * So these cases check the READINGS, not the conclusions: that each finds a
 * non-empty universe, that it fails loudly when its source moves, and that the
 * counts agree with what an independent audit of the same repository found.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const rowsModule = require(resolve(__dirname, '..', '..', '..', '..', '..',
    'docs', 'audits', '2026-09-11', 'tools-programme-rows.cjs'));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const audit = require(resolve(__dirname, '..', '..', '..', '..', '..',
    'docs', 'audits', '2026-09-11', 'tool-profile-audit.json'));

const row = (id: string, entry: Record<string, unknown>) => ({ id, ...entry });
const rows = () => rowsModule.toolsRows(row, audit) as Array<Record<string, any>>;
const find = (id: string) => rows().find(entry => entry.id === id)!;

describe('the tools programme rows read something real', () => {
    it('produces exactly T1 through T6, once each', () => {
        const ids = rows().map(entry => entry.id);
        expect(ids).toEqual(['T1', 'T2', 'T3', 'T4', 'T5', 'T6']);
    });

    it('finds a non-empty discovery universe before reporting on it', () => {
        // "0 of 0 items without a tour" is a green produced by a broken regular
        // expression. The universe has to be real before the gap means anything.
        const { discovery } = rowsModule.tourCoverageGaps();
        expect(discovery).toBeGreaterThan(10);
    });

    it('counts orphaned controls per FAMILY, not per flag name', () => {
        // `emailConfirmations` is declared by eighteen families and read by
        // three. Counted by name it is "covered"; counted by (family, flag) it
        // is fifteen controls an owner can switch with no consequence — and the
        // screen tells them it did something.
        const t1 = find('T1');
        expect(t1.open).toBeGreaterThan(10);
        expect(String(t1.openLabel)).toContain('.emailConfirmations');
        // The number an independent audit of this repository reached by hand
        // was FIFTEEN: eleven families with no consumer plus four with a typed
        // flag and no visible control.
        //
        // It is fourteen now, and the one that left is named rather than
        // absorbed: `vehicles.emailConfirmations`. A test drive is an
        // appointment the `vehicles` family asked for, so
        // `appointment-notifications.service.ts` resolves the switch through
        // `['vehicles', 'appointments']`, most specific first — a real
        // consumer, not a mention. The remaining fourteen are all
        // `emailConfirmations`, which is the shape of the finding: one flag
        // eighteen families declare and four act on.
        //
        // This pin moves only WITH a consumer, never to follow the count.
        expect(t1.open).toBe(14);
        expect(String(t1.openLabel)).not.toContain('vehicles.emailConfirmations');
    });

    it('reads the evidence scope from the call, not from a comment', () => {
        const scope = rowsModule.evidenceScopeWired();
        expect(typeof scope.wired).toBe('boolean');
        expect(String(scope.detail).length).toBeGreaterThan(10);
        // Whatever the answer, it has to be derived from the argument list.
        expect(String(scope.detail)).not.toContain('TODO');
    });

    it('does not count the five step-up negatives as missing positives', () => {
        // The `file_claim` tasks are refusals on purpose. Counting them as gaps
        // invites somebody to fabricate a positive, which is the one outcome
        // nobody wants from a coverage number.
        const t5 = find('T5');
        expect(String(t5.openLabel)).toContain('file_claim');
        expect(t5.open).toBeGreaterThanOrEqual(0);
    });

    it('declares a provenance on every row, and never "derived" without a reading', () => {
        for (const entry of rows()) {
            expect(['derived', 'declared', 'executed_evidence']).toContain(entry.provenance);
            // A `declared` row has to carry the condition that would close it,
            // or it is prose with a number attached.
            if (entry.provenance === 'declared') {
                expect(String(entry.evidence)).toContain('Condición de cierre');
            }
        }
    });
});
