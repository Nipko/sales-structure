/* eslint-disable @typescript-eslint/no-var-requires */

const {
    AUTHORIZED_FIXTURES,
    CANCELLATION_REASON,
    summaryLine,
    timestampMatches,
    validateInventory,
} = require('../../../scripts/remediate-agreed-terms-test-fixtures.cjs');

function inventory() {
    return AUTHORIZED_FIXTURES.map((expected: any, index: number) => ({
        id: expected.id,
        tenantId: expected.tenantId ?? '6b24f86a-ff01-48c0-b071-355781700564',
        schema: `tenant_${index}`,
        status: 'pending',
        cancellation_reason: null,
        orphan: true,
        created_at: expected.createdAt.length === 10
            ? new Date(`${expected.createdAt}T13:37:02.000Z`)
            : new Date(expected.createdAt),
    }));
}

describe('the authorized agreed-terms test-fixture manifest', () => {
    it('names exactly nine unique appointments and accepts their observed state', () => {
        expect(AUTHORIZED_FIXTURES).toHaveLength(9);
        expect(new Set(AUTHORIZED_FIXTURES.map((row: any) => row.id))).toHaveProperty('size', 9);
        expect(validateInventory(inventory())).toMatchObject({ ready: { length: 9 }, alreadyResolved: [] });
    });

    it.each([
        ['missing id', (rows: any[]) => rows.slice(1), 'missing_fixture_id'],
        ['duplicate id', (rows: any[]) => [...rows, { ...rows[0], schema: 'tenant_duplicate' }], 'duplicate_fixture_id'],
        ['changed tenant', (rows: any[]) => rows.map((row, i) => i ? row : { ...row, tenantId: '00000000-0000-0000-0000-000000000000' }), 'fixture_tenant_changed'],
        ['changed date', (rows: any[]) => rows.map((row, i) => i ? row : { ...row, created_at: new Date('2026-09-13T00:00:00Z') }), 'fixture_timestamp_changed'],
        ['changed status', (rows: any[]) => rows.map((row, i) => i ? row : { ...row, status: 'confirmed' }), 'fixture_status_changed'],
        ['new agreement', (rows: any[]) => rows.map((row, i) => i ? row : { ...row, orphan: false }), 'fixture_terms_changed'],
    ])('fails closed on %s', (_name, mutate, code) => {
        expect(() => validateInventory(mutate(inventory()))).toThrow(code);
    });

    it('is idempotent only for rows carrying this remediation reason', () => {
        const rows = inventory();
        rows[0] = { ...rows[0], status: 'cancelled', cancellation_reason: CANCELLATION_REASON };
        expect(validateInventory(rows)).toMatchObject({ ready: { length: 8 }, alreadyResolved: { length: 1 } });

        rows[1] = { ...rows[1], status: 'cancelled', cancellation_reason: 'customer_cancelled' };
        expect(() => validateInventory(rows)).toThrow('fixture_status_changed');
    });

    it('treats the masked timestamp as a date guard, not as no guard', () => {
        expect(timestampMatches('2026-08-13T23:59:59.000Z', '2026-08-13')).toBe(true);
        expect(timestampMatches('2026-08-14T00:00:00.000Z', '2026-08-13')).toBe(false);
    });

    it('emits a machine-readable exact-cardinality receipt', () => {
        expect(summaryLine({ expected: 9, found: 9, cancelled: 9, alreadyResolved: 0, ready: 0, applied: true }))
            .toBe('AGREED_TERMS_TEST_FIXTURE_REMEDIATION expected=9 found=9 cancelled=9 already_resolved=0 ready=0 applied=1 errors=0');
    });
});
