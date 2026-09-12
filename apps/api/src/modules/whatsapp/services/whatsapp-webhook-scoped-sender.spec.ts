import { WhatsappWebhookService } from './whatsapp-webhook.service';

const tenantId = '33333333-3333-4333-8333-333333333333';
const phoneNumberId = '15550001111';
const wabaId = 'waba-77';

/**
 * ═══ THE CUSTOMER WHO WROTE WITHOUT A PHONE NUMBER ═══
 *
 * Meta's business-scoped user ids let somebody message a business without the
 * business seeing a number: the webhook carries `from_user_id` where it used to
 * carry `from`. This ingress required `msg.from` to be a non-empty string and
 * DISCARDED anything else — a deliberate guard, because a message with no
 * sender was unanswerable and would have broken the `contacts` INSERT.
 *
 * Against a portfolio where usernames have rolled out, that reasoning turns
 * into silence. The customer writes, nothing answers, and the only trace is an
 * error log saying "Mensaje SIN REMITENTE descartado".
 *
 * These cases drive the real method. The assertion is what reached the QUEUE,
 * because that is the thing that decides whether a customer gets an answer.
 */
describe('a sender with no phone number', () => {
    function harness() {
        const enqueued: any[] = [];
        const service: any = Object.create(WhatsappWebhookService.prototype);
        Object.assign(service, {
            prisma: { executeInTenantSchema: jest.fn(async () => []) },
            redis: {
                // Every message claims its idempotency key for the first time.
                acquireLock: jest.fn(async () => true),
                del: jest.fn(async () => undefined),
            },
            inboundQueue: { enqueue: jest.fn(async (msg: any) => { enqueued.push(msg); }) },
            complianceService: {
                detectOptOut: jest.fn(() => false),
                processOptOut: jest.fn(async () => undefined),
            },
            tenantCache: new Map(),
            CACHE_TTL: 300_000,
            IDEMPOTENCY_TTL: 86_400,
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
            resolveTenantId: jest.fn(async () => tenantId),
            resolveAccessTokenAndMarkRead: jest.fn(async () => undefined),
        });
        return { service, enqueued };
    }

    const value = (message: Record<string, unknown>, contacts: unknown[] = []) => ({
        metadata: { phone_number_id: phoneNumberId, waba_id: wabaId },
        contacts,
        messages: [{ id: 'wamid.PROBE', type: 'text', text: { body: 'hola' }, ...message }],
    });

    it('still reads a phone sender exactly as it did', async () => {
        // The tenants who exist today are the ones with the most to lose: the
        // key has to come out byte for byte, or contacts move and histories
        // split for people nobody touched.
        const h = harness();
        await h.service.processMessageEvent(phoneNumberId, 
            value({ from: '573001112233' }, [{ wa_id: '573001112233', profile: { name: 'Ana' } }]));

        expect(h.enqueued).toHaveLength(1);
        expect(h.enqueued[0].contactId).toBe('573001112233');
        expect(h.enqueued[0].metadata.senderKind).toBe('phone');
        expect(h.enqueued[0].metadata.senderPhone).toBe('573001112233');
    });

    it('answers a customer who has only a business-scoped id', async () => {
        // THE CASE THIS EXISTS FOR. This message used to be dropped.
        const h = harness();
        await h.service.processMessageEvent(phoneNumberId, value({ from_user_id: 'BSU_abc123XYZ' }));

        expect(h.enqueued).toHaveLength(1);
        // Keyed with the portfolio the id means something inside — two
        // portfolios minting the same string must not become one contact.
        expect(h.enqueued[0].contactId).toBe(`bsuid:${wabaId}:BSU_abc123XYZ`);
        expect(h.enqueued[0].metadata.senderKind).toBe('business_scoped');
        // Absent, not guessed. A person who has not shared their number can
        // still ask a question and get one answered.
        expect(h.enqueued[0].metadata.senderPhone).toBeNull();
    });

    it('records the phone as an alias when the portfolio asserts one', async () => {
        const h = harness();
        await h.service.processMessageEvent(phoneNumberId, value(
            { from_user_id: 'BSU_abc123XYZ' },
            [{ user_id: 'BSU_abc123XYZ', wa_id: '573001112233', profile: { name: 'Ana' } }]));

        expect(h.enqueued[0].contactId).toBe(`bsuid:${wabaId}:BSU_abc123XYZ`);
        expect(h.enqueued[0].metadata.senderPhone).toBe('573001112233');
        expect(h.enqueued[0].metadata.senderPhoneProvenance).toBe('portfolio_contact');
    });

    it('still discards a message that names nobody at all', async () => {
        // The guard was not wrong, only too wide. A message with neither
        // identifier is genuinely unanswerable, and it must NOT release its
        // idempotency claim: Meta would redeliver the same broken body in a loop.
        const h = harness();
        await h.service.processMessageEvent(phoneNumberId, value({}));

        expect(h.enqueued).toEqual([]);
        expect(h.service.redis.del).not.toHaveBeenCalled();
    });

    it('keeps two portfolios apart even when the id looks the same', async () => {
        const first = harness();
        await first.service.processMessageEvent(phoneNumberId, value({ from_user_id: 'SAME_ID_1234' }));
        const second = harness();
        await second.service.processMessageEvent(phoneNumberId, {
            metadata: { phone_number_id: '15559998888', waba_id: 'waba-99' },
            contacts: [],
            messages: [{ id: 'wamid.OTHER', type: 'text', text: { body: 'hola' },
                from_user_id: 'SAME_ID_1234' }],
        });

        expect(first.enqueued[0].contactId).not.toBe(second.enqueued[0].contactId);
    });
});
