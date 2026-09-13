/**
 * What kind of attachment this is — decided once, from the same evidence.
 *
 * ── WHAT WENT WRONG ─────────────────────────────────────────────────────────
 *
 * Nothing carried a media kind. The tools return `{url, caption}`, the turn sink
 * kept `{url, caption}`, `toDispatchTurnOutput` copied `{url, caption}`, and the
 * batch builder read the absent field as `image`. Every transport then defaulted
 * to `image` too, so a voice note, a video or a PDF left the platform declared
 * as a photo: Meta rejects the payload, and the caption folded onto it —
 * `image` accepts one, `audio` does not — went with it.
 *
 * The kind is therefore derived from the URL when nobody declared one, in ONE
 * place, so the counter, the batch builder and the two transports cannot
 * disagree about what a `.ogg` is.
 */

/** The kinds a dispatch item may carry. WhatsApp and Telegram share these. */
export const MEDIA_KINDS = ['image', 'video', 'audio', 'document'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

const BY_EXTENSION: ReadonlyArray<readonly [RegExp, MediaKind]> = Object.freeze([
    [/\.(mp4|mov|avi|mkv|webm|3gp)$/, 'video'],
    [/\.(mp3|ogg|oga|wav|m4a|opus|aac|amr)$/, 'audio'],
    [/\.(pdf|docx?|xlsx?|pptx?|zip|rar|txt|csv)$/, 'document'],
    [/\.(jpe?g|png|webp|gif|bmp|tiff?)$/, 'image'],
] as const);

/**
 * The kind of this attachment.
 *
 * A declared kind wins — a caller that knows is more reliable than a filename.
 * Otherwise the extension decides, and `image` is the last resort because it is
 * what every transport already assumed and because it is the only kind whose
 * wrong guess degrades rather than fails: a photo sent as a photo that is really
 * a PDF is a rejected payload either way, while a PDF sent as a document is
 * right even when the extension lied.
 *
 * The query string and the fragment are stripped first: a signed CDN URL ends in
 * `?X-Amz-Signature=…`, and matching the extension against that finds nothing
 * and calls every signed attachment a photo.
 */
export function mediaKindFor(url?: string | null, declared?: string | null): MediaKind {
    const named = String(declared ?? '').trim().toLowerCase();
    if ((MEDIA_KINDS as readonly string[]).includes(named)) return named as MediaKind;

    const path = String(url ?? '').split('#')[0].split('?')[0].toLowerCase();
    for (const [pattern, kind] of BY_EXTENSION) if (pattern.test(path)) return kind;
    return 'image';
}
