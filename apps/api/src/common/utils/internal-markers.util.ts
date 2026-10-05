/**
 * Internal markers that must never reach a customer.
 *
 * The prompt contract (rule 5b) asks the model to cite the knowledge article
 * behind a claim as `[Article: exact source title]`. The citation is a signal
 * for `attributeKnowledgeResponse` and for nobody else: shown to a customer it
 * is an unexplained bracket with an internal document title in it (seen in a
 * real QA_TIENDA transcript on 2 October).
 *
 * Attribution has to read the RAW reply, so the order is fixed: record the
 * attribution first, strip afterwards. The strip then runs again at every
 * egress (`ChannelGatewayService.sendMessage`, `buildDispatchItems`) because
 * "every producer remembered to clean its text" is a list someone maintains,
 * while the edge the text crosses is a property of the code.
 */

/**
 * The citation family the attribution parser understands (singular and plural,
 * the languages of the product) plus the shape an internal identifier would
 * take if it leaked (`[kb_article: <id>]`). The label list is deliberately
 * closed: arbitrary bracketed text ("[M]", "[Nota: ...]") is the customer's
 * business and stays.
 */
const MARKER = /[ \t]*\[\s*(?:Art(?:icle|[ií]culo|igo|icolo|ikel)s?|kb_article|retrieval_?id|document_?id)\s*:\s*[^\]\n]{1,300}\]/giu;
const QUICK_CHECK = /\[\s*(?:art|kb_|retrieval|document)/i;

export function stripInternalMarkers(text: string): string {
    if (typeof text !== 'string' || !text) return text;
    if (!QUICK_CHECK.test(text)) return text;
    let removed = false;
    const lines: string[] = [];
    for (const line of text.split('\n')) {
        const cleaned = line.replace(MARKER, (match: string, offset: number, whole: string) => {
            removed = true;
            const before = whole[offset - 1];
            const after = whole[offset + match.length];
            // "uno[Article: X]dos" must not become "unodos".
            return before && after && /[\p{L}\p{N}]/u.test(before) && /[\p{L}\p{N}]/u.test(after) ? ' ' : '';
        });
        // A line that held only the marker leaves nothing behind, not a blank gap.
        if (cleaned !== line && !cleaned.trim()) continue;
        lines.push(cleaned !== line ? cleaned.replace(/[ \t]+$/, '') : cleaned);
    }
    if (!removed) return text;
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
