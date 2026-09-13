import { BadRequestException } from '@nestjs/common';
import { WhatsappSpendController } from './whatsapp-spend.controller';
import { WhatsappSendAdmissionService } from './whatsapp-send-admission.service';

describe('WhatsApp spend policy control plane', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';

    function kit(current: 'observe' | 'enforce' = 'observe') {
        const query = jest.fn(async () => [{ value: { enforcement: current, repetition: { max: 1 } } }]);
        const execute = jest.fn(async () => 1);
        const audit = jest.fn(async () => ({}));
        const tx = {
            $queryRawUnsafe: query,
            $executeRawUnsafe: execute,
            auditLog: { create: audit },
        };
        const prisma = { $transaction: jest.fn(async (work: any) => work(tx)) } as any;
        const admission = {
            enforcementMode: jest.fn(async () => current),
            invalidateEnforcement: jest.fn(async () => undefined),
            cacheEnforcement: jest.fn(async () => undefined),
        };
        const controller = new WhatsappSpendController(
            prisma, {} as any, {} as any, admission as any,
        );
        const req = { user: { tenantId, id: 'owner-1' }, ip: '127.0.0.1' };
        return { controller, admission, query, execute, audit, req };
    }

    it('projects the runtime defaults and the effective mode from one authority', async () => {
        const h = kit();
        const result = await h.controller.policy(h.req);
        expect(result.data).toMatchObject({
            enforcement: 'observe',
            defaults: {
                enforcement: 'observe',
                numberDeliveriesPerCalendarMonth: 2_000,
                contactDeliveriesPerCalendarMonth: 60,
            },
            communication: {
                paymentMethodDeadline: '2026-09-30',
                effectiveOn: '2026-10-01',
            },
        });
        expect(h.admission.enforcementMode).toHaveBeenCalledWith(tenantId);
    });

    it('commits the settings change and its audit before invalidating the send cache', async () => {
        const h = kit();
        const result = await h.controller.setPolicyEnforcement(h.req, { enforcement: 'enforce' });
        expect(result.data).toEqual({ before: 'observe', after: 'enforce' });
        expect(h.execute).toHaveBeenCalledWith(
            expect.stringContaining("settings #> '{whatsappSpend}'::text[]"),
            tenantId,
            JSON.stringify({ enforcement: 'enforce' }),
        );
        expect(h.audit).toHaveBeenCalledWith({ data: expect.objectContaining({
            tenantId, userId: 'owner-1',
            action: 'whatsapp.spend.enforcement_changed',
            details: { before: 'observe', after: 'enforce' },
        }) });
        expect(h.admission.invalidateEnforcement).toHaveBeenCalledWith(tenantId);
        expect(h.admission.cacheEnforcement).toHaveBeenCalledWith(tenantId, 'enforce');
    });

    it('rejects an invented mode before opening a transaction', async () => {
        const h = kit();
        await expect(h.controller.setPolicyEnforcement(h.req, { enforcement: 'automatic' }))
            .rejects.toBeInstanceOf(BadRequestException);
        expect((h.controller as any).prisma.$transaction).not.toHaveBeenCalled();
    });

    it('does not invalidate the sender cache when the audited transaction fails', async () => {
        const h = kit();
        h.audit.mockRejectedValueOnce(new Error('audit unavailable'));
        await expect(h.controller.setPolicyEnforcement(h.req, { enforcement: 'enforce' }))
            .rejects.toThrow('audit unavailable');
        expect(h.admission.invalidateEnforcement).toHaveBeenCalledWith(tenantId);
        expect(h.admission.cacheEnforcement).not.toHaveBeenCalled();
    });
});

describe('WhatsApp spend policy shared runtime cache', () => {
    const tenantId = '22222222-2222-4222-8222-222222222222';

    it('reads the shared value before PostgreSQL and invalidates the tenant key', async () => {
        const redis = {
            getTenantData: jest.fn(async () => 'enforce'),
            setTenantData: jest.fn(async () => undefined),
            tenantKey: jest.fn((tenant: string, key: string) => `tenant:${tenant}:${key}`),
            del: jest.fn(async () => undefined),
        };
        const prisma = { tenant: { findUnique: jest.fn(async () => ({
            settings: { whatsappSpend: { enforcement: 'observe' } },
        })) } };
        const service = new WhatsappSendAdmissionService(
            prisma as any, {} as any, undefined, redis as any,
        );

        expect(await service.enforcementMode(tenantId)).toBe('enforce');
        expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
        await service.invalidateEnforcement(tenantId);
        expect(redis.del).toHaveBeenCalledWith(
            `tenant:${tenantId}:whatsapp-spend:enforcement`,
        );
    });

    it('falls back to PostgreSQL and warms the shared cache on a miss', async () => {
        const redis = {
            getTenantData: jest.fn(async () => null),
            setTenantData: jest.fn(async () => undefined),
        };
        const prisma = { tenant: { findUnique: jest.fn(async () => ({
            settings: { whatsappSpend: { enforcement: 'enforce' } },
        })) } };
        const service = new WhatsappSendAdmissionService(
            prisma as any, {} as any, undefined, redis as any,
        );

        expect(await service.enforcementMode(tenantId)).toBe('enforce');
        expect(redis.setTenantData).toHaveBeenCalledWith(
            tenantId, 'whatsapp-spend:enforcement', 'enforce', 300,
        );
    });
});
