/**
 * Replace characters that cannot safely appear in an XML 1.0 prompt. Iterating
 * by code point preserves valid supplementary characters (emoji) while still
 * catching lone UTF-16 surrogates. Unicode noncharacters are rejected as well
 * because downstream provider/parser behavior is inconsistent for them.
 */
export function sanitizeXmlCharacters(value: unknown): string {
    let sanitized = '';
    for (const character of String(value ?? '')) {
        const codePoint = character.codePointAt(0)!;
        const isControl = (codePoint >= 0x00 && codePoint <= 0x08)
            || codePoint === 0x0B
            || codePoint === 0x0C
            || (codePoint >= 0x0E && codePoint <= 0x1F)
            || (codePoint >= 0x7F && codePoint <= 0x9F);
        const isSurrogate = codePoint >= 0xD800 && codePoint <= 0xDFFF;
        const isNonCharacter = (codePoint >= 0xFDD0 && codePoint <= 0xFDEF)
            || (codePoint & 0xFFFF) === 0xFFFE
            || (codePoint & 0xFFFF) === 0xFFFF;
        const isOutOfRange = codePoint > 0x10FFFF;
        sanitized += isControl || isSurrogate || isNonCharacter || isOutOfRange
            ? '\uFFFD'
            : character;
    }
    return sanitized;
}

/** Encode untrusted data for an XML text node used inside an LLM prompt. */
export function escapeXmlText(value: unknown): string {
    return sanitizeXmlCharacters(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/** Encode untrusted data for a double-quoted XML attribute. */
export function escapeXmlAttribute(value: unknown): string {
    return escapeXmlText(value)
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
