import * as fs from 'fs';
import * as path from 'path';
import {
    parseMetaDeliveryStatuses, parseProviderPricing, recordChannelDeliveryStatuses,
} from './channel-delivery-status';
import { applyDispatchProviderStatus } from './agent-dispatch-outbox';

// The per-receipt decision about the CONVERSATION RECORD is proven where it
// lives, against real PostgreSQL. Stubbed here so these tests are about the
// seam and nothing else — and so `not_newer` can be produced on demand, which
// no amount of fake SQL would do honestly.
jest.mock('./agent-dispatch-outbox', () => ({
    ...jest.requireActual('./agent-dispatch-outbox'),
    applyDispatchProviderStatus: jest.fn(async () => ({ reason: 'applied' })),
}));

/**
 * ═══ A RECEIPT HAS TO REACH BOTH RECORDS ═══
 *
 * A provider status event carries two different facts to two different places:
 * what the customer's history should say, and what the money did. The writer
 * only ever knew about the first, so every reservation on the platform stayed
 * counted for ever — the POST can only say "Meta accepted it", and the charge
 * lands on delivery.
 *
 * These tests are about the SEAM, not about the ledger's own rules (those live
 * beside the ledger, against real PostgreSQL). What has to be true here:
 * receipts reach the ledger, only for the channel that is billed, and neither
 * record can cost the other.
 */
describe('a delivery receipt reaches the money as well as the history', () => {
    beforeEach(() => {
        (applyDispatchProviderStatus as jest.Mock).mockReset();
        (applyDispatchProviderStatus as jest.Mock).mockResolvedValue({ reason: 'applied' });
    });

    const store = () => ({
        transactionInTenantSchema: jest.fn(async (_schema: string, work: any) =>
            work(async () => [])),
        executeInTenantSchema: jest.fn(async () => []),
    });
    const logger = () => ({ error: jest.fn(), warn: jest.fn(), debug: jest.fn() });

    const deps = (spendLedger: any, over: Record<string, unknown> = {}) => ({
        store: store() as any,
        logger: logger() as any,
        resolveSchema: async () => 'tenant_acme',
        spendLedger,
        ...over,
    });

    const event = (over: Record<string, unknown> = {}) => ({
        providerMessageId: 'wamid.ONE', status: 'delivered' as const, errorCode: null, ...over,
    });

    it('hands every WhatsApp receipt to the ledger', async () => {
        const spendLedger = { applyDeliveryReceipt: jest.fn(async () => 'settled') };
        await recordChannelDeliveryStatuses([event()],
            { channelType: 'whatsapp', channelAccountId: 'phone-1' }, deps(spendLedger) as any);

        expect(spendLedger.applyDeliveryReceipt).toHaveBeenCalledWith('tenant_acme',
            expect.objectContaining({ providerMessageId: 'wamid.ONE', status: 'delivered' }));
    });

    it('carries Meta’s own pricing block through, because it decides the amount', async () => {
        const spendLedger = { applyDeliveryReceipt: jest.fn(async () => 'settled') };
        await recordChannelDeliveryStatuses(
            [event({ pricing: { billable: false, category: 'marketing', model: 'PMP' } })],
            { channelType: 'whatsapp', channelAccountId: 'phone-1' }, deps(spendLedger) as any);

        expect(spendLedger.applyDeliveryReceipt).toHaveBeenCalledWith('tenant_acme',
            expect.objectContaining({
                pricing: { billable: false, category: 'marketing', model: 'PMP' },
            }));
    });

    it('leaves the four unbilled channels alone', async () => {
        // Instagram, Messenger, Telegram and the widget are not billed per
        // message by their provider. Sending their receipts to the ledger would
        // be a query per receipt for a row that cannot exist.
        const spendLedger = { applyDeliveryReceipt: jest.fn(async () => 'unknown_receipt') };
        for (const channelType of ['instagram', 'messenger', 'telegram']) {
            await recordChannelDeliveryStatuses([event()],
                { channelType, channelAccountId: 'account-1' }, deps(spendLedger) as any);
        }
        expect(spendLedger.applyDeliveryReceipt).not.toHaveBeenCalled();
    });

    it('still records the history when the ledger cannot be reached', async () => {
        // The asymmetry is deliberate. A reservation that cannot be resolved is
        // an accounting gap somebody can fix later; a delivery status that never
        // reached the timeline is a customer whose record is wrong for ever.
        const spendLedger = {
            applyDeliveryReceipt: jest.fn(async () => { throw new Error('pool exhausted'); }),
        };
        const dependencies = deps(spendLedger);
        const report = await recordChannelDeliveryStatuses([event()],
            { channelType: 'whatsapp', channelAccountId: 'phone-1' }, dependencies as any);

        expect(dependencies.store.transactionInTenantSchema).toHaveBeenCalled();
        expect(report.results[0]).toMatchObject({ reason: 'applied', applied: true });
        // And the caller is told, so a retryable job can come back for it.
        expect(report.unavailable).toBe(true);
    });

    it('tells the ledger about a receipt the timeline already knew', async () => {
        // The two records answer different questions. A redelivered webhook the
        // history rejects as `not_newer` may still be the FIRST one the ledger
        // has seen — that is exactly what happens when the write to one of them
        // failed a moment earlier.
        const spendLedger = { applyDeliveryReceipt: jest.fn(async () => 'settled') };
        (applyDispatchProviderStatus as jest.Mock)
            .mockResolvedValueOnce({ reason: 'not_newer' });
        const dependencies = deps(spendLedger);
        const report = await recordChannelDeliveryStatuses([event()],
            { channelType: 'whatsapp', channelAccountId: 'phone-1' }, dependencies as any);

        expect(report.results[0].reason).toBe('not_newer');
        expect(spendLedger.applyDeliveryReceipt).toHaveBeenCalledTimes(1);
    });

    it('never reaches the ledger when the tenant could not be resolved', async () => {
        const spendLedger = { applyDeliveryReceipt: jest.fn() };
        await recordChannelDeliveryStatuses([event()],
            { channelType: 'whatsapp', channelAccountId: 'phone-1' },
            deps(spendLedger, { resolveSchema: async () => null }) as any);
        expect(spendLedger.applyDeliveryReceipt).not.toHaveBeenCalled();
    });

    // ── Reading Meta's payload ──────────────────────────────────────────────

    it('reads the pricing block off a real Meta status entry', () => {
        const [parsed] = parseMetaDeliveryStatuses([{
            id: 'wamid.X', status: 'delivered', recipient_id: '573001112233',
            pricing: { billable: false, pricing_model: 'PMP', category: 'utility' },
        }]);
        expect(parsed.pricing).toEqual({ billable: false, category: 'utility', model: 'PMP' });
    });

    it('keeps a scoped receipt recipient distinct across business portfolios', () => {
        const status = { id: 'wamid.B', status: 'delivered', recipient_id: '',
            recipient_user_id: 'BSU_abc123XYZ' };
        const [first] = parseMetaDeliveryStatuses([status], 'whatsapp', { wabaId: 'waba-one' });
        const [second] = parseMetaDeliveryStatuses([status], 'whatsapp', { wabaId: 'waba-two' });
        expect(first.recipient).toBe('bsuid:waba-one:BSU_abc123XYZ');
        expect(second.recipient).toBe('bsuid:waba-two:BSU_abc123XYZ');
    });

    it('never reads a missing field as "free"', () => {
        // The failure that would be invisible: Meta renames or drops `billable`,
        // every delivery settles at zero, and a month of spending disappears
        // from the report without anything looking broken.
        expect(parseProviderPricing({})).toBeNull();
        expect(parseProviderPricing(null)).toBeNull();
        expect(parseProviderPricing({ billable: 'false' })).toBeNull();
        expect(parseProviderPricing({ pricing_model: 'PMP' }))
            .toEqual({ billable: null, category: null, model: 'PMP' });
    });

    it('carries the tenant, so the receipt can pause the number that cannot pay', async () => {
        // A `131042` on a failed delivery means this business account cannot be
        // billed, and the answer is to stop sending from it. The pause is keyed
        // on (tenant, account); the schema name identifies neither.
        const spendLedger = { applyDeliveryReceipt: jest.fn(async () => 'released') };
        await recordChannelDeliveryStatuses(
            [event({ status: 'failed', errorCode: 'wa_131042', errorDetail: 'no payment method' })],
            { channelType: 'whatsapp', channelAccountId: 'phone-1', tenantId: 'tenant-uuid' },
            deps(spendLedger) as any);

        expect(spendLedger.applyDeliveryReceipt).toHaveBeenCalledWith('tenant_acme',
            expect.objectContaining({
                tenantId: 'tenant-uuid', channelAccountId: 'phone-1',
                errorCode: 'wa_131042', errorDetail: 'no payment method',
            }));
    });

    /**
     * ═══ WHY THIS IS NOT A GREP ═══
     *
     * There used to be a test here that read three source files and asserted
     * each contained the string `spendLedger`. All three did — one of them only
     * in its constructor, where the injected service sat unused while the
     * handler called the writer without it. The road Meta actually uses was the
     * one nobody had connected, and the test said it was fine for weeks.
     *
     * What replaces it is a list of the ingresses with the test that exercises
     * each one for real. The list is the reminder; the tests are the evidence.
     */
    it('names, for every ingress, the test that exercises it', () => {
        const root = path.join(__dirname, '..');
        const ingresses: Array<[string, string]> = [
            // The endpoint the DEPLOYED whatsapp worker posts to — the road
            // Meta's receipts actually travel on this platform.
            ['internal/internal.controller.ts',
                'internal/internal-receipt-to-the-ledger.spec.ts'],
            // The API's own Meta webhook, for numbers pointed at `api.`.
            ['whatsapp/services/whatsapp-webhook.service.ts',
                'whatsapp/services/whatsapp-webhook-receipts.spec.ts'],
            // Instagram/Messenger, which reach this writer and are not billed
            // per message — the test proves the ledger is NOT called.
            ['channels/channels.controller.ts',
                'channels/delivery-receipt-reaches-the-ledger.spec.ts'],
        ];
        for (const [ingress, proof] of ingresses) {
            expect({ ingress, exists: fs.existsSync(path.join(root, ingress)) })
                .toEqual({ ingress, exists: true });
            expect({ proof, exists: fs.existsSync(path.join(root, proof)) })
                .toEqual({ proof, exists: true });
        }
    });
});
