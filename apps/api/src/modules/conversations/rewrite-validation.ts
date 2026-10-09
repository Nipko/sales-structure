import { hasToolCallMarkup } from '../../common/utils/tool-call-markup.util';
import { replyLanguageOf } from './reply-language';

/**
 * What an LLM returns when it is asked to rewrite its own message is not always "only the corrected message": it comes back
 * wrapped in quotes and followed by a comment about itself («This seems to address the concern about claiming an action. It
 * reports the *»). Those words went to the customer, in English, because the corrective rewrite was audited only for the
 * claim it was asked to remove.
 *
 * Every rewrite is validated here before it can replace a reply: wrappers and labels are removed, paragraphs that talk ABOUT
 * the reply, the claim or the action («This seems to…», «It reports…», «I have rewritten…») are cut, and what is left must be in
 * the customer's language and carry no tool-call markup. A paragraph is cut for being META, never merely for being in another
 * language: an English tenant's product paragraph inside a Spanish reply, or an English customer's «It only takes a minute», stays. Anything that cannot be made clean returns null: the caller then uses its deterministic text.
 */

const OPENERS = '"“«\'‘';
const CLOSERS: Record<string, string> = { '"': '"“”', '“': '”', '«': '»', "'": "'’", '‘': '’' };

/** A line that introduces the rewrite («Mensaje corregido:», «Here is the corrected message:»). */
const LABEL = /^\s*(?:\*\*)?(?:mensaje corregido|respuesta corregida|mensagem corrigida|message corrig[eé]|corrected(?: message| version| reply)?|rewritten(?: message| version| reply)?|revised(?: message| version| reply)?|here(?:'s| is) (?:the |your )?(?:corrected|rewritten|revised|updated)[^:\n]{0,40}|aqu[ií] (?:est[aá]|tienes) (?:el )?mensaje (?:corregido|reescrito)|voici (?:le )?message corrig[eé]|aqui est[aá] a mensagem corrigida)(?:\*\*)?\s*:\s*/i;

/** A paragraph that talks ABOUT the message instead of being it. */
// Phrases of self-commentary only: «this»/«it»/«note» alone are ordinary first words of an English customer's reply.
const META = /^\s*[*_>-]*\s*(?:this (?:seems|appears) to\b|this (?:rewrite|rewritten (?:message|reply|response)|(?:message|reply|response|version) (?:now|no longer|avoids|does not claim|doesn't claim|has been (?:rewritten|corrected|revised)))\b|it (?:reports|avoids claiming|does not claim|doesn't claim|no longer claims|states that the (?:action|operation|booking|appointment|order))\b|the (?:corrected|rewritten|revised) (?:message|reply|response|version)\b|the (?:message|reply|response) (?:above|now|no longer|avoids|does not claim)\b|here(?:'s| is| are) (?:the|a|my) (?:corrected|rewritten|revised)\b|i (?:have|'ve|will|'ll) (?:rewritten|rewrite|corrected|revised|removed|adjusted|reworded|reword)\b|as an ai\b)/i;

function unwrap(text: string): string {
    const first = text[0];
    if (!first || !OPENERS.includes(first)) return text;
    const closers = CLOSERS[first] || first;
    // The closing quote is the LAST one after which only a comment (or nothing) follows.
    for (let index = text.length - 1; index > 0; index -= 1) {
        if (!closers.includes(text[index])) continue;
        const rest = text.slice(index + 1).trim();
        if (!rest || META.test(rest)) return text.slice(1, index).trim();
    }
    return text;
}

export function sanitizeRewrittenReply(rewritten: unknown, options: { lang?: string; names?: readonly string[] } = {}): string | null {
    if (typeof rewritten !== 'string') return null;
    let text = rewritten.replace(/\r\n/g, '\n').trim();
    if (!text) return null;
    if (hasToolCallMarkup(text, options.names ?? [])) return null;
    text = text.replace(LABEL, '').trim();
    text = unwrap(text);
    // A quote opened after a label line or a blank line wraps the message as well.
    const kept = text.split(/\n{2,}/).map(paragraph => paragraph.trim()).filter(paragraph => paragraph
        && !META.test(paragraph));
    text = kept.join('\n\n').trim();
    text = unwrap(text).replace(LABEL, '').trim();
    if (text.length < 6) return null;
    const lang = options.lang ? options.lang.slice(0, 2).toLowerCase() : undefined;
    const written = replyLanguageOf(text, options.names ?? []);
    if (lang && written && written !== lang) return null;
    // A stray markdown marker left by a cut sentence («It reports the *») is not a message.
    if (/(?:^|\n)\s*[*_]\s*$/.test(text)) return null;
    return text;
}
