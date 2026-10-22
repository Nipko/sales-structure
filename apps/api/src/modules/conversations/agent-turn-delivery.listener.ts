import { Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { RECIPIENT_OPTED_OUT_CODE } from '../../common/policies/opt-out-register';
import {
    AGENT_DISPATCH_SETTLED_EVENT, type AgentDispatchSettledEvent,
} from '../channels/agent-dispatch-events';
import type { TurnDeliveryState } from './agent-turn-ledger';
import { AgentTurnLedgerStore } from './agent-turn-ledger.store';

/**
 * Suppression codes that mean "deliberately not sent" rather than "could not
 * be sent": the agent that wrote the words changed, the policy that authorised
 * a proactive effect withdrew it, the person who wrote it lost the right, or
 * the recipient opted out. Everything else that ends `suppressed` — attempts
 * exhausted, a definite provider refusal, a permanent preflight, a person
 * resolving an uncertain effect as not delivered — is a FAILURE to answer.
 */
const DELIBERATE_SUPPRESSION = /^(agent_|proactive_|human_)/;

/**
 * Pure: what a terminal dispatch transition means for the turn that produced it.
 *
 *   sent / stored            → delivered (the receipt is the proof)
 *   reconciliation_required  → unknown
 *   suppressed, deliberate   → suppressed
 *   suppressed, otherwise    → failed
 */
export function turnDeliveryForDispatch(event: Pick<AgentDispatchSettledEvent,
    'state' | 'receipt' | 'errorCode' | 'dispatchId'>): { state: TurnDeliveryState; receipt: string | null } | null {
    switch (event.state) {
        case 'sent':
        case 'stored': {
            // `stored` is the widget's own lane: the effect landed in our
            // storage, which IS the customer's channel. It may carry no
            // provider id, so the dispatch row itself is named as the proof.
            const receipt = event.receipt?.trim() || (event.state === 'stored' ? `dispatch:${event.dispatchId}` : null);
            return receipt ? { state: 'delivered', receipt } : { state: 'unknown', receipt: null };
        }
        case 'reconciliation_required':
            return { state: 'unknown', receipt: null };
        case 'suppressed': {
            const code = String(event.errorCode || '');
            const deliberate = DELIBERATE_SUPPRESSION.test(code) || code === RECIPIENT_OPTED_OUT_CODE;
            return { state: deliberate ? 'suppressed' : 'failed', receipt: null };
        }
        default:
            return null;
    }
}

/**
 * Feeds the turn ledger's delivery truth from the outbox's terminal transitions.
 *
 * Listens rather than being called: channels publishes `agent.dispatch.settled`
 * and knows nothing about turns. Idempotent end to end — the ledger write is a
 * monotonic, rank-guarded UPDATE, so a duplicate, late or out-of-order event is
 * a no-op and a receipt is never overwritten by a later failure.
 */
@Injectable()
export class AgentTurnDeliveryListener {
    private readonly logger = new Logger(AgentTurnDeliveryListener.name);

    constructor(@Optional() private readonly turnLedger?: AgentTurnLedgerStore) {}

    @OnEvent(AGENT_DISPATCH_SETTLED_EVENT, { async: true })
    async onDispatchSettled(event: AgentDispatchSettledEvent): Promise<void> {
        try {
            if (!this.turnLedger || !event?.schemaName || !event.inboundMessageId) return;
            const mapped = turnDeliveryForDispatch(event);
            if (!mapped) return;
            const result = await this.turnLedger.recordDeliveryOutcome(event.schemaName, {
                inboundMessageId: event.inboundMessageId,
                conversationId: event.conversationId,
                state: mapped.state,
                receipt: mapped.receipt,
            });
            if (result?.applied && mapped.state !== 'delivered') {
                this.logger.warn(`[TurnDelivery] turn ${event.inboundMessageId} is ${mapped.state}: dispatch `
                    + `${event.dispatchId} ended ${event.state} (${event.errorCode ?? 'no code'})`);
            }
        } catch (error: any) {
            // An event handler that throws would surface as an unhandled
            // rejection in the process that just recorded a send.
            this.logger.error(`[TurnDelivery] ${event?.dispatchId}: ${error?.message}`);
        }
    }
}
