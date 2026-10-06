import { WhatsappWebhookService } from './whatsapp-webhook.service';

const tenantId = '33333333-3333-4333-8333-333333333333';
const phoneNumberId = '15550001111';

/**
 * A reaction (and a service `system` notice or `request_welcome`) is not something the
 * customer wrote for the agent. On this ingress (`POST /channels/webhook/whatsapp`) it used
 * to be queued like a message and the agent answered an emoji. Drives the real method; the
 * oracle is what reached the inbound queue.
 */
describe('WhatsApp ingress: events that are not a customer turn', () => {
    function harness() {
        const enqueued: any[] = [];
        const service: any = Object.create(WhatsappWebhookService.prototype);
        Object.assign(service, {
            prisma: { executeInTenantSchema: jest.fn(async () => []) },
            redis: { acquireLock: jest.fn(async () => true), del: jest.fn(async () => undefined) },
            inboundQueue: { enqueue: jest.fn(async (msg: any) => { enqueued.push(msg); }) },
            complianceService: { detectOptOut: jest.fn(() => false), processOptOut: jest.fn(async () => undefined) },
            tenantCache: new Map(), CACHE_TTL: 300_000, IDEMPOTENCY_TTL: 86_400,
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
            resolveTenantId: jest.fn(async () => tenantId),
            resolveAccessTokenAndMarkRead: jest.fn(async () => undefined),
        });
        return { service, enqueued };
    }
    const run = (h: ReturnType<typeof harness>, messages: any[]) => h.service.processMessageEvent(phoneNumberId,
        { metadata: { phone_number_id: phoneNumberId }, contacts: [{ wa_id: '573001112233', profile: { name: 'Ana' } }], messages }, 'waba-1');
    const msg = (extra: Record<string, unknown>) => ({ id: 'wamid.X', from: '573001112233', timestamp: '1791000000', ...extra });

    it('a text message is still queued', async () => {
        const h = harness();
        await run(h, [msg({ type: 'text', text: { body: 'hola' } })]);
        expect(h.enqueued).toHaveLength(1);
    });

    it('a reaction queues nothing', async () => {
        const h = harness();
        await run(h, [msg({ type: 'reaction', reaction: { message_id: 'wamid.OLD', emoji: '👍' } })]);
        expect(h.enqueued).toHaveLength(0);
    });

    it('system and request_welcome queue nothing', async () => {
        const h = harness();
        await run(h, [msg({ id: 'wamid.S', type: 'system', system: { body: 'cambio de numero' } }), msg({ id: 'wamid.W', type: 'request_welcome' })]);
        expect(h.enqueued).toHaveLength(0);
    });

    it('a reaction in a batch does not strand its sibling text', async () => {
        const h = harness();
        await run(h, [msg({ id: 'wamid.R', type: 'reaction', reaction: { emoji: '❤' } }), msg({ id: 'wamid.T', type: 'text', text: { body: 'hola' } })]);
        expect(h.enqueued).toHaveLength(1);
        expect(h.enqueued[0].content.text).toBe('hola');
    });

    it('sticker, contacts, order and button are NOT filtered', async () => {
        const h = harness();
        await run(h, [msg({ id: 'wamid.1', type: 'sticker', sticker: { id: 'm1' } }), msg({ id: 'wamid.2', type: 'contacts', contacts: [] }),
            msg({ id: 'wamid.3', type: 'order', order: {} }), msg({ id: 'wamid.4', type: 'button', button: { text: 'Si' } })]);
        expect(h.enqueued).toHaveLength(4);
    });
});
