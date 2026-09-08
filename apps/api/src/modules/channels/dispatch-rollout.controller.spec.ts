import { BadRequestException, ConflictException } from '@nestjs/common';
import { DispatchRolloutController } from './dispatch-rollout.controller';

/**
 * The endpoint an operator resolves an uncertain effect through.
 *
 * `delivered` and `not_delivered` close a row for good and `retry` sends another
 * message to a real customer, so the record of who decided and why has to
 * survive whatever happens next. It used to be written after the transaction,
 * on a different connection, with its failure discarded — so an irreversible
 * decision could exist with no author at all.
 */
describe('resolving an uncertain dispatch effect over HTTP', () => {
    const dispatchId = '11111111-1111-4111-8111-111111111111';
    const tenantId = '22222222-2222-4222-8222-222222222222';
    const actorId = '33333333-3333-4333-8333-333333333333';
    const request = { user: { id: actorId, role: 'super_admin', email: 'ops@example.test' } };

    function harness(overrides: { resolve?: any; audit?: any } = {}) {
        const resolution = {
            id: '44444444-4444-4444-8444-444444444444', dispatchId, resolution: 'retry',
            evidence: 'Provider log shows no request in the window', actorId, actorRole: 'super_admin',
            previousState: 'reconciliation_required', previousErrorCode: 'provider_timeout',
            newState: 'failed', receipt: null, createdAt: new Date(),
        };
        const outbox: any = {
            resolve: overrides.resolve ?? jest.fn().mockResolvedValue({ row: { id: dispatchId, state: 'failed' }, resolution }),
            markResolutionExported: jest.fn().mockResolvedValue(undefined),
            unexportedResolutions: jest.fn().mockResolvedValue([]),
        };
        const prisma: any = { auditLog: { create: overrides.audit ?? jest.fn().mockResolvedValue({}) } };
        const controller = new DispatchRolloutController({} as any, outbox, prisma);
        (controller as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
        return { controller, outbox, prisma, resolution };
    }

    const body = { resolution: 'retry', evidence: 'Provider log shows no request in the window' };

    it('signs the decision with the person who made it and their role', async () => {
        const { controller, outbox } = harness();
        await controller.resolve(tenantId, dispatchId, body, request);
        expect(outbox.resolve).toHaveBeenCalledWith(tenantId, expect.objectContaining({
            dispatchId, resolution: 'retry', evidence: body.evidence,
            actorId, actorRole: 'super_admin',
        }));
    });

    it('copies the whole evidence and the failure it replaced into the platform log', async () => {
        const { controller, prisma, outbox, resolution } = harness();
        await controller.resolve(tenantId, dispatchId, body, request);
        const written = prisma.auditLog.create.mock.calls[0][0].data;
        expect(written).toMatchObject({ tenantId, userId: actorId, resource: dispatchId,
            action: 'dispatch.reconciliation.resolved' });
        expect(written.details).toMatchObject({
            resolutionId: resolution.id, resolution: 'retry', evidence: body.evidence,
            previousState: 'reconciliation_required', previousErrorCode: 'provider_timeout',
            resultingState: 'failed', actorRole: 'super_admin', actorEmail: 'ops@example.test',
        });
        expect(outbox.markResolutionExported).toHaveBeenCalledWith(tenantId, resolution.id);
    });

    it('still answers when the copy fails, and leaves it to be drained again', async () => {
        const { controller, outbox } = harness({ audit: jest.fn().mockRejectedValue(new Error('audit down')) });
        const answer: any = await controller.resolve(tenantId, dispatchId, body, request);
        // The decision itself committed with the state change, so the request
        // succeeded; what failed was a copy that can be made again.
        expect(answer.success).toBe(true);
        expect(answer.data.state).toBe('failed');
        expect(outbox.markResolutionExported).not.toHaveBeenCalled();
    });

    it('re-runs the copies a previous export never finished', async () => {
        const { controller, outbox, prisma, resolution } = harness();
        outbox.unexportedResolutions
            .mockResolvedValueOnce([resolution])
            .mockResolvedValueOnce([]);
        const answer: any = await controller.exportPending(tenantId, request);
        expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
        expect(outbox.markResolutionExported).toHaveBeenCalledWith(tenantId, resolution.id);
        expect(answer.data).toEqual({ attempted: 1, remaining: 0 });
    });

    it('separates a row somebody else already settled from a malformed request', async () => {
        const conflicted = harness({
            resolve: jest.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'dispatch_not_reconcilable:suppressed' })),
        });
        await expect(conflicted.controller.resolve(tenantId, dispatchId, body, request))
            .rejects.toBeInstanceOf(ConflictException);

        const refused = harness({
            resolve: jest.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'dispatch_resolution_evidence_required' })),
        });
        await expect(refused.controller.resolve(tenantId, dispatchId, body, request))
            .rejects.toBeInstanceOf(BadRequestException);
    });

    it('hands the refusal code back in the field a client reads codes from', async () => {
        const { controller } = harness({
            resolve: jest.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'dispatch_receipt_required' })),
        });
        await expect(controller.resolve(tenantId, dispatchId, body, request))
            .rejects.toMatchObject({ response: { error: 'dispatch_receipt_required' } });
    });

    it('never writes an audit row for a decision that was refused', async () => {
        const { controller, prisma } = harness({
            resolve: jest.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'dispatch_redacted' })),
        });
        await expect(controller.resolve(tenantId, dispatchId, body, request)).rejects.toThrow();
        expect(prisma.auditLog.create).not.toHaveBeenCalled();
    });
});
