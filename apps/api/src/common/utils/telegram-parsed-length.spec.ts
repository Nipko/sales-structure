import { telegramParsedLength, toTelegramHtml } from './channel-text-format.util';
import { foldableCaption, renderedCaptionLength, MAX_NATIVE_CAPTION } from
    '../../modules/channels/native-caption';
import { bodyLengthFor, textLimitFor } from '../../modules/conversations/turn-outcome-effects';

/**
 * ═══ "N CHARACTERS AFTER ENTITIES PARSING" ═══
 *
 * That is what Telegram's documentation says about every one of its length
 * limits, and it names a third number that neither of the two obvious ones is:
 *
 *   · the RAW string the model wrote. `**negrita**` is ten characters here and
 *     six to Telegram, so a limit applied to this splits answers that would
 *     have fitted in one bubble — two messages the customer sees as two, and on
 *     a billed channel two charges;
 *   · the ESCAPED HTML on the wire. One `&` becomes `&amp;`, so a caption of a
 *     thousand ampersands measures five thousand and is denied a fold it was
 *     always entitled to;
 *   · the PARSED length: markup gone, entities decoded back to one character.
 *
 * The text limit used the first. The caption limit used the second. Both erred
 * towards sending more messages than necessary, which is the direction that
 * costs money quietly rather than failing loudly — so nothing ever surfaced it.
 */
describe('the length Telegram actually measures', () => {
    it('counts plain text as itself', () => {
        expect(telegramParsedLength('hola')).toBe(4);
    });

    it('does not count the markup it parses away', () => {
        // Eleven characters of markdown, seven of message.
        expect(telegramParsedLength('**negrita**')).toBe(7);
        expect(telegramParsedLength('**x**')).toBe(1);
        // A lone `*x*` is NOT markdown here: `toTelegramHtml` only reads
        // single asterisks as italics when the text is otherwise authored in
        // markdown, so this one stays three literal characters — and
        // Telegram will show three. The measure follows the renderer.
    });

    it('counts an escaped ampersand as the one character it becomes', () => {
        // THE CAPTION DEFECT. `&` goes on the wire as `&amp;` — five characters
        // of payload for one character of message, and Telegram counts the one.
        expect(toTelegramHtml('&')).toBe('&amp;');
        expect(telegramParsedLength('&')).toBe(1);
        expect(telegramParsedLength('&'.repeat(1_024))).toBe(1_024);
    });

    it.each([['<', 1], ['>', 1], ['"', 1]])(
        'counts the escaped %s as one character', (char, expected) => {
            expect(telegramParsedLength(char)).toBe(expected);
        });

    it('does not double-decode a literal that was meant to be read', () => {
        // `&amp;lt;` on the wire is the literal text `&lt;`, which a customer is
        // meant to SEE. Decoding `&amp;` before `&lt;` would turn it into `<`
        // and count four characters as one.
        expect(telegramParsedLength('&lt;')).toBe(4);
    });

    it('counts an astral emoji as the two UTF-16 units Telegram counts', () => {
        // Deliberately NOT `[...text].length`. Telegram measures UTF-16 code
        // units, which is exactly what `String.length` gives; counting code
        // POINTS instead would let a message of four thousand emoji through at
        // twice its real size.
        expect(telegramParsedLength('👍')).toBe(2);
        expect(telegramParsedLength('👍'.repeat(2_048))).toBe(4_096);
    });

    it('counts a code span’s contents, not its fence', () => {
        expect(telegramParsedLength('`abc`')).toBe(3);
    });
});

describe('the caption fold, measured the provider’s way', () => {
    const fold = (caption: string) => foldableCaption('telegram', 'image', caption);

    it('folds exactly 1024 parsed characters', () => {
        const caption = 'x'.repeat(MAX_NATIVE_CAPTION);
        expect(renderedCaptionLength('telegram', caption)).toBe(1_024);
        expect(fold(caption)).toBe(caption);
    });

    it('refuses 1025, because that one really is over', () => {
        expect(fold('x'.repeat(MAX_NATIVE_CAPTION + 1))).toBeNull();
    });

    it('folds a caption of 1024 ampersands, which used to measure 5120', () => {
        // The reproduction. Five kilobytes of payload, one kilobyte of message.
        const caption = '&'.repeat(MAX_NATIVE_CAPTION);
        expect(toTelegramHtml(caption)).toHaveLength(5_120);
        expect(renderedCaptionLength('telegram', caption)).toBe(1_024);
        expect(fold(caption)).toBe(caption);
    });

    it('still refuses 1025 ampersands', () => {
        expect(fold('&'.repeat(MAX_NATIVE_CAPTION + 1))).toBeNull();
    });

    it('folds 512 astral emoji and refuses 513', () => {
        // 512 × 2 = 1024 UTF-16 units, exactly the limit.
        expect(fold('👍'.repeat(512))).toBe('👍'.repeat(512));
        expect(fold('👍'.repeat(513))).toBeNull();
    });

    it('leaves WhatsApp measured as written', () => {
        // WhatsApp takes the caption as text and only rewrites markdown, which
        // cannot grow it past its own input.
        expect(renderedCaptionLength('whatsapp', '&'.repeat(10))).toBe(10);
    });
});

describe('the text limit, measured the provider’s way', () => {
    it('measures a Telegram body after parsing', () => {
        expect(bodyLengthFor('telegram', '**negrita**')).toBe(7);
    });

    it('measures every other channel as written', () => {
        // They receive the string; there is nothing to parse away.
        expect(bodyLengthFor('whatsapp', '**negrita**')).toBe(11);
        expect(bodyLengthFor('instagram', '&'.repeat(10))).toBe(10);
    });

    it('lets a heavily formatted answer stay one Telegram bubble', () => {
        // THE TEXT DEFECT. Bold markers on every line: four thousand raw
        // characters that Telegram sees as well under its limit. Split by raw
        // length, this arrived as two messages.
        const limit = textLimitFor('telegram');
        const line = '**palabra**\n';
        const body = line.repeat(400);
        expect(body.length).toBeGreaterThan(limit);
        expect(bodyLengthFor('telegram', body)).toBeLessThanOrEqual(limit);
    });

    it('still refuses a body that is genuinely too long', () => {
        // The measure changed; the ceiling did not. Plain text over the limit
        // is over the limit.
        const limit = textLimitFor('telegram');
        expect(bodyLengthFor('telegram', 'x'.repeat(limit + 1))).toBeGreaterThan(limit);
    });
});
