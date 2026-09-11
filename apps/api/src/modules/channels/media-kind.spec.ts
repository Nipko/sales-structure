import { WhatsAppAdapter } from './whatsapp/whatsapp.adapter';
import { TelegramAdapter } from './telegram/telegram.adapter';
import { buildDispatchItems } from './dispatch-items';
import { mediaKindFor } from './media-kind';
import { foldableCaption, renderedCaptionLength, MAX_NATIVE_CAPTION } from './native-caption';
import { compactTurnAnswer, countTurnEffects, toDispatchTurnOutput } from '../conversations/turn-outcome-effects';

/**
 * ═══ AN AUDIO NOTE IS NOT A PHOTO ═══
 *
 * Nothing carried a media kind. Tools returned `{url, caption}`, the turn sink
 * kept `{url, caption}`, `toDispatchTurnOutput` copied `{url, caption}`, and the
 * batch builder read the absent field as `image`. So a voice note, a video or a
 * PDF left declared as a photo — Meta rejects that payload, and the caption
 * folded onto it went down with it, because `image` accepts a caption and
 * `audio` does not.
 */
describe('the kind of an attachment survives to the transport', () => {
    describe('deriving it', () => {
        it.each([
            ['https://cdn.test/a.jpg', 'image'],
            ['https://cdn.test/a.png', 'image'],
            ['https://cdn.test/a.mp4', 'video'],
            ['https://cdn.test/a.ogg', 'audio'],
            ['https://cdn.test/a.opus', 'audio'],
            ['https://cdn.test/a.pdf', 'document'],
            ['https://cdn.test/a.docx', 'document'],
        ])('reads %s as %s', (url, kind) => {
            expect(mediaKindFor(url)).toBe(kind);
        });

        it('lets a caller that knows override the filename', () => {
            expect(mediaKindFor('https://cdn.test/a.jpg', 'document')).toBe('document');
            // But not with a kind no transport has.
            expect(mediaKindFor('https://cdn.test/a.mp4', 'sticker')).toBe('video');
        });

        it('ignores a signed URL\'s query string, which every CDN adds', () => {
            // Matching the extension against `…?X-Amz-Signature=…` finds nothing
            // and calls every signed attachment a photo.
            expect(mediaKindFor('https://cdn.test/a.ogg?X-Amz-Signature=deadbeef&x=1')).toBe('audio');
            expect(mediaKindFor('https://cdn.test/a.pdf#page=2')).toBe('document');
        });

        it('falls back to image, which is what every transport already assumed', () => {
            expect(mediaKindFor('https://cdn.test/no-extension')).toBe('image');
            expect(mediaKindFor(undefined)).toBe('image');
        });
    });

    describe('carrying it through the batch', () => {
        const answer = (url: string, caption?: string) => ({
            chunks: [], paymentLinks: [], media: [{ url, ...(caption ? { caption } : {}) }],
        });

        it.each([
            ['https://cdn.test/a.mp4', 'video'],
            ['https://cdn.test/a.ogg', 'audio'],
            ['https://cdn.test/a.pdf', 'document'],
        ])('commits %s as %s, not as an image', (url, kind) => {
            const compacted = compactTurnAnswer(answer(url, 'mira esto'),
                { lane: 'durable', channelType: 'whatsapp' });
            const items = buildDispatchItems(toDispatchTurnOutput(compacted) as any,
                { channelType: 'whatsapp' });
            const media = items.find(item => item.kind === 'media')!;
            expect((media.payload as any).mediaType).toBe(kind);
        });

        it('keeps the caption separate for an audio, because Meta has no field for it', async () => {
            // The count and the batch have to agree about this, or the platform
            // reports a saving it did not make.
            const source = answer('https://cdn.test/a.ogg', 'escuchá esto');
            const compacted = compactTurnAnswer(source, { lane: 'durable', channelType: 'whatsapp' });
            const items = buildDispatchItems(toDispatchTurnOutput(compacted) as any,
                { channelType: 'whatsapp' });
            expect(items.map(item => item.kind)).toEqual(['media', 'text']);
            expect(countTurnEffects(source as any, { lane: 'durable', channelType: 'whatsapp' })).toBe(2);
        });

        it('folds the caption for a video, which Meta does carry', () => {
            const source = answer('https://cdn.test/a.mp4', 'mirá esto');
            const compacted = compactTurnAnswer(source, { lane: 'durable', channelType: 'whatsapp' });
            const items = buildDispatchItems(toDispatchTurnOutput(compacted) as any,
                { channelType: 'whatsapp' });
            expect(items.map(item => item.kind)).toEqual(['media']);
            expect(countTurnEffects(source as any, { lane: 'durable', channelType: 'whatsapp' })).toBe(1);
        });
    });

    describe('what the transports actually send', () => {
        let sent: any[];
        beforeEach(() => {
            sent = [];
            (global as any).fetch = jest.fn(async (url: string, init: any) => {
                sent.push({ url, body: JSON.parse(init.body) });
                return { status: 200, json: async () => ({ messages: [{ id: 'wamid' }], result: { message_id: 7 } }) } as any;
            });
        });
        afterEach(() => { delete (global as any).fetch; });

        it('declares the audio to Meta as audio', async () => {
            const adapter = new WhatsAppAdapter({ get: () => 'v21.0' } as any);
            await adapter.sendStrict({ itemKind: 'media', to: '57300', channelAccountId: 'a',
                payload: { mediaUrl: 'https://cdn.test/a.ogg', mediaType: 'audio' } }, 'token');
            expect(sent[0].body.type).toBe('audio');
        });

        it('picks the Telegram method from the kind the item declares', async () => {
            const adapter = new TelegramAdapter({ get: () => undefined } as any);
            await adapter.sendStrict({ itemKind: 'media', to: '99', channelAccountId: 'a',
                payload: { mediaUrl: 'https://cdn.test/a.pdf', mediaType: 'document' } }, 'bot');
            expect(sent[0].url).toContain('/sendDocument');
        });
    });

    /**
     * ═══ WHICH OF THREE LENGTHS TELEGRAM MEANS ═══
     *
     * These tests used to assert the ESCAPED length, on the belief that a
     * caption of 1 024 ampersands — 5 120 characters of payload — would be
     * rejected. Telegram's documentation says otherwise, in as many words:
     * "0-1024 characters AFTER ENTITIES PARSING". `&amp;` is one character to
     * Telegram, and so is `&`.
     *
     * The old rule never rejected anything; it declined a fold the caption was
     * entitled to, so the picture and its words arrived as two messages instead
     * of one. On a channel nobody bills that is a worse-looking conversation;
     * on a billed one it is a second charge — and it failed quietly, which is
     * why it survived.
     *
     * The detailed boundary cases live in `telegram-parsed-length.spec.ts`.
     */
    describe('the Telegram caption limit is measured the way Telegram measures it', () => {
        it('counts an escaped character as the one it becomes, not the five it costs', () => {
            const raw = '&'.repeat(300);
            expect(renderedCaptionLength('telegram', raw)).toBe(raw.length);
            expect(renderedCaptionLength('whatsapp', raw)).toBe(raw.length);
        });

        it('does not count the markup it parses away', () => {
            // `**negrita**` is eleven characters of markdown and seven of
            // message. Measuring the markdown declines folds unnecessarily.
            expect(renderedCaptionLength('telegram', '**negrita**')).toBe(7);
        });

        it('folds a caption of 1024 ampersands, which the old rule measured as 5120', () => {
            const raw = '&'.repeat(MAX_NATIVE_CAPTION);
            expect(raw.length).toBe(MAX_NATIVE_CAPTION);
            expect(foldableCaption('telegram', 'image', raw)).toBe(raw);
            expect(foldableCaption('whatsapp', 'image', raw)).toBe(raw);
        });

        it('still folds a plain caption of the same length', () => {
            const plain = 'a'.repeat(MAX_NATIVE_CAPTION);
            expect(foldableCaption('telegram', 'image', plain)).toBe(plain);
        });

        it('still refuses one that is genuinely over the limit', () => {
            // The measure changed; the ceiling did not.
            expect(foldableCaption('telegram', 'image', 'a'.repeat(MAX_NATIVE_CAPTION + 1)))
                .toBeNull();
        });

        it('sends the picture and its words as ONE effect', () => {
            const items = buildDispatchItems({
                media: [{ url: 'https://cdn.test/a.jpg', caption: '&'.repeat(MAX_NATIVE_CAPTION) }],
            }, { channelType: 'telegram' });
            expect(items.map(item => item.kind)).toEqual(['media']);
        });

        it('keeps the caption as its own effect when it really does not fit', () => {
            const items = buildDispatchItems({
                media: [{ url: 'https://cdn.test/a.jpg',
                    caption: 'a'.repeat(MAX_NATIVE_CAPTION + 1) }],
            }, { channelType: 'telegram' });
            expect(items.map(item => item.kind)).toEqual(['media', 'text']);
        });
    });
});
