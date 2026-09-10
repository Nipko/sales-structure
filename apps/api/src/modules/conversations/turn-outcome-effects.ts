/**
 * How many separate charges one answer becomes, and how to make it fewer.
 *
 * From 1 October 2026 Meta bills a delivered WhatsApp service message. The unit
 * is the message, not the answer, so the same reply costs whatever the pipeline
 * decided to split it into. Today one turn that says something, hands over a
 * payment link and attaches a photo leaves as four separate messages on the
 * durable lane and three on the legacy one — for one thing the agent said.
 *
 * This file does two jobs, both pure:
 *
 *   · `countTurnEffects` says what an answer costs on a given lane. It exists so
 *     that "we reduced the number of effects" is a measurement rather than a
 *     claim, and so a change that quietly adds one fails a test.
 *   · `compactTurnAnswer` folds what the transport can genuinely carry in one
 *     message into one message, and refuses everything else.
 *
 * ── WHAT IT WILL NOT DO ─────────────────────────────────────────────────────
 *
 * Compaction that changes what the customer receives is not a saving, it is a
 * defect with a smaller bill. Three refusals are deliberate and permanent:
 *
 *   1. **A recovered envelope is never recompacted.** An answer already recorded
 *      — or worse, already committed as a batch — is recovered under the
 *      contract it was written with. Rewriting it would change the identity of
 *      effects a customer may already have started receiving.
 *   2. **A caption is not folded where the provider would bill it twice.**
 *      WhatsApp and Telegram deliver a captioned attachment as ONE message, so
 *      folding there costs nothing and saves a charge. Messenger and Instagram
 *      genuinely perform two POSTs behind one call and return only the last id,
 *      so the split stays: one acceptance has to mean exactly one effect.
 *      `native-caption.ts` is the single place that draws that line, and this
 *      file asks it rather than repeating it.
 *   3. **Nothing merges past the channel's own limit.** A body WhatsApp rejects
 *      is not one cheaper message, it is zero messages and an error. The same
 *      goes for a caption past 1,024 characters, and it is never truncated to
 *      fit: a shorter message the customer did not ask for is not a saving.
 *
 * The link fold is the one that pays, and it has a condition the model cannot
 * satisfy: the URL is inserted **by the server, verbatim from the tool receipt**.
 * The model never retypes it, and the item keeps the `payment_link` kind so its
 * provenance survives the fold.
 */

import { carriesNativeCaption, foldableCaption, NATIVE_CAPTION_CHANNELS } from '../channels/native-caption';

/** What one turn decided to say, before it becomes transport effects. */
export interface TurnAnswer {
    /** Reply bubbles, in the order the customer should read them. */
    readonly chunks: readonly string[];
    /** Canonical URLs from tool receipts. Never a URL the model typed. */
    readonly paymentLinks: readonly string[];
    /**
     * Attachments the model asked for by id, with their captions.
     *
     * `mediaType` is here because whether a caption is a second effect depends
     * on it: WhatsApp carries a caption on an image, a video and a document, and
     * rejects one on audio. Absent means `image`, which is what both transports
     * already default an unnamed type to.
     */
    readonly media: readonly {
        readonly url: string; readonly caption?: string; readonly mediaType?: string | null;
    }[];
    /** An interactive form, which can be the whole of what a turn produced. */
    readonly flow?: unknown | null;
}

/**
 * Which delivery path will carry it.
 *
 * The two lanes used to cost different amounts for the same answer: the durable
 * outbox split every caption from its attachment for a receipt it could trust,
 * which cost one extra message per picture even on the channels that bill a
 * captioned attachment as one. They now agree wherever the provider does, and
 * differ only where it genuinely takes two requests.
 */
export type DeliveryLane = 'durable' | 'legacy';


/**
 * The most a single text body may carry.
 *
 * WhatsApp rejects a body over 4096 characters. The margin is not superstition:
 * `toWhatsAppFormatting` rewrites markdown on the way out and can add
 * characters, and a rejection costs the whole message.
 */
export const CHANNEL_TEXT_LIMIT: Readonly<Record<string, number>> = Object.freeze({
    whatsapp: 4096,
    telegram: 4096,
    instagram: 1000,
    messenger: 2000,
    web_widget: 32000,
});
const DEFAULT_TEXT_LIMIT = 1000;
const SAFETY_MARGIN = 96;

export function textLimitFor(channelType: string): number {
    return Math.max(0, (CHANNEL_TEXT_LIMIT[channelType] ?? DEFAULT_TEXT_LIMIT) - SAFETY_MARGIN);
}

/**
 * How many separate remote effects this answer becomes.
 *
 * Mirrors what the two producers actually do rather than what they ought to:
 * `buildDispatchItems` for the durable lane, and the three loops in
 * `ConversationsService` for the legacy one. A change to either that this
 * function does not follow is a change that costs money nobody counted.
 */
export function countTurnEffects(answer: TurnAnswer, options: {
    lane: DeliveryLane; channelType: string;
}): number {
    // A Flow replaces the turn's words: sending both would show the customer the
    // same thing twice, and both producers already know that.
    const textEffects = answer.flow ? 1 : answer.chunks.filter(chunk => chunk.trim()).length;
    const linkEffects = new Set(answer.paymentLinks.filter(link => link.trim())).size;
    const mediaEffects = answer.media.reduce((total, entry) => {
        if (!entry.url?.trim()) return total;
        if (options.lane === 'legacy') return total + 1; // caption rides along
        // On the durable lane the caption rides along too, but only where the
        // provider bills the result as one message. `foldableCaption` is the one
        // function that decides; asking it here rather than repeating the rule
        // is what stops this count from reporting a saving the transport did not
        // make — or missing one it did.
        if (foldableCaption(options.channelType, entry.mediaType, entry.caption)) return total + 1;
        return total + 1 + (entry.caption && entry.caption.trim() ? 1 : 0);
    }, 0);
    return textEffects + linkEffects + mediaEffects;
}

/** A compaction that was applied, or one that was refused and why. */
export interface CompactionNote {
    readonly rule: 'link_into_last_bubble' | 'merge_bubbles' | 'caption_onto_media';
    readonly applied: boolean;
    /** Stable code. For a refusal, the reason — never what would be nice. */
    readonly reason: string;
    /** Effects saved by this rule. Zero for a refusal. */
    readonly saved: number;
}

export interface CompactedTurnAnswer {
    readonly answer: TurnAnswer;
    readonly notes: readonly CompactionNote[];
    /** Chunks whose text now ends in a canonical link, by index. */
    readonly linkCarryingChunks: readonly number[];
    readonly before: number;
    readonly after: number;
}

const note = (rule: CompactionNote['rule'], applied: boolean, reason: string, saved = 0): CompactionNote =>
    Object.freeze({ rule, applied, reason, saved });

/**
 * Fold this answer into as few messages as the transport can honestly carry.
 *
 * `recovered` is the switch that protects everything already committed: a turn
 * being replayed keeps the shape it was recorded with, because its effects may
 * already be identified, queued, or in the customer's hand.
 */
export function compactTurnAnswer(answer: TurnAnswer, options: {
    lane: DeliveryLane;
    channelType: string;
    /** True when these words come from a stored envelope rather than this turn. */
    recovered?: boolean;
}): CompactedTurnAnswer {
    const before = countTurnEffects(answer, options);
    const notes: CompactionNote[] = [];
    const limit = textLimitFor(options.channelType);

    if (options.recovered) {
        return Object.freeze({
            answer, before, after: before, linkCarryingChunks: Object.freeze([]),
            notes: Object.freeze([
                note('link_into_last_bubble', false, 'recovered_envelope_keeps_its_shape'),
                note('merge_bubbles', false, 'recovered_envelope_keeps_its_shape'),
                note('caption_onto_media', false, 'recovered_envelope_keeps_its_shape'),
            ]),
        });
    }

    let chunks = answer.chunks.filter(chunk => chunk.trim());
    const links = [...new Set(answer.paymentLinks.filter(link => link.trim()))];

    // ── 1. Merge bubbles that did not need to be separate ───────────────────
    //
    // Reaches an answer whose chunks were split by an older policy — those
    // envelopes exist — and never splits anything itself. Two paragraphs that
    // fit in one body were one message before anybody decided otherwise.
    if (answer.flow) {
        notes.push(note('merge_bubbles', false, 'flow_carries_its_own_body'));
    } else if (chunks.length <= 1) {
        notes.push(note('merge_bubbles', false, 'already_one_bubble'));
    } else {
        const merged = chunks.join('\n\n');
        if (merged.length <= limit) {
            const saved = chunks.length - 1;
            chunks = [merged];
            notes.push(note('merge_bubbles', true, 'whole_answer_fits_one_body', saved));
        } else {
            notes.push(note('merge_bubbles', false, 'merged_body_exceeds_channel_limit'));
        }
    }

    // ── 2. The canonical link, appended by the server to the last bubble ────
    //
    // The saving that matters, and the one with a real constraint: the URL is
    // copied verbatim from the tool receipt, and the item that carries it keeps
    // the `payment_link` kind, so the fold does not launder a model-written URL
    // into prose. A link already quoted in the words is not appended twice.
    const linkCarrying: number[] = [];
    let remainingLinks = links;
    if (!links.length) {
        notes.push(note('link_into_last_bubble', false, 'no_canonical_link_this_turn'));
    } else if (answer.flow) {
        notes.push(note('link_into_last_bubble', false, 'flow_body_is_not_ours_to_extend'));
    } else if (!chunks.length) {
        // The link IS the message. Folding it into nothing saves nothing.
        notes.push(note('link_into_last_bubble', false, 'no_words_to_carry_the_link'));
    } else {
        const target = chunks.length - 1;
        let body = chunks[target];
        const folded: string[] = [];
        for (const link of links) {
            if (body.includes(link)) {
                // Already in the words. Dropping the separate effect is still a
                // saving, and the customer sees no change at all.
                folded.push(link);
                continue;
            }
            const candidate = `${body}\n\n${link}`;
            if (candidate.length > limit) break; // and every later link too: order is kept
            body = candidate;
            folded.push(link);
        }
        if (folded.length) {
            chunks = [...chunks.slice(0, target), body];
            linkCarrying.push(target);
            remainingLinks = links.filter(link => !folded.includes(link));
            notes.push(note('link_into_last_bubble', true,
                folded.length === links.length ? 'server_appended_canonical_url'
                    : 'server_appended_what_fit_the_body', folded.length));
        } else {
            notes.push(note('link_into_last_bubble', false, 'body_plus_link_exceeds_channel_limit'));
        }
    }

    // ── 3. The caption on its attachment ────────────────────────────────────
    //
    // Applied where the provider bills the captioned attachment as ONE message,
    // refused everywhere else with the reason recorded rather than hidden. The
    // answer itself does not change here — the fold happens in
    // `buildDispatchItems`, which asks the same `foldableCaption` — so what this
    // reports and what the transport does cannot drift apart.
    const captioned = answer.media.filter(entry => entry.caption && entry.caption.trim());
    const foldable = captioned.filter(entry =>
        options.lane === 'durable' && foldableCaption(options.channelType, entry.mediaType, entry.caption));
    if (!captioned.length) {
        notes.push(note('caption_onto_media', false, 'no_captioned_attachment_this_turn'));
    } else if (options.lane === 'legacy') {
        notes.push(note('caption_onto_media', false, 'legacy_transport_already_carries_the_caption'));
    } else if (!foldable.length) {
        // Three distinct reasons, kept distinct: a channel that genuinely needs
        // two requests, a media kind the provider gives no caption field, and a
        // caption past 1,024 characters — which is not a cheaper message but a
        // rejected payload, and is never truncated to make it fit.
        notes.push(note('caption_onto_media', false,
            !carriesNativeCaption(options.channelType, captioned[0].mediaType)
                ? (NATIVE_CAPTION_CHANNELS.has(options.channelType)
                    ? 'media_kind_has_no_caption_field'
                    : 'channel_needs_two_requests_for_a_caption')
                : 'caption_longer_than_the_provider_accepts'));
    } else {
        notes.push(note('caption_onto_media', true, 'caption_delivered_with_its_attachment', foldable.length));
    }

    const compacted: TurnAnswer = Object.freeze({
        chunks: Object.freeze(chunks),
        paymentLinks: Object.freeze(remainingLinks),
        media: answer.media,
        ...(answer.flow ? { flow: answer.flow } : {}),
    });
    return Object.freeze({
        answer: compacted,
        notes: Object.freeze(notes),
        linkCarryingChunks: Object.freeze(linkCarrying),
        before,
        after: countTurnEffects(compacted, options),
    });
}

/**
 * The compacted answer in the shape the durable batch builder takes.
 *
 * The one subtlety, and the reason this is a function rather than a spread: a
 * bubble that now ends in a canonical URL is handed over as a `paymentLinks`
 * entry, not as text. `buildDispatchItems` gives those items the `payment_link`
 * kind, so the fold saves a message without laundering a receipt-issued URL
 * into text the model wrote — the provenance survives in the item's kind, where
 * admission and any later dispute can still read it. The ordering works out
 * because the builder emits links straight after the text, and the folded
 * bubble is the last one.
 */
export function toDispatchTurnOutput(compacted: CompactedTurnAnswer): {
    textChunks: string[]; paymentLinks: string[];
    media: { url: string; caption?: string | null }[]; flow?: unknown;
} {
    const { answer, linkCarryingChunks } = compacted;
    const carrying = new Set(linkCarryingChunks);
    return {
        textChunks: answer.chunks.filter((_, index) => !carrying.has(index)),
        paymentLinks: [
            ...answer.chunks.filter((_, index) => carrying.has(index)),
            ...answer.paymentLinks,
        ],
        media: answer.media.map(entry => ({ url: entry.url, caption: entry.caption })),
        ...(answer.flow ? { flow: answer.flow } : {}),
    };
}
