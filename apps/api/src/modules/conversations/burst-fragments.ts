/**
 * ═══ ONE BURST, ONE TURN — INCLUDING THE PHOTOS ═══
 *
 * People do not write one message. They write "hola", "mirá", a photo, another
 * photo, "esto me llegó roto". Five inbound messages, one question.
 *
 * Text fragments were already buffered and answered as a single turn. Media was
 * excluded — `media/buttons are distinct turns — no debounce` — so those five
 * became three turns: one for the merged text and one for each photo. Three
 * answers to one question, and from 1 October 2026 three charged WhatsApp
 * messages for it. The customer sees the agent reply about the first photo
 * before they have finished sending the second.
 *
 * ── WHY TEXT AND MEDIA SHARE ONE BUFFER ─────────────────────────────────────
 *
 * Because the intent is split across them. "esto me llegó roto" is meaningless
 * without the photo, and the photo is ambiguous without the sentence. Two
 * separate buffers would flush independently and hand the model each half
 * without the other — the conflation this module exists to avoid, wearing the
 * opposite mask.
 *
 * So one ordered list of fragments, drained together, and the ORDER is kept:
 * "the second one" means nothing if the photos arrive shuffled.
 *
 * ── WHAT IS DELIBERATELY NOT BUFFERED ───────────────────────────────────────
 *
 * A button press, a list selection and a Flow completion are answers to a
 * question the agent just asked. They are not fragments of a thought; merging
 * one into a burst would make the agent answer a menu choice with a paragraph
 * about the photo that arrived beside it. They stay their own turn, exactly as
 * before.
 */

export type BurstFragment =
    | { readonly kind: 'text'; readonly text: string }
    | {
        readonly kind: 'media';
        /** `image`, `audio`, `video`, `document`. */
        readonly type: string;
        readonly mediaUrl?: string | null;
        readonly mediaId?: string | null;
        readonly mimeType?: string | null;
        readonly filename?: string | null;
        /** What the customer typed on the attachment itself. */
        readonly caption?: string | null;
    };

/** Anything that can be merged; anything else stays its own turn. */
export function fragmentFor(content: {
    type?: string; text?: string; caption?: string;
    mediaUrl?: string; mediaId?: string; mimeType?: string; filename?: string;
    interactiveReply?: unknown;
} | null | undefined): BurstFragment | null {
    if (!content) return null;
    // An interactive reply answers a question the agent asked. It is not a
    // fragment of a thought, and merging it would have the agent answer a menu
    // choice with a paragraph about the photo beside it.
    if (content.interactiveReply) return null;
    if (content.type === 'text') {
        const text = String(content.text ?? '');
        return text ? { kind: 'text', text } : null;
    }
    if (!MERGEABLE_MEDIA.has(String(content.type ?? ''))) return null;
    return {
        kind: 'media',
        type: String(content.type),
        mediaUrl: content.mediaUrl ?? null,
        mediaId: content.mediaId ?? null,
        mimeType: content.mimeType ?? null,
        filename: content.filename ?? null,
        caption: content.caption ?? null,
    };
}

const MERGEABLE_MEDIA = new Set(['image', 'audio', 'video', 'document']);

export interface MergedBurst {
    /** Every text the customer typed, in order, captions included. */
    readonly text: string;
    /** Every attachment, in order. Empty for a text-only burst. */
    readonly media: readonly Extract<BurstFragment, { kind: 'media' }>[];
    /** How many inbound messages this turn is answering. */
    readonly fragments: number;
}

/**
 * Fold an ordered burst into the one turn it always was.
 *
 * Consecutive identical lines collapse, which is not cosmetic: a turn that had
 * to give its conversation lock back returns its merged burst to the buffer and
 * the retry appends its own text again, so the last fragment would be read
 * twice. The same rule now covers a caption repeated on three photos, which is
 * what a phone does when somebody selects three images and types once.
 *
 * Attachments are de-duplicated by identity rather than by position: WhatsApp
 * redelivers, and two records for one photo would be described to the model
 * twice and counted twice by the media throttle.
 */
export function mergeBurst(fragments: readonly BurstFragment[]): MergedBurst {
    const lines: string[] = [];
    const media: Extract<BurstFragment, { kind: 'media' }>[] = [];
    const seen = new Set<string>();

    for (const fragment of fragments) {
        if (fragment.kind === 'text') {
            lines.push(...fragment.text.split('\n'));
            continue;
        }
        const identity = fragment.mediaId || fragment.mediaUrl || '';
        // No identity at all means it cannot be proved a duplicate, and dropping
        // it would lose a photo. Kept: describing one twice is cheaper than
        // never seeing it.
        if (identity && seen.has(identity)) continue;
        if (identity) seen.add(identity);
        media.push(fragment);
        if (fragment.caption) lines.push(...String(fragment.caption).split('\n'));
    }

    const deduped = lines.filter((line, index) =>
        index === 0 || line.trim() !== lines[index - 1].trim());
    return Object.freeze({
        text: deduped.join('\n').trim(),
        media: Object.freeze(media),
        fragments: fragments.length,
    });
}

/**
 * What the flushing message should look like once the burst is folded in.
 *
 * The merged turn keeps the type of the LAST fragment, because that is the
 * message the customer just sent and the one the pipeline is already holding.
 * A burst ending in text is a text turn carrying attachments; a burst ending in
 * a photo is a media turn carrying everything typed around it.
 */
export function foldedContent(last: BurstFragment | null, merged: MergedBurst): {
    readonly type: string;
    readonly text: string;
    readonly mediaBurst: readonly Extract<BurstFragment, { kind: 'media' }>[];
} {
    const type = last?.kind === 'media' && merged.media.length ? last.type : 'text';
    return Object.freeze({ type, text: merged.text, mediaBurst: merged.media });
}
