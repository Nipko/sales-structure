import { buildDispatchItems } from '../channels/dispatch-items';
import {
    compactTurnAnswer, countTurnEffects, textLimitFor, toDispatchTurnOutput,
    type TurnAnswer,
} from './turn-outcome-effects';

/**
 * What one answer costs, measured rather than asserted.
 *
 * Every "we reduced the number of messages" claim in this change is a number
 * produced here. The counter is checked against the real batch builder in the
 * same file, so a count that drifts from what the outbox actually commits fails
 * instead of flattering us.
 */

const answer = (over: Partial<TurnAnswer> = {}): TurnAnswer => ({
    chunks: [], paymentLinks: [], media: [], ...over,
});

/** The shape a sales turn with a link and a photo actually has. */
const TYPICAL: TurnAnswer = answer({
    chunks: ['Claro, el corte de cabello cuesta $45.000 y tengo cupo mañana a las 3 PM.'],
    paymentLinks: ['https://checkout.wompi.co/l/VPOS_aBcD12'],
    media: [{ url: 'https://cdn.example/salon.webp', caption: 'Así queda el corte' }],
});

describe('what one answer costs today', () => {
    it('counts three separate charges for one sales turn on the durable lane', () => {
        // words + link + captioned picture. It was four while the caption was
        // split off on every channel; WhatsApp bills a captioned attachment as
        // one message, so that split was a charge for nothing.
        expect(countTurnEffects(TYPICAL, { lane: 'durable', channelType: 'whatsapp' })).toBe(3);
    });

    it('still counts four where the provider really does need two requests', () => {
        // Messenger performs two POSTs behind one call and returns only the last
        // id. Pretending otherwise would under-report the bill, not save money.
        expect(countTurnEffects(TYPICAL, { lane: 'durable', channelType: 'messenger' })).toBe(4);
    });

    it('counts three on the legacy lane, because the caption rides on the picture', () => {
        expect(countTurnEffects(TYPICAL, { lane: 'legacy', channelType: 'whatsapp' })).toBe(3);
    });

    it('agrees with the batch the outbox would actually commit', () => {
        // The counter is only worth having if it matches the producer. This is
        // the assertion that keeps them together.
        // On both a channel that folds and one that does not, because the two
        // functions now share a decision and a shared decision is exactly what
        // can be got wrong in one place and right in the other.
        for (const channelType of ['whatsapp', 'telegram', 'messenger', 'instagram']) {
            const items = buildDispatchItems({
                textChunks: [...TYPICAL.chunks],
                paymentLinks: [...TYPICAL.paymentLinks],
                media: TYPICAL.media.map(entry => ({ url: entry.url, caption: entry.caption })),
            }, { channelType });
            expect({ channelType, items: items.length })
                .toEqual({ channelType,
                    items: countTurnEffects(TYPICAL, { lane: 'durable', channelType }) });
        }
    });

    it('does not bill a Flow twice by adding the words it already carries', () => {
        const withFlow = answer({ chunks: ['ignored'], flow: { flowId: 'f', flowToken: 't' } });
        expect(countTurnEffects(withFlow, { lane: 'durable', channelType: 'whatsapp' })).toBe(1);
    });

    it('counts an old three-bubble envelope as three charges', () => {
        // Envelopes split by the previous policy exist in the ledger. They are
        // the reason merging is worth implementing at all.
        const old = answer({ chunks: ['uno', 'dos', 'tres'] });
        expect(countTurnEffects(old, { lane: 'durable', channelType: 'whatsapp' })).toBe(3);
    });
});

describe('what it costs after compaction', () => {
    it('turns the sales turn into one message plus its captioned picture', () => {
        const result = compactTurnAnswer(TYPICAL, { lane: 'durable', channelType: 'whatsapp' });
        // Three before, two after: the link folds into the words, and the
        // caption already travels on the picture.
        expect(result.before).toBe(3);
        expect(result.after).toBe(2);
        expect(result.answer.chunks[0]).toContain('https://checkout.wompi.co/l/VPOS_aBcD12');
        expect(result.answer.paymentLinks).toEqual([]);
    });

    it('turns the three-charge legacy turn into two', () => {
        // The legacy producer already carried the caption on the picture, so
        // the saving there is the link alone.
        const result = compactTurnAnswer(TYPICAL, { lane: 'legacy', channelType: 'whatsapp' });
        expect(result.before).toBe(3);
        expect(result.after).toBe(2);
    });

    it('appends the canonical URL verbatim — the server types it, not the model', () => {
        const url = 'https://checkout.wompi.co/l/VPOS_aBcD12?ref=abc%2Fdef';
        const result = compactTurnAnswer(answer({ chunks: ['Aquí tienes el enlace:'], paymentLinks: [url] }),
            { lane: 'durable', channelType: 'whatsapp' });
        // Character for character. A URL a model retyped is the failure this
        // whole rule has to stay clear of.
        expect(result.answer.chunks[0].endsWith(url)).toBe(true);
    });

    it('keeps the folded bubble on the payment_link item so its provenance survives', () => {
        const result = compactTurnAnswer(TYPICAL, { lane: 'durable', channelType: 'whatsapp' });
        const items = buildDispatchItems(toDispatchTurnOutput(result) as any,
            { channelType: 'whatsapp' });
        const kinds = items.map(item => item.kind);
        // One text-shaped message carrying the words AND the canonical URL, and
        // it is not typed `text`: the kind is what a later dispute reads.
        expect(kinds).toEqual(['payment_link', 'media']);
        // And the caption is on the picture rather than gone.
        expect((items[1].payload as any).caption).toBe('Así queda el corte');
        expect(items).toHaveLength(result.after);
        expect((items[0].payload as any).text).toContain('https://checkout.wompi.co/l/VPOS_aBcD12');
    });

    it('merges bubbles an older policy split, and says how many it saved', () => {
        const result = compactTurnAnswer(answer({ chunks: ['uno', 'dos', 'tres'] }),
            { lane: 'durable', channelType: 'whatsapp' });
        expect(result.after).toBe(1);
        expect(result.notes.find(entry => entry.rule === 'merge_bubbles'))
            .toMatchObject({ applied: true, saved: 2 });
    });

    it('drops the separate effect when the link is already in the words', () => {
        const url = 'https://checkout.wompi.co/l/VPOS_aBcD12';
        const result = compactTurnAnswer(
            answer({ chunks: [`Pagá acá: ${url}`], paymentLinks: [url] }),
            { lane: 'durable', channelType: 'whatsapp' });
        expect(result.before).toBe(2);
        expect(result.after).toBe(1);
        // The customer sees exactly what they saw before: the URL once.
        expect(result.answer.chunks[0]).toBe(`Pagá acá: ${url}`);
    });
});

describe('the compactions it refuses, and why', () => {
    it('never recompacts a recovered envelope', () => {
        const result = compactTurnAnswer(answer({ chunks: ['uno', 'dos'], paymentLinks: ['https://x.test/1'] }),
            { lane: 'durable', channelType: 'whatsapp', recovered: true });
        expect(result.after).toBe(result.before);
        expect(result.answer.chunks).toEqual(['uno', 'dos']);
        for (const entry of result.notes) {
            expect(entry).toMatchObject({ applied: false, reason: 'recovered_envelope_keeps_its_shape' });
        }
    });

    it('refuses a merge that would exceed what WhatsApp accepts', () => {
        const limit = textLimitFor('whatsapp');
        const half = 'a'.repeat(Math.ceil(limit * 0.6));
        const result = compactTurnAnswer(answer({ chunks: [half, half] }),
            { lane: 'durable', channelType: 'whatsapp' });
        expect(result.after).toBe(2);
        expect(result.notes.find(entry => entry.rule === 'merge_bubbles'))
            .toMatchObject({ applied: false, reason: 'merged_body_exceeds_channel_limit' });
    });

    it('refuses to fold a link into a body that has no room for it', () => {
        const body = 'b'.repeat(textLimitFor('whatsapp'));
        const result = compactTurnAnswer(answer({ chunks: [body], paymentLinks: ['https://x.test/1'] }),
            { lane: 'durable', channelType: 'whatsapp' });
        expect(result.after).toBe(2);
        expect(result.notes.find(entry => entry.rule === 'link_into_last_bubble'))
            .toMatchObject({ applied: false, reason: 'body_plus_link_exceeds_channel_limit' });
    });

    it('respects Instagram\'s much shorter body instead of WhatsApp\'s', () => {
        const body = 'c'.repeat(900);
        const result = compactTurnAnswer(answer({ chunks: [body], paymentLinks: ['https://x.test/1'] }),
            { lane: 'durable', channelType: 'instagram' });
        expect(result.after).toBe(2);
    });

    it('records the caption fold where the provider bills it as one message', () => {
        const result = compactTurnAnswer(TYPICAL, { lane: 'durable', channelType: 'whatsapp' });
        expect(result.notes.find(entry => entry.rule === 'caption_onto_media'))
            .toMatchObject({ applied: true, reason: 'caption_delivered_with_its_attachment', saved: 1 });
    });

    it('refuses the fold on a media kind the provider gives no caption field', () => {
        // Meta rejects a caption on audio, and a rejected payload is zero
        // messages rather than one cheap one.
        const result = compactTurnAnswer(
            answer({ media: [{ url: 'https://cdn.test/a.ogg', mediaType: 'audio', caption: 'hola' }] }),
            { lane: 'durable', channelType: 'whatsapp' });
        expect(result.notes.find(entry => entry.rule === 'caption_onto_media'))
            .toMatchObject({ applied: false, reason: 'media_kind_has_no_caption_field' });
    });

    it('refuses the fold for a caption longer than the provider accepts', () => {
        const result = compactTurnAnswer(
            answer({ media: [{ url: 'https://cdn.test/a.jpg', caption: 'x'.repeat(1025) }] }),
            { lane: 'durable', channelType: 'whatsapp' });
        expect(result.notes.find(entry => entry.rule === 'caption_onto_media'))
            .toMatchObject({ applied: false, reason: 'caption_longer_than_the_provider_accepts' });
    });

    it('says Messenger needs two requests rather than pretending it does not', () => {
        const result = compactTurnAnswer(answer({ media: [{ url: 'https://cdn.test/a', caption: 'hola' }] }),
            { lane: 'durable', channelType: 'messenger' });
        expect(result.notes.find(entry => entry.rule === 'caption_onto_media'))
            .toMatchObject({ applied: false, reason: 'channel_needs_two_requests_for_a_caption' });
    });

    it('does not extend a Flow body with a link that is not ours to put there', () => {
        const result = compactTurnAnswer(
            answer({ flow: { flowId: 'f', flowToken: 't' }, paymentLinks: ['https://x.test/1'] }),
            { lane: 'durable', channelType: 'whatsapp' });
        expect(result.answer.paymentLinks).toEqual(['https://x.test/1']);
        expect(result.notes.find(entry => entry.rule === 'link_into_last_bubble'))
            .toMatchObject({ applied: false, reason: 'flow_body_is_not_ours_to_extend' });
    });

    it('keeps a link that has no words to travel with as its own message', () => {
        const result = compactTurnAnswer(answer({ paymentLinks: ['https://x.test/1'] }),
            { lane: 'durable', channelType: 'whatsapp' });
        expect(result.after).toBe(1);
        expect(result.answer.paymentLinks).toEqual(['https://x.test/1']);
    });

    it('folds only the links that fit, and keeps the rest in order', () => {
        const body = 'd'.repeat(textLimitFor('whatsapp') - 40);
        const first = 'https://x.test/1';
        const second = 'https://x.test/2222222222222222222222222';
        const result = compactTurnAnswer(answer({ chunks: [body], paymentLinks: [first, second] }),
            { lane: 'durable', channelType: 'whatsapp' });
        expect(result.answer.chunks[0]).toContain(first);
        expect(result.answer.paymentLinks).toEqual([second]);
        expect(result.after).toBe(2);
    });
});
