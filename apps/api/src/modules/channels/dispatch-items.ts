import type { DispatchItem, DispatchItemKind } from './agent-dispatch-outbox';

/**
 * Turns what a turn produced into the ordered list of remote effects it means.
 *
 * The split is the whole point. Today a media message carries its caption, and
 * two channels then perform two POSTs behind one call: Messenger sends the
 * attachment and then the text, returning only the last id, so a caption that
 * failed took the picture down with it and the retry sent the picture again.
 * Here each effect is its own item, in the order the customer should see them,
 * and each earns its own receipt.
 *
 * A payment link stays a separate item for a different reason: its URL comes
 * from a canonical tool result, never from the model's prose, so it must not be
 * concatenated into text the model wrote and lose that provenance.
 *
 * Pure and side-effect free — no database, no channel, no provider. The caller
 * records the result, and only what this returns can ever be dispatched.
 */
export interface DispatchTurnOutput {
    /** Reply bubbles, already split, in the order they should arrive. */
    readonly textChunks?: readonly string[];
    /** Each entry is one attachment; its caption becomes a separate text item. */
    readonly media?: readonly { url: string; caption?: string | null; mediaType?: string | null; filename?: string | null }[];
    /** Canonical URLs from tool receipts. Never a URL the model typed. */
    readonly paymentLinks?: readonly string[];
    /** At most one interactive Flow per turn, and never a fallback for it. */
    readonly flow?: {
        flowId: string; flowToken: string; text: string;
        headerText?: string | null; footerText?: string | null; flowCta?: string | null;
        flowMode?: 'published' | 'draft' | null; initialScreen?: string | null;
        initialData?: Record<string, unknown> | null;
    } | null;
}

/** Refuses to build anything rather than let a malformed effect through. */
export class DispatchItemError extends Error {
    constructor(readonly code: string) { super(code); }
}
const MAX_ITEMS = 32;
const MAX_TEXT = 32000;

function textItem(text: string, kind: DispatchItemKind): DispatchItem {
    const body = String(text ?? '').trim();
    if (!body) throw new DispatchItemError('dispatch_item_empty_text');
    if (body.length > MAX_TEXT) throw new DispatchItemError('dispatch_item_text_too_long');
    return Object.freeze({ kind, payload: Object.freeze({ text: body }) });
}

export function buildDispatchItems(output: DispatchTurnOutput): DispatchItem[] {
    if (!output || typeof output !== 'object') throw new DispatchItemError('dispatch_item_invalid_output');
    const items: DispatchItem[] = [];

    // A Flow replaces the turn's own text: it carries its body, and sending both
    // would show the customer the same thing twice. It is never accompanied by a
    // text fallback here — a fallback may only exist as a separate item admitted
    // after a rejection somebody actually observed.
    if (output.flow) {
        const { flowId, flowToken } = output.flow;
        if (!String(flowId ?? '').trim() || !String(flowToken ?? '').trim())
            throw new DispatchItemError('dispatch_item_incomplete_flow');
        items.push(Object.freeze({ kind: 'flow' as const, payload: Object.freeze({
            flowId: String(flowId), flowToken: String(flowToken),
            text: String(output.flow.text ?? ''),
            ...(output.flow.headerText ? { headerText: String(output.flow.headerText) } : {}),
            ...(output.flow.footerText ? { footerText: String(output.flow.footerText) } : {}),
            ...(output.flow.flowCta ? { flowCta: String(output.flow.flowCta) } : {}),
            ...(output.flow.flowMode ? { flowMode: output.flow.flowMode } : {}),
            ...(output.flow.initialScreen ? { initialScreen: String(output.flow.initialScreen) } : {}),
            ...(output.flow.initialData && Object.keys(output.flow.initialData).length
                ? { initialData: output.flow.initialData } : {}),
        }) }));
    } else {
        for (const chunk of output.textChunks || []) items.push(textItem(chunk, 'text'));
    }

    // The link goes before the pictures because it is what the customer is
    // waiting for — the same order the current producer sends them in, so
    // turning the switch on does not reorder anybody's reply.
    for (const link of output.paymentLinks || []) items.push(textItem(link, 'payment_link'));

    for (const attachment of output.media || []) {
        const url = String(attachment?.url ?? '').trim();
        if (!url) throw new DispatchItemError('dispatch_item_empty_media');
        items.push(Object.freeze({ kind: 'media' as const, payload: Object.freeze({
            mediaUrl: url,
            ...(attachment.mediaType ? { mediaType: String(attachment.mediaType) } : {}),
            ...(attachment.filename ? { filename: String(attachment.filename) } : {}),
        }) }));
        // The caption follows the attachment as its own effect, so a caption
        // that fails never causes the attachment to be sent a second time.
        if (attachment.caption && String(attachment.caption).trim()) {
            items.push(textItem(String(attachment.caption), 'text'));
        }
    }

    if (!items.length) throw new DispatchItemError('dispatch_item_nothing_to_send');
    if (items.length > MAX_ITEMS) throw new DispatchItemError('dispatch_item_too_many');
    return items;
}
