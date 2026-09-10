import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
    DISPATCH_MAX_ATTEMPTS, DISPATCH_OUTBOX_DDL, DispatchOutboxError,
    admitDispatch, applyDispatchProviderStatus, expireDispatchLeases, markDispatchQueued,
    prepareDispatchBatch, readDispatchRow,
    readNextDispatchInBatch, readPendingDispatch, redactDispatchOutbox, redactSettledDispatchOutbox, settleDispatch,
    type DispatchBinding, type DispatchItem,
} from './agent-dispatch-outbox';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';

const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl ? describe : describe.skip)('normal dispatch outbox with real PostgreSQL', () => {
    const tenantId = randomUUID();
    const schema = `tenant_dispatch_obx_${randomUUID().replace(/-/g, '')}`;
    let client: PrismaClient, prisma: any;
    let second: PrismaClient, secondPrisma: any;

    const sql = (text: string, params: any[] = []): Promise<any[]> =>
        prisma.executeInTenantSchema(schema, text, params);
    const tx = <T>(work: (query: any) => Promise<T>): Promise<T> =>
        prisma.transactionInTenantSchema(schema, work);
    /** A genuinely separate connection, so the locks under test are real. */
    const racer = <T>(work: (query: any) => Promise<T>): Promise<T> =>
        secondPrisma.transactionInTenantSchema(schema, work);
    const code = async (pending: Promise<unknown>): Promise<string> => {
        try { await pending; } catch (error) {
            if (error instanceof DispatchOutboxError) return error.code;
            return `unexpected:${(error as Error).message}`;
        }
        return 'no_error';
    };

    beforeAll(async () => {
        const url = new URL(databaseUrl!);
        if (!['localhost', '127.0.0.1'].includes(url.hostname) || !url.pathname.endsWith('_eval_isolation'))
            throw new Error('disposable_loopback_database_required');
        client = new PrismaClient({ datasourceUrl: databaseUrl });
        await ensureSyntheticGlobalTables(sql => client.$executeRawUnsafe(sql));
        await client.$executeRawUnsafe(
            'INSERT INTO public.tenants(id,schema_name,is_active) VALUES($1::uuid,$2,true)', tenantId, schema);
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        second = new PrismaClient({ datasourceUrl: databaseUrl });
        secondPrisma = Object.create(PrismaService.prototype);
        secondPrisma.$transaction = second.$transaction.bind(second);
        await sql('CREATE TABLE contacts(id UUID PRIMARY KEY, name TEXT)');
        await sql(`CREATE TABLE conversations(id UUID PRIMARY KEY, contact_id UUID REFERENCES contacts(id),
            channel_type TEXT, status TEXT DEFAULT 'active')`);
        await sql(`CREATE TABLE messages(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            conversation_id UUID REFERENCES conversations(id), direction TEXT, content_type TEXT,
            content_text TEXT, media_url TEXT, status TEXT, external_id TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE UNIQUE INDEX uidx_messages_external_id ON messages(external_id)
            WHERE external_id IS NOT NULL`);
        for (const statement of DISPATCH_OUTBOX_DDL) await sql(statement);
    });

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_dispatch_obx_[a-f\d]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2',
                tenantId, schema);
        } finally { await client.$disconnect(); await second?.$disconnect(); }
    });

    beforeEach(async () => {
        await sql('TRUNCATE agent_dispatch_outbox_sources, agent_dispatch_outbox, messages, conversations, contacts CASCADE');
    });

    const scope = { kind: 'agent', tenantId, schemaName: schema, agentId: randomUUID(), version: 1,
        operationalHash: 'a'.repeat(64) };

    async function fixture(): Promise<DispatchBinding> {
        const contactId = randomUUID(), conversationId = randomUUID(), inboundMessageId = randomUUID();
        await sql("INSERT INTO contacts VALUES($1::uuid,'Cliente sintético')", [contactId]);
        await sql("INSERT INTO conversations VALUES($1::uuid,$2::uuid,'whatsapp','active')",
            [conversationId, contactId]);
        await sql(`INSERT INTO messages(id,conversation_id,direction,content_type,content_text,status)
            VALUES($1::uuid,$2::uuid,'inbound','text','Necesito ayuda','delivered')`,
            [inboundMessageId, conversationId]);
        return { conversationId, contactId, inboundMessageId,
            channelType: 'whatsapp', channelAccountId: 'wa-main', recipient: '+573000000000' };
    }

    const items: DispatchItem[] = [
        { kind: 'media', payload: { mediaUrl: 'https://example.test/a.jpg' } },
        { kind: 'text', payload: { text: 'La foto del producto' } },
    ];
    const prepare = (binding: DispatchBinding, over: Partial<Parameters<typeof prepareDispatchBatch>[2]> = {}) =>
        tx(query => prepareDispatchBatch(query, schema, { binding, items, operationalScope: scope, ...over }));
    const admit = (dispatchId: string, leaseToken = randomUUID(), leaseSeconds = 60) =>
        tx(query => admitDispatch(query, schema, { dispatchId, leaseToken, leaseSeconds }));

    describe('preparing a batch', () => {
        it('records one row per remote effect, in order, before anything is published', async () => {
            const binding = await fixture();
            const { batchId, rows } = await prepare(binding);
            expect(rows.map(row => [row.itemIndex, row.itemKind, row.state, row.attempts]))
                .toEqual([[0, 'media', 'prepared', 0], [1, 'text', 'prepared', 0]]);
            // A caption is its own effect with its own future receipt: the image
            // must never be resent because only the caption failed.
            expect(new Set(rows.map(row => row.id)).size).toBe(2);
            expect(rows.every(row => row.batchId === batchId)).toBe(true);
            expect(rows[1].payload).toEqual({ text: 'La foto del producto' });
            expect(rows[0].binding).toEqual(binding);
        });

        it('returns what was already recorded for the same inbound instead of a second batch', async () => {
            const binding = await fixture();
            const first = await prepare(binding);
            const again = await prepare(binding);
            expect(again.batchId).toBe(first.batchId);
            expect(again.rows.map(row => row.id)).toEqual(first.rows.map(row => row.id));
            expect(await sql('SELECT id FROM agent_dispatch_outbox')).toHaveLength(2);
        });

        it('refuses a different result claiming the same inbound', async () => {
            const binding = await fixture();
            await prepare(binding);
            expect(await code(prepare(binding, { items: [items[0]] }))).toBe('dispatch_batch_conflict');
            expect(await code(prepare(binding, { items: [items[1], items[0]] }))).toBe('dispatch_batch_conflict');
        });

        it('refuses an inbound that is not persisted, and a contact that does not own the conversation', async () => {
            const binding = await fixture(), other = await fixture();
            expect(await code(prepare({ ...binding, inboundMessageId: randomUUID() })))
                .toBe('dispatch_inbound_unavailable');
            expect(await code(prepare({ ...binding, contactId: other.contactId })))
                .toBe('dispatch_binding_changed');
            expect(await code(prepare(binding, { items: [] }))).toBe('dispatch_invalid_batch');
            expect(await sql('SELECT id FROM agent_dispatch_outbox')).toHaveLength(0);
        });
    });

    describe('admitting one attempt', () => {
        it('grants a lease, raises attempts and refuses a second admission while it is alive', async () => {
            const { rows } = await prepare(await fixture());
            const admitted = await admit(rows[0].id);
            expect(admitted).toMatchObject({ state: 'admitted', attempts: 1 });
            expect(await code(admit(rows[0].id))).toBe('dispatch_lease_active');
            // The next item waits: a caption must never overtake its picture.
            expect(await code(admit(rows[1].id))).toBe('dispatch_awaiting_predecessor');
        });

        it('admits the next item only once the one before it actually arrived', async () => {
            const { rows } = await prepare(await fixture());
            const lease = randomUUID();
            await admit(rows[0].id, lease);
            expect(await code(admit(rows[1].id))).toBe('dispatch_awaiting_predecessor');
            await tx(query => settleDispatch(query, schema,
                { dispatchId: rows[0].id, leaseToken: lease, outcome: { kind: 'sent', receipt: 'wamid.IMG' } }));
            expect((await admit(rows[1].id)).state).toBe('admitted');
        });

        it('refuses a caption whose picture finished without arriving', async () => {
            const { rows } = await prepare(await fixture());
            const lease = randomUUID();
            await admit(rows[0].id, lease);
            await tx(query => settleDispatch(query, schema, { dispatchId: rows[0].id, leaseToken: lease,
                outcome: { kind: 'suppressed', errorCode: 'wa_131053' } }));
            // Its words describe something the customer never received.
            expect(await code(admit(rows[1].id))).toBe('dispatch_predecessor_failed');
        });

        it('sends an expired permission to reconciliation instead of granting a new one', async () => {
            const { rows } = await prepare(await fixture());
            await admit(rows[0].id, randomUUID(), 5);
            await sql("UPDATE agent_dispatch_outbox SET lease_expires_at=NOW()-INTERVAL '1 second' WHERE id=$1::uuid",
                [rows[0].id]);
            // The attempt may have reached the provider. Silence is not evidence,
            // so admission refuses and deliberately writes nothing: the lease it
            // still carries is what a reconciler needs.
            expect(await code(admit(rows[0].id))).toBe('dispatch_reconciliation_required');
            expect((await tx(query => readDispatchRow(query, schema, rows[0].id)))!.state).toBe('admitted');
            // The committed sweep is what moves it, keeping the attempt identity.
            const expired = await tx(query => expireDispatchLeases(query, schema));
            expect(expired.map(row => row.id)).toEqual([rows[0].id]);
            expect(await tx(query => readDispatchRow(query, schema, rows[0].id)))
                .toMatchObject({ state: 'reconciliation_required', errorCode: 'lease_expired_after_admission' });
            expect(await code(admit(rows[0].id))).toBe('dispatch_terminal:reconciliation_required');
            expect(await tx(query => readPendingDispatch(query, schema))).toHaveLength(1);
        });

        it('refuses every terminal state and a row still waiting for its backoff', async () => {
            const { rows } = await prepare(await fixture());
            for (const state of ['sent', 'stored', 'suppressed', 'reconciliation_required']) {
                await sql('UPDATE agent_dispatch_outbox SET state=$2 WHERE id=$1::uuid', [rows[0].id, state]);
                expect(await code(admit(rows[0].id))).toBe(`dispatch_terminal:${state}`);
            }
            await sql(`UPDATE agent_dispatch_outbox SET state='failed', available_at=NOW()+INTERVAL '5 minutes'
                WHERE id=$1::uuid`, [rows[0].id]);
            expect(await code(admit(rows[0].id))).toBe('dispatch_not_available_yet');
        });

        it('does not let a rolled back send reset the attempt budget', async () => {
            const { rows } = await prepare(await fixture());
            for (let attempt = 1; attempt <= DISPATCH_MAX_ATTEMPTS; attempt++) {
                const lease = randomUUID();
                expect((await admit(rows[0].id, lease)).attempts).toBe(attempt);
                // The external call failed and its own work rolled back; the
                // count committed with the admission and survives it.
                await tx(query => settleDispatch(query, schema,
                    { dispatchId: rows[0].id, leaseToken: lease, outcome: { kind: 'failed', errorCode: 'timeout', retryInSeconds: 0 } }));
            }
            // The budget is spent, so the row is suppressed rather than left
            // looking retryable forever.
            expect(await code(admit(rows[0].id))).toBe('dispatch_terminal:suppressed');
            const row = await tx(query => readDispatchRow(query, schema, rows[0].id));
            expect(row).toMatchObject({ state: 'suppressed', attempts: DISPATCH_MAX_ATTEMPTS });
        });
    });

    describe('recording what an attempt produced', () => {
        it('keeps an accepted receipt readable and refuses to downgrade it', async () => {
            const { rows } = await prepare(await fixture());
            const lease = randomUUID();
            await admit(rows[0].id, lease);
            const sent = await tx(query => settleDispatch(query, schema,
                { dispatchId: rows[0].id, leaseToken: lease, outcome: { kind: 'sent', receipt: 'wamid.ABC' } }));
            expect(sent).toMatchObject({ state: 'sent', receipt: 'wamid.ABC' });
            // A late report about the same attempt reads the receipt back; it
            // never turns an accepted send into something retryable.
            const late = await tx(query => settleDispatch(query, schema,
                { dispatchId: rows[0].id, leaseToken: lease, outcome: { kind: 'failed', errorCode: 'post_check' } }));
            expect(late).toMatchObject({ state: 'sent', receipt: 'wamid.ABC' });
            // And it is readable without passing any new-admission guard.
            expect(await tx(query => readDispatchRow(query, schema, rows[0].id)))
                .toMatchObject({ state: 'sent', receipt: 'wamid.ABC' });
        });

        it('refuses an outcome from a lease that is no longer the current one', async () => {
            const { rows } = await prepare(await fixture());
            await admit(rows[0].id, randomUUID());
            expect(await code(tx(query => settleDispatch(query, schema,
                { dispatchId: rows[0].id, leaseToken: randomUUID(), outcome: { kind: 'sent', receipt: 'x' } }))))
                .toBe('dispatch_lease_lost');
            expect((await tx(query => readDispatchRow(query, schema, rows[0].id)))!.state).toBe('admitted');
        });

        it('requires a receipt to claim acceptance', async () => {
            const { rows } = await prepare(await fixture());
            const lease = randomUUID();
            await admit(rows[0].id, lease);
            expect(await code(tx(query => settleDispatch(query, schema,
                { dispatchId: rows[0].id, leaseToken: lease, outcome: { kind: 'sent', receipt: '  ' } }))))
                .toBe('dispatch_receipt_required');
        });

        it('records an uncertain attempt without making it available again', async () => {
            const { rows } = await prepare(await fixture());
            const lease = randomUUID();
            await admit(rows[0].id, lease);
            const settled = await tx(query => settleDispatch(query, schema, { dispatchId: rows[0].id,
                leaseToken: lease, outcome: { kind: 'reconciliation_required', errorCode: 'ack_lost' } }));
            expect(settled).toMatchObject({ state: 'reconciliation_required', errorCode: 'ack_lost' });
            expect(await tx(query => readPendingDispatch(query, schema))).toHaveLength(1); // only the sibling item
        });
    });

    describe('recovering pending work', () => {
        it('lists what may be published again and never an admitted or uncertain row', async () => {
            const { rows } = await prepare(await fixture());
            const lease = randomUUID();
            await admit(rows[0].id, lease);
            // Only the head of a batch is listed: publishing a later item would
            // just park it behind the predecessor guard.
            expect(await tx(query => readPendingDispatch(query, schema))).toHaveLength(0);
            await tx(query => settleDispatch(query, schema,
                { dispatchId: rows[0].id, leaseToken: lease, outcome: { kind: 'failed', errorCode: 'net', retryInSeconds: 0 } }));
            expect((await tx(query => readPendingDispatch(query, schema))).map(row => row.id))
                .toEqual([rows[0].id]);
            const second = randomUUID();
            await admit(rows[0].id, second);
            await tx(query => settleDispatch(query, schema, { dispatchId: rows[0].id,
                leaseToken: second, outcome: { kind: 'sent', receipt: 'wamid.HEAD' } }));
            // Head delivered: the next effect becomes the batch head.
            expect((await tx(query => readPendingDispatch(query, schema))).map(row => row.id))
                .toEqual([rows[1].id]);
        });

        it('offers the next effect of a batch once this one arrived', async () => {
            const { rows } = await prepare(await fixture());
            expect(await tx(query => readNextDispatchInBatch(query, schema, rows[0].id)))
                .toMatchObject({ id: rows[1].id, itemIndex: 1 });
            expect(await tx(query => readNextDispatchInBatch(query, schema, rows[1].id))).toBeNull();
        });

        it('marks published rows as queued without granting any permission', async () => {
            const { rows } = await prepare(await fixture());
            expect(await tx(query => markDispatchQueued(query, schema, rows.map(row => row.id)))).toBe(2);
            expect(await tx(query => markDispatchQueued(query, schema, rows.map(row => row.id)))).toBe(0);
            const row = await tx(query => readDispatchRow(query, schema, rows[0].id));
            expect(row).toMatchObject({ state: 'queued', attempts: 0 });
            expect((await admit(rows[0].id)).state).toBe('admitted');
        });
    });

    describe('two workers reaching the same row at once', () => {
        it('grants exactly one permission and prepares exactly one batch', async () => {
            const binding = await fixture();
            // Two turns preparing the same inbound: one batch, one set of rows.
            const [left, right] = await Promise.all([prepare(binding), racer(query =>
                prepareDispatchBatch(query, schema, { binding, items, operationalScope: scope }))]);
            expect(right.batchId).toBe(left.batchId);
            expect(await sql('SELECT id FROM agent_dispatch_outbox')).toHaveLength(2);

            // Two workers admitting the same row: one attempt, one lease.
            const dispatchId = left.rows[0].id;
            const outcomes = await Promise.allSettled([
                admit(dispatchId),
                racer(query => admitDispatch(query, schema,
                    { dispatchId, leaseToken: randomUUID(), leaseSeconds: 60 })),
            ]);
            const granted = outcomes.filter(result => result.status === 'fulfilled');
            expect(granted).toHaveLength(1);
            const refused = outcomes.find(result => result.status === 'rejected') as PromiseRejectedResult;
            expect(refused.reason).toBeInstanceOf(DispatchOutboxError);
            expect(refused.reason.code).toBe('dispatch_lease_active');
            expect((await tx(query => readDispatchRow(query, schema, dispatchId)))!.attempts).toBe(1);
        });
    });

    describe('the history the customer conversation shows', () => {
        const history = (conversationId: string) => sql(
            `SELECT content_type, content_text, media_url, status, external_id FROM messages
             WHERE conversation_id=$1::uuid AND direction='outbound' ORDER BY external_id`, [conversationId]);

        it('records each effect as pending, in the same transaction as its row', async () => {
            const binding = await fixture();
            const { rows } = await prepare(binding);
            // Written 'pending', not 'delivered'. Saving history has never been
            // proof of sending, and the previous path claimed otherwise.
            await expect(history(binding.conversationId)).resolves.toEqual([
                { content_type: 'image', content_text: null, media_url: 'https://example.test/a.jpg',
                    status: 'pending', external_id: `out:dispatch:${binding.inboundMessageId}:0` },
                { content_type: 'text', content_text: 'La foto del producto', media_url: null,
                    status: 'pending', external_id: `out:dispatch:${binding.inboundMessageId}:1` },
            ]);
            expect(rows.map(row => row.messageId).every(Boolean)).toBe(true);
        });

        it('marks it sent when the provider accepted it, and not delivered', async () => {
            const binding = await fixture();
            const { rows } = await prepare(binding);
            const lease = randomUUID();
            await admit(rows[0].id, lease);
            await tx(query => settleDispatch(query, schema,
                { dispatchId: rows[0].id, leaseToken: lease, outcome: { kind: 'sent', receipt: 'wamid.OK' } }));
            // An HTTP acceptance is not a claim about the customer's phone.
            expect((await history(binding.conversationId)).map(message => message.status))
                .toEqual(['sent', 'pending']);
        });

        it('leaves an uncertain outcome pending and marks a definite refusal failed', async () => {
            const binding = await fixture();
            const { rows } = await prepare(binding);
            const uncertain = randomUUID(), refused = randomUUID();
            await admit(rows[0].id, uncertain);
            await tx(query => settleDispatch(query, schema, { dispatchId: rows[0].id, leaseToken: uncertain,
                outcome: { kind: 'reconciliation_required', errorCode: 'ack_lost' } }));
            // The caption may only be admitted after its picture arrived, so the
            // refusal under test is recorded on an arrived predecessor.
            await sql("UPDATE agent_dispatch_outbox SET state='sent', receipt='wamid.IMG' WHERE id=$1::uuid", [rows[0].id]);
            await admit(rows[1].id, refused);
            await tx(query => settleDispatch(query, schema, { dispatchId: rows[1].id, leaseToken: refused,
                outcome: { kind: 'suppressed', errorCode: 'wa_131047' } }));
            await sql("UPDATE agent_dispatch_outbox SET state='reconciliation_required', receipt=NULL WHERE id=$1::uuid", [rows[0].id]);
            // Claiming failure for an uncertain attempt would be as wrong as
            // claiming delivery: the provider may well have acted.
            expect((await history(binding.conversationId)).map(message => message.status))
                .toEqual(['pending', 'failed']);
        });

        it('still records the reply when the deduplication index lags the deploy', async () => {
            const binding = await fixture();
            await sql('DROP INDEX IF EXISTS uidx_messages_external_id');
            try {
                const { rows } = await prepare(binding);
                expect(rows.map(row => row.messageId).every(Boolean)).toBe(true);
                expect(await history(binding.conversationId)).toHaveLength(2);
            } finally {
                await sql(`CREATE UNIQUE INDEX uidx_messages_external_id ON messages(external_id)
                    WHERE external_id IS NOT NULL`);
            }
        });

        it('re-preparing the same inbound reuses its history rather than duplicating it', async () => {
            const binding = await fixture();
            await prepare(binding);
            await prepare(binding);
            expect(await history(binding.conversationId)).toHaveLength(2);
        });
    });

    describe('what the provider later says about a receipt', () => {
        const statusOf = async (messageId: string) =>
            (await sql('SELECT status FROM messages WHERE id=$1::uuid', [messageId]))[0].status;
        const apply = (providerMessageId: string, status: any, errorCode?: string) =>
            tx(query => applyDispatchProviderStatus(query, schema, { providerMessageId, status, errorCode }));

        async function accepted(receipt = 'wamid.ABC') {
            const binding = await fixture();
            const { rows } = await prepare(binding);
            const lease = randomUUID();
            await admit(rows[0].id, lease);
            await tx(query => settleDispatch(query, schema,
                { dispatchId: rows[0].id, leaseToken: lease, outcome: { kind: 'sent', receipt } }));
            return { binding, row: rows[0], receipt };
        }

        it('records acceptance as sent, never as delivered', async () => {
            const { row } = await accepted();
            // `delivered` is a claim about the customer's phone that an HTTP 200
            // does not make. Only the provider can say it.
            expect(await statusOf(row.messageId!)).toBe('sent');
        });

        it('resolves the provider id through the dispatch row, not through external_id', async () => {
            const { row, receipt } = await accepted();
            // external_id holds our own deduplication identity, which is why the
            // webhook used to match nothing at all.
            const [message] = await sql('SELECT external_id FROM messages WHERE id=$1::uuid', [row.messageId]);
            expect(message.external_id).not.toBe(receipt);
            await expect(apply(receipt, 'delivered')).resolves.toMatchObject(
                { applied: true, messageId: row.messageId, status: 'delivered' });
            expect(await statusOf(row.messageId!)).toBe('delivered');
        });

        it('moves status forward only, whatever order the events arrive in', async () => {
            const { row, receipt } = await accepted();
            await apply(receipt, 'read');
            // A late `delivered` after a `read` must not walk the record back.
            await expect(apply(receipt, 'delivered')).resolves.toMatchObject({ applied: false, reason: 'not_newer' });
            await expect(apply(receipt, 'sent')).resolves.toMatchObject({ applied: false, reason: 'not_newer' });
            expect(await statusOf(row.messageId!)).toBe('read');
        });

        it('is idempotent for a repeated event', async () => {
            const { row, receipt } = await accepted();
            await expect(apply(receipt, 'delivered')).resolves.toMatchObject({ applied: true });
            await expect(apply(receipt, 'delivered')).resolves.toMatchObject({ applied: false, reason: 'not_newer' });
            expect(await statusOf(row.messageId!)).toBe('delivered');
        });

        it('accepts a rejection after acceptance but never after delivery', async () => {
            const refused = await accepted('wamid.REFUSED');
            await expect(apply(refused.receipt, 'failed', 'wa_131047')).resolves.toMatchObject({ applied: true });
            expect(await statusOf(refused.row.messageId!)).toBe('failed');
            expect((await sql('SELECT error_code FROM agent_dispatch_outbox WHERE id=$1::uuid',
                [refused.row.id]))[0].error_code).toBe('wa_131047');

            const arrived = await accepted('wamid.ARRIVED');
            await apply(arrived.receipt, 'delivered');
            // The customer already has it; "failed" would be the false statement.
            await expect(apply(arrived.receipt, 'failed')).resolves.toMatchObject(
                { applied: false, reason: 'already_delivered' });
            expect(await statusOf(arrived.row.messageId!)).toBe('delivered');
        });

        it('never lets a late delivery erase a rejection the provider already reported', async () => {
            const rejected = await accepted('wamid.REJECTED');
            await expect(apply(rejected.receipt, 'failed', 'wa_131047')).resolves.toMatchObject({ applied: true });
            // `failed` has no rank, so a later `delivered` compared against -1 and
            // overwrote it — the mirror of the refusal just above, which the code
            // spelled out in one direction and not the other.
            await expect(apply(rejected.receipt, 'delivered')).resolves.toMatchObject(
                { applied: false, reason: 'already_failed', status: 'failed' });
            await expect(apply(rejected.receipt, 'read')).resolves.toMatchObject(
                { applied: false, reason: 'already_failed' });
            expect(await statusOf(rejected.row.messageId!)).toBe('failed');
        });

        it('ignores a receipt it does not know and one whose words were erased', async () => {
            await expect(apply('wamid.NEVER-SEEN', 'delivered'))
                .resolves.toMatchObject({ applied: false, reason: 'unknown_receipt' });
            const { binding, receipt } = await accepted('wamid.ERASED');
            await tx(query => redactDispatchOutbox(query, schema, { contactIds: [binding.contactId] }));
            await expect(apply(receipt, 'delivered')).resolves.toMatchObject({ applied: false, reason: 'redacted' });
        });
    });

    describe('retention', () => {
        /** Ages a row past the window without waiting a month for it. */
        const age = (id: string, days: number) => tx(query => query(
            `UPDATE agent_dispatch_outbox SET updated_at = NOW() - make_interval(days => $2::int) WHERE id=$1::uuid`,
            [id, days]));

        const settled = async (receipt: string) => {
            const binding = await fixture();
            const { rows } = await prepare(binding);
            const lease = randomUUID();
            await admit(rows[0].id, lease);
            await tx(query => settleDispatch(query, schema,
                { dispatchId: rows[0].id, leaseToken: lease, outcome: { kind: 'sent', receipt } }));
            return { binding, rows };
        };

        it('drops the words of a settled row once they are old, and keeps the row', async () => {
            // The payload is a COPY: `messages` holds the history a person reads,
            // and this column exists only so an unsent effect can still be sent.
            // A sent row can never be sent again, so past the window it is a
            // second copy of somebody's message kept for no reason — and nothing
            // was dropping it, so the table grew forever.
            const { rows } = await settled('wamid.OLD');
            await age(rows[0].id, 45);
            expect(await tx(query => redactSettledDispatchOutbox(query, schema))).toBe(1);
            const row = await tx(query => readDispatchRow(query, schema, rows[0].id));
            // What an operator still asks of a settled row — did it go out, when,
            // with what receipt — survives. The copy does not.
            expect(row).toMatchObject({ state: 'sent', receipt: 'wamid.OLD', redacted: true, payload: null, binding: null });
        });

        it('leaves a row that is still young', async () => {
            const { rows } = await settled('wamid.RECENT');
            await age(rows[0].id, 3);
            expect(await tx(query => redactSettledDispatchOutbox(query, schema))).toBe(0);
            expect(await tx(query => readDispatchRow(query, schema, rows[0].id))).toMatchObject({ redacted: false });
        });

        it('never touches a row waiting for a person or for another attempt', async () => {
            // `reconciliation_required` is the queue somebody works from: they
            // need the recipient and the payload to go and look at the provider.
            const binding = await fixture();
            const { rows } = await prepare(binding);
            const lease = randomUUID();
            await admit(rows[0].id, lease);
            await tx(query => settleDispatch(query, schema, { dispatchId: rows[0].id, leaseToken: lease,
                outcome: { kind: 'reconciliation_required', errorCode: 'http_504' } }));
            await age(rows[0].id, 400);
            // And a prepared row has not been sent at all.
            await age(rows[1].id, 400);
            expect(await tx(query => redactSettledDispatchOutbox(query, schema))).toBe(0);
            expect(await tx(query => readDispatchRow(query, schema, rows[0].id)))
                .toMatchObject({ state: 'reconciliation_required', redacted: false });
            expect(await tx(query => readDispatchRow(query, schema, rows[1].id))).toMatchObject({ redacted: false });
        });

        it('is bounded, and does not redact anything twice', async () => {
            const first = await settled('wamid.A'), second = await settled('wamid.B');
            await age(first.rows[0].id, 60);
            await age(second.rows[0].id, 60);
            expect(await tx(query => redactSettledDispatchOutbox(query, schema, { limit: 1 }))).toBe(1);
            expect(await tx(query => redactSettledDispatchOutbox(query, schema, { limit: 5 }))).toBe(1);
            // Already redacted rows are not counted again on the next pass, so a
            // daily sweep does not report work it is not doing.
            expect(await tx(query => redactSettledDispatchOutbox(query, schema, { limit: 5 }))).toBe(0);
        });

        it('refuses a schema it was not pointed at', async () => {
            expect(await code(tx(query => redactSettledDispatchOutbox(query, 'not a schema'))))
                .toBe('dispatch_invalid_reference');
        });
    });

    describe('erasure', () => {
        it('clears the payload and recipient by contact while keeping the row that stops a resend', async () => {
            const binding = await fixture();
            const { rows } = await prepare(binding);
            const lease = randomUUID();
            await admit(rows[0].id, lease);
            await tx(query => settleDispatch(query, schema,
                { dispatchId: rows[0].id, leaseToken: lease, outcome: { kind: 'sent', receipt: 'wamid.KEEP' } }));
            expect(await tx(query => redactDispatchOutbox(query, schema, { contactIds: [binding.contactId] }))).toBe(2);
            const sent = await tx(query => readDispatchRow(query, schema, rows[0].id));
            // The acceptance stays a fact; the words and the recipient are gone.
            expect(sent).toMatchObject({ state: 'sent', receipt: 'wamid.KEEP', redacted: true, payload: null, binding: null });
            const pending = await tx(query => readDispatchRow(query, schema, rows[1].id));
            expect(pending).toMatchObject({ redacted: true, payload: null });
            expect(await tx(query => readPendingDispatch(query, schema))).toHaveLength(0);
            expect(await code(admit(rows[1].id))).toBe('dispatch_redacted');
        });

        it('reaches a payload derived from a retired source and sends an admitted row to reconciliation', async () => {
            const binding = await fixture();
            const sourceContactId = randomUUID(), sourceId = randomUUID();
            const { rows } = await prepare(binding, { sources: [{ id: sourceId, sourceContactId }] });
            await admit(rows[0].id);
            expect(await tx(query => redactDispatchOutbox(query, schema, { sourceIds: [sourceId] }))).toBe(2);
            // An in-flight attempt cannot be told "nothing happened", so erasure
            // leaves it needing reconciliation rather than silently available.
            expect((await tx(query => readDispatchRow(query, schema, rows[0].id))))
                .toMatchObject({ state: 'reconciliation_required', redacted: true });
            expect(await sql('SELECT dispatch_id FROM agent_dispatch_outbox_sources')).toHaveLength(0);
        });

        it('reaches a payload derived from a retired release, and refuses an invalid scope', async () => {
            const binding = await fixture();
            const releaseId = randomUUID();
            await prepare(binding, { learningFootprint: [{ version: 1, tenantId, agentId: scope.agentId,
                entries: [{ releaseId, releaseHash: 'b'.repeat(64), exampleId: randomUUID(), projectionHash: 'c'.repeat(64) }] }] });
            expect(await tx(query => redactDispatchOutbox(query, schema, { releaseIds: [releaseId] }))).toBe(2);
            expect(await code(tx(query => redactDispatchOutbox(query, schema, { contactIds: ['not-a-uuid'] }))))
                .toBe('dispatch_redaction_scope_invalid');
            expect(await tx(query => redactDispatchOutbox(query, schema, {}))).toBe(0);
        });
    });
});
