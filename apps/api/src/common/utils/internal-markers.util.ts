/**
 * Internal markers that must never reach a customer.
 *
 * The prompt contract (`prompt-assembler.service.ts`, rule 5b) asks the model to
 * cite the knowledge article behind a claim as `[Article: exact source title]`,
 * in that English form whatever the customer's language. The citation is a
 * signal for `attributeKnowledgeResponse` and for nobody else: shown to a
 * customer it is an unexplained bracket with an internal document title in it
 * (seen in a real QA_TIENDA transcript on 2 October).
 *
 * Attribution has to read the RAW reply, so the order is fixed: record the
 * attribution first, strip afterwards. The strip then runs again at the AI
 * egress points (`buildDispatchItems`, and `ChannelGatewayService.sendMessage`
 * for AI-origin messages) as defence in depth.
 *
 * The label list is deliberately closed to what the prompt asks for plus the
 * shape an internal identifier would take if it leaked. `Artículo`, `Artikel`
 * and the like are NOT stripped when they hold a product reference: in a store
 * they are one ("Ref [Artículo: 4512] disponible") and belong to the customer.
 * The model does localise the label sometimes ("[Artículo: ¿Cuál es la política
 * de cancelación?]", seen on a travel agency on 9 October), so a localised label
 * is stripped when what follows it is a QUESTION (a product is never one) or is
 * exactly the title of a source the turn retrieved (`sourceTitles`, known only
 * where the reply is produced), and kept otherwise: "[Artículo: Camiseta Azul
 * Talla M]" is a product, and so is any code or short name.
 */
import { Logger } from '@nestjs/common';
import { hasToolCallMarkup, stripToolCallMarkup } from './tool-call-markup.util';

const LABEL = '(?<lab>Article|kb_article|retrieval_?id|document_?id|Art[ií]culos?|Artigos?|Articolos?|Artikel|Articles)';
const LOCALISED_LABEL = /^(?:art[ií]culos?|artigos?|articolos?|artikel|articles)$/i;
const fold = (value: string): string => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
/** A localised label counts as a citation only when its text is a question or the title of a retrieved source. */
const citationLike = (body: string, sourceTitles: ReadonlySet<string>): boolean => /[¿?]/.test(body) || sourceTitles.has(fold(body));
/** Title text, allowing one level of nested brackets: "[Article: Política [2024]]". */
const BODY = '(?<body>(?:[^\\[\\]\\n]|\\[[^\\[\\]\\n]*\\]){1,300})';
const MARKER = new RegExp(
    // optional emphasis wrapper ( **[Article: X]** ), the marker, an optional
    // markdown link target, and the matching closing emphasis.
    `[ \\t]*(?<e>\\*{1,3}|_{1,3}|~~)?\\[\\s*${LABEL}\\s*:\\s*${BODY}\\](?:\\([^)\\n]*\\))?(?:\\k<e>)?`,
    'giu',
);
const QUICK_CHECK = /\[\s*(?:article|art[ií]culo|artigo|articolo|artikel|kb_|retrieval|document)/i;

const logger = new Logger('InternalMarkers');

export function stripInternalMarkers(input: string, sourceTitles: readonly string[] = []): string {
    if (typeof input !== 'string' || !input) return input;
    const titles = new Set(sourceTitles.map(title => fold(String(title ?? ''))).filter(Boolean));
    // Last line of defence at egress: a tool call written as text (the turn guard should have caught it first).
    // It is removed, never turned into a call, and logged loudly because it means a guard upstream was bypassed.
    let text = input;
    if (hasToolCallMarkup(text)) {
        text = stripToolCallMarkup(text);
        logger.error(`[Egress] tool-call markup removed from an outgoing message (${input.length - text.length} chars) — an upstream guard missed it`);
    }
    if (!QUICK_CHECK.test(text)) return text;
    let removed = false;
    const lines: string[] = [];
    for (const line of text.split('\n')) {
        const cleaned = line.replace(MARKER, (match: string, ...rest: any[]) => {
            const groups = rest[rest.length - 1] as { lab?: string; body?: string };
            // A product reference written with a localised label is the customer's, not an internal citation.
            if (LOCALISED_LABEL.test(groups?.lab ?? '') && !citationLike(groups?.body ?? '', titles)) return match;
            removed = true;
            const offset = rest[rest.length - 3] as number;
            const whole = rest[rest.length - 2] as string;
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
    // Keep the leading indentation of the first kept line; drop only blank lines.
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').trimEnd();
}
