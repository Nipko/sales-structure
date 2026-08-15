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
            tenant: {
                findUnique: jest.fn().mockResolvedValue(tenant),
                update: jest.fn().mockResolvedValue({}),
            },
            channelAccount: { count: jest.fn().mockResolvedValue(2) },
            user: {
                findMany: jest.fn().mockResolvedValue([{ id: 'user-1' }]),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                count: jest.fn().mockResolvedValue(0),
            },
            trustedDevice: {
                findMany: jest.fn().mockResolvedValue([]),
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
            billingSubscription: { findUnique: jest.fn().mockResolvedValue(null) },
            preflightTenantPublicPurge: jest.fn().mockImplementation(async () => { order.push('public-preflight'); }),
            executeInTenantSchema: jest.fn().mockResolvedValue([]),
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
            get: jest.fn().mockResolvedValue(null),
            getClient: jest.fn(),
        };
        const events = {
            emit: jest.fn().mockImplementation(() => { order.push('event'); return true; }),
        };
        const media = {
            deleteAllTenantFiles: jest.fn().mockImplementation(async () => {
                order.push('media');
                return { removed: 3, tenantDir: '/media/acme', archiveDir: '/media/archives/acme' };
            }),
        };
        const billing = {
            cancelSubscription: jest.fn().mockImplementation(async () => {
                order.push('billing');
                // Devuelve el mandato varado, si lo hay: la purga lo propaga al
                // resumen para que el operador lo vea antes de irse de la página.
                return { strandedMandate: null };
            }),
        };
        const queue = {} as any;
        const service = new OffboardingService(
            prisma, redis, events as any, media as any, billing as any,
            queue, queue, queue, queue, queue, queue,
            queue, queue, queue, queue, queue, queue,
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
        jest.spyOn(service as any, 'assertPurgeAccessGate')
            .mockImplementation(async () => { order.push('access-gate'); });

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
        expect(h.redis.releaseLockToken).toHaveBeenCalledWith(`lock:tenant-lifecycle:${tenantId}`, 'lock-token');
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

    it('runs public-table classification before credential capture or checkpoint effects', async () => {
        const h = makeHarness();
        h.prisma.preflightTenantPublicPurge.mockRejectedValue({
            response: { error: 'tenant_purge_unclassified_public_data', tables: ['future_secrets'] },
        });

        await expect(h.service.purgeTenant(tenantId)).rejects.toMatchObject({
            response: { error: 'tenant_purge_unclassified_public_data' },
        });

        expect((h.service as any).capturePurgeExternalPlan).not.toHaveBeenCalled();
        expect(h.prisma.$executeRawUnsafe).not.toHaveBeenCalled();
        expect(h.prisma.dropTenantSchema).not.toHaveBeenCalled();
    });

    it('fails before checkpoint and DROP when a captured credential cannot be decrypted', async () => {
        const h = makeHarness();
        jest.spyOn(h.service as any, 'capturePurgeExternalPlan').mockResolvedValue({
            ...externalPlan,
            channels: [{
                channelType: 'telegram',
                accountId: 'bot-1',
                encryptedCredential: 'not-an-aes-gcm-token',
            }],
        });

        await expect(h.service.purgeTenant(tenantId)).rejects.toMatchObject({
            response: { error: 'tenant_purge_undecryptable_credential' },
        });
        expect(h.prisma.$executeRawUnsafe).not.toHaveBeenCalled();
        expect(h.prisma.dropTenantSchema).not.toHaveBeenCalled();
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
        expect(h.order.indexOf('checkpoint')).toBeLessThan(h.order.indexOf('access-gate'));
        expect(h.order.indexOf('access-gate')).toBeLessThan(h.order.indexOf('queue-fence'));
        expect(h.order.indexOf('drop')).toBeLessThan(h.order.indexOf('external'));
        expect(h.order.indexOf('external')).toBeLessThan(h.order.indexOf('billing'));
        expect(h.order.indexOf('billing')).toBeLessThan(h.order.indexOf('media'));
        expect(h.order.indexOf('media')).toBeLessThan(h.order.indexOf('public-commit'));
        expect(h.order.indexOf('public-commit')).toBeLessThan(h.order.indexOf('queue-release'));
        expect(h.order.indexOf('public-commit')).toBeLessThan(h.order.indexOf('event'));
    });

    it('rejects reactivation while the purge runtime fence exists', async () => {
        const h = makeHarness();
        h.redis.get.mockResolvedValue('1');

        await expect(h.service.reactivate(tenantId)).rejects.toMatchObject({
            response: expect.objectContaining({ error: 'tenant_purge_in_progress' }),
        });
        expect(h.prisma.tenant.update).not.toHaveBeenCalled();
        expect(h.redis.releaseLockToken).toHaveBeenCalledWith(
            `lock:tenant-lifecycle:${tenantId}`,
            'lock-token',
        );
    });

    it('does not let extendTrial activate a tenant whose provisioning never committed', async () => {
        const h = makeHarness();

        await expect(h.service.extendTrial(tenantId, 7)).rejects.toMatchObject({
            response: expect.objectContaining({ error: 'tenant_provisioning_incomplete' }),
        });
        expect(h.prisma.tenant.update).not.toHaveBeenCalled();
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
        const queues = Array.from({ length: 12 }, (_, index) => ({
            pause: jest.fn().mockResolvedValue(undefined),
            resume: jest.fn().mockResolvedValue(undefined),
            getJobs: jest.fn().mockResolvedValue(index === 0 ? [activeJob] : []),
        }));
        const service = new OffboardingService(
            { fiscalInvoice: { findUnique: jest.fn() } } as any,
            {} as any, {} as any, {} as any, {} as any,
            queues[0] as any, queues[1] as any, queues[2] as any,
            queues[3] as any, queues[4] as any, queues[5] as any,
            queues[6] as any, queues[7] as any, queues[8] as any,
            queues[9] as any, queues[10] as any, queues[11] as any,
        );

        await expect((service as any).fenceQueuesForPurge(tenantId))
            .rejects.toMatchObject({ response: { error: 'tenant_purge_active_queue_job' } });
        for (const queue of queues) {
            expect(queue.pause).toHaveBeenCalledTimes(1);
            expect(queue.resume).toHaveBeenCalledTimes(1);
        }
        expect(activeJob.remove).not.toHaveBeenCalled();
    });

    it('rescans all tenant-touching queues before resume', async () => {
        const queues = Array.from({ length: 12 }, () => ({
            pause: jest.fn().mockResolvedValue(undefined),
            resume: jest.fn().mockResolvedValue(undefined),
            getJobs: jest.fn().mockResolvedValue([]),
        }));
        const service = new OffboardingService(
            { fiscalInvoice: { findUnique: jest.fn() } } as any,
            {} as any, {} as any, {} as any, {} as any,
            queues[0] as any, queues[1] as any, queues[2] as any,
            queues[3] as any, queues[4] as any, queues[5] as any,
            queues[6] as any, queues[7] as any, queues[8] as any,
            queues[9] as any, queues[10] as any, queues[11] as any,
        );

        const release = await (service as any).fenceQueuesForPurge(tenantId);
        for (const queue of queues) expect(queue.getJobs).toHaveBeenCalledTimes(2);

        await release();
        for (const queue of queues) {
            expect(queue.getJobs).toHaveBeenCalledTimes(4);
            expect(queue.resume).toHaveBeenCalledTimes(1);
        }
    });

    it('resolves fiscal queue ownership through the retained invoice row', async () => {
        const prisma = {
            fiscalInvoice: { findUnique: jest.fn().mockResolvedValue({ tenantId }) },
        };
        const queue = {} as any;
        const service = new OffboardingService(
            prisma as any, {} as any, {} as any, {} as any, {} as any,
            queue, queue, queue, queue, queue, queue,
            queue, queue, queue, queue, queue, queue,
        );

        await expect((service as any).jobBelongsToTenant(
            { data: { fiscalInvoiceId: 'invoice-1' } },
            'fiscal-invoice',
            tenantId,
        )).resolves.toBe(true);
        expect(prisma.fiscalInvoice.findUnique).toHaveBeenCalledWith({
            where: { id: 'invoice-1' },
            select: { tenantId: true },
        });
    });

    it('captures inactive accounts that are still connected at the provider', async () => {
        const prisma = {
            channelAccount: {
                findMany: jest.fn().mockResolvedValue([{
                    id: 'channel-row-1',
                    tenantId,
                    channelType: 'telegram',
                    accountId: 'bot-1',
                    isActive: false,
                    accessToken: null,
                    metadata: { disconnected_at_provider: false },
                }]),
            },
            whatsappCredential: {
                findMany: jest.fn().mockResolvedValue([{
                    credentialType: 'telegram_token',
                    encryptedValue: 'encrypted-token',
                }]),
            },
            executeInTenantSchema: jest.fn().mockResolvedValue([]),
        };
        const queue = {} as any;
        const service = new OffboardingService(
            prisma as any, {} as any, {} as any, {} as any, {} as any,
            queue, queue, queue, queue, queue, queue,
            queue, queue, queue, queue, queue, queue,
        );

        await expect((service as any).capturePurgeExternalPlan(
            tenantId,
            tenant.schemaName,
            {},
        )).resolves.toMatchObject({
            channels: [{
                channelType: 'telegram',
                accountId: 'bot-1',
                encryptedCredential: 'encrypted-token',
            }],
        });
        expect(prisma.channelAccount.findMany).toHaveBeenCalledWith({ where: { tenantId } });
    });

    it('covers web/mobile sessions, trust cache, handoff, booking and account-scoped tokens', async () => {
        const client = {
            scan: jest.fn().mockResolvedValue(['0', []]),
            del: jest.fn(),
        };
        const redis = { getClient: jest.fn().mockReturnValue(client) };
        const queue = {} as any;
        const service = new OffboardingService(
            {} as any, redis as any, {} as any, {} as any, {} as any,
            queue, queue, queue, queue, queue, queue,
            queue, queue, queue, queue, queue, queue,
        );

        await (service as any).cleanupPurgeRedis(
            tenantId,
            ['user-1'],
            ['conversation-1'],
            ['hash-1'],
        );
        const patterns = client.scan.mock.calls.map((call) => call[2]);
        expect(patterns).toEqual(expect.arrayContaining([
            `tenant_sessions:${tenantId}`,
            'session:user-1',
            'session:user-1:*',
            'refresh:user-1:*',
            'trust:hash-1',
            `handoff:${tenantId}:*`,
            'booking:conversation-1',
            `wa_token:${tenantId}:*`,
            `instagram_token:${tenantId}:*`,
            `messenger_token:${tenantId}:*`,
            `telegram_token:${tenantId}:*`,
            `sms_token:${tenantId}:*`,
        ]));
    });

    it('aborts external requests when their deadline expires', async () => {
        jest.useFakeTimers();
        const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(((_url: any, init: any) =>
            new Promise((_resolve, reject) => {
                init.signal.addEventListener('abort', () => reject(new Error('aborted')));
            })) as any);
        const queue = {} as any;
        const service = new OffboardingService(
            {} as any, {} as any, {} as any, {} as any, {} as any,
            queue, queue, queue, queue, queue, queue,
            queue, queue, queue, queue, queue, queue,
        );

        const request = (service as any).fetchWithDeadline('https://example.test', {}, 25);
        jest.advanceTimersByTime(25);
        await expect(request).rejects.toThrow('HTTP deadline exceeded after 25ms');

        fetchSpy.mockRestore();
        jest.useRealTimers();
    });
});
