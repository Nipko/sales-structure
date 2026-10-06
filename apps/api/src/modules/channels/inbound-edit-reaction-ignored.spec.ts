import { WhatsAppAdapter } from './whatsapp/whatsapp.adapter';
import { InstagramAdapter } from './instagram/instagram.adapter';
import { TelegramAdapter } from './telegram/telegram.adapter';

/**
 * An edit or a reaction is not a new customer turn: none of the adapters may turn one
 * into an inbound message (that would be a second agent reply and a second quota charge).
 * CHAN-TG-03 covers Telegram's `edited_message`; WhatsApp reactions used to reach the agent
 * as "[Unsupported message type: reaction]".
 */
describe('inbound edits and reactions are ignored by every adapter', () => {
    const config = { get: () => undefined } as any;
    const wa = (message: any) => ({ entry: [{ changes: [{ value: {
        metadata: { phone_number_id: 'pn1' }, contacts: [{ profile: { name: 'Ana' } }], messages: [message] } }] }] });

    it('WhatsApp: a text message is still normalized', async () => {
        const out = await new WhatsAppAdapter(config).handleWebhook(wa({ id: 'wamid.1', from: '573001112233', timestamp: '1800000000', type: 'text', text: { body: 'hola' } }), 'pn1');
        expect(out?.content).toMatchObject({ type: 'text', text: 'hola' });
    });

    it('WhatsApp: a reaction is not an inbound message', async () => {
        const out = await new WhatsAppAdapter(config).handleWebhook(
            wa({ id: 'wamid.2', from: '573001112233', timestamp: '1800000001', type: 'reaction', reaction: { message_id: 'wamid.1', emoji: '👍' } }), 'pn1');
        expect(out).toBeNull();
    });

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
