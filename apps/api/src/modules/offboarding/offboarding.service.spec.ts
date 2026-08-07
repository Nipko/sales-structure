import { OffboardingService } from './offboarding.service';

describe('OffboardingService purge saga', () => {
    const tenantId = '11111111-1111-4111-8111-111111111111';
    const tenant = {
        id: tenantId,
        name: 'Acme',
        schemaName: 'tenant_acme_11111111111141118111111111111111',
        settings: {},
    };
    const externalPlan = {
        version: 1 as const,
        capturedAt: '2026-08-06T00:00:00.000Z',
        channels: [],
        googleOAuthTokens: [],
    };

    function makeHarness() {
        const order: string[] = [];
        const prisma: any = {
            tenant: { findUnique: jest.fn().mockResolvedValue(tenant) },
            channelAccount: { count: jest.fn().mockResolvedValue(2) },
            user: { findMany: jest.fn().mockResolvedValue([{ id: 'user-1' }]) },
            billingSubscription: { findUnique: jest.fn().mockResolvedValue(null) },
            $executeRawUnsafe: jest.fn().mockImplementation(async () => { order.push('checkpoint'); return 1; }),
            dropTenantSchema: jest.fn().mockImplementation(async () => { order.push('drop'); }),
            purgeTenantPublicDataAtomic: jest.fn().mockImplementation(async () => {
                order.push('public-commit');
                return { tenants: 1, fiscal_invoices_retained: 1 };
            }),
        };
        const redis: any = {
            acquireLockToken: jest.fn().mockResolvedValue('lock-token'),
            renewLockToken: jest.fn().mockResolvedValue(true),
            releaseLockToken: jest.fn().mockResolvedValue(undefined),
            set: jest.fn().mockResolvedValue(undefined),
            getClient: jest.fn(),
        };
        const events = {
            emit: jest.fn().mockImplementation(() => { order.push('event'); return true; }),
        };
        const media = {
            deleteAllTenantFiles: jest.fn().mockImplementation(async () => {
                order.push('media');
                return { removed: 3, tenantDir: '/media/acme' };
            }),
        };
        const billing = {
            cancelSubscription: jest.fn().mockImplementation(async () => { order.push('billing'); }),
        };
        const queue = {} as any;
        const service = new OffboardingService(
            prisma, redis, events as any, media as any, billing as any,
            queue, queue, queue, queue, queue,
        );
        const releaseFence = jest.fn().mockImplementation(async () => { order.push('queue-release'); });
        jest.spyOn(service as any, 'capturePurgeExternalPlan')
            .mockImplementation(async () => { order.push('capture'); return externalPlan; });
        jest.spyOn(service as any, 'fenceQueuesForPurge')
            .mockImplementation(async () => { order.push('queue-fence'); return releaseFence; });
        jest.spyOn(service as any, 'executePurgeExternalPlan')
            .mockImplementation(async () => { order.push('external'); });
        jest.spyOn(service as any, 'cleanupPurgeRedis')
            .mockImplementation(async () => { order.push('redis-cleanup'); });

        return { service, prisma, redis, events, media, billing, order, releaseFence };
    }

    it('does not run any irreversible external effect when DROP/verify fails', async () => {
        const h = makeHarness();
        h.prisma.dropTenantSchema.mockRejectedValue(new Error('injected DROP failure'));

        await expect(h.service.purgeTenant(tenantId)).rejects.toThrow('injected DROP failure');

        expect((h.service as any).executePurgeExternalPlan).not.toHaveBeenCalled();
        expect(h.billing.cancelSubscription).not.toHaveBeenCalled();
        expect(h.media.deleteAllTenantFiles).not.toHaveBeenCalled();
        expect(h.prisma.purgeTenantPublicDataAtomic).not.toHaveBeenCalled();
        expect(h.events.emit).not.toHaveBeenCalled();
        expect(h.releaseFence).toHaveBeenCalledTimes(1);
        expect(h.redis.releaseLockToken).toHaveBeenCalledWith(`lock:tenant-purge:${tenantId}`, 'lock-token');
    });

    it('fails closed on queue fencing errors before DROP', async () => {
        const h = makeHarness();
        jest.spyOn(h.service as any, 'fenceQueuesForPurge')
            .mockRejectedValue(new Error('queue unavailable'));

        await expect(h.service.purgeTenant(tenantId)).rejects.toThrow('queue unavailable');

        expect(h.prisma.dropTenantSchema).not.toHaveBeenCalled();
        expect((h.service as any).executePurgeExternalPlan).not.toHaveBeenCalled();
        expect(h.prisma.purgeTenantPublicDataAtomic).not.toHaveBeenCalled();
        expect(h.events.emit).not.toHaveBeenCalled();
    });

    it('stops before durable effects when purge lock ownership is lost', async () => {
        const h = makeHarness();
        h.redis.renewLockToken.mockResolvedValue(false);

        await expect(h.service.purgeTenant(tenantId)).rejects.toMatchObject({
            code: 'lock_ownership_lost',
        });

        expect((h.service as any).capturePurgeExternalPlan).not.toHaveBeenCalled();
        expect(h.prisma.$executeRawUnsafe).not.toHaveBeenCalled();
        expect(h.prisma.dropTenantSchema).not.toHaveBeenCalled();
        expect(h.events.emit).not.toHaveBeenCalled();
    });

    it('orders DROP before provider, billing and local irreversible cleanup', async () => {
        const h = makeHarness();
        h.prisma.billingSubscription.findUnique.mockResolvedValue({
            providerSubscriptionId: 'remote-sub',
            status: 'active',
        });

        await expect(h.service.purgeTenant(tenantId)).resolves.toMatchObject({
            schemaDropped: true,
            publicRowsDeleted: { tenants: 1 },
        });

        expect(h.order.indexOf('capture')).toBeLessThan(h.order.indexOf('drop'));
        expect(h.order.indexOf('drop')).toBeLessThan(h.order.indexOf('external'));
        expect(h.order.indexOf('queue-release')).toBeLessThan(h.order.indexOf('external'));
        expect(h.order.indexOf('external')).toBeLessThan(h.order.indexOf('billing'));
        expect(h.order.indexOf('billing')).toBeLessThan(h.order.indexOf('media'));
        expect(h.order.indexOf('media')).toBeLessThan(h.order.indexOf('public-commit'));
        expect(h.order.indexOf('public-commit')).toBeLessThan(h.order.indexOf('event'));
    });

    it('keeps success/event closed on public delete failure and succeeds on retry', async () => {
        const h = makeHarness();
        h.prisma.purgeTenantPublicDataAtomic
            .mockRejectedValueOnce(new Error('public delete failed'))
            .mockResolvedValueOnce({ tenants: 1, fiscal_invoices_retained: 1 });
        h.prisma.tenant.findUnique
            .mockResolvedValueOnce(tenant)
            .mockResolvedValueOnce({
                ...tenant,
                settings: {
                    purgeSaga: { externalPlan, externalCompleted: true },
                },
            });

        await expect(h.service.purgeTenant(tenantId)).rejects.toThrow('public delete failed');
        expect(h.events.emit).not.toHaveBeenCalled();

        await expect(h.service.purgeTenant(tenantId)).resolves.toMatchObject({ schemaDropped: true });
        expect(h.events.emit).toHaveBeenCalledTimes(1);
        expect(h.prisma.purgeTenantPublicDataAtomic).toHaveBeenCalledTimes(2);
        // The durable checkpoint prevents repeating provider teardown after the
        // public transaction failed but external revocation had completed.
        expect((h.service as any).executePurgeExternalPlan).toHaveBeenCalledTimes(1);
    });

    it('pauses every queue and rejects an active tenant job', async () => {
        const activeJob = {
            id: 'active-1',
            data: { tenantId },
            getState: jest.fn().mockResolvedValue('active'),
            remove: jest.fn(),
        };
        const queues = Array.from({ length: 5 }, (_, index) => ({
            pause: jest.fn().mockResolvedValue(undefined),
            resume: jest.fn().mockResolvedValue(undefined),
            getJobs: jest.fn().mockResolvedValue(index === 0 ? [activeJob] : []),
        }));
        const service = new OffboardingService(
            {} as any, {} as any, {} as any, {} as any, {} as any,
            queues[0] as any, queues[1] as any, queues[2] as any,
            queues[3] as any, queues[4] as any,
        );

        await expect((service as any).fenceQueuesForPurge(tenantId))
            .rejects.toMatchObject({ response: { error: 'tenant_purge_active_queue_job' } });
        for (const queue of queues) {
            expect(queue.pause).toHaveBeenCalledTimes(1);
            expect(queue.resume).toHaveBeenCalledTimes(1);
        }
        expect(activeJob.remove).not.toHaveBeenCalled();
    });
});
