import { BillingReconciliationProcessor } from './reconciliation.processor';

describe('BillingReconciliationProcessor engine crash recovery', () => {
    it('safely reschedules a worker reservation that never crossed the durable provider-POST boundary', async () => {
        const attempt = {
            id: 'attempt-1',
            provider: 'wompi',
            providerTxnId: null,
            reference: 'sub_uuid_ren_20260815_1',
            failureClass: null,
            metadata: { executionStage: 'reserved' },
        };
        const engine = {
            findUnresolvedAttempts: jest.fn().mockResolvedValue([attempt]),
            markAttempt: jest.fn().mockResolvedValue(true),
            settleFailed: jest.fn(),
        };
        const charging = {
            getChargeByReference: jest.fn().mockResolvedValue(null),
            getCharge: jest.fn(),
        };
        const processor = new BillingReconciliationProcessor(
            {} as any,
            {} as any,
            { getCharging: jest.fn().mockReturnValue(charging) } as any,
            {} as any,
            {} as any,
            {} as any,
            engine as any,
        );

        await expect(processor.reconcileEngineCharges()).resolves.toEqual({
            scanned: 1,
            resolved: 1,
            errors: 0,
        });
        expect(charging.getChargeByReference).toHaveBeenCalledWith(attempt.reference);
        expect(engine.markAttempt).toHaveBeenCalledWith(
            attempt.id,
            'scheduled',
            expect.objectContaining({
                failureCode: 'worker_crash_before_provider_post',
                sentAt: null,
            }),
        );
        expect(engine.settleFailed).not.toHaveBeenCalled();
    });
});
