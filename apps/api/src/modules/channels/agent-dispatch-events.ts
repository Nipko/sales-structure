import type { DispatchRow, DispatchState } from './agent-dispatch-outbox';

/**
 * ═══ THE OUTBOX SAYS WHAT BECAME OF AN EFFECT ═══
 *
 * The turn ledger settles when the turn returns; whether the customer received
 * anything is only known later, here, when a dispatch row reaches a terminal
 * state. Nothing carried that fact back, so a reply whose POST died with
 * `fetch failed` stayed `settled` with outcome `send` while the customer got
 * nothing (production QA, 2026-10-22).
 *
 * This is the one-way message that carries it. Channels publishes it after the
 * transition has COMMITTED; whoever cares (the conversations module, for the
 * turn ledger) listens. Channels never imports conversations.
 *
 * In-process and best-effort by design: losing one leaves the ledger saying
 * `pending`, which the Ops monitor reports as an unanswered turn — the safe
 * direction. The outbox row stays the authority for the effect itself.
 */
export const AGENT_DISPATCH_SETTLED_EVENT = 'agent.dispatch.settled';

/** The terminal transitions published. A retryable `failed` is not one. */
export const AGENT_DISPATCH_SETTLED_STATES: readonly DispatchState[] =
    Object.freeze(['sent', 'stored', 'suppressed', 'reconciliation_required']);

export interface AgentDispatchSettledEvent {
    readonly tenantId: string;
    readonly schemaName: string;
    readonly dispatchId: string;
    /**
     * The batch's origin. For an `inbound_reply` it is the customer message the
     * turn answered — the same id `agent_turn_ledger` is keyed on.
     */
    readonly inboundMessageId: string;
    readonly conversationId: string;
    readonly itemIndex: number;
    readonly state: DispatchState;
    readonly receipt: string | null;
    readonly errorCode: string | null;
}

/**
 * The event a committed row warrants, or `null`.
 *
 * Only replies to an inbound are published: a proactive effect (reminder,
 * campaign, REST send) has no turn behind it. A redacted row has lost the
 * binding that names the turn, and is not a delivery outcome anyway.
 */
export function dispatchSettledEvent(tenantId: string, schemaName: string,
    row: DispatchRow | null | undefined): AgentDispatchSettledEvent | null {
    if (!row || row.redacted || !row.binding) return null;
    if (row.originKind !== 'inbound_reply') return null;
    if (!AGENT_DISPATCH_SETTLED_STATES.includes(row.state)) return null;
    return Object.freeze({
        tenantId,
        schemaName,
        dispatchId: row.id,
        inboundMessageId: row.binding.inboundMessageId,
        conversationId: row.binding.conversationId,
        itemIndex: row.itemIndex,
        state: row.state,
        receipt: row.receipt,
        errorCode: row.errorCode,
    });
}
