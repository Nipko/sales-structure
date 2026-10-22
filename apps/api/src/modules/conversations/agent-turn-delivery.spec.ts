import { EventEmitter2 } from '@nestjs/event-emitter';
import { AgentDispatchOutboxStore } from '../channels/agent-dispatch-outbox.store';
import {
    AGENT_DISPATCH_SETTLED_EVENT, dispatchSettledEvent, type AgentDispatchSettledEvent,
} from '../channels/agent-dispatch-events';
import type { DispatchRow } from '../channels/agent-dispatch-outbox';
import { deliveryTransitionAllowed, TURN_DELIVERY_STATES } from './agent-turn-ledger';
import { AgentTurnDeliveryListener, turnDeliveryForDispatch } from './agent-turn-delivery.listener';

/**
 * Delivery truth for agent turns, without a database: the transition rule, the
 * meaning of each terminal dispatch state for the turn, which committed rows the
 * outbox store publishes, and what the conversations listener does with them.
 * The PostgreSQL proof is `agent-turn-delivery.postgres.spec.ts`.
 */
const INBOUND = '11111111-1111-4111-8111-111111111111';
const CONVERSATION = '22222222-2222-4222-8222-222222222222';
const DISPATCH = '33333333-3333-4333-8333-333333333333';

const row = (over: Partial<DispatchRow> = {}): DispatchRow => ({
    id: DISPATCH, messageId: null, batchId: DISPATCH, itemIndex: 0, itemKind: 'text', state: 'sent',
    attempts: 1, receipt: 'tg:1', errorCode: null, availableAt: new Date(), redacted: false,
    originKind: 'inbound_reply', disposition: 'reactive', replyToMessageId: INBOUND,
    binding: { conversationId: CONVERSATION, contactId: CONVERSATION, inboundMessageId: INBOUND,
        channelType: 'telegram', channelAccountId: 'tg', recipient: '1' },
    payload: { text: 'hola' }, operationalScope: {}, learningFootprint: null, ...over,
} as DispatchRow);

const event = (over: Partial<AgentDispatchSettledEvent> = {}): AgentDispatchSettledEvent => ({
    tenantId: 't', schemaName: 'tenant_demo', dispatchId: DISPATCH, inboundMessageId: INBOUND,
    conversationId: CONVERSATION, itemIndex: 0, state: 'sent', receipt: 'tg:1', errorCode: null, ...over,
});

describe('turn delivery transitions are monotonic', () => {
    it('lets anything replace "not tracked"', () => {
        for (const state of TURN_DELIVERY_STATES) expect(deliveryTransitionAllowed(null, state)).toBe(true);
    });

    it('never downgrades delivered', () => {
        for (const state of TURN_DELIVERY_STATES) expect(deliveryTransitionAllowed('delivered', state)).toBe(false);
    });

    it('keeps failed terminal except for a receipt', () => {
        expect(deliveryTransitionAllowed('failed', 'pending')).toBe(false);
        expect(deliveryTransitionAllowed('failed', 'unknown')).toBe(false);
        expect(deliveryTransitionAllowed('failed', 'suppressed')).toBe(false);
        expect(deliveryTransitionAllowed('failed', 'failed')).toBe(false);
        expect(deliveryTransitionAllowed('failed', 'delivered')).toBe(true);
    });

    it('lets unknown resolve either way, and pending move anywhere forward', () => {
        expect(deliveryTransitionAllowed('unknown', 'delivered')).toBe(true);
        expect(deliveryTransitionAllowed('unknown', 'failed')).toBe(true);
        expect(deliveryTransitionAllowed('unknown', 'pending')).toBe(false);
        expect(deliveryTransitionAllowed('pending', 'unknown')).toBe(true);
        expect(deliveryTransitionAllowed('pending', 'pending')).toBe(false);
    });

    it('refuses a state it does not know', () => {
        expect(deliveryTransitionAllowed('pending', 'arrived' as any)).toBe(false);
    });
});

describe('what a terminal dispatch transition means for its turn', () => {
    it('maps a receipt to delivered and an uncertain effect to unknown', () => {
        expect(turnDeliveryForDispatch(event())).toEqual({ state: 'delivered', receipt: 'tg:1' });
        expect(turnDeliveryForDispatch(event({ state: 'reconciliation_required', receipt: null, errorCode: 'fetch failed' })))
            .toEqual({ state: 'unknown', receipt: null });
    });

    it('never claims delivery for a sent row without a receipt', () => {
        expect(turnDeliveryForDispatch(event({ receipt: null }))).toEqual({ state: 'unknown', receipt: null });
    });

    it('distinguishes a deliberate suppression from a failure to answer', () => {
        for (const code of ['agent_served_agent_changed', 'proactive_cancelled:x', 'human_revoked:y', 'recipient_opted_out'])
            expect(turnDeliveryForDispatch(event({ state: 'suppressed', receipt: null, errorCode: code }))?.state)
                .toBe('suppressed');
        for (const code of ['attempts_exhausted', 'telegram_400_chat_not_found', 'predecessor_not_delivered', null])
            expect(turnDeliveryForDispatch(event({ state: 'suppressed', receipt: null, errorCode: code }))?.state)
                .toBe('failed');
    });

    it('ignores a non-terminal state', () => {
        expect(turnDeliveryForDispatch(event({ state: 'failed' }))).toBeNull();
    });
});

describe('which committed rows the outbox publishes', () => {
    it('publishes terminal replies with the turn link the row carries', () => {
        expect(dispatchSettledEvent('t', 'tenant_demo', row())).toMatchObject({
            inboundMessageId: INBOUND, conversationId: CONVERSATION, state: 'sent', receipt: 'tg:1' });
        expect(dispatchSettledEvent('t', 'tenant_demo', row({ state: 'reconciliation_required', receipt: null })))
            .toMatchObject({ state: 'reconciliation_required' });
    });

    it('stays silent for retryable, proactive or redacted rows', () => {
        expect(dispatchSettledEvent('t', 'tenant_demo', row({ state: 'failed' }))).toBeNull();
        expect(dispatchSettledEvent('t', 'tenant_demo', row({ state: 'admitted' }))).toBeNull();
        expect(dispatchSettledEvent('t', 'tenant_demo', row({ originKind: 'proactive' }))).toBeNull();
        expect(dispatchSettledEvent('t', 'tenant_demo', row({ redacted: true, binding: null }))).toBeNull();
        expect(dispatchSettledEvent('t', 'tenant_demo', null)).toBeNull();
    });

    it('emits through the store without letting a listener failure escape', () => {
        const events = new EventEmitter2();
        const seen: AgentDispatchSettledEvent[] = [];
        events.on(AGENT_DISPATCH_SETTLED_EVENT, payload => { seen.push(payload); throw new Error('listener broke'); });
        const store = new AgentDispatchOutboxStore({} as any, {} as any, events);
        expect(() => (store as any).publishSettled('t', 'tenant_demo',
            [row(), row({ state: 'failed' }), row({ state: 'suppressed', errorCode: 'x' })])).not.toThrow();
        expect(seen.map(entry => entry.state)).toEqual(['sent', 'suppressed']);
    });

    it('is a no-op for a store built without an emitter (scripts, fixtures)', () => {
        const store = new AgentDispatchOutboxStore({} as any, {} as any);
        expect(() => (store as any).publishSettled('t', 'tenant_demo', [row()])).not.toThrow();
    });
});

describe('the conversations listener', () => {
    it('records the mapped state against the turn and its conversation', async () => {
        const recordDeliveryOutcome = jest.fn(async () => ({ applied: true, row: null }));
        const listener = new AgentTurnDeliveryListener({ recordDeliveryOutcome } as any);
        await listener.onDispatchSettled(event({ state: 'reconciliation_required', receipt: null, errorCode: 'fetch failed' }));
        expect(recordDeliveryOutcome).toHaveBeenCalledWith('tenant_demo', {
            inboundMessageId: INBOUND, conversationId: CONVERSATION, state: 'unknown', receipt: null });
    });

    it('does nothing for a non-terminal event and never throws', async () => {
        const recordDeliveryOutcome = jest.fn(async () => { throw new Error('db down'); });
        const listener = new AgentTurnDeliveryListener({ recordDeliveryOutcome } as any);
        await listener.onDispatchSettled(event({ state: 'failed' }));
        expect(recordDeliveryOutcome).not.toHaveBeenCalled();
        await expect(listener.onDispatchSettled(event())).resolves.toBeUndefined();
        await expect(new AgentTurnDeliveryListener().onDispatchSettled(event())).resolves.toBeUndefined();
    });
});
