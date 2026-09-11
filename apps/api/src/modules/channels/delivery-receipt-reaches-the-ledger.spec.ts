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

    it('has all three status ingresses wired to the ledger', () => {
        // Structural, because the alternative is discovering in production that
        // the road Meta actually uses was the one nobody connected. The API's
        // own webhook, the endpoint the deployed WhatsApp worker posts to, and
        // the generic channel webhook.
        const root = path.join(__dirname, '..');
        for (const relative of [
            'whatsapp/services/whatsapp-webhook.service.ts',
            'internal/internal.controller.ts',
            'channels/channels.controller.ts',
        ]) {
            const source = fs.readFileSync(path.join(root, relative), 'utf8');
            expect(source).toContain('spendLedger');
        }
    });
});
