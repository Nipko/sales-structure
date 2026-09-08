import { WhatsappWebhookService } from './whatsapp-webhook.service';

const tenantId = '11111111-1111-4111-8111-111111111111';
const schemaName = 'tenant_wa_status';

describe('WhatsApp delivery status reaches the conversation record', () => {
    function harness() {
        const applied: any[] = [];
        const legacy: any[] = [];
        const prisma: any = {
            getTenantSchemaName: jest.fn(async () => schemaName),
            transactionInTenantSchema: jest.fn(async (_schema: string, work: any) => {
                // Stand in for the outbox: capture what the status writer was asked
                // to apply, one transaction per event.
                const query = jest.fn(async (sql: string) => {
                    if (sql.includes('current_schema() AS schema')) return [{ schema: schemaName, outbox: 'x' }];
                    if (sql.includes('FROM agent_dispatch_outbox d')) return [];
                    return [];
                });
                const result = await work(query);
                applied.push(query.mock.calls);
                return result;
            }),
            executeInTenantSchema: jest.fn(async (_schema: string, sql: string, params: any[]) => {
                if (sql.includes("SET status = 'failed'")) legacy.push(params);
                return [];
            }),
        };
        const service: any = Object.create(WhatsappWebhookService.prototype);
        Object.assign(service, {
            prisma,
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
            resolveTenantId: jest.fn(async () => tenantId),
        });
        return { service, prisma, applied, legacy };
    }

    const run = (service: any, statuses: any[]) =>
        service.recordDeliveryStatuses('phone-1', statuses);

    it('forwards the whole lifecycle, not only rejections', async () => {
        const h = harness();
        await run(h.service, [
            { id: 'wamid.A', status: 'sent', recipient_id: '+57300' },
            { id: 'wamid.A', status: 'delivered', recipient_id: '+57300' },
            { id: 'wamid.A', status: 'read', recipient_id: '+57300' },
        ]);
        // Only `failed` used to be handled at all, so `delivered` and `read`
        // never reached the record even once the lookup was fixed.
        expect(h.prisma.transactionInTenantSchema).toHaveBeenCalledTimes(3);
    });

    it('applies each event in its own transaction, so order and repeats are decided per event', async () => {
        const h = harness();
        await run(h.service, [
            { id: 'wamid.A', status: 'delivered' },
            { id: 'wamid.B', status: 'sent' },
            { id: 'wamid.A', status: 'delivered' },
        ]);
        expect(h.prisma.transactionInTenantSchema).toHaveBeenCalledTimes(3);
    });

    it('ignores events without an id or with a status it does not model', async () => {
        const h = harness();
        await run(h.service, [
            { status: 'delivered' },
            { id: 'wamid.C', status: 'deleted' },
            { id: 'wamid.C', status: '' },
        ]);
        expect(h.prisma.transactionInTenantSchema).not.toHaveBeenCalled();
        expect(h.prisma.executeInTenantSchema).not.toHaveBeenCalled();
    });

    it('still marks a legacy outbound rejected by the id its producer stored', async () => {
        const h = harness();
        await run(h.service, [
            { id: 'wamid.D', status: 'failed', errors: [{ code: 131047, title: 'Re-engagement' }] },
            { id: 'wamid.E', status: 'delivered' },
        ]);
        // Producers that predate the outbox identify their outbound by the
        // provider id itself; losing them would be a regression.
        expect(h.legacy).toEqual([[['wamid.D']]]);
    });

    it('does nothing when the tenant cannot be resolved, and never throws', async () => {
        const h = harness();
        h.service.resolveTenantId = jest.fn(async () => null);
        await expect(run(h.service, [{ id: 'wamid.F', status: 'delivered' }])).resolves.toBeUndefined();
        expect(h.prisma.transactionInTenantSchema).not.toHaveBeenCalled();
    });

    it('survives a status write that fails, because diagnosis must not depend on it', async () => {
        const h = harness();
        h.prisma.transactionInTenantSchema.mockRejectedValue(new Error('schema unavailable'));
        await expect(run(h.service, [{ id: 'wamid.G', status: 'delivered' }])).resolves.toBeUndefined();
    });

    describe('a payload that carries messages and statuses at once', () => {
        function eventHarness() {
            const h = harness();
            Object.assign(h.service, {
                redis: { acquireLock: jest.fn(async () => true), del: jest.fn(async () => 1) },
                complianceService: { detectOptOut: jest.fn(() => false) },
                inboundQueue: { enqueue: jest.fn(async () => undefined) },
                resolveAccessTokenAndMarkRead: jest.fn(),
            });
            return h;
        }

        const value = {
            metadata: { phone_number_id: 'phone-1' },
            contacts: [{ wa_id: '57300', profile: { name: 'Ana' } }],
            messages: [{ id: 'wamid.IN', from: '57300', type: 'text', text: { body: 'hola' } }],
            statuses: [{ id: 'wamid.OUT', status: 'delivered', recipient_id: '57300' }],
        };

        it('applies the statuses instead of dropping them behind the messages', async () => {
            const h = eventHarness();
            await h.service.processMessageEvent('phone-1', value);
            // Statuses used to be read only on the branch where `messages` was
            // empty, so Meta batching both in one `value` lost every receipt.
            expect(h.prisma.transactionInTenantSchema).toHaveBeenCalledTimes(1);
            expect((h.service as any).inboundQueue.enqueue).toHaveBeenCalledTimes(1);
        });

        it('still queues the customer message when the status write is unavailable', async () => {
            const h = eventHarness();
            h.prisma.transactionInTenantSchema.mockRejectedValue(new Error('schema unavailable'));
            await h.service.processMessageEvent('phone-1', value);
            expect((h.service as any).inboundQueue.enqueue).toHaveBeenCalledTimes(1);
        });
    });
});
