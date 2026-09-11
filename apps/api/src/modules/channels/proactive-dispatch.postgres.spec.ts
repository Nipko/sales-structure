import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
    DISPATCH_OUTBOX_DDL, admitDispatch, prepareDispatchBatch, readPendingDispatch, settleDispatch,
    type DispatchBinding,
} from './agent-dispatch-outbox';
import { ProactiveDispatchService } from './proactive-dispatch.service';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';

/**
 * ═══ THE DURABLE LANE, FOR THINGS NOBODY ASKED FOR ═══
 *
 * `agent_dispatch_outbox` gives an effect eight things: a stable logical
 * identity, a decision and a payload committed BEFORE the remote effect, one
 * owner of the POST, an ACK kept separate from delivery, a safe retry across an
 * uncertain COMMIT, recovery after a restart, a receipt tied back to the
 * message, and a payload that erasure can clear.
 *
 * All of it was modelled around ANSWERING an inbound message:
 * `inbound_message_id NOT NULL`, and a hard check that the row exists in
 * `messages` with `direction = 'inbound'`. A reminder, a drip step and a
 * campaign answer nothing, so they could not write a row — which is why
 * twenty-five producers went out through BullMQ, where Redis is the only
 * record, or straight to the adapter, where there is none.
 *
 * The change is one word: `inbound_message_id` means THE ORIGIN. For a reply it
 * is still the inbound message. For a proactive effect it is a UUID derived
 * from the producer's own durable identity, so two attempts at the same effect
 * derive the same origin and the existing uniqueness makes the second one a
 * no-op.
 *
 * Real PostgreSQL, because every one of those eight guarantees is a constraint,
 * a lock or a transaction boundary.
 */
const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl ? describe : describe.skip)('the durable lane accepts a proactive effect', () => {
    const tenantId = randomUUID();
    const schema = `tenant_proactive_obx_${randomUUID().replace(/-/g, '')}`;
    const contactId = randomUUID();
    const conversationId = randomUUID();
    let client: PrismaClient;
    let prisma: any;
    jest.setTimeout(120_000);

    const sql = (text: string, params: any[] = []): Promise<any[]> =>
        prisma.executeInTenantSchema(schema, text, params);
    const tx = <T>(work: (query: any) => Promise<T>): Promise<T> =>
        prisma.transactionInTenantSchema(schema, work);

    const scope = () => ({
        tenantId, schemaName: schema, channelType: 'whatsapp',
        channelAccountId: '15550001111', agentId: randomUUID(), personaVersion: 1,
    });

    const proactive = (originKey: string, over: Partial<DispatchBinding> = {}) => ({
        conversationId, contactId,
        inboundMessageId: ProactiveDispatchService.originId(originKey),
        channelType: 'whatsapp', channelAccountId: '15550001111',
        recipient: '15559998888', ...over,
    }) as DispatchBinding;

    const prepare = (originKey: string, text = 'Te recuerdo tu turno de mañana') =>
        tx(query => prepareDispatchBatch(query, schema, {
            binding: proactive(originKey),
            items: [{ kind: 'text', payload: { text } }],
            operationalScope: scope(),
            originKind: 'proactive',
        }));

    beforeAll(async () => {
        const url = new URL(databaseUrl!);
        if (!['localhost', '127.0.0.1'].includes(url.hostname)
            || !url.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        client = new PrismaClient({ datasourceUrl: databaseUrl });
        await ensureSyntheticGlobalTables(text => client.$executeRawUnsafe(text));
        await client.$executeRawUnsafe(
            'INSERT INTO public.tenants(id,schema_name,is_active) VALUES($1::uuid,$2,true)',
            tenantId, schema);
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        await sql('CREATE TABLE contacts(id UUID PRIMARY KEY, name TEXT)');
        // `channel_account_id` is NOT NULL in production, and the binding is
        // checked on all four identifiers — a harness without it cannot see a
        // row that would leave from a connection the thread does not belong to.
        await sql(`CREATE TABLE conversations(id UUID PRIMARY KEY, contact_id UUID REFERENCES contacts(id),
            channel_type TEXT, status TEXT DEFAULT 'active', channel_account_id TEXT)`);
        await sql(`CREATE TABLE messages(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            conversation_id UUID REFERENCES conversations(id), direction TEXT, content_type TEXT,
            content_text TEXT, media_url TEXT, status TEXT, external_id TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE UNIQUE INDEX uidx_messages_external_id ON messages(external_id)
            WHERE external_id IS NOT NULL`);
        for (const statement of DISPATCH_OUTBOX_DDL) await sql(statement);
        await sql('INSERT INTO contacts(id,name) VALUES($1::uuid,$2)', [contactId, 'Ana']);
        await sql(`INSERT INTO conversations(id,contact_id,channel_type,channel_account_id)
            VALUES($1::uuid,$2::uuid,'whatsapp','15550001111')`, [conversationId, contactId]);
    });

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_proactive_obx_[a-f0-9]{32}$/.test(schema)) {
                throw new Error('invalid_cleanup_scope');
            }
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe(
                'DELETE FROM public.tenants WHERE id=$1::uuid', tenantId);
        } finally { await client.$disconnect(); }
    });

    // ── 1. A STABLE LOGICAL IDENTITY ────────────────────────────────────────

    it('derives the same origin from the same producer key, every time', () => {
        // Not `randomUUID`. An id minted inside a failed attempt is not
        // recomputable, so the retry would mint a second one and send a second
        // message — the same class of mistake as the outbound `jobId` incident.
        const once = ProactiveDispatchService.originId('appointment:abc:24h');
        expect(ProactiveDispatchService.originId('appointment:abc:24h')).toBe(once);
        expect(once).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('derives a different origin for a different effect of the same appointment', () => {
        expect(ProactiveDispatchService.originId('appointment:abc:24h'))
            .not.toBe(ProactiveDispatchService.originId('appointment:abc:2h'));
    });

    it('refuses a producer that cannot name what makes this effect this effect', () => {
        // A producer with no stable identity has nothing to retry against, and
        // saying so is better than minting a random id that turns every retry
        // into a second message.
        expect(() => ProactiveDispatchService.originId('  '))
            .toThrow('proactive_dispatch_requires_an_origin_key');
    });

    // ── 2. THE DECISION AND THE PAYLOAD, BEFORE THE REMOTE EFFECT ───────────

    it('commits a row with its payload before anything is sent', async () => {
        const { rows } = await prepare(`reminder:${randomUUID()}`);
        expect(rows).toHaveLength(1);
        expect(rows[0].state).toBe('prepared');
        expect(rows[0].payload).toEqual({ text: 'Te recuerdo tu turno de mañana' });
        const [row] = await sql(
            `SELECT origin_kind, state FROM agent_dispatch_outbox WHERE id = $1::uuid`, [rows[0].id]);
        expect(row).toEqual({ origin_kind: 'proactive', state: 'prepared' });
    });

    it('writes the history row in the same transaction, as pending', async () => {
        const { rows } = await prepare(`reminder:${randomUUID()}`);
        const [message] = await sql('SELECT status, direction FROM messages WHERE id = $1::uuid',
            [rows[0].messageId]);
        // `pending`, not `delivered`: nothing has been sent yet, and a history
        // that says otherwise is the "Sent" lie all over again.
        expect(message).toEqual({ status: 'pending', direction: 'outbound' });
    });

    // ── 3. A SAFE RETRY ACROSS AN UNCERTAIN COMMIT ──────────────────────────

    it('returns the first batch when the same effect is prepared again', async () => {
        // The producer's COMMIT acknowledgement was lost, so it tries again.
        // This is the whole reason the origin is derived rather than random.
        const key = `reminder:${randomUUID()}`;
        const first = await prepare(key);
        const second = await prepare(key);
        expect(second.batchId).toBe(first.batchId);
        expect(second.rows.map(row => row.id)).toEqual(first.rows.map(row => row.id));
        const [{ count }] = await sql(
            'SELECT count(*)::int AS count FROM agent_dispatch_outbox WHERE inbound_message_id = $1::uuid',
            [proactive(key).inboundMessageId]);
        expect(count).toBe(1);
    });

    it('refuses a second batch whose SHAPE disagrees with the first', async () => {
        // Two different results claiming one effect. Neither may silently
        // replace the other.
        const key = `reminder:${randomUUID()}`;
        await prepare(key);
        await expect(tx(query => prepareDispatchBatch(query, schema, {
            binding: proactive(key),
            items: [{ kind: 'text', payload: { text: 'a' } }, { kind: 'text', payload: { text: 'b' } }],
            operationalScope: scope(), originKind: 'proactive',
        }))).rejects.toMatchObject({ code: 'dispatch_batch_conflict' });
    });

    // ── 4. ONE OWNER OF THE POST ────────────────────────────────────────────

    it('admits exactly one attempt at a time', async () => {
        const { rows } = await prepare(`reminder:${randomUUID()}`);
        const leaseToken = randomUUID();
        const admitted = await tx(query => admitDispatch(query, schema, {
            dispatchId: rows[0].id, leaseToken, leaseSeconds: 60,
        }));
        expect(admitted.state).toBe('admitted');
        // A second holder is refused while the first one's lease is alive.
        await expect(tx(query => admitDispatch(query, schema, {
            dispatchId: rows[0].id, leaseToken: randomUUID(), leaseSeconds: 60,
        }))).rejects.toBeDefined();
    });

    // ── 5. AN ACK KEPT SEPARATE FROM DELIVERY ───────────────────────────────

    it('records the receipt without claiming the message arrived', async () => {
        const { rows } = await prepare(`reminder:${randomUUID()}`);
        const leaseToken = randomUUID();
        await tx(query => admitDispatch(query, schema, {
            dispatchId: rows[0].id, leaseToken, leaseSeconds: 60,
        }));
        await tx(query => settleDispatch(query, schema, {
            dispatchId: rows[0].id, leaseToken,
            outcome: { kind: 'sent', receipt: 'wamid.PROACTIVE' },
        }));
        const [row] = await sql(
            'SELECT state, receipt FROM agent_dispatch_outbox WHERE id = $1::uuid', [rows[0].id]);
        expect(row).toEqual({ state: 'sent', receipt: 'wamid.PROACTIVE' });
        // The history says `sent`, which is acceptance. Whether it was
        // delivered is the status webhook's answer, and the receipt is how it
        // finds this row.
        const [message] = await sql('SELECT status FROM messages WHERE id = $1::uuid',
            [rows[0].messageId]);
        expect(message.status).toBe('sent');
    });

    // ── 6. RECOVERY AFTER A RESTART ─────────────────────────────────────────

    it('is found by the recovery sweep when nothing ever published it', async () => {
        // The producer committed the row and the process died before the
        // publish. Under BullMQ-only there was nothing left to find.
        const { rows } = await prepare(`reminder:${randomUUID()}`);
        const pending = await tx(query => readPendingDispatch(query, schema, 100));
        expect(pending.map(row => row.id)).toContain(rows[0].id);
    });

    it('has its own index, because it has no inbound to sweep from', async () => {
        const [index] = await sql(
            `SELECT indexdef FROM pg_indexes
              WHERE schemaname = $1 AND indexname = 'idx_agent_dispatch_outbox_proactive'`, [schema]);
        expect(index?.indexdef).toContain("origin_kind = 'proactive'");
    });

    // ── 7. AND THE CHECK A REPLY STILL GETS ─────────────────────────────────

    it('still demands a real inbound message for a reply', async () => {
        // The relaxation is scoped to proactive effects. A reply whose inbound
        // message does not exist is still a batch that could never be tied back
        // to the customer message that caused it.
        await expect(tx(query => prepareDispatchBatch(query, schema, {
            binding: { ...proactive(`reply:${randomUUID()}`) },
            items: [{ kind: 'text', payload: { text: 'x' } }],
            operationalScope: scope(),
            // No `originKind`: the default is a reply, which is what every
            // existing caller is.
        }))).rejects.toMatchObject({ code: 'dispatch_inbound_unavailable' });
    });

    it('still refuses a binding whose conversation belongs to another contact', async () => {
        // Checked in BOTH directions. A proactive effect still writes its
        // history into a conversation, and naming somebody else's is a conflict
        // however the batch was caused.
        await expect(tx(query => prepareDispatchBatch(query, schema, {
            binding: proactive(`reminder:${randomUUID()}`, { contactId: randomUUID() }),
            items: [{ kind: 'text', payload: { text: 'x' } }],
            operationalScope: scope(), originKind: 'proactive',
        }))).rejects.toMatchObject({ code: 'dispatch_binding_changed' });
    });

    it('still refuses a batch with no operational authority', async () => {
        // Who the effect is served on behalf of is not optional just because
        // nobody asked for the effect.
        await expect(tx(query => prepareDispatchBatch(query, schema, {
            binding: proactive(`reminder:${randomUUID()}`),
            items: [{ kind: 'text', payload: { text: 'x' } }],
            operationalScope: null as any, originKind: 'proactive',
        }))).rejects.toMatchObject({ code: 'dispatch_invalid_batch' });
    });
});
