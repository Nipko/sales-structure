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
 * and the like are NOT stripped: in a store they are a product reference
 * ("Ref [Artículo: 4512] disponible") and belong to the customer.
 */
import { Logger } from '@nestjs/common';
import { hasToolCallMarkup, stripToolCallMarkup } from './tool-call-markup.util';

const LABEL = '(?:Article|kb_article|retrieval_?id|document_?id)';
/** Title text, allowing one level of nested brackets: "[Article: Política [2024]]". */
const BODY = '(?:[^\\[\\]\\n]|\\[[^\\[\\]\\n]*\\]){1,300}';
const MARKER = new RegExp(
    // optional emphasis wrapper ( **[Article: X]** ), the marker, an optional
    // markdown link target, and the matching closing emphasis.
    `[ \\t]*(?<e>\\*{1,3}|_{1,3}|~~)?\\[\\s*${LABEL}\\s*:\\s*${BODY}\\](?:\\([^)\\n]*\\))?(?:\\k<e>)?`,
    'giu',
);
const QUICK_CHECK = /\[\s*(?:article|kb_|retrieval|document)/i;

const logger = new Logger('InternalMarkers');

export function stripInternalMarkers(input: string): string {
    if (typeof input !== 'string' || !input) return input;
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
