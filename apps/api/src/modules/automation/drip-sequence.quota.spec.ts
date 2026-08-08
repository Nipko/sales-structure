import { DripSequenceService } from './drip-sequence.service';

describe('DripSequenceService quota serialization', () => {
    it('checks maxDripSequences and inserts under the same tenant transaction lock', async () => {
        const query = jest.fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ count: 2 }])
            .mockResolvedValueOnce([{ id: 'sequence-1' }]);
        const prisma = {
            getTenantSchemaName: jest.fn().mockResolvedValue('tenant_schema'),
            transactionInTenantSchema: jest.fn(async (_schema: string, callback: any) => callback(query)),
        };
        const redis = { get: jest.fn().mockResolvedValue('1') };
        const throttle = { enforcePlanLimit: jest.fn().mockResolvedValue(undefined) };
        const service = new DripSequenceService(
            {} as any,
            prisma as any,
            redis as any,
            throttle as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
        );

        await expect(service.createSequence('11111111-1111-4111-8111-111111111111', {
            name: 'Sequence',
            trigger_event: 'manual',
            steps: [{ delay_seconds: 0, message_type: 'template', template_name: 'welcome' }],
        })).resolves.toEqual({ id: 'sequence-1' });

        expect(throttle.enforcePlanLimit).toHaveBeenCalledWith(
            '11111111-1111-4111-8111-111111111111',
            'maxDripSequences',
            2,
            'secuencias drip',
        );
        expect(query.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
        expect(query.mock.calls[2][0]).toContain('INSERT INTO drip_sequences');
    });
});
