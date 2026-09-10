/**
 * When a caption and its attachment are ONE message, and when they are two.
 *
 * This is the only place that answers it, because four places have to agree:
 * `buildDispatchItems` decides whether to emit a separate text item, the
 * WhatsApp and Telegram strict transports decide whether to attach a caption,
 * and `countTurnEffects` reports what the turn cost. If any of them disagreed,
 * the platform would either send a caption twice, drop it silently, or report a
 * saving it did not make — and from 1 October 2026 that last one is a number in
 * somebody's Meta bill.
 *
 * ── WHY THIS IS SAFE FOR THE ONE-ACCEPTANCE-ONE-EFFECT RULE ─────────────────
 *
 * The durable outbox exists so that one acceptance from a provider means exactly
 * one effect the customer received. That is why the caption was split off in the
 * first place: Messenger and Instagram perform TWO POSTs behind one call and
 * return only the last id, so a caption that failed took the picture down with
 * it and the retry sent the picture again.
 *
 * On WhatsApp and Telegram a captioned attachment is not two effects wearing one
 * receipt — it is genuinely one message, billed once, acknowledged once. Folding
 * there does not weaken the rule; it stops paying for a split the transport never
 * needed. Messenger and Instagram keep the split, and this function is what keeps
 * that distinction from being re-litigated in four files.
 */

/** Channels whose media API carries the caption in the same request. */
export const NATIVE_CAPTION_CHANNELS: ReadonlySet<string> = new Set(['whatsapp', 'telegram']);

/**
 * Media kinds that accept a caption, per channel.
 *
 * WhatsApp accepts a caption on image, video and document and REJECTS one on
 * audio — a fold there would turn a working attachment into a rejected payload,
 * which is not a cheaper message but zero messages.
 */
const CAPTIONABLE_MEDIA: Readonly<Record<string, ReadonlySet<string>>> = {
    whatsapp: new Set(['image', 'video', 'document']),
    telegram: new Set(['image', 'video', 'document', 'audio']),
};

/**
 * The most a caption may carry before the fold stops being free.
 *
 * Both providers cap it at 1,024 characters. A longer caption is not a cheaper
 * message: it is a rejected payload. Past the limit the caption stays its own
 * item, which still arrives.
 */
export const MAX_NATIVE_CAPTION = 1024;

/** Whether this channel can deliver this attachment and its caption as one message. */
export function carriesNativeCaption(channelType?: string | null, mediaType?: string | null): boolean {
    const channel = String(channelType ?? '').trim().toLowerCase();
    if (!NATIVE_CAPTION_CHANNELS.has(channel)) return false;
    // `image` is the default the transports already apply to an unnamed type.
    const media = String(mediaType ?? 'image').trim().toLowerCase() || 'image';
    return CAPTIONABLE_MEDIA[channel]?.has(media) === true;
}

/**
 * The caption to fold, or `null` when it must stay a separate effect.
 *
 * Returns `null` — never a truncated string. Cutting a caption to fit would
 * change what the customer reads in order to save a message, which is the one
 * trade this whole module refuses to make.
 */
export function foldableCaption(
    channelType: string | null | undefined,
    mediaType: string | null | undefined,
    caption: string | null | undefined,
): string | null {
    const body = String(caption ?? '').trim();
    if (!body) return null;
    if (!carriesNativeCaption(channelType, mediaType)) return null;
    return body.length <= MAX_NATIVE_CAPTION ? body : null;
}
