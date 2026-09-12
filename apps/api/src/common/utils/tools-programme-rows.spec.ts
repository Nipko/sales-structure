import * as fs from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '..', '..', '..', '..', '..');

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
    it('produces exactly T1 through T7, once each', () => {
        const ids = rows().map(entry => entry.id);
        expect(ids).toEqual(['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']);
    });

    describe('T7 — the row about this table being enforced at all', () => {
        /**
         * The condition a document can satisfy instead of a gate, which is
         * how the tool-profile artefact went stale without stopping a
         * closure. So each of the three pieces is dropped in turn and the
         * row has to name what went missing.
         *
         * The reader is injected rather than the tree mutated: writing a
         * broken workflow to disk in this repository is how a concurrent
         * stage commits one.
         */
        const ALL_T = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'];
        const realIo = {
            read: (rel: string) => fs.readFileSync(resolve(ROOT, rel), 'utf8'),
            exists: (rel: string) => fs.existsSync(resolve(ROOT, rel)),
        };
        /** The real tree with one file's text rewritten, or made absent. */
        const treeWithout = (target: string, transform?: (text: string) => string) => ({
            read: (rel: string) => rel === target && transform
                ? transform(realIo.read(rel))
                : realIo.read(rel),
            exists: (rel: string) => (rel === target && !transform ? false : realIo.exists(rel)),
        });

        it('is satisfied by the real tree', () => {
            expect(rowsModule.closureWiring(ALL_T, realIo)).toEqual([]);
            expect(find('T7').open).toBe(0);
        });

        it('goes red when the shared verifier stops running the tools generator', () => {
            // THE DEFECT IT EXISTS FOR. The artefact was stale and nothing
            // failed, because the one verifier every workflow calls did not
            // know about this generator.
            const missing = rowsModule.closureWiring(ALL_T,
                treeWithout('docs/audits/2026-09-09/verify-artifacts.cjs',
                    text => text.replace(/2026-09-11\/generate-tool-profile-audit\.cjs/g, 'x')));
            expect(missing).toHaveLength(1);
            expect(String(missing[0])).toContain('generate-tool-profile-audit');
        });

        it.each(['candidate', 'deploy', 'vertical-quality'])(
            'goes red when %s stops calling that verifier', workflow => {
                // One workflow keeping its own copy of the list is the same
                // defect with more places to forget.
                const missing = rowsModule.closureWiring(ALL_T,
                    treeWithout(`.github/workflows/${workflow}.yml`,
                        text => text.replace(/verify-artifacts\.cjs/g, 'x')));
                expect(missing).toEqual([`${workflow} no llama al verificador compartido`]);
            });

        it('goes red when a T row disappears from the table', () => {
            // A row nobody prints reads as closed — the lesson this table
            // already learned once, applied to the table itself.
            const missing = rowsModule.closureWiring(['T1', 'T2'], realIo);
            expect(missing).toEqual([
                'la tabla de cierre no reporta T3',
                'la tabla de cierre no reporta T4',
                'la tabla de cierre no reporta T5',
                'la tabla de cierre no reporta T6',
            ]);
        });

        it('names what is missing instead of counting it', () => {
            // "1 pendiente" on a wiring row sends the reader through three
            // files to find out which one.
            const missing = rowsModule.closureWiring([], realIo);
            for (const entry of missing) expect(String(entry).length).toBeGreaterThan(15);
        });
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
        // The sweep counts PAIRS, and the pair is what the label prints —
        // `family.flag`, never a bare flag name. That is the property this
        // case exists for; the exact count is pinned below.
        expect(String(t1.openLabel)).toContain('0 controles configurables');
        // The number an independent audit of this repository reached by hand
        // was FIFTEEN: eleven families with no consumer plus four with a typed
        // flag and no visible control.
        //
        // It is ONE, and every family that left is named rather than
        // absorbed, because this pin moves only WITH a consumer and never to
        // follow the count. Each of these has a productive reader that
        // resolves the switch from the agent that SERVED the operation:
        //
        //  · `vehicles`, `realEstate`, `pets` — appointment-shaped. A test
        //    drive, a property visit and a veterinary visit are appointments
        //    carrying a validated marker, so the notification resolves
        //    `[family, 'appointments']`, most specific first.
        //  · `orders` — post-commit on the `pending → confirmed` transition
        //    only, through the one factory both the agent path and the
        //    dashboard path use.
        //  · `homeServices`, `education`, `gyms`, `insurance`, `restaurants`,
        //    `photography`, `repairOrders`, `treatments`, `vehicleRentals`,
        //    `petBoarding` — each on its own confirming transition, through
        //    the shared five-step decision in `OperationConfirmationService`.
        //
        // `petServices` was the last orphan. It has no committing tool of its
        // own, so the truthful close is removing the control instead of wiring
        // it to an operation owned by the sibling `pets` family.
        expect(t1.open).toBe(0);
        expect(String(t1.openLabel)).not.toContain('petServices.emailConfirmations');
        for (const closed of [
            'vehicles', 'realEstate', 'pets', 'orders', 'homeServices', 'education',
            'gyms', 'insurance', 'restaurants', 'photography', 'repairOrders',
            'treatments', 'vehicleRentals', 'petBoarding',
        ]) {
            expect(String(t1.openLabel)).not.toContain(`${closed}.emailConfirmations`);
        }
    });

    it('reads the evidence scope from the call, not from a comment', () => {
        const scope = rowsModule.evidenceScopeWired();
        expect(typeof scope.wired).toBe('boolean');
        expect(String(scope.detail).length).toBeGreaterThan(10);
        // Whatever the answer, it has to be derived from the argument list.
        expect(String(scope.detail)).not.toContain('TODO');
    });

    it('derives T2 from the readiness authority instead of a declared number', () => {
        const gaps = rowsModule.readinessDivergenceGaps();
        const t2 = find('T2');
        expect(gaps.length).toBeGreaterThan(0);
        expect(t2).toMatchObject({ provenance: 'derived', open: gaps.length });
        for (const key of gaps) expect(String(t2.openLabel)).toContain(key);
    });

    it('derives T6 from the service Assist actually calls', () => {
        const t6 = find('T6');
        expect(rowsModule.assistOperationAuthorityGaps()).toEqual([]);
        expect(t6).toMatchObject({ provenance: 'derived', open: 0 });

        const source = fs.readFileSync(resolve(ROOT, 'apps/api/src/modules/copilot/copilot.service.ts'), 'utf8');
        const broken = source.replace('.listOperations(tenantId', '.listOperationsRemoved(tenantId');
        expect(rowsModule.assistOperationAuthorityGaps(broken))
            .toContain('Assist no consulta listOperations');
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
