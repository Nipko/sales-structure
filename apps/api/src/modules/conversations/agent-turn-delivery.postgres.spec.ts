import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OUTBOUND_CONTRACT_VERSION } from '@parallext/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
    DISPATCH_OUTBOX_DDL, admitDispatch, expireDispatchLeases, prepareDispatchBatch,
    recordLateDispatchAcceptance, settleDispatch,
    type DispatchBinding, type DispatchItem, type DispatchOutcome, type DispatchRow,
} from '../channels/agent-dispatch-outbox';
import { AGENT_DISPATCH_SETTLED_EVENT, dispatchSettledEvent } from '../channels/agent-dispatch-events';
import {
    TURN_LEDGER_DDL, openTurnLedger, readRecentTurnOutcomes, readTurnLedger, readUndeliveredTurns,
    recordTurnDelivery, recordTurnOutcome, recordTurnResult, settleTurnLedger,
} from './agent-turn-ledger';
import { AgentTurnLedgerStore } from './agent-turn-ledger.store';
import { AgentTurnDeliveryListener } from './agent-turn-delivery.listener';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';

/**
 * ═══ DELIVERY TRUTH FOR AGENT TURNS, AGAINST A REAL POSTGRESQL ═══
 *
 * Production QA (2026-10-22): a Telegram reply died with `fetch failed`, the
 * outbox filed it as `reconciliation_required`, the customer got nothing — and
 * the turn ledger said `settled` with outcome `send`. Nothing carried the
 * outbox's verdict back to the turn.
 *
 * This drives the real chain on one schema: the ledger primitives the turn
 * writes, the outbox primitives the processor writes, the event the store
 * publishes after each terminal commit, and the conversations listener that
 * turns it into `agent_turn_ledger.delivery_state`. The link is the column both
 * tables share: the dispatch batch's origin `inbound_message_id` IS the turn's
 * inbound message id.
 */
const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl ? describe : describe.skip)('agent turn delivery truth with real PostgreSQL', () => {
    const tenantId = randomUUID();
    const schema = `tenant_turn_delivery_${randomUUID().replace(/-/g, '')}`;
    let client: PrismaClient;
    let prisma: any;
    let events: EventEmitter2;
    let listener: AgentTurnDeliveryListener;
    jest.setTimeout(90_000);

    const sql = (text: string, params: any[] = []): Promise<any[]> =>
        prisma.executeInTenantSchema(schema, text, params);
    const tx = <T>(work: (query: any) => Promise<T>): Promise<T> =>
        prisma.transactionInTenantSchema(schema, work);

    const scope = { kind: 'agent', tenantId, schemaName: schema, agentId: randomUUID(), version: 1,
        operationalHash: 'a'.repeat(64) };

    beforeAll(async () => {
        const url = new URL(databaseUrl!);
        if (!['localhost', '127.0.0.1'].includes(url.hostname) || !url.pathname.endsWith('_eval_isolation'))
            throw new Error('disposable_loopback_database_required');
        client = new PrismaClient({ datasourceUrl: databaseUrl });
        await ensureSyntheticGlobalTables(statement => client.$executeRawUnsafe(statement));
        await client.$executeRawUnsafe(
            'INSERT INTO public.tenants(id,schema_name,is_active) VALUES($1::uuid,$2,true)', tenantId, schema);
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        await sql('CREATE TABLE contacts(id UUID PRIMARY KEY, name TEXT)');
        await sql(`CREATE TABLE conversations(id UUID PRIMARY KEY, contact_id UUID REFERENCES contacts(id),
            channel_type TEXT, status TEXT DEFAULT 'active', channel_account_id TEXT)`);
        await sql(`CREATE TABLE messages(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            conversation_id UUID REFERENCES conversations(id), direction TEXT, content_type TEXT,
            content_text TEXT, media_url TEXT, status TEXT, external_id TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW())`);
        for (const statement of DISPATCH_OUTBOX_DDL) await sql(statement);
        for (const statement of TURN_LEDGER_DDL) await sql(statement);

        // The production wiring: the listener is subscribed to the event the
        // outbox store publishes, through a real emitter.
        listener = new AgentTurnDeliveryListener(new AgentTurnLedgerStore(prisma));
        events = new EventEmitter2();
        events.on(AGENT_DISPATCH_SETTLED_EVENT, event => listener.onDispatchSettled(event));
    });

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_turn_delivery_[a-f\d]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2',
                tenantId, schema);
        } finally { await client.$disconnect(); }
    });

    /** What the store does after each committed transition. */
    async function publish(row: DispatchRow): Promise<void> {
        const event = dispatchSettledEvent(tenantId, schema, row);
        if (event) await events.emitAsync(AGENT_DISPATCH_SETTLED_EVENT, event);
    }

    /** A customer wrote, the agent decided to `send`, the outbox owns delivery, the turn settled. */
    async function settledSendTurn(items: DispatchItem[] = [{ kind: 'text', payload: { text: 'Hola, ¿en qué te ayudo?' } }]) {
        const contactId = randomUUID(), conversationId = randomUUID(), inboundMessageId = randomUUID();
        await sql("INSERT INTO contacts VALUES($1::uuid,'Cliente sintético')", [contactId]);
        await sql(`INSERT INTO conversations(id,contact_id,channel_type,status,channel_account_id)
            VALUES($1::uuid,$2::uuid,'telegram','active','tg-main')`, [conversationId, contactId]);
        await sql(`INSERT INTO messages(id,conversation_id,direction,content_type,content_text,status)
            VALUES($1::uuid,$2::uuid,'inbound','text','Hola','delivered')`, [inboundMessageId, conversationId]);
        const binding: DispatchBinding = { conversationId, contactId, inboundMessageId,
            channelType: 'telegram', channelAccountId: 'tg-main', recipient: '123456789' };
        await tx(query => openTurnLedger(query, schema, binding));
        await tx(query => recordTurnResult(query, schema, { inboundMessageId,
            envelope: { text: 'Hola', chunks: ['Hola'], paymentLinks: [], media: [], learningFootprints: [] } }));
        await tx(query => recordTurnOutcome(query, schema, { inboundMessageId,
            outcome: { version: OUTBOUND_CONTRACT_VERSION, kind: 'send', effects: [] } }));
        const { rows } = await tx(query => prepareDispatchBatch(query, schema,
            { binding, items, operationalScope: scope as any }));
        await tx(query => recordTurnDelivery(query, schema, { inboundMessageId, route: 'durable' }));
        const settled = await tx(query => settleTurnLedger(query, schema, inboundMessageId));
        return { binding, rows, settled: settled! };
    }

    async function attempt(dispatchId: string, outcome: DispatchOutcome) {
        const leaseToken = randomUUID();
        await tx(query => admitDispatch(query, schema, { dispatchId, leaseToken, leaseSeconds: 60 }));
        const row = await tx(query => settleDispatch(query, schema, { dispatchId, leaseToken, outcome }));
        await publish(row);
        return { row, leaseToken };
    }

    const ledger = (inboundMessageId: string) => tx(query => readTurnLedger(query, schema, inboundMessageId));

    it('starts a send-settled turn as pending: settled is not delivered', async () => {
        const { settled } = await settledSendTurn();
        expect(settled.state).toBe('settled');
        expect(settled.outcome?.kind).toBe('send');
        expect(settled.deliveryState).toBe('pending');
        expect(settled.answeredAt).toBeNull();
    });

    it('moves to delivered on the provider receipt, with the receipt and the moment it was answered', async () => {
        const { binding, rows } = await settledSendTurn();
        await attempt(rows[0].id, { kind: 'sent', receipt: 'tg:5501' });
        const row = await ledger(binding.inboundMessageId);
        expect(row?.deliveryState).toBe('delivered');
        expect(row?.deliveryReceipt).toBe('tg:5501');
        expect(row?.answeredAt).toBeInstanceOf(Date);
    });

    it('moves to failed on a permanent provider refusal', async () => {
        const { binding, rows } = await settledSendTurn();
        await attempt(rows[0].id, { kind: 'suppressed', errorCode: 'telegram_400_chat_not_found' });
        const row = await ledger(binding.inboundMessageId);
        expect(row?.deliveryState).toBe('failed');
        expect(row?.answeredAt).toBeNull();
    });

    it('records reconciliation_required as unknown — the production fetch-failed case — and a late receipt still delivers it', async () => {
        const { binding, rows } = await settledSendTurn();
        const { leaseToken } = await attempt(rows[0].id, { kind: 'reconciliation_required', errorCode: 'fetch failed' });
        expect((await ledger(binding.inboundMessageId))?.deliveryState).toBe('unknown');

        const late = await tx(query => recordLateDispatchAcceptance(query, schema,
            { dispatchId: rows[0].id, leaseToken, receipt: 'tg:late-1' }));
        await publish(late);
        const row = await ledger(binding.inboundMessageId);
        expect(row?.deliveryState).toBe('delivered');
        expect(row?.deliveryReceipt).toBe('tg:late-1');
    });

    it('records an expired lease (the recovery pass) as unknown', async () => {
        const { binding, rows } = await settledSendTurn();
        await tx(query => admitDispatch(query, schema, { dispatchId: rows[0].id, leaseToken: randomUUID(), leaseSeconds: 5 }));
        await sql(`UPDATE agent_dispatch_outbox SET lease_expires_at = NOW() - INTERVAL '1 second' WHERE id=$1::uuid`,
            [rows[0].id]);
        const expired = await tx(query => expireDispatchLeases(query, schema, 100));
        for (const row of expired) await publish(row);
        expect((await ledger(binding.inboundMessageId))?.deliveryState).toBe('unknown');
    });

    it('never downgrades delivered: a later item that fails or goes uncertain changes nothing', async () => {
        const { binding, rows } = await settledSendTurn([
            { kind: 'text', payload: { text: 'Primera burbuja' } },
            { kind: 'text', payload: { text: 'Segunda burbuja' } },
            { kind: 'text', payload: { text: 'Tercera burbuja' } },
        ]);
        await attempt(rows[0].id, { kind: 'sent', receipt: 'tg:first' });
        const delivered = await ledger(binding.inboundMessageId);
        await attempt(rows[1].id, { kind: 'reconciliation_required', errorCode: 'fetch failed' });
        await attempt(rows[2].id, { kind: 'suppressed', errorCode: 'telegram_403_blocked' });
        const row = await ledger(binding.inboundMessageId);
        expect(row?.deliveryState).toBe('delivered');
        expect(row?.deliveryReceipt).toBe('tg:first');
        expect(row?.answeredAt?.getTime()).toBe(delivered?.answeredAt?.getTime());
    });

    it('treats duplicate events as no-ops', async () => {
        const { binding, rows } = await settledSendTurn();
        const { row: sent } = await attempt(rows[0].id, { kind: 'sent', receipt: 'tg:dup' });
        const first = await ledger(binding.inboundMessageId);
        await publish(sent);
        await publish(sent);
        const store = new AgentTurnLedgerStore(prisma);
        const again = await store.recordDeliveryOutcome(schema, { inboundMessageId: binding.inboundMessageId,
            conversationId: binding.conversationId, state: 'delivered', receipt: 'tg:dup' });
        expect(again?.applied).toBe(false);
        const row = await ledger(binding.inboundMessageId);
        expect(row?.deliveryState).toBe('delivered');
        expect(row?.answeredAt?.getTime()).toBe(first?.answeredAt?.getTime());

        // And a duplicate failure on a failed turn is equally inert.
        const failedTurn = await settledSendTurn();
        await attempt(failedTurn.rows[0].id, { kind: 'suppressed', errorCode: 'attempts_exhausted' });
        const failedOnce = await ledger(failedTurn.binding.inboundMessageId);
        const repeat = await store.recordDeliveryOutcome(schema, {
            inboundMessageId: failedTurn.binding.inboundMessageId, state: 'failed' });
        expect(repeat?.applied).toBe(false);
        const unknownAfterFailed = await store.recordDeliveryOutcome(schema, {
            inboundMessageId: failedTurn.binding.inboundMessageId, state: 'unknown' });
        expect(unknownAfterFailed?.applied).toBe(false);
        expect((await ledger(failedTurn.binding.inboundMessageId))?.deliveryState).toBe('failed');
        expect(failedOnce?.deliveryState).toBe('failed');
    });

    it('keeps a receipt that won the race against the settle of its own turn', async () => {
        const contactId = randomUUID(), conversationId = randomUUID(), inboundMessageId = randomUUID();
        await sql("INSERT INTO contacts VALUES($1::uuid,'Cliente sintético')", [contactId]);
        await sql(`INSERT INTO conversations(id,contact_id,channel_type,status,channel_account_id)
            VALUES($1::uuid,$2::uuid,'telegram','active','tg-main')`, [conversationId, contactId]);
        await sql(`INSERT INTO messages(id,conversation_id,direction,content_type,content_text,status)
            VALUES($1::uuid,$2::uuid,'inbound','text','Hola','delivered')`, [inboundMessageId, conversationId]);
        const binding: DispatchBinding = { conversationId, contactId, inboundMessageId,
            channelType: 'telegram', channelAccountId: 'tg-main', recipient: '123456789' };
        await tx(query => openTurnLedger(query, schema, binding));
        await tx(query => recordTurnResult(query, schema, { inboundMessageId,
            envelope: { text: 'Hola', chunks: ['Hola'], paymentLinks: [], media: [], learningFootprints: [] } }));
        await tx(query => recordTurnOutcome(query, schema, { inboundMessageId,
            outcome: { version: OUTBOUND_CONTRACT_VERSION, kind: 'send', effects: [] } }));
        const { rows } = await tx(query => prepareDispatchBatch(query, schema, { binding,
            items: [{ kind: 'text', payload: { text: 'Hola' } }], operationalScope: scope as any }));
        await tx(query => recordTurnDelivery(query, schema, { inboundMessageId, route: 'durable' }));
        // The first bubble is accepted before runTurn returns...
        await attempt(rows[0].id, { kind: 'sent', receipt: 'tg:fast' });
        // ...and the settle that follows must not pull it back to pending.
        const settled = await tx(query => settleTurnLedger(query, schema, inboundMessageId));
        expect(settled?.deliveryState).toBe('delivered');
    });

    it('refuses to write delivery into another conversation\'s turn', async () => {
        const { binding } = await settledSendTurn();
        const store = new AgentTurnLedgerStore(prisma);
        const result = await store.recordDeliveryOutcome(schema, { inboundMessageId: binding.inboundMessageId,
            conversationId: randomUUID(), state: 'delivered', receipt: 'tg:wrong' });
        expect(result?.applied).toBe(false);
        expect((await ledger(binding.inboundMessageId))?.deliveryState).toBe('pending');
    });

    it('exposes delivery state to the recent-outcomes reader and counts the unanswered for Ops', async () => {
        const answered = await settledSendTurn();
        await attempt(answered.rows[0].id, { kind: 'sent', receipt: 'tg:ok' });
        const lost = await settledSendTurn();
        await attempt(lost.rows[0].id, { kind: 'reconciliation_required', errorCode: 'fetch failed' });
        const waiting = await settledSendTurn();

        const recent = await tx(query => readRecentTurnOutcomes(query, schema,
            { conversationId: lost.binding.conversationId, since: new Date(Date.now() - 3600_000) }));
        expect(recent.map(entry => entry.deliveryState)).toEqual(['unknown']);

        // Fresh turns are inside the grace period and must not page anyone.
        const fresh = await tx(query => readUndeliveredTurns(query, schema, { olderThanMinutes: 5 }));
        expect(fresh.total).toBe(0);

        await sql(`UPDATE agent_turn_ledger SET created_at = NOW() - INTERVAL '10 minutes'
                    WHERE inbound_message_id = ANY($1::uuid[])`,
            [[answered.binding.inboundMessageId, lost.binding.inboundMessageId, waiting.binding.inboundMessageId]]);
        const overdue = await tx(query => readUndeliveredTurns(query, schema, { olderThanMinutes: 5 }));
        expect(overdue.unknown).toBeGreaterThanOrEqual(1);
        expect(overdue.pending).toBeGreaterThanOrEqual(1);
        // The answered one is never counted, however old.
        const counted = await sql(`SELECT inbound_message_id FROM agent_turn_ledger
            WHERE delivery_state IN ('pending','unknown','failed') AND inbound_message_id = $1::uuid`,
            [answered.binding.inboundMessageId]);
        expect(counted).toHaveLength(0);
        expect(overdue.total).toBe(overdue.pending + overdue.unknown + overdue.failed);
    });
});
