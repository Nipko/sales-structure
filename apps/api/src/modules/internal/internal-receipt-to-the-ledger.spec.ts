import { InternalController } from './internal.controller';

const tenantId = '11111111-1111-4111-8111-111111111111';
const schemaName = 'tenant_receipt_ingress';
const phoneNumberId = '15550001111';

/**
 * ═══ THE ROAD META'S RECEIPTS ACTUALLY TRAVEL ═══
 *
 * `wa.parallly-chat.cloud` is the service Meta posts to. Its worker forwards
 * every `sent/delivered/read/failed` to THIS endpoint. So this — not the API's
 * own webhook, which only receives what is pointed at `api.` — is where the
 * platform's delivery receipts land in production.
 *
 * It was injected with the ledger and never handed it to the writer. On the
 * deployed road: `delivered` settled nothing, `failed` released nothing, and a
 * late `131042` paused no number. Every reservation stayed counted for ever.
 *
 * The test that was supposed to catch this read the controller's SOURCE FILE
 * and asserted it contained the word `spendLedger`. It did — in the
 * constructor. A word in a file is not a wire; these call the real handler and
 * watch what comes out the other side.
 */
describe('the receipts the deployed worker posts reach the money', () => {
    function harness(options: { ledgerThrows?: boolean; schema?: string | null } = {}) {
        const receipts: any[] = [];
        const prisma: any = {
            tenant: {
                findUnique: jest.fn(async () => (options.schema === null
                    ? null : { schemaName: options.schema ?? schemaName })),
            },
            transactionInTenantSchema: jest.fn(async (_schema: string, work: any) =>
                work(jest.fn(async (sql: string) => {
                    // Enough of the outbox for the conversation-record half to
                    // reach a decision. What it decides is proven against real
                    // PostgreSQL beside the outbox; here it only has to not be
                    // the thing that fails, so the ledger half is what is
                    // actually under test.
                    if (sql.includes('current_schema() AS schema')) {
                        return [{ schema: schemaName, outbox: 'agent_dispatch_outbox' }];
                    }
                    return [];
                }))),
            executeInTenantSchema: jest.fn(async () => []),
        };
        const spendLedger = {
            applyDeliveryReceipt: jest.fn(async (schema: string, receipt: any) => {
                receipts.push({ schema, receipt });
                if (options.ledgerThrows) throw new Error('pgbouncer unavailable');
                return 'settled';
            }),
        };
        const controller = new InternalController(
            prisma, {} as any, {} as any, {} as any, spendLedger as any);
        (controller as any).logger =
            { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
        return { controller, receipts, spendLedger, prisma };
    }

    const internal = { user: { isInternalService: true } };
    const post = (h: ReturnType<typeof harness>, over: Record<string, unknown> = {}) =>
        h.controller.channelDeliveryStatus(internal as any, {
            tenantId, channelType: 'whatsapp', channelAccountId: phoneNumberId,
            providerMessageId: 'wamid.ONE', status: 'delivered', ...over,
        } as any);

    it('hands a delivery to the ledger, keyed to the tenant schema', async () => {
        const h = harness();
        await post(h);
        expect(h.receipts).toHaveLength(1);
        expect(h.receipts[0].schema).toBe(schemaName);
        expect(h.receipts[0].receipt).toMatchObject(
            { providerMessageId: 'wamid.ONE', status: 'delivered' });
    });

    it.each(['sent', 'delivered', 'read', 'failed'])(
        'hands `%s` to the ledger, because each one means something different', async status => {
            const h = harness();
            await post(h, { providerMessageId: `wamid.${status}`, status });
            expect(h.receipts.map(entry => entry.receipt.status)).toEqual([status]);
        });

    it('carries Meta’s pricing block, the only authority that settles at zero', async () => {
        const h = harness();
        await post(h, { pricing: { billable: false, pricing_model: 'PMP', category: 'service' } });
        expect(h.receipts[0].receipt.pricing)
            .toEqual({ billable: false, category: 'service', model: 'PMP' });
    });

    it('never reads a missing pricing block as free', async () => {
        // The invisible catastrophe: Meta renames a field, every delivery
        // settles at zero, and a month of spending vanishes from the report
        // without anything looking broken.
        const h = harness();
        await post(h, { pricing: { something_new: 7 } });
        expect(h.receipts[0].receipt.pricing).toBeNull();
    });

    it('carries the tenant and the number, so a funding refusal can pause it', async () => {
        // `131042` pauses a (tenant, account) pair — not a schema. The ledger
        // cannot derive either from the schema name, so both travel with the
        // receipt or the pause cannot be written at all.
        const h = harness();
        await post(h, { status: 'failed', errorCode: 131042 });
        expect(h.receipts[0].receipt).toMatchObject({
            tenantId, channelAccountId: phoneNumberId, errorCode: 'wa_131042',
        });
    });

    it('carries Meta’s words, because the code behind them is sometimes generic', async () => {
        const h = harness();
        await post(h, {
            status: 'failed', errorCode: 131000,
            errorDetail: 'title="Generic" details="add a valid payment method"',
        });
        expect(h.receipts[0].receipt.errorDetail)
            .toBe('title="Generic" details="add a valid payment method"');
    });

    it('asks the caller to retry when the money could not be recorded', async () => {
        // The worker owns a retryable BullMQ job. A receipt that reached the
        // conversation record and not the ledger must NOT be acknowledged: Meta
        // does not redeliver what we said we had.
        const h = harness({ ledgerThrows: true });
        await expect(post(h)).rejects.toMatchObject({ status: 503 });
    });

    it('leaves the ledger alone for a channel nobody bills per message', async () => {
        const h = harness();
        await h.controller.channelDeliveryStatus(internal as any, {
            tenantId, channelType: 'telegram', channelAccountId: 'bot-1',
            providerMessageId: 'tg-1', status: 'delivered',
        } as any);
        expect(h.receipts).toHaveLength(0);
    });

    it('says nothing to the ledger about a connection with no tenant', async () => {
        const h = harness({ schema: null });
        await post(h);
        expect(h.receipts).toHaveLength(0);
    });
});
