jest.mock('../../common/utils/subscription-entitlement.util', () => ({
    ...jest.requireActual('../../common/utils/subscription-entitlement.util'),
    resolveTenantSubscriptionAccess: jest.fn().mockResolvedValue({ allowed: true }),
}));

import { assertTurnOutcome } from '@parallext/shared';
import { ConversationsService } from './conversations.service';
import { HandoffService } from '../handoff/handoff.service';
import { noDataWaitReplacementText } from './human-offer';
import { SETTLED_WITHOUT_DECISION, deterministicTurnOutcome, settleTurnLedger } from './agent-turn-ledger';
import { AgentTurnLedgerStore } from './agent-turn-ledger.store';

/**
 * Production 2026-10-23, 12 times in ~1.5 h across 4 tenants:
 *
 *   ERROR: new row for relation "agent_turn_ledger" violates check constraint "agent_turn_ledger_result"
 *   [TurnLedger] turn dd0f8ee1-… is UNSETTLED and recoverable
 *
 * The failing turn was «Sí, por favor pregúntele a alguien del equipo y me avisa por aquí» answering our offer of a person:
 * runTurn transferred, sent the fixed notice and returned before the model, so the row reached the settle with no envelope,
 * no outcome and no hand-off — and `CHECK (state = 'open' OR envelope IS NOT NULL OR outcome IS NOT NULL OR redacted_at IS
 * NOT NULL)` refused it. About 25 such rows stayed `open` in the 7 QA tenants.
 *
 * Driven through the real `processIncomingMessage` → `runTurn` → `replyOnceThroughOutbox` → settle, against a ledger double
 * that applies the same constraint the table does.
 */
const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const CONTACT_ID = '22222222-2222-4222-8222-222222222222';
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333';
const LEAD_ID = '44444444-4444-4444-8444-444444444444';
const INBOUND_ID = '88888888-8888-4888-8888-888888888888';
const SCHEMA = 'tenant_ledger_settle';
const PRODUCTION_ACCEPTANCE = 'Sí, por favor pregúntele a alguien del equipo y me avisa por aquí';

/** The table's own rule, applied to the row the double holds. */
const satisfiesResultConstraint = (row: any) =>
    row.state === 'open' || row.envelope !== null || row.outcome !== null || row.redacted === true;

function ledgerDouble() {
    const row: any = { state: 'open', envelope: null, outcome: null, handoff: null, redacted: false };
    const order: string[] = [];
    const violations: string[] = [];
    const ledger = {
        row, order, violations,
        open: jest.fn(async () => ({ ...row, attempts: 1, writers: [] })),
        read: jest.fn(async () => ({ ...row, writers: [] })),
        recordResult: jest.fn(async (_s: string, input: any) => {
            row.envelope = input.envelope; row.state = 'result_recorded'; return { ...row };
        }),
        recordDelivery: jest.fn(async () => { if (row.state !== 'settled') row.state = 'dispatch_owned'; }),
        recordHandoff: jest.fn(async (_s: string, _id: string, handoff: any) => { row.handoff = handoff; order.push('handoff'); }),
        recordOutcome: jest.fn(async (_s: string, _id: string, outcome: any, options: any = {}) => {
            assertTurnOutcome(outcome);
            order.push(`outcome:${outcome.kind}`);
            if (options.onlyIfUndecided && row.outcome) return;
            row.outcome = outcome;
        }),
        recentOutcomes: jest.fn(async () => []),
        // What PostgreSQL does with the UPDATE the store sends: refuse a bare row.
        settle: jest.fn(async () => {
            const next = { ...row, state: 'settled' };
            if (!satisfiesResultConstraint(next)) {
                violations.push('agent_turn_ledger_result');
                return false;
            }
            row.state = 'settled';
            return true;
        }),
    };
    return ledger;
}

function turn(text: string, options: {
    lastOutbound?: string | null; ledger?: ReturnType<typeof ledgerDouble>; optOut?: boolean;
} = {}) {
    const ledger = options.ledger ?? ledgerDouble();
    const handoff: any = Object.create(HandoffService.prototype);
    Object.assign(handoff, {
        llmRouter: { execute: jest.fn().mockRejectedValue(new Error('classifier down')) },
        logger: { warn: jest.fn(), log: jest.fn() },
        executeHandoff: jest.fn().mockResolvedValue({ assignedTo: null, receipt: { id: 'receipt-1' } }),
        isInHandoff: jest.fn().mockResolvedValue(false),
    });
    const lastOutbound = options.lastOutbound === undefined ? noDataWaitReplacementText('es') : options.lastOutbound;
    const prisma = {
        executeInTenantSchema: jest.fn(async (_schema: string, sql: string) => {
            if (sql.includes('to_regclass')) return [{ t: 'agent_dispatch_outbox' }];
            if (sql.includes('COUNT(*) as cnt')) return [{ cnt: 1 }];
            if (/direction = 'outbound'/.test(sql) && lastOutbound) return [{ content_text: lastOutbound, created_at: new Date() }];
            return [];
        }),
        transactionInTenantSchema: jest.fn(async (_s: string, cb: (tx: any) => Promise<unknown>) => cb(jest.fn(async () => []))),
    };
    const sends: any[] = [];
    const service: any = Object.create(ConversationsService.prototype);
    Object.assign(service, {
        logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        prisma,
        turnLedger: ledger,
        pipelineService: { autoProgressFromConversation: jest.fn().mockResolvedValue(undefined), isAutoProgressEnabled: jest.fn().mockResolvedValue(false) },
        redis: {
            acquireLockToken: jest.fn().mockResolvedValue('owned'), releaseLockToken: jest.fn().mockResolvedValue(true),
            renewLockToken: jest.fn().mockResolvedValue(true), get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue(undefined),
        },
        languageDetector: { detect: jest.fn().mockReturnValue('es') },
        debounceBurst: jest.fn().mockResolvedValue(undefined),
        resolveConversation: jest.fn(async () => ({
            contact: { id: CONTACT_ID }, lead: { id: LEAD_ID },
            conversation: { id: CONVERSATION_ID, contact_id: CONTACT_ID, status: 'active', updated_at: new Date(), metadata: {} },
        })),
        tenantSchema: jest.fn().mockResolvedValue(SCHEMA),
        analyticsService: { trackEvent: jest.fn().mockResolvedValue(undefined) },
        nurturingService: { cancelFollowUp: jest.fn().mockResolvedValue(undefined), scheduleFollowUp: jest.fn().mockResolvedValue(undefined) },
        dripSequenceService: { stopOnReply: jest.fn().mockResolvedValue(undefined) },
        leadScoring: { scoreAfterMessage: jest.fn().mockResolvedValue(undefined) },
        personaService: { resolvePersonaForChannel: jest.fn().mockResolvedValue({
            config: { language: 'es', hours: { aiOutsideHours: true }, behavior: { handoffTriggers: [] } },
            agentId: '77777777-7777-4777-8777-777777777777', version: 1, operationalHash: 'a'.repeat(64),
        }) },
        llmRouter: { analyzeComplexity: () => 0, analyzeSentiment: () => 0 },
        throttle: {
            getAiMessageUsage: jest.fn().mockResolvedValue({ used: 0, limit: Infinity }),
            reserveAiMessageCount: jest.fn().mockResolvedValue({ allowed: true }),
            commitAiMessageCount: jest.fn().mockResolvedValue(undefined),
            releaseAiMessageCount: jest.fn().mockResolvedValue(undefined),
        },
        handoffService: handoff,
        complianceService: {
            detectOptOut: jest.fn().mockReturnValue(options.optOut === true),
            processOptOut: jest.fn().mockResolvedValue(undefined),
        },
        isWithinBusinessHours: jest.fn().mockReturnValue(true),
        loadTenantBusinessHours: jest.fn().mockResolvedValue(null),
        persistConversationPersonaResolution: jest.fn().mockResolvedValue(undefined),
        sendTypingIndicatorQuietly: jest.fn().mockResolvedValue(undefined),
        saveMessage: jest.fn().mockResolvedValue({ id: INBOUND_ID, duplicate: false }),
        saveAiMessage: jest.fn().mockResolvedValue(undefined), recordAgentSignal: jest.fn(),
        generateResponse: jest.fn().mockResolvedValue('Respuesta del agente.'),
        dispatchReplyThroughOutbox: jest.fn().mockResolvedValue(true),
        resumeOwnedDispatchBatch: jest.fn().mockResolvedValue(false),
        // The real `replyOnceThroughOutbox` runs; only the transport under it is a double.
        channelGateway: { getStrictTransport: jest.fn().mockReturnValue({}) },
        proactiveDispatch: { send: jest.fn(async (_tenant: string, input: any) => {
            ledger.order.push(`send:${input.originKey}`);
            sends.push(input);
            return { kind: 'prepared' };
        }) },
    });
    const message: any = {
        id: 'provider-message', tenantId: TENANT_ID, contactId: '7915652977', channelType: 'telegram',
        channelAccountId: 'paralllyqa_tienda_b9b84e_bot', content: { type: 'text', text }, metadata: {},
    };
    return { service, ledger, handoff, sends, message, run: () => service.processIncomingMessage(message) };
}

describe('the accepted human offer settles its turn (production 2026-10-23)', () => {
    it.each([PRODUCTION_ACCEPTANCE, 'sí', 'Sí, por favor'])(
        '«%s» after the offer: transfer, one notice, and a row the constraint accepts', async text => {
            const t = turn(text);
            await t.run();

            expect(t.handoff.executeHandoff).toHaveBeenCalledTimes(1);
            expect(t.service.generateResponse).not.toHaveBeenCalled();
            expect(t.sends.map(send => send.originKey)).toEqual([`handoff-notice:${INBOUND_ID}`]);

            // The decision is on the row BEFORE the notice leaves, like the model path's envelope.
            expect(t.ledger.order.indexOf('outcome:escalate')).toBeGreaterThanOrEqual(0);
            expect(t.ledger.order.indexOf('outcome:escalate'))
                .toBeLessThan(t.ledger.order.indexOf(`send:handoff-notice:${INBOUND_ID}`));
            const reason = t.handoff.executeHandoff.mock.calls[0][3];
            expect(t.ledger.row.outcome).toMatchObject({ kind: 'escalate', reason: `handoff:${reason}`, effects: [] });
            expect(t.ledger.row.handoff).toEqual({ reason, noticeKind: 'handoff_notice', receiptId: 'receipt-1' });

            // The settle the production log refused now goes through.
            expect(t.ledger.settle).toHaveBeenCalledWith(SCHEMA, INBOUND_ID, 'processIncomingMessage');
            expect(t.ledger.violations).toEqual([]);
            expect(t.ledger.row.state).toBe('settled');
            expect(satisfiesResultConstraint(t.ledger.row)).toBe(true);
        });

    it('a bare «sí» is the acceptance itself', async () => {
        const t = turn('sí');
        await t.run();
        expect(t.handoff.executeHandoff.mock.calls[0][3]).toBe('customer_accepted_human_offer');
        expect(t.ledger.row.outcome.reason).toBe('handoff:customer_accepted_human_offer');
    });

    it('a redelivery of the settled inbound sends nothing and transfers nobody again', async () => {
        const first = turn(PRODUCTION_ACCEPTANCE);
        await first.run();
        const again = turn(PRODUCTION_ACCEPTANCE, { ledger: first.ledger });
        await again.run();
        expect(again.handoff.executeHandoff).not.toHaveBeenCalled();
        expect(again.sends).toEqual([]);
        expect(first.ledger.violations).toEqual([]);
    });
});

describe('the other deterministic early returns settle with their own decision', () => {
    it('a keyword request for a person (no offer pending) records the hand-off', async () => {
        const t = turn('quiero hablar con una persona', { lastOutbound: null });
        await t.run();
        expect(t.handoff.executeHandoff).toHaveBeenCalledTimes(1);
        expect(t.ledger.row.outcome).toMatchObject({ kind: 'escalate' });
        expect(t.ledger.violations).toEqual([]);
        expect(t.ledger.row.state).toBe('settled');
    });

    it('an opt-out says nothing and records that silence', async () => {
        const t = turn('STOP', { lastOutbound: null, optOut: true });
        await t.run();
        expect(t.sends).toEqual([]);
        expect(t.ledger.row.outcome).toMatchObject({ kind: 'suppress', reason: 'customer_opted_out', effects: [] });
        expect(t.ledger.violations).toEqual([]);
    });

    it('the quota fallback is a fixed reply and records a send named after it', async () => {
        const t = turn('hola', { lastOutbound: null });
        t.service.throttle.reserveAiMessageCount.mockResolvedValue({ allowed: false });
        t.service.buildQuotaFallbackMessage = jest.fn().mockResolvedValue('Fuera de cupo.');
        t.service.eventEmitter = { emit: jest.fn() };
        await t.run();
        expect(t.sends.map(send => send.originKey)).toEqual([`quota-fallback:${INBOUND_ID}`]);
        expect(t.ledger.row.outcome).toMatchObject({ kind: 'send', reason: 'fixed_reply:quota-fallback' });
        expect(t.ledger.violations).toEqual([]);
    });

    it('a fixed reply never overwrites a decision the turn already recorded (the stalled-ask route)', async () => {
        const t = turn('hola', { lastOutbound: null });
        (t.message as any).turnLedgerRef = { schemaName: SCHEMA, inboundMessageId: INBOUND_ID };
        t.ledger.row.outcome = deterministicTurnOutcome('escalate', 'stalled_ask_route');
        await t.service.replyOnceThroughOutbox({
            tenantId: TENANT_ID,
            conversation: { id: CONVERSATION_ID, contact_id: CONTACT_ID },
            msg: t.message, operationalScope: {}, inboundMessageId: INBOUND_ID,
            item: { kind: 'text', payload: { text: 'Le paso con el equipo.' } },
            originKey: `stalled-ask-route:${INBOUND_ID}`,
        });
        expect(t.ledger.row.outcome.reason).toBe('stalled_ask_route');
    });

    it('a notice with its own identity (the queue notice) is not this turn\'s answer and records nothing', async () => {
        const t = turn('hola', { lastOutbound: null });
        (t.message as any).turnLedgerRef = { schemaName: SCHEMA, inboundMessageId: INBOUND_ID };
        await t.service.replyOnceThroughOutbox({
            tenantId: TENANT_ID,
            conversation: { id: CONVERSATION_ID, contact_id: CONTACT_ID },
            msg: t.message, operationalScope: {}, inboundMessageId: INBOUND_ID,
            item: { kind: 'text', payload: { text: 'Sigue en espera.' } },
            originKey: `handoff-queue-notice:${CONVERSATION_ID}:x`, ownIdentity: true,
        });
        expect(t.ledger.recordOutcome).not.toHaveBeenCalled();
    });
});

describe('the settle itself never hits the result constraint with a bare row', () => {
    const settledRow = (bare: boolean) => ({
        id: 'row', inbound_message_id: INBOUND_ID, conversation_id: CONVERSATION_ID, contact_id: CONTACT_ID,
        channel_type: 'telegram', state: 'settled', attempts: 1, operational_scope: {}, writers: [],
        envelope: null, outcome: bare ? deterministicTurnOutcome('suppress', SETTLED_WITHOUT_DECISION) : { kind: 'send' },
        delivery_route: 'unknown', created_at: new Date(), settled_bare: bare,
    });

    it('closes a bare row with a valid, named outcome in the same statement, and says so', async () => {
        const calls: any[] = [];
        const query: any = jest.fn(async (sql: string, params: any[]) => { calls.push({ sql, params }); return [settledRow(true)]; });
        const onFallback = jest.fn();
        const row = await settleTurnLedger(query, SCHEMA, INBOUND_ID, { onFallback });
        expect(onFallback).toHaveBeenCalledTimes(1);
        expect(row?.state).toBe('settled');
        const fallback = JSON.parse(calls[0].params[1]);
        expect(() => assertTurnOutcome(fallback)).not.toThrow();
        expect(fallback).toMatchObject({ kind: 'suppress', reason: SETTLED_WITHOUT_DECISION, effects: [] });
        // Only a row with nothing on it takes the fallback; anything recorded is kept.
        expect(calls[0].sql).toMatch(/envelope IS NULL AND outcome IS NULL\s+AND redacted_at IS NULL/);
        expect(calls[0].sql).toMatch(/outcome = CASE WHEN prior\.bare THEN \$2::jsonb ELSE l\.outcome END/);
    });

    it('leaves a row that carries a decision exactly as it was', async () => {
        const query: any = jest.fn(async () => [settledRow(false)]);
        const onFallback = jest.fn();
        await settleTurnLedger(query, SCHEMA, INBOUND_ID, { onFallback });
        expect(onFallback).not.toHaveBeenCalled();
    });

    it('the store names the caller path in ONE warning and reports the turn settled', async () => {
        const prisma: any = {
            transactionInTenantSchema: jest.fn(async (_schema: string, work: any) => work(jest.fn(async (sql: string) =>
                /UPDATE/.test(sql) ? [settledRow(true)] : []))),
        };
        const store = new AgentTurnLedgerStore(prisma);
        const warn = jest.spyOn((store as any).logger, 'warn').mockImplementation(() => undefined);
        const error = jest.spyOn((store as any).logger, 'error').mockImplementation(() => undefined);
        await expect(store.settle(SCHEMA, INBOUND_ID, 'processIncomingMessage')).resolves.toBe(true);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).toContain('via processIncomingMessage');
        expect(error).not.toHaveBeenCalled();
    });
});
