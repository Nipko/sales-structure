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
    it('counts four separate charges for one sales turn on the durable lane', () => {
        // words + link + picture + caption. One thing said, four messages billed.
        expect(countTurnEffects(TYPICAL, { lane: 'durable', channelType: 'whatsapp' })).toBe(4);
    });

    it('counts three on the legacy lane, because the caption rides on the picture', () => {
        expect(countTurnEffects(TYPICAL, { lane: 'legacy', channelType: 'whatsapp' })).toBe(3);
    });

    it('agrees with the batch the outbox would actually commit', () => {
        // The counter is only worth having if it matches the producer. This is
        // the assertion that keeps them together.
        const items = buildDispatchItems({
            textChunks: [...TYPICAL.chunks],
            paymentLinks: [...TYPICAL.paymentLinks],
            media: TYPICAL.media.map(entry => ({ url: entry.url, caption: entry.caption })),
        });
        expect(items).toHaveLength(countTurnEffects(TYPICAL, { lane: 'durable', channelType: 'whatsapp' }));
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
    it('turns the four-charge sales turn into three', () => {
        const result = compactTurnAnswer(TYPICAL, { lane: 'durable', channelType: 'whatsapp' });
        expect(result.before).toBe(4);
        expect(result.after).toBe(3);
        expect(result.answer.chunks[0]).toContain('https://checkout.wompi.co/l/VPOS_aBcD12');
        expect(result.answer.paymentLinks).toEqual([]);
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
        const items = buildDispatchItems(toDispatchTurnOutput(result) as any);
        const kinds = items.map(item => item.kind);
        // One text-shaped message carrying the words AND the canonical URL, and
        // it is not typed `text`: the kind is what a later dispute reads.
        expect(kinds).toEqual(['payment_link', 'media', 'text']);
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

    it('leaves a caption where the durable lane cannot carry it, and records the reason', () => {
        const result = compactTurnAnswer(TYPICAL, { lane: 'durable', channelType: 'whatsapp' });
        expect(result.notes.find(entry => entry.rule === 'caption_onto_media'))
            .toMatchObject({ applied: false, reason: 'outbox_media_item_has_no_caption_field' });
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
