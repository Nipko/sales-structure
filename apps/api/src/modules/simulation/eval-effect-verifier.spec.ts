import { verifyExpectedEffects } from './eval-effect-verifier';
import { EVAL_EFFECT_VERIFIERS } from './eval.service';
import { canEvalExecuteWriter } from '../conversations/agent-test-tool-policy';

const contactId = '00000000-0000-4000-8000-00000000eba1';
const noRow = { kind: 'db_effect', family: 'repair_orders', table: 'repair_orders', type: 'no_row' } as const;
const run = (expected: any[], query = jest.fn().mockResolvedValue([{ cnt: 0 }])) =>
    verifyExpectedEffects({ expected, query, contactId, verifiers: EVAL_EFFECT_VERIFIERS });

describe('committed effect evidence', () => {
    it('verifies vehicle and accepted service identities through code-owned metadata projections', async () => {
        const query = jest.fn().mockResolvedValue([{ cnt: 1 }]);
        expect((await run([{ kind: 'db_effect', type: 'row_exists', family: 'appointments', table: 'appointments',
            where: { vehicle_id: contactId, vehicle_terms_id: contactId, service_terms_id: contactId } }], query)).passed).toBe(true);
        expect(query.mock.calls[0][0]).toContain('contact_id = $1::uuid');
        expect(query.mock.calls[0][0]).toContain(`"metadata" #>> '{vehicleTerms,vehicleId}' = $3`);
        expect(query.mock.calls[0][1]).toEqual([contactId, contactId, contactId, contactId]);
    });
    it('rejects malformed projection definitions before querying', async () => {
        const query = jest.fn();
        const result = await verifyExpectedEffects({ contactId, query,
            verifiers: { appointments: { table: 'appointments', contactColumn: 'contact_id',
                jsonFields: { vehicle_id: { column: 'metadata', path: ["vehicleId'} OR TRUE --"] } } } },
            expected: [{ kind: 'db_effect', type: 'row_exists', family: 'appointments', table: 'appointments', where: { vehicle_id: contactId } }],
        });
        expect(result.passed).toBe(false); expect(query).not.toHaveBeenCalled();
    });
    it('verifies workshop rows without authorizing a workshop writer', async () => {
        expect(canEvalExecuteWriter('create_repair_order', contactId)).toBe(false);
        const query = jest.fn().mockResolvedValue([{ cnt: 1 }]);
        const result = await run([{ ...noRow, type: 'row_exists', where: { status: 'awaiting_approval', approval_status: 'pending' } }], query);
        expect(result.passed).toBe(true);
        expect(query.mock.calls[0][0]).toContain('contact_id = $1::uuid');
        expect(query.mock.calls[0][1]).toEqual([contactId, 'awaiting_approval', 'pending']);
    });
    it.each([[], [{}], [{ cnt: null }], [{ cnt: '' }], [{ cnt: ' ' }], [{ cnt: false }], [{ cnt: [] }], [{ cnt: -1 }], [{ cnt: 'NaN' }], [{ cnt: 0 }, { cnt: 0 }]].map(result => [result]))(
        'never turns malformed DB evidence into a passing no-row assertion: %j', async result => {
            expect((await run([noRow], jest.fn().mockResolvedValue(result))).passed).toBe(false);
        });
    it('does not turn a failed query into absence', async () => {
        const result = await run([noRow], jest.fn().mockRejectedValue(new Error('missing table')));
        expect(result).toMatchObject({ passed: false, checks: [{ detail: 'verification_query_failed' }] });
    });
    it.each([
        { where: { 'status) OR TRUE --': 'confirmed' } },
        { where: { status: { op: 'unknown', value: 'confirmed' } } },
        { where: { status: { op: 'eq' } } },
        { where: { status: { op: 'eq', value: ['confirmed'] } } },
        { where: [] }, { type: 'anything' }, { kind: 'anything' }, { type: 'row_count', count: -1 },
    ])('rejects malformed assertions without dropping their filters: %j', async patch => {
        const query = jest.fn();
        expect((await run([{ ...noRow, ...patch }], query)).passed).toBe(false);
        expect(query).not.toHaveBeenCalled();
    });
    it('handles NULL intentionally and binds all customer-provided values', async () => {
        const query = jest.fn().mockResolvedValue([{ cnt: 1 }]);
        expect((await run([{ ...noRow, type: 'row_count', count: 1, where: { cancelled_at: null, customer_concern: "x'; DROP TABLE repair_orders; --" } }], query)).passed).toBe(true);
        expect(query.mock.calls[0][0]).toContain('"cancelled_at" IS NULL');
        expect(query.mock.calls[0][0]).not.toContain('DROP');
        expect(query.mock.calls[0][1]).toEqual([contactId, "x'; DROP TABLE repair_orders; --"]);
    });
});
