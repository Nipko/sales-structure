import { ChannelsController } from '../channels.controller';
import { TelegramAdapter } from './telegram.adapter';

/**
 * N3 · Telegram inbound: signature, unknown bots, duplicates, edited messages,
 * normalisation and failure propagation.
 *
 * Real: `ChannelsController.processTelegramUpdate` (the synchronous stage that
 * runs before the 200) and the real `TelegramAdapter.handleWebhook`.
 * Simulated: the bot registry (an array), Redis NX (a Set), the inbound queue
 * (a recorder) and the profile-photo lookup (no token, so no network call).
 * No PostgreSQL is needed; the file keeps the N3 name so the same runner picks it up.
 */
describe('N3 Telegram webhook intake', () => {
    const SECRET = 's3cret-token-aaaa';
    const bots: any[] = [];
    const claimed = new Set<string>();
    const queued: any[] = [];
    let controller: any;
    let queueFailure: Error | null, redisFailure: Error | null;

    const bot = (accountId: string, tenantId: string, secret?: string) => ({
        channelType: 'telegram', accountId, tenantId, isActive: true, accessToken: 'encrypted_ref',
        metadata: secret ? { webhookSecret: secret } : {},
    });
    const update = (extra: Record<string, any> = {}) => ({
        update_id: 1001,
        message: { message_id: 7, date: 1_800_000_000, chat: { id: 555 }, from: { id: 555, first_name: 'Ana', is_bot: false }, text: 'hola', ...extra },
    });

    beforeEach(() => {
        bots.length = 0; claimed.clear(); queued.length = 0; queueFailure = null; redisFailure = null;
        bots.push(bot('tienda_bot', 'tenant-a', SECRET), bot('otra_bot', 'tenant-b', 'other-secret'));
        const adapter = new TelegramAdapter();
        const logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
        controller = Object.create(ChannelsController.prototype);
        Object.assign(controller, {
            logger,
            prisma: { channelAccount: {
                findFirst: async ({ where }: any) => bots.find(b => b.accountId === where.accountId && b.isActive) ?? null,
                findMany: async () => bots.filter(b => b.isActive),
            } },
            redis: { acquireLock: async (key: string) => {
                if (redisFailure) throw redisFailure;
                if (claimed.has(key)) return false;
                claimed.add(key); return true;
            } },
            gateway: { processIncomingWebhook: async (_c: string, body: any, account: string) => adapter.handleWebhook(body, account) },
            channelToken: {},
            inboundQueue: { enqueue: async (message: any) => { if (queueFailure) throw queueFailure; queued.push(message); } },
        });
    });

    const deliver = (body: any, botUsername: string | null, secret?: string) =>
        controller.processTelegramUpdate(body, botUsername, secret);

    it('CHAN-TG-01: a wrong or missing secret token creates no message and no turn, and is acknowledged', async () => {
        await expect(deliver(update(), 'tienda_bot', 'forged')).resolves.toBeUndefined();
        await expect(deliver(update(), 'tienda_bot', undefined)).resolves.toBeUndefined();
        expect(queued).toEqual([]);
    });

    it('CHAN-TG-01: an unknown bot, an inactive bot, and an update without a message create nothing', async () => {
        await deliver(update(), 'bot_que_no_existe', 'ninguna-clave-conocida');
        await deliver(update(), 'bot_que_no_existe', undefined);
        bots[0].isActive = false;
        await deliver(update(), 'tienda_bot', SECRET);
        bots[0].isActive = true;
        await deliver({ update_id: 2002, callback_query: { id: 'x' } }, 'tienda_bot', SECRET);
        expect(queued).toEqual([]);
    });

    it('CHAN-TG-01: a valid secret enqueues exactly one inbound message for the right tenant', async () => {
        await deliver(update(), 'tienda_bot', SECRET);
        expect(queued).toHaveLength(1);
        expect(queued[0]).toMatchObject({ tenantId: 'tenant-a', channelType: 'telegram', channelAccountId: 'tienda_bot', content: { type: 'text', text: 'hola' } });
    });

    it('CHAN-TG-01: the generic route finds the bot by its own secret and never by "any bot"', async () => {
        await deliver(update(), null, 'other-secret');
        expect(queued.map(m => m.tenantId)).toEqual(['tenant-b']);
        await deliver(update({ message_id: 8 }), null, 'unknown-secret');
        expect(queued).toHaveLength(1);
    });

    it('CHAN-TG-01: an infrastructure failure (Redis or the queue) is NOT swallowed, so Telegram retries', async () => {
        redisFailure = new Error('redis_down');
        await expect(deliver(update(), 'tienda_bot', SECRET)).rejects.toThrow('redis_down');
        redisFailure = null; claimed.clear(); queueFailure = new Error('queue_down');
        await expect(deliver(update(), 'tienda_bot', SECRET)).rejects.toThrow('queue_down');
    });

    it('CHAN-TG-02: the same update_id delivered twice produces one inbound job; equal ids on two bots do not collide', async () => {
        await deliver(update(), 'tienda_bot', SECRET);
        await deliver(update(), 'tienda_bot', SECRET);
        expect(queued).toHaveLength(1);
        await deliver(update(), 'otra_bot', 'other-secret');
        expect(queued.map(m => m.tenantId)).toEqual(['tenant-a', 'tenant-b']);
    });

    it.each([
        ['voice', { text: undefined, voice: { file_id: 'v1' } }, { type: 'audio', mimeType: 'audio/ogg', mediaUrl: 'v1' }],
        ['photo with caption', { text: undefined, photo: [{ file_id: 'small' }, { file_id: 'big' }], caption: 'mira' }, { type: 'image', mimeType: 'image/jpeg', mediaUrl: 'big', caption: 'mira' }],
        ['document', { text: undefined, document: { file_id: 'd1', mime_type: 'application/pdf', file_name: 'factura.pdf' } }, { type: 'document', filename: 'factura.pdf', mimeType: 'application/pdf' }],
        ['location', { text: undefined, location: { latitude: 4.6, longitude: -74.1 } }, { type: 'location' }],
    ])('CHAN-TG-04: a %s is normalised to the right content type', async (_label, extra, expected) => {
        await deliver(update(extra), 'tienda_bot', SECRET);
        expect(queued[0].content).toMatchObject(expected);
    });

    it('CHAN-TG-04: a message from a bot is ignored', async () => {
        await deliver(update({ from: { id: 9, is_bot: true } }), 'tienda_bot', SECRET);
        expect(queued).toEqual([]);
    });
});
