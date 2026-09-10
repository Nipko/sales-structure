import { WhatsAppAdapter } from './whatsapp/whatsapp.adapter';
import { TelegramAdapter } from './telegram/telegram.adapter';
import { MessengerAdapter } from './messenger/messenger.adapter';
import { carriesNativeCaption, foldableCaption, MAX_NATIVE_CAPTION } from './native-caption';

/**
 * ═══ WHEN A CAPTION IS A SECOND CHARGE, AND WHEN IT IS NOT ═══
 *
 * Four places have to agree about this: the batch builder, the two transports
 * that can attach a caption, and the counter that reports what a turn cost. They
 * all ask `foldableCaption`, and these cases pin what it answers — including the
 * three refusals, which are the ones that turn into a rejected payload rather
 * than a cheaper message when they are got wrong.
 *
 * The transports are exercised through their real `strictBody`, not through a
 * restatement of the rule. A test that re-implemented the decision would agree
 * with itself about a body Meta rejects.
 */
describe('whether a caption travels with its attachment', () => {
    describe('the decision', () => {
        it('folds on the channels that deliver both as one message', () => {
            for (const channelType of ['whatsapp', 'telegram']) {
                expect({ channelType, folded: foldableCaption(channelType, 'image', 'hola') })
                    .toEqual({ channelType, folded: 'hola' });
            }
        });

        it('refuses on the channels that really perform two requests', () => {
            // Messenger and Instagram POST the attachment and then the text and
            // return only the last id: one acceptance would be covering two
            // effects, which is what the outbox exists to prevent.
            for (const channelType of ['messenger', 'instagram', 'web_widget', '', null, undefined]) {
                expect({ channelType, folded: foldableCaption(channelType, 'image', 'hola') })
                    .toEqual({ channelType, folded: null });
            }
        });

        it('refuses on a media kind the provider gives no caption field', () => {
            // Meta rejects a caption on audio. Telegram accepts one.
            expect(foldableCaption('whatsapp', 'audio', 'hola')).toBeNull();
            expect(foldableCaption('telegram', 'audio', 'hola')).toBe('hola');
            for (const mediaType of ['image', 'video', 'document']) {
                expect({ mediaType, folded: foldableCaption('whatsapp', mediaType, 'hola') })
                    .toEqual({ mediaType, folded: 'hola' });
            }
        });

        it('treats an unnamed media kind as an image, which is what the transports do', () => {
            expect(foldableCaption('whatsapp', undefined, 'hola')).toBe('hola');
            expect(carriesNativeCaption('whatsapp', null)).toBe(true);
        });

        it('refuses past the provider limit instead of truncating', () => {
            // A caption over 1,024 characters is a rejected payload, not a
            // cheaper message. Cutting it to fit would change what the customer
            // reads in order to save a charge, which is not a saving.
            expect(foldableCaption('whatsapp', 'image', 'x'.repeat(MAX_NATIVE_CAPTION))).toHaveLength(1024);
            expect(foldableCaption('whatsapp', 'image', 'x'.repeat(MAX_NATIVE_CAPTION + 1))).toBeNull();
        });

        it('is not fooled by whitespace', () => {
            expect(foldableCaption('whatsapp', 'image', '   ')).toBeNull();
            expect(foldableCaption('whatsapp', 'image', undefined)).toBeNull();
            expect(foldableCaption('whatsapp', 'image', '  hola  ')).toBe('hola');
        });
    });

    describe('what each transport actually puts on the wire', () => {
        // Driven through `sendStrict` with a stubbed `fetch`, so what is asserted
        // is the request body the provider would receive — not a private method's
        // return value, and not a restatement of the rule.
        const whatsapp = new WhatsAppAdapter({ get: () => 'v21.0' } as any);
        const telegram = new TelegramAdapter({ get: () => undefined } as any);
        const messenger = new MessengerAdapter({ get: () => undefined } as any);

        let sent: any[];
        beforeEach(() => {
            sent = [];
            (global as any).fetch = jest.fn(async (_url: string, init: any) => {
                sent.push(JSON.parse(init.body));
                return { status: 200, json: async () => ({ messages: [{ id: 'wamid.OUT' }],
                    result: { message_id: 7 }, message_id: 'mid.OUT' }) } as any;
            });
        });
        afterEach(() => { delete (global as any).fetch; });

        const send = (adapter: any, payload: Record<string, unknown>) =>
            adapter.sendStrict({ itemKind: 'media', to: 'psid-1', channelAccountId: 'acct-1', payload }, 'token');

        it('WhatsApp attaches the caption to the image itself', async () => {
            await send(whatsapp, { mediaUrl: 'https://cdn.test/a.jpg', caption: 'Mira' });
            expect(sent).toHaveLength(1);
            expect(sent[0].image).toEqual({ link: 'https://cdn.test/a.jpg', caption: 'Mira' });
        });

        it('WhatsApp sends no caption field on audio, which Meta would reject', async () => {
            await send(whatsapp, { mediaUrl: 'https://cdn.test/a.ogg', mediaType: 'audio', caption: 'Escuchá' });
            expect(sent[0].audio).not.toHaveProperty('caption');
            expect(JSON.stringify(sent[0])).not.toContain('Escuchá');
        });

        it('WhatsApp sends no caption field when there is none', async () => {
            await send(whatsapp, { mediaUrl: 'https://cdn.test/a.jpg' });
            expect(sent[0].image).not.toHaveProperty('caption');
        });

        it('Telegram attaches the caption and says how to render it', async () => {
            await send(telegram, { mediaUrl: 'https://cdn.test/a.jpg', caption: 'Mira' });
            expect(sent).toHaveLength(1);
            expect(sent[0]).toMatchObject({ caption: 'Mira', parse_mode: 'HTML' });
        });

        it('Telegram sends no parse_mode when there is no caption', async () => {
            await send(telegram, { mediaUrl: 'https://cdn.test/a.jpg' });
            expect(sent[0]).not.toHaveProperty('caption');
            expect(sent[0]).not.toHaveProperty('parse_mode');
        });

        it('Messenger ignores a caption on the payload, because it cannot carry one', async () => {
            // The batch builder never gives it one; if it ever did, the transport
            // must not quietly bundle two effects behind one acceptance.
            await send(messenger, { mediaUrl: 'https://cdn.test/a.jpg', caption: 'Mira' });
            expect(sent).toHaveLength(1);
            expect(JSON.stringify(sent[0])).not.toContain('Mira');
        });
    });
});
