import { ChannelsController } from '../channels.controller';
import { TelegramAdapter } from './telegram.adapter';

/**
 * N3 — Telegram edited messages (was red; fixed by ignoring edits). Do not relax the assertion.
 *
 *   CHAN-TG-03  TelegramAdapter.handleWebhook used to read `payload.message || payload.edited_message`
 *               and the webhook subscribed to `edited_message`, so when the customer fixed a
 *               typo Telegram sent a NEW update_id and the edit was queued as a brand-new
 *               inbound message: a second agent turn, a second reply, and a second charge to
 *               the AI quota for one sentence. Edits are now ignored (the turn already ran).
 *
 * Real: ChannelsController.processTelegramUpdate and the real TelegramAdapter.
 * Simulated: bot registry, Redis NX, inbound queue (recorders). No network, no PostgreSQL.
 */
describe('N3 DEFECT: Telegram edited message', () => {
    const SECRET = 's3cret-token-aaaa';
    const queued: any[] = [];
    const claimed = new Set<string>();
    let controller: any;

    beforeEach(() => {
        queued.length = 0; claimed.clear();
        const adapter = new TelegramAdapter();
        const bot = { channelType: 'telegram', accountId: 'tienda_bot', tenantId: 'tenant-a', isActive: true, accessToken: 'encrypted_ref', metadata: { webhookSecret: SECRET } };
        controller = Object.create(ChannelsController.prototype);
        Object.assign(controller, {
            logger: { warn: jest.fn(), log: jest.fn(), error: jest.fn() },
            prisma: { channelAccount: { findFirst: async () => bot, findMany: async () => [bot] } },
            redis: { acquireLock: async (key: string) => { if (claimed.has(key)) return false; claimed.add(key); return true; } },
            gateway: { processIncomingWebhook: async (_c: string, body: any, account: string) => adapter.handleWebhook(body, account) },
            channelToken: {},
            inboundQueue: { enqueue: async (message: any) => { queued.push(message); } },
        });
    });

    it('CHAN-TG-03: an edited message does not trigger a second turn', async () => {
        const original = { message_id: 7, date: 1_800_000_000, chat: { id: 555 }, from: { id: 555, first_name: 'Ana', is_bot: false }, text: 'hola' };
        await controller.processTelegramUpdate({ update_id: 1001, message: original }, 'tienda_bot', SECRET);
        await controller.processTelegramUpdate({ update_id: 1002, edited_message: { ...original, text: 'hola, corregido', edit_date: 1_800_000_060 } }, 'tienda_bot', SECRET);
        // eslint-disable-next-line no-console
        console.log(`[DEFECT-EVIDENCE CHAN-TG-03] message_id=7 sent once, then edited (edited_message, update_id=1002) -> inbound jobs=${queued.length}; second job: tgMessageId=${queued[1]?.metadata?.tgMessageId} text=${JSON.stringify(queued[1]?.content?.text)}`);
        expect(queued).toHaveLength(1);
    });
});
