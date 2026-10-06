import { InstagramAdapter } from './instagram/instagram.adapter';
import { TelegramAdapter } from './telegram/telegram.adapter';

/**
 * An edit or a reaction is not a new customer turn: Instagram and Telegram adapters must not turn one into an
 * inbound message. (WhatsApp is covered on its real ingress: whatsapp-webhook-non-turn.spec.ts and the worker spec.)
 */
describe('inbound edits and reactions are ignored by every adapter', () => {
    const config = { get: () => undefined } as any;
    it('Instagram: a reaction and a message edit carry no `message` and are ignored', async () => {
        const adapter = new InstagramAdapter(config);
        const base = { sender: { id: 'u1' }, recipient: { id: 'ig1' }, timestamp: 1_800_000_000_000 };
        expect(await adapter.handleWebhook({ entry: [{ messaging: [{ ...base, reaction: { mid: 'm1', action: 'react', emoji: '❤' } }] }] }, 'ig1')).toBeNull();
        expect(await adapter.handleWebhook({ entry: [{ messaging: [{ ...base, message_edit: { mid: 'm1', text: 'corregido', num_edit: 1 } }] }] }, 'ig1')).toBeNull();
        expect(await adapter.handleWebhook({ entry: [{ messaging: [{ ...base, message: { mid: 'm2', text: 'hola' } }] }] }, 'ig1'))
            .toMatchObject({ content: { type: 'text', text: 'hola' } });
    });

    it('Telegram: edited_message is ignored, the original message is not', async () => {
        const adapter = new TelegramAdapter(config);
        const message = { message_id: 7, date: 1_800_000_000, chat: { id: 555 }, from: { id: 555, first_name: 'Ana', is_bot: false }, text: 'hola' };
        expect(await adapter.handleWebhook({ update_id: 1, message }, 'bot')).toMatchObject({ content: { text: 'hola' } });
        expect(await adapter.handleWebhook({ update_id: 2, edited_message: { ...message, text: 'hola!', edit_date: 1_800_000_060 } }, 'bot')).toBeNull();
    });
});
