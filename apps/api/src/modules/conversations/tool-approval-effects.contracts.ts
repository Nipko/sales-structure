export type ApprovalEffectKind = 'media' | 'handoff' | 'payment_link';
export type ApprovalEffectState = 'pending' | 'queued' | 'processing' | 'sent' | 'stored' | 'completed'
    | 'failed' | 'suppressed' | 'reconciliation_required';
export interface ApprovalEffectSummary { id: string; kind: ApprovalEffectKind; state: ApprovalEffectState; errorCode?: string; }
export type ApprovalDeliveryState = Exclude<ApprovalEffectState, 'sent' | 'stored'> | 'not_required';
export interface ApprovalEffectDescriptor { kind: ApprovalEffectKind; itemIndex: number; }
const MEDIA_TOOLS = new Set(['send_product_image', 'send_property_image', 'send_listing_image', 'send_vehicle_image', 'send_portfolio']);
export const APPROVAL_EFFECTS_EVENT = 'tool.approval.effects_requested';
export function approvalMediaItems(result: Record<string, any>): any[] {
    return Array.isArray(result._mediaToSend) ? result._mediaToSend : result._mediaToSend ? [result._mediaToSend] : [];
}
export function approvedEffectDescriptors(tool: string, status: string, result: Record<string, any>): ApprovalEffectDescriptor[] {
    // Remote results are data, not instructions to dispatch side effects from the local runtime.
    if (!result || typeof tool !== 'string' || tool.startsWith('mcp:') || tool.startsWith('mcp_') || result.controlBlocked) return [];
    const effects: ApprovalEffectDescriptor[] = [];
    if (status === 'succeeded' && result.success === true && MEDIA_TOOLS.has(tool)) {
        approvalMediaItems(result).slice(0, 20).forEach((_, itemIndex) => effects.push({ kind: 'media', itemIndex }));
    }
    if (status === 'succeeded' && tool === 'create_payment_link' && result.linkCreated === true) {
        effects.push({ kind: 'payment_link', itemIndex: 0 });
    }
    if (['succeeded', 'failed', 'handoff_required', 'reconciliation_required'].includes(status) && result.shouldHandoff === true) {
        effects.push({ kind: 'handoff', itemIndex: 0 });
    }
    return effects;
}
export function approvalDeliveryState(effects: ApprovalEffectSummary[]): ApprovalDeliveryState {
    if (!effects.length) return 'not_required';
    for (const state of ['reconciliation_required', 'failed', 'processing', 'pending', 'queued', 'suppressed'] as const) {
        if (effects.some(effect => effect.state === state)) return state;
    }
    return 'completed';
}

// No content, URL, recipient or credentials in this durable delivery bookkeeping.
export const APPROVAL_EFFECTS_DDL = `CREATE TABLE IF NOT EXISTS tool_approval_effects (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    ticket_id UUID NOT NULL REFERENCES tool_approval_tickets(id) ON DELETE CASCADE,
    kind VARCHAR(30) NOT NULL CHECK (kind IN ('media', 'handoff', 'payment_link')),
    item_index INTEGER NOT NULL CHECK (item_index >= 0),
    state VARCHAR(40) NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'queued', 'processing', 'sent', 'stored', 'completed', 'failed', 'suppressed', 'reconciliation_required')),
    attempts INTEGER NOT NULL DEFAULT 0,
    lease_token UUID,
    lease_expires_at TIMESTAMPTZ,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    error_code VARCHAR(100),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(ticket_id, kind, item_index)
)`;

export const APPROVAL_EFFECTS_STATE_MIGRATION = [
    `DO $widget_state$ BEGIN
        PERFORM pg_advisory_xact_lock(hashtextextended(current_schema() || ':approval-effect-state-migration',0));
        IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='tool_approval_effects'::regclass
            AND conname='tool_approval_effects_state_check' AND pg_get_constraintdef(oid) LIKE '%stored%') THEN
            ALTER TABLE tool_approval_effects DROP CONSTRAINT IF EXISTS tool_approval_effects_state_check;
            ALTER TABLE tool_approval_effects ADD CONSTRAINT tool_approval_effects_state_check
                CHECK (state IN ('pending','queued','processing','sent','stored','completed','failed','suppressed','reconciliation_required'));
        END IF;
    END $widget_state$`,
];
