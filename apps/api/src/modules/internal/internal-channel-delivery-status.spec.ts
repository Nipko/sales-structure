import { InternalController } from './internal.controller';
import { InternalAuthGuard } from '../../common/guards/internal-auth.guard';

const tenantId = '11111111-1111-4111-8111-111111111111';
const schemaName = 'tenant_delivery_status';

/**
 * The status endpoint the deployed WhatsApp worker calls.
 *
 * The worker used to decide these events itself, against `messages.external_id`
 * and a ranking that put `failed` above `delivered`. What is being pinned here
 * is that the decision now belongs to one authenticated place, that it refuses
 * what it cannot key, and that it tells a retryable caller the difference
 * between a record that said no and a record nobody could read.
 */
describe('internal channel delivery status', () => {
    function harness(options: {
        outboxRow?: any;
        messageStatus?: string;
        schema?: string | null;
        transactionThrows?: boolean;
    } = {}) {
        const updates: Array<{ sql: string; params: any[] }> = [];
        const legacy: Array<{ sql: string; params: any[] }> = [];
        const prisma: any = {
            tenant: {
                findUnique: jest.fn(async () => (options.schema === undefined
                    ? { schemaName }
                    : options.schema === null ? null : { schemaName: options.schema })),
            },
            transactionInTenantSchema: jest.fn(async (_schema: string, work: any) => {
                if (options.transactionThrows) throw new Error('pgbouncer unavailable');
                const query = jest.fn(async (sql: string, params: any[] = []) => {
                    if (sql.includes('current_schema() AS schema')) {
                        return [{ schema: schemaName, outbox: 'agent_dispatch_outbox' }];
                    }
                    if (sql.includes('FROM agent_dispatch_outbox d')) {
                        return options.outboxRow
                            ? [{ ...options.outboxRow, message_status: options.messageStatus ?? 'sent' }]
                            : [];
                    }
                    updates.push({ sql, params });
                    return [];
                });
                return work(query);
            }),
            executeInTenantSchema: jest.fn(async (_schema: string, sql: string, params: any[]) => {
                legacy.push({ sql, params });
                return [];
            }),
        };
        const controller = new InternalController(prisma, {} as any, {} as any, {} as any);
        (controller as any).logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
        return { controller, prisma, updates, legacy };
    }

    const internal = { user: { isInternalService: true } };
    const body = (overrides: Record<string, unknown> = {}) => ({
        tenantId,
        channelType: 'whatsapp',
        channelAccountId: '15550001111',
        providerMessageId: 'wamid.ABC',
        status: 'delivered',
        ...overrides,
    }) as any;

    describe('authentication', () => {
        const guard = () => new InternalAuthGuard({ get: () => 'the-internal-key' } as any);
        const context = (headers: Record<string, unknown>) => ({
            switchToHttp: () => ({ getRequest: () => ({ headers }) }),
        }) as any;

        it('refuses a request with no internal key', async () => {
            await expect(guard().canActivate(context({}))).rejects.toMatchObject({ status: 401 });
        });

        it('refuses a request whose internal key does not match', async () => {
            await expect(guard().canActivate(context({ 'x-internal-key': 'the-wrong-keys' })))
                .rejects.toMatchObject({ status: 401 });
        });

        it('refuses at the handler too, in case the guard wiring ever changes', async () => {
            const h = harness();
            await expect(h.controller.channelDeliveryStatus({ user: {} } as any, body()))
                .rejects.toMatchObject({ status: 403 });
            expect(h.prisma.transactionInTenantSchema).not.toHaveBeenCalled();
        });
    });

    describe('validation', () => {
        const refuses = async (overrides: Record<string, unknown>) => {
            const h = harness();
            await expect(h.controller.channelDeliveryStatus(internal as any, body(overrides)))
                .rejects.toMatchObject({ status: 400 });
            expect(h.prisma.transactionInTenantSchema).not.toHaveBeenCalled();
        };

        it('refuses a tenant that is not a uuid', () => refuses({ tenantId: 'tenant-one' }));
        it('refuses a channel it does not carry', () => refuses({ channelType: 'pigeon' }));
        it('refuses a missing channel account', () => refuses({ channelAccountId: '  ' }));
        it('refuses an empty receipt', () => refuses({ providerMessageId: '' }));
        it('refuses a receipt longer than the outbox stores', () => refuses({ providerMessageId: 'w'.repeat(301) }));
        // Meta also emits `deleted`, and a status the record does not model must
        // not reach the writer dressed as one it does.
        it('refuses a status it does not model', () => refuses({ status: 'deleted' }));
        it('refuses a status of the wrong shape', () => refuses({ status: { value: 'read' } }));
        it('refuses an error code that is neither text nor a number', () => refuses({ errorCode: { code: 131047 } }));
    });

    describe('application', () => {
        it('applies a delivery through the receipt on the dispatch row', async () => {
            const h = harness({ outboxRow: { id: 'd-1', message_id: 'm-1' }, messageStatus: 'sent' });
            await expect(h.controller.channelDeliveryStatus(internal as any, body()))
                .resolves.toEqual({ applied: true, reason: 'applied' });
            expect(h.updates).toEqual([
                { sql: expect.stringContaining('UPDATE messages SET status=$2'), params: ['m-1', 'delivered'] },
            ]);
        });

        it('namespaces the provider error code so the number can be looked up', async () => {
            const h = harness({ outboxRow: { id: 'd-1', message_id: 'm-1' }, messageStatus: 'sent' });
            await h.controller.channelDeliveryStatus(internal as any,
                body({ status: 'failed', errorCode: 131047 }));
            expect(h.updates).toContainEqual({
                sql: expect.stringContaining('UPDATE agent_dispatch_outbox SET error_code'),
                params: ['d-1', 'wa_131047'],
            });
        });

        it('refuses to walk a delivered message back to failed', async () => {
            const h = harness({ outboxRow: { id: 'd-1', message_id: 'm-1' }, messageStatus: 'delivered' });
            await expect(h.controller.channelDeliveryStatus(internal as any, body({ status: 'failed' })))
                .resolves.toEqual({ applied: false, reason: 'already_delivered' });
            expect(h.updates).toEqual([]);
        });

        it('reports a repeated event as a decision, not as work done', async () => {
            const h = harness({ outboxRow: { id: 'd-1', message_id: 'm-1' }, messageStatus: 'read' });
            await expect(h.controller.channelDeliveryStatus(internal as any, body({ status: 'delivered' })))
                .resolves.toEqual({ applied: false, reason: 'not_newer' });
        });

        it('still marks a pre-outbox outbound rejected by the id its producer stored', async () => {
            const h = harness();
            await expect(h.controller.channelDeliveryStatus(internal as any, body({ status: 'failed' })))
                .resolves.toEqual({ applied: false, reason: 'unknown_receipt' });
            expect(h.legacy).toEqual([{
                sql: expect.stringContaining("UPDATE messages SET status = 'failed'"),
                params: [['wamid.ABC']],
            }]);
            // Same prohibition as the outbox: a message the customer already has
            // is not something a late rejection may contradict.
            expect(h.legacy[0].sql).toContain("status NOT IN ('failed', 'delivered', 'read', 'redacted')");
        });

        it('does not touch the legacy path for a receipt the outbox owns', async () => {
            const h = harness({ outboxRow: { id: 'd-1', message_id: 'm-1' }, messageStatus: 'sent' });
            await h.controller.channelDeliveryStatus(internal as any, body({ status: 'failed' }));
            expect(h.legacy).toEqual([]);
        });

        it('answers a connection that belongs to no tenant without asking for a retry', async () => {
            const h = harness({ schema: null });
            await expect(h.controller.channelDeliveryStatus(internal as any, body()))
                .resolves.toEqual({ applied: false, reason: 'unknown_tenant' });
        });

        it('fails visibly when the record cannot be read, so the caller retries', async () => {
            const h = harness({ transactionThrows: true });
            await expect(h.controller.channelDeliveryStatus(internal as any, body()))
                .rejects.toMatchObject({ status: 503 });
        });
    });
});
