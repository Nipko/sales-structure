import {
    ACCEPTED_UNFROZEN, COMMERCIAL_DIMENSIONS, COMMERCIAL_GROUP_DIMENSIONS, OUTSIDE_AUTHORITIES,
    commercialAuthorityForTable, commercialCoverage, commercialOnly, commercialReaders,
    commercialReadersWithoutFrozenAuthority, groupId, TIME_BOUNDED_DIMENSIONS,
} from './commercial-reader-inventory';
import { EVALUATION_TOOL_READ_GROUPS } from './evaluation-reader-inventory';
import { EVALUATION_OUTPUT_TABLES, sealRevision } from './evaluation-revision';
import { evaluationSnapshot, sealEvaluationSnapshot } from '../conversations/agent-evaluation-snapshot';

/**
 * The inventory has to be computed, and it has to be complete.
 *
 * Complete first: a new tool joins a read group because the coverage spec next
 * door forces it to, and this file forces that group to say whether its answer
 * can move money. Between them a commercial reader cannot arrive unnoticed —
 * which is the only property that makes the count below worth quoting.
 *
 * Computed second: every "is this frozen?" answer is derived from the
 * manifest's own rule, so nobody can improve the number by editing a label.
 * The tests here mostly try to break that derivation.
 */

describe('the commercial reader inventory', () => {
    const readers = commercialReaders();

    it('classifies every read group, including the ones that decide nothing', () => {
        const ids = EVALUATION_TOOL_READ_GROUPS.map(groupId);
        const classified = Object.keys(COMMERCIAL_GROUP_DIMENSIONS);
        // An empty list is a claim — "nothing this returns can change what
        // somebody pays" — and a missing entry is not. They must not be the
        // same thing, so the keys have to match exactly.
        expect(classified.sort()).toEqual([...ids].sort());
        for (const dimensions of Object.values(COMMERCIAL_GROUP_DIMENSIONS)) {
            for (const dimension of dimensions) expect(COMMERCIAL_DIMENSIONS).toContain(dimension);
            expect(dimensions.length).toBe(new Set(dimensions).size);
        }
    });

    it('classifies every non-table read the groups declare', () => {
        const declared = new Set(EVALUATION_TOOL_READ_GROUPS.flatMap(group => [...group.outsideNamespace]));
        for (const token of declared) {
            expect({ token, classified: token in OUTSIDE_AUTHORITIES })
                .toEqual({ token, classified: true });
            expect(OUTSIDE_AUTHORITIES[token].because.length).toBeGreaterThan(40);
        }
        // And nothing classified that nobody reads: a stale entry here would let
        // a removed authority keep vouching for a reader that no longer exists.
        for (const token of Object.keys(OUTSIDE_AUTHORITIES)) expect(declared.has(token)).toBe(true);
    });

    it('reads the frozen answer off the manifest rule rather than restating it', () => {
        // The rule is the manifest's, not this file's: a tenant relation is a
        // dependency unless the run writes it.
        expect(commercialAuthorityForTable('services')).toBe('manifest_dependency');
        expect(commercialAuthorityForTable('products')).toBe('manifest_dependency');
        for (const table of EVALUATION_OUTPUT_TABLES) {
            expect(commercialAuthorityForTable(table)).toBe('excluded_output');
        }
        // A table that has not been invented yet answers the same way, because
        // the default is "included" — which is what stops a new catalogue
        // arriving outside the manifest in silence.
        expect(commercialAuthorityForTable('a_table_nobody_has_written_yet')).toBe('manifest_dependency');
    });

    it('never lets a commercial answer rest on a table the run itself writes', () => {
        // This is the failure the derivation exists to catch: a price read out
        // of a table excluded from the manifest is a price no revision covers.
        for (const reader of commercialOnly()) {
            const excluded = Object.entries(reader.tables)
                .filter(([, authority]) => authority !== 'manifest_dependency').map(([table]) => table);
            expect({ reader: reader.id, excluded }).toEqual({ reader: reader.id, excluded: [] });
        }
    });

    it('leaves exactly the accepted exceptions, and each says why', () => {
        const remaining = commercialReadersWithoutFrozenAuthority();
        const resting = [...new Set(remaining.flatMap(reader => [...reader.unfrozen]))].sort();
        // Not zero, and deliberately not written as if it were. What the
        // acceptance criterion can honestly require is that nothing unfrozen is
        // load-bearing without a stated reason.
        expect(resting).toEqual(Object.keys(ACCEPTED_UNFROZEN).sort());
        for (const [token, because] of Object.entries(ACCEPTED_UNFROZEN)) {
            expect({ token, stated: because.length > 60 }).toEqual({ token, stated: true });
            // And an accepted exception has to be one the classification agrees
            // is unfrozen: accepting something already frozen would be a reason
            // nobody needs, hiding the one somebody does.
            expect(OUTSIDE_AUTHORITIES[token].kind).toBe('unfrozen');
        }
    });

    it('says which dimension each unfrozen read actually moves', () => {
        const clockBound = commercialOnly().filter(reader => reader.unfrozen.includes('wall_clock'));
        expect(clockBound.length).toBeGreaterThan(0);
        // Every reader resting on the clock must decide at least one thing a
        // validity window can move. A reader whose only outputs are values — a
        // price, a currency, the text of a policy — resting on the clock would
        // mean the clock was changing a number, which is a different and much
        // worse problem, and this is where it would surface.
        for (const reader of clockBound) {
            expect({ reader: reader.id, movesAWindow: reader.dimensions.some(dimension =>
                TIME_BOUNDED_DIMENSIONS.includes(dimension)) })
                .toEqual({ reader: reader.id, movesAWindow: true });
        }
        // And the mirror of it: a value-only reader must not be resting on a
        // clock at all.
        for (const reader of commercialOnly()) {
            if (reader.dimensions.some(dimension => TIME_BOUNDED_DIMENSIONS.includes(dimension))) continue;
            expect({ reader: reader.id, unfrozen: reader.unfrozen })
                .toEqual({ reader: reader.id, unfrozen: [] });
        }
    });

    it('covers all ten commercial dimensions with at least one reader', () => {
        const coverage = commercialCoverage();
        for (const dimension of COMMERCIAL_DIMENSIONS) {
            expect({ dimension, readers: coverage.dimensions[dimension] > 0 })
                .toEqual({ dimension, readers: true });
        }
        expect(coverage.commercial).toBe(coverage.frozen + coverage.unfrozen);
        expect(coverage.commercial).toBeLessThan(coverage.readers);
        // eslint-disable-next-line no-console
        console.log(`[commercial-readers] ${coverage.commercial}/${coverage.readers} commercial, `
            + `${coverage.frozen} fully frozen, ${coverage.unfrozen} resting on `
            + `${Object.entries(coverage.restingOn).map(([token, count]) => `${token}×${count}`).join(', ') || '—'}`);
    });

    it('keeps the instant beside the revision, which is what closes the clock', () => {
        // `ACCEPTED_UNFROZEN` says the clock is survivable because a result
        // records WHEN it was taken as well as what it was measured against.
        // That is a claim about the snapshot, so it is checked here rather than
        // left as prose: an availability answer whose instant nobody kept is
        // indistinguishable from a fresh one, and then the acceptance is a
        // hole with a paragraph in front of it.
        const snapshot = evaluationSnapshot('11111111-1111-4111-8111-111111111111',
            '22222222-2222-4222-8222-222222222222', { version: 1, config_json: { language: 'es' } });
        snapshot.manifest = sealRevision(snapshot.tenantId,
            [{ key: 'tenant.services', state: 'present', hash: 'a'.repeat(64) }], []);
        sealEvaluationSnapshot(snapshot);
        expect(snapshot.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(snapshot.manifest!.revision).toMatch(/^[a-f0-9]{64}$/);
        // And the seal covers the instant: moving it invalidates the manifest,
        // so the pair cannot be pulled apart after the fact.
        const sealedRevision = snapshot.manifest!.revision;
        const moved = { ...snapshot, capturedAt: new Date(Date.parse(snapshot.capturedAt) + 86_400_000).toISOString() };
        sealEvaluationSnapshot(moved);
        expect(moved.manifest!.revision).not.toBe(sealedRevision);
    });

    it('does not call a reader frozen for having no commercial dimension at all', () => {
        // A group that decides nothing commercial is not "frozen" — it is out of
        // scope, and conflating the two would let the coverage number improve by
        // declaring readers uninteresting.
        for (const reader of readers) {
            if (reader.dimensions.length) continue;
            expect(reader.frozen).toBe(false);
        }
        expect(commercialCoverage().frozen).toBe(commercialOnly().filter(reader => reader.frozen).length);
    });
});
