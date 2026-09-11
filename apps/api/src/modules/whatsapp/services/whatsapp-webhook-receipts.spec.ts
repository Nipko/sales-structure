import { WhatsappWebhookService } from './whatsapp-webhook.service';

const tenantId = '22222222-2222-4222-8222-222222222222';
const schemaName = 'tenant_api_webhook';
const phoneNumberId = '15550009999';

/**
 * ═══ THE OTHER INGRESS, AND THE RULE IT USED TO OWN ALONE ═══
 *
 * Numbers whose Meta webhook points at `api.` land here instead of at the
 * deployed worker. Both roads carry the same events and both must reach the
 * same two records — the customer's history and the money.
 *
 * This ingress used to hold its own copy of the funding rule: a private
 * `observeFundingFailures` that read the failures and paused the number. The
 * copy worked, which is exactly why nobody noticed that the OTHER road had no
 * copy at all. One rule in two places is one rule in the wrong number of
 * places; it now lives with the ledger, and what this pins is that this
 * ingress still gets it — and that it hands over what the rule needs.
 */
describe('the API’s own Meta webhook reaches the ledger', () => {
    function harness() {
        const receipts: any[] = [];
        const prisma: any = {
            channelAccount: { findFirst: jest.fn(async () => ({ tenantId })) },
            getTenantSchemaName: jest.fn(async () => schemaName),
            transactionInTenantSchema: jest.fn(async (_schema: string, work: any) =>
                work(jest.fn(async (sql: string) => (sql.includes('current_schema() AS schema')
                    ? [{ schema: schemaName, outbox: 'agent_dispatch_outbox' }] : [])))),
            executeInTenantSchema: jest.fn(async () => []),
        };
        const spendLedger = {
            applyDeliveryReceipt: jest.fn(async (schema: string, receipt: any) => {
                receipts.push({ schema, receipt });
                return 'settled';
            }),
        };
        const service: any = Object.create(WhatsappWebhookService.prototype);
        Object.assign(service, {
            prisma, spendLedger, tenantCache: new Map(), CACHE_TTL: 300_000,
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        });
        return { service, receipts, spendLedger, prisma };
    }

    const statuses = (entries: any[]) => entries;

    it('hands Meta’s delivery to the ledger under the tenant schema', async () => {
        const h = harness();
        await h.service.recordDeliveryStatuses(phoneNumberId,
            statuses([{ id: 'wamid.A', status: 'delivered', recipient_id: '57300' }]));
        expect(h.receipts).toHaveLength(1);
        expect(h.receipts[0].schema).toBe(schemaName);
        expect(h.receipts[0].receipt).toMatchObject(
            { providerMessageId: 'wamid.A', status: 'delivered' });
    });

    it('hands over the tenant and the number the pause is keyed on', async () => {
        // The funding rule no longer lives in this file. It can only run at all
        // if this ingress passes what it needs — which is the pair, not the
        // schema name.
        const h = harness();
        await h.service.recordDeliveryStatuses(phoneNumberId, statuses([{
            id: 'wamid.B', status: 'failed',
            errors: [{ code: 131042, title: 'Business eligibility payment issue' }],
        }]));
        expect(h.receipts[0].receipt).toMatchObject({
            tenantId, channelAccountId: phoneNumberId, errorCode: 'wa_131042',
        });
        expect(String(h.receipts[0].receipt.errorDetail))
            .toContain('Business eligibility payment issue');
    });

    it('carries the pricing block Meta put on the status', async () => {
        const h = harness();
        await h.service.recordDeliveryStatuses(phoneNumberId, statuses([{
            id: 'wamid.C', status: 'delivered',
            pricing: { billable: false, pricing_model: 'PMP', category: 'service' },
        }]));
        expect(h.receipts[0].receipt.pricing)
            .toEqual({ billable: false, category: 'service', model: 'PMP' });
    });

    it('resolves the tenant once for a batch, not once per receipt', async () => {
        // Both halves of every receipt need it, and Meta batches statuses. One
        // lookup per event would be a query per receipt for an answer that
        // cannot change inside one payload.
        const h = harness();
        await h.service.recordDeliveryStatuses(phoneNumberId, statuses([
            { id: 'wamid.D', status: 'sent' },
            { id: 'wamid.D', status: 'delivered' },
            { id: 'wamid.D', status: 'read' },
        ]));
        expect(h.receipts).toHaveLength(3);
        expect(h.prisma.channelAccount.findFirst).toHaveBeenCalledTimes(1);
    });

    it('says nothing to the ledger for a number that belongs to no tenant', async () => {
        const h = harness();
        h.prisma.channelAccount.findFirst = jest.fn(async () => null);
        await h.service.recordDeliveryStatuses(phoneNumberId,
            statuses([{ id: 'wamid.E', status: 'delivered' }]));
        expect(h.receipts).toHaveLength(0);
    });
});
