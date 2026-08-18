/**
 * Channel-aware outbound text formatting.
 *
 * LLM providers emit standard Markdown no matter what the prompt says, and
 * WhatsApp does not speak Markdown: it uses a single asterisk for bold, an
 * underscore for italic, and has no headings at all. Asking the model to "not
 * use markdown" is unenforceable, so the conversion happens on the OUTBOUND
 * path, right before the provider payload is built.
 *
 * Only the wire format is rewritten — what we persist in `messages` keeps the
 * original Markdown, so the agent inbox and the other channels are unaffected.
 */

/**
 * Internal sentinels, taken from the Unicode private-use area rather than the
 * C0 controls so no lint rule has to be silenced. They are stripped from the
 * input before anything else runs, so a message that already carried one
 * cannot collide with a placeholder.
 */
/** Placeholder delimiter for spans that must survive untouched (code, URLs). */
const GUARD = '\ue000';
/** Stand-in for a resolved WhatsApp bold marker, so later rules can't re-read it as Markdown. */
const BOLD = '\ue001';

const SENTINELS = /[\ue000\ue001]/g;
const GUARDED_SPAN = /\ue000(\d+)\ue000/g;
const BOLD_SENTINEL = /\ue001/g;

const FENCED_CODE = /```[\s\S]*?```/g;
const INLINE_CODE = /`[^`\n]+`/g;
/**
 * Schemed and www-prefixed URLs, plus BARE domains that carry a path
 * (`parallly-chat.cloud/__promo__`). The bare form deliberately requires the
 * slash: without it, `3.5` and `etc.` would be swallowed as links, and a
 * domain with no path cannot contain the `__`/`**` runs this guard exists to
 * protect. Missing that form rewrote a real link into `.../*promo*`.
 */
const URL = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+|\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)*\.[a-z]{2,}\/[^\s<>"'`]*/gi;
/** Punctuation that ends a sentence far more often than it ends a URL. */
const URL_TRAILING_PUNCT = /[*~.,;:!?]+$/;

const HEADING_LINE = /^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm;
const BOLD_ITALIC_MD = /\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g;
const BOLD_ASTERISK_MD = /\*\*(?=\S)([\s\S]*?\S)\*\*/g;
const BOLD_UNDERSCORE_MD = /(?<![\w_])__(?=\S)([\s\S]*?\S)__(?![\w_])/g;
const STRIKE_MD = /~~(?=\S)([\s\S]*?\S)~~/g;
/**
 * Italic is the only ambiguous rule: a lone `*x*` is Markdown italic to the
 * model, but it is already valid BOLD to WhatsApp — which is exactly what a
 * human agent types in the inbox — and it is also arithmetic and a list bullet.
 * Rewriting it blindly would silently downgrade an agent's deliberate bold.
 *
 * So it is rewritten only when the same message carries a marker WhatsApp does
 * not understand (`**`, `__`, `~~`, a `#` heading): that proves the author was
 * writing Markdown, which makes the lone asterisk italic rather than bold. With
 * no such fingerprint the asterisks are left alone — an untouched `*x*` still
 * renders as bold, never as the literal asterisks the owner reported.
 */
const MARKDOWN_FINGERPRINT = /\*\*|__|~~|^[ \t]{0,3}#{1,6}[ \t]+\S/m;
/** Delimiters hugging the text, no word character outside, no nesting inside. */
const ITALIC_ASTERISK_MD = /(?<![\w*\ue001])\*(?=\S)([^*\n]*?\S)\*(?![\w*\ue001])/g;
/** Already WhatsApp-shaped bold: `*Título*` must not be wrapped a second time. */
const ALREADY_BOLD = /^\*[^*]+\*$/;


/**
 * Shared first pass: strip sentinels and park the spans that no rule may touch.
 *
 * Code and URLs are set aside identically for every channel — the reasons are
 * the same everywhere (verbatim text must stay verbatim, and one altered byte
 * breaks a link) — so the guarding lives here instead of being re-derived, and
 * subtly differently, in each transform.
 */
function guardSpans(text: string): { out: string; guarded: string[] } {
    const guarded: string[] = [];
    const keep = (match: string): string => `${GUARD}${guarded.push(match) - 1}${GUARD}`;

    let out = text.replace(SENTINELS, '');
    out = out.replace(FENCED_CODE, keep);
    out = out.replace(INLINE_CODE, keep);
    out = out.replace(URL, (match) => {
        const trailing = match.match(URL_TRAILING_PUNCT)?.[0] ?? '';
        const url = trailing ? match.slice(0, -trailing.length) : match;
        return url ? keep(url) + trailing : match;
    });
    return { out, guarded };
}

/**
 * Convert Markdown emphasis to WhatsApp's own markup.
 *
 * Deliberately NOT converted:
 * - fenced ``` blocks and `inline code`: WhatsApp renders both natively, and
 *   rewriting anything inside a code span would corrupt text whose whole point
 *   is to be shown verbatim.
 * - URLs: a link can legitimately contain `_` or `*`, and altering one byte
 *   breaks the destination.
 * - Markdown links `[text](url)`: WhatsApp autolinks the bare URL anyway, and
 *   any rewrite here would drop either the label or the target.
 */
export function toWhatsAppFormatting(text: string): string {
    if (!text) return text;

    const { out: parked, guarded } = guardSpans(text);
    // Sampled before the markers are consumed by the rules below.
    const authoredInMarkdown = MARKDOWN_FINGERPRINT.test(parked);
    let out = parked;

    out = out.replace(BOLD_ITALIC_MD, `${BOLD}_$1_${BOLD}`);
    out = out.replace(BOLD_ASTERISK_MD, `${BOLD}$1${BOLD}`);
    out = out.replace(BOLD_UNDERSCORE_MD, `${BOLD}$1${BOLD}`);
    out = out.replace(STRIKE_MD, '~$1~');
    if (authoredInMarkdown) out = out.replace(ITALIC_ASTERISK_MD, '_$1_');

    // Headings run last so inline emphasis inside the title is already resolved
    // and `### **Título**` cannot end up double-wrapped back into `**Título**`.
    out = out.replace(HEADING_LINE, (_line, rawTitle: string) => {
        const title = rawTitle.replace(BOLD_SENTINEL, '*').trim();
        // A heading whose title is only whitespace must keep the original
        // line: returning '' can empty the entire message body, and Meta
        // answers 400 to an empty body — turning a cosmetic rule into a
        // failed delivery that the outbound job then retries and loses.
        if (!title) return _line;
        return ALREADY_BOLD.test(title) ? title : `*${title}*`;
    });

    out = out.replace(BOLD_SENTINEL, '*');
    return out.replace(GUARDED_SPAN, (_m, index: string) => guarded[Number(index)]);
}

const escapeTelegramHtml = (value: string): string => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/**
 * Convert Markdown to the HTML subset Telegram accepts with `parse_mode: HTML`.
 *
 * Order is load-bearing: the text is entity-escaped FIRST and the tags are
 * emitted afterwards. Converting first would let a customer's own `<b>` — or
 * any stray `<` in a message we echo back — reach Telegram as real markup, and
 * an unbalanced tag makes the API reject the whole send with a 400, losing the
 * reply. Escaping first means the only tags in the payload are the ones this
 * function produced.
 *
 * Guarded spans are re-escaped on the way out for the same reason: a URL
 * carrying `&` is invalid HTML otherwise, and Telegram autolinks bare URLs, so
 * no anchor tag is needed.
 */
export function toTelegramHtml(text: string): string {
    if (!text) return text;

    const { out: parked, guarded } = guardSpans(text);
    const authoredInMarkdown = MARKDOWN_FINGERPRINT.test(parked);

    let out = escapeTelegramHtml(parked);

    out = out.replace(BOLD_ITALIC_MD, '<b><i>$1</i></b>');
    out = out.replace(BOLD_ASTERISK_MD, '<b>$1</b>');
    out = out.replace(BOLD_UNDERSCORE_MD, '<b>$1</b>');
    out = out.replace(STRIKE_MD, '<s>$1</s>');
    if (authoredInMarkdown) out = out.replace(ITALIC_ASTERISK_MD, '<i>$1</i>');

    out = out.replace(HEADING_LINE, (line, rawTitle: string) => {
        const title = rawTitle.trim();
        // Same reason as WhatsApp: an empty body is a 400 and a lost message.
        return title ? `<b>${title}</b>` : line;
    });

    return out.replace(GUARDED_SPAN, (_m, index: string) => {
        const span = guarded[Number(index)];
        const fenced = span.match(/^```[^\n]*\n?([\s\S]*?)```$/);
        if (fenced) return `<pre>${escapeTelegramHtml(fenced[1])}</pre>`;
        const inline = span.match(/^`([^`\n]+)`$/);
        if (inline) return `<code>${escapeTelegramHtml(inline[1])}</code>`;
        return escapeTelegramHtml(span);
    });
}

/**
 * Strip Markdown for channels that render nothing: Instagram, Messenger, the
 * web chat widget and SMS all show the raw string, so every marker the model
 * emits is literal noise in front of the customer.
 *
 * Only the markers are removed; the words they wrapped stay. Code spans keep
 * their contents for the same reason (their point is the text, not the fence).
 */
export function toPlainText(text: string): string {
    if (!text) return text;

    const { out: parked, guarded } = guardSpans(text);
    const authoredInMarkdown = MARKDOWN_FINGERPRINT.test(parked);

    let out = parked;
    out = out.replace(BOLD_ITALIC_MD, '$1');
    out = out.replace(BOLD_ASTERISK_MD, '$1');
    out = out.replace(BOLD_UNDERSCORE_MD, '$1');
    out = out.replace(STRIKE_MD, '$1');
    if (authoredInMarkdown) out = out.replace(ITALIC_ASTERISK_MD, '$1');

    out = out.replace(HEADING_LINE, (line, rawTitle: string) => rawTitle.trim() || line);

    return out.replace(GUARDED_SPAN, (_m, index: string) => {
        const span = guarded[Number(index)];
        const fenced = span.match(/^```[^\n]*\n?([\s\S]*?)```$/);
        if (fenced) return fenced[1];
        const inline = span.match(/^`([^`\n]+)`$/);
        if (inline) return inline[1];
        return span;
    });
}

/**
 * Channels whose wire format is plain text: whatever the model wrote is shown
 * verbatim, so Markdown markers are noise the customer reads.
 */
const PLAIN_TEXT_CHANNELS = new Set(['instagram', 'messenger', 'widget', 'web', 'webchat', 'sms']);

/**
 * Format outbound text for a specific channel.
 *
 * Email is deliberately absent: it is composed from HTML templates on its own
 * path, not from model Markdown, so running either transform over it would
 * damage markup that is already correct. An unknown channel is returned
 * untouched — never guess a format we have not verified against the provider.
 */
export function formatOutboundText(text: string, channelType: string): string {
    const channel = String(channelType || '').toLowerCase();
    if (channel === 'whatsapp') return toWhatsAppFormatting(text);
    if (channel === 'telegram') return toTelegramHtml(text);
    if (PLAIN_TEXT_CHANNELS.has(channel)) return toPlainText(text);
    return text;
}
