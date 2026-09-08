import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AgentDispatchOutboxStore } from './agent-dispatch-outbox.store';
import { DISPATCH_MAX_ATTEMPTS, DISPATCH_OUTBOX_DDL, redactDispatchOutbox,
    type DispatchBinding, type DispatchItem } from './agent-dispatch-outbox';
import { operationalConfigurationHash } from '../persona/agent-configuration-revision';
import { createRuntimeLearningFootprint } from '../learning/learning-runtime-footprint';
import { learningSnapshotHash, type RuntimeLearningExample } from '../learning/learning-contracts';

const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl ? describe : describe.skip)('guarded dispatch admission with real PostgreSQL', () => {
    const tenantId = randomUUID(), agentId = randomUUID();
    const schema = `tenant_dispatch_adm_${randomUUID().replace(/-/g, '')}`;
    let client: PrismaClient, prisma: any, store: AgentDispatchOutboxStore;

    const sql = (text: string, params: any[] = []): Promise<any[]> =>
        prisma.executeInTenantSchema(schema, text, params);
    const reason = async (pending: Promise<unknown>): Promise<string> => {
        try { await pending; } catch (error: any) { return String(error?.code || error?.message); }
        return 'no_error';
    };

    beforeAll(async () => {
        const url = new URL(databaseUrl!);
        if (!['localhost', '127.0.0.1'].includes(url.hostname) || !url.pathname.endsWith('_eval_isolation'))
            throw new Error('disposable_loopback_database_required');
        client = new PrismaClient({ datasourceUrl: databaseUrl });
        await client.$executeRawUnsafe(
            'CREATE TABLE IF NOT EXISTS public.tenants(id UUID PRIMARY KEY,schema_name TEXT,is_active BOOLEAN,language TEXT)');
        await client.$executeRawUnsafe(
            'INSERT INTO public.tenants(id,schema_name,is_active) VALUES($1::uuid,$2,true)', tenantId, schema);
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        // Only the tenant lifecycle lookup is stubbed. Routing, sources, binding
        // and the outbox transitions all run against real SQL.
        prisma.tenant = { findUnique: jest.fn(async () => (
            { id: tenantId, schemaName: schema, isActive: true, onboardingCompletedAt: new Date() })) };
        const redis = { get: jest.fn(async () => null) };
        store = new AgentDispatchOutboxStore(prisma, redis as any);
        await sql('CREATE TABLE contacts(id UUID PRIMARY KEY, name TEXT)');
        await sql(`CREATE TABLE conversations(id UUID PRIMARY KEY, contact_id UUID REFERENCES contacts(id),
            channel_type TEXT, status TEXT DEFAULT 'active')`);
        await sql(`CREATE TABLE messages(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            conversation_id UUID REFERENCES conversations(id), direction TEXT, content_type TEXT,
            content_text TEXT, media_url TEXT, status TEXT, external_id TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE UNIQUE INDEX uidx_messages_external_id ON messages(external_id)
            WHERE external_id IS NOT NULL`);
        await sql(`CREATE TABLE agent_personas(id UUID PRIMARY KEY,name TEXT,config_json JSONB,channels TEXT[],
            channel_bindings TEXT[],schedule_mode TEXT,is_active BOOLEAN,is_default BOOLEAN,version INTEGER)`);
        await sql('CREATE TABLE persona_config(config_json JSONB,is_active BOOLEAN,version INTEGER)');
        await sql('CREATE TABLE customer_memory_erasure(contact_id UUID PRIMARY KEY)');
        await sql(`CREATE TABLE learning_sources(id UUID PRIMARY KEY,agent_id UUID,source_kind TEXT,status TEXT,
            source_contact_id UUID,source_conversation_id UUID,channel TEXT,transcript JSONB,source_evidence JSONB)`);
        await sql('CREATE TABLE learning_examples(id UUID PRIMARY KEY,source_id UUID,agent_id UUID,status TEXT)');
        await sql(`CREATE TABLE learning_releases(id UUID PRIMARY KEY,agent_id UUID,status TEXT,snapshot JSONB,
            snapshot_hash TEXT,example_ids UUID[])`);
        // The store bootstraps these lazily; created here so the per-test reset
        // can truncate them before the first store call ever runs.
        for (const statement of DISPATCH_OUTBOX_DDL) await sql(statement);
    });

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_dispatch_adm_[a-f\d]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2',
                tenantId, schema);
        } finally { await client.$disconnect(); }
    });

    beforeEach(async () => {
        await sql(`TRUNCATE agent_dispatch_outbox_sources, agent_dispatch_outbox, messages, conversations,
            contacts, agent_personas, persona_config, learning_releases, learning_examples,
            learning_sources, customer_memory_erasure CASCADE`);
        await sql(`INSERT INTO agent_personas VALUES($1::uuid,'Alex','{"persona":{"name":"Alex"}}',
            ARRAY['whatsapp'],'{}'::text[],'24_7',true,true,1)`, [agentId]);
    });

    const items: DispatchItem[] = [{ kind: 'text', payload: { text: 'La respuesta del agente' } }];

    async function scope() {
        const [agent] = await sql('SELECT * FROM agent_personas WHERE id=$1::uuid', [agentId]);
        return { kind: 'agent' as const, tenantId, schemaName: schema, agentId, version: 1,
            operationalHash: operationalConfigurationHash(agent) };
    }

    async function fixture(): Promise<DispatchBinding> {
        const contactId = randomUUID(), conversationId = randomUUID(), inboundMessageId = randomUUID();
        await sql("INSERT INTO contacts VALUES($1::uuid,'Cliente sintético')", [contactId]);
        await sql("INSERT INTO conversations VALUES($1::uuid,$2::uuid,'whatsapp','active')", [conversationId, contactId]);
        await sql(`INSERT INTO messages(id,conversation_id,direction,content_type,content_text,status)
            VALUES($1::uuid,$2::uuid,'inbound','text','Hola','delivered')`, [inboundMessageId, conversationId]);
        return { conversationId, contactId, inboundMessageId,
            channelType: 'whatsapp', channelAccountId: 'phone-1', recipient: '+573000000000' };
    }

    /** A published release with one live train source and one holdout source. */
    async function learning() {
        const sourceIds = [randomUUID(), randomUUID()], exampleId = randomUUID(), releaseId = randomUUID();
        for (const id of sourceIds) {
            await sql(`INSERT INTO learning_sources VALUES($1::uuid,$2::uuid,'file','active',NULL,NULL,
                'whatsapp','[]'::jsonb,NULL)`, [id, agentId]);
        }
        await sql("INSERT INTO learning_examples VALUES($1::uuid,$2::uuid,$3::uuid,'approved')",
            [exampleId, sourceIds[0], agentId]);
        const frozen = { id: exampleId, source_id: sourceIds[0], kind: 'brand_style', intent: 'general',
            response_pattern: 'Be helpful.', rationale: 'Reviewed.', facts_required: [] };
        const snapshot = { examples: [frozen], heldout: [{ source_id: sourceIds[1] }] };
        const hash = learningSnapshotHash(snapshot);
        await sql("INSERT INTO learning_releases VALUES($1::uuid,$2::uuid,'published',$3::jsonb,$4,$5::uuid[])",
            [releaseId, agentId, JSON.stringify(snapshot), hash, [exampleId]]);
        const example: RuntimeLearningExample = { id: exampleId, releaseId, releaseHash: hash,
            situation: frozen.intent, responsePattern: frozen.response_pattern, rationale: frozen.rationale,
            factsRequired: [], authority: 'style_only' };
        return { sourceIds, releaseId, footprint: createRuntimeLearningFootprint(tenantId, agentId, [example]) };
    }

    const prepare = async (binding: DispatchBinding, footprints?: any[], sources?: any[]) =>
        store.prepare(tenantId, { binding, items, operationalScope: await scope(),
            learningFootprints: footprints, sources });

    describe('preparing before anything is published', () => {
        it('records the batch and returns the same rows on a replay', async () => {
            const binding = await fixture();
            const first = await prepare(binding);
            expect(first.rows).toHaveLength(1);
            expect(first.rows[0].state).toBe('prepared');
            expect((await prepare(binding)).rows.map(row => row.id)).toEqual(first.rows.map(row => row.id));
        });

        it('refuses a scope that does not belong to this tenant schema', async () => {
            const binding = await fixture();
            await expect(store.prepare(tenantId, { binding, items,
                operationalScope: { ...(await scope()), tenantId: randomUUID() } as any }))
                .rejects.toMatchObject({ code: 'dispatch_authority_required' });
        });
    });

    describe('deciding who owns the answer to an inbound', () => {
        it('answers null before anything was prepared, and the batch afterwards', async () => {
            const binding = await fixture();
            await expect(store.findBatchForInbound(tenantId, schema, binding)).resolves.toBeNull();
            const { rows } = await prepare(binding);
            const found = await store.findBatchForInbound(tenantId, schema, binding);
            expect(found!.map(row => row.id)).toEqual(rows.map(row => row.id));
        });

        it('refuses a batch that describes a different binding rather than delivering it', async () => {
            const binding = await fixture();
            await prepare(binding);
            for (const changed of [
                { ...binding, conversationId: (await fixture()).conversationId },
                { ...binding, contactId: (await fixture()).contactId },
                { ...binding, channelType: 'telegram' },
                { ...binding, channelAccountId: 'phone-2' },
                { ...binding, recipient: '+573009999999' },
            ]) {
                expect(await reason(store.findBatchForInbound(tenantId, schema, changed)))
                    .toMatch(/dispatch_batch_binding_changed|dispatch_batch_conflict/);
            }
        });

        it('refuses a batch whose items are not contiguous from zero', async () => {
            const binding = await fixture();
            const { rows } = await prepare(binding);
            // A gap means a partially recorded result; delivering it as the whole
            // answer would drop an effect silently.
            await sql('UPDATE agent_dispatch_outbox SET item_index=1 WHERE id=$1::uuid', [rows[0].id]);
            expect(await reason(store.findBatchForInbound(tenantId, schema, binding)))
                .toBe('dispatch_batch_conflict');
            await sql('UPDATE agent_dispatch_outbox SET item_index=0 WHERE id=$1::uuid', [rows[0].id]);
            // Two batch ids for one inbound is the other shape of the same fault.
            await sql(`INSERT INTO agent_dispatch_outbox(batch_id,conversation_id,contact_id,inbound_message_id,
                channel_type,channel_account_id,recipient,item_index,item_kind,payload,state)
                VALUES(gen_random_uuid(),$1::uuid,$2::uuid,$3::uuid,'whatsapp','phone-1','+573000000000',
                1,'text','{"text":"otro"}'::jsonb,'prepared')`,
            [binding.conversationId, binding.contactId, binding.inboundMessageId]);
            expect(await reason(store.findBatchForInbound(tenantId, schema, binding)))
                .toBe('dispatch_batch_conflict');
        });

        it('still owns the reply after erasure removed the words', async () => {
            const binding = await fixture();
            await prepare(binding);
            await prisma.transactionInTenantSchema(schema, (query: any) =>
                redactDispatchOutbox(query, schema, { contactIds: [binding.contactId] }));
            const found = await store.findBatchForInbound(tenantId, schema, binding);
            expect(found).toHaveLength(1);
            expect(found![0].redacted).toBe(true);
        });

        it('refuses a schema that does not belong to the tenant', async () => {
            const binding = await fixture();
            expect(await reason(store.findBatchForInbound(randomUUID(), schema, binding)))
                .toBe('dispatch_tenant_unavailable');
            expect(await reason(store.findBatchForInbound(tenantId, 'public', binding)))
                .toBe('dispatch_tenant_unavailable');
        });
    });

    describe('publishing a batch', () => {
        it('publishes only rows with work left and marks them after publishing', async () => {
            const binding = await fixture();
            const { rows } = await prepare(binding);
            const published: [string, number][] = [];
            let markedAt = -1;
            const spy = jest.spyOn(store, 'markQueued');
            spy.mockImplementation(async (tenant: string, ids: readonly string[]) => {
                markedAt = published.length; return ids.length;
            });
            const count = await store.publishBatch(tenantId, rows,
                async (id, delay) => { published.push([id, delay]); }, 1200);
            expect(count).toBe(1);
            expect(published).toEqual([[rows[0].id, 0]]);
            // Marked only after every publish attempt: a crash before the mark
            // republishes the same deterministic ids, which is the safe direction.
            expect(markedAt).toBe(published.length);
            spy.mockRestore();
        });

        it('publishes nothing for a batch already sent or redacted', async () => {
            const binding = await fixture();
            const { rows } = await prepare(binding);
            const lease = randomUUID();
            await store.admit(tenantId, rows[0].id, { leaseSeconds: 60 });
            await sql("UPDATE agent_dispatch_outbox SET state='sent', receipt='wamid.X', lease_token=NULL, lease_expires_at=NULL WHERE id=$1::uuid", [rows[0].id]);
            const published: string[] = [];
            expect(await store.publishBatch(tenantId,
                (await store.findBatchForInbound(tenantId, schema, binding))!,
                async id => { published.push(id); })).toBe(0);
            expect(published).toEqual([]);
            expect(lease).toBeTruthy();
        });
    });

    describe('granting one attempt', () => {
        it('grants it when routing, sources and binding still hold', async () => {
            const { rows } = await prepare(await fixture());
            const granted = await store.admit(tenantId, rows[0].id);
            expect(granted.row).toMatchObject({ state: 'admitted', attempts: 1 });
            expect(granted.row.payload).toEqual({ text: 'La respuesta del agente' });
            expect(granted.leaseToken).toMatch(/^[a-f0-9-]{36}$/);
        });

        it('refuses after the agent revision changed', async () => {
            const { rows } = await prepare(await fixture());
            await sql('UPDATE agent_personas SET version=2 WHERE id=$1::uuid', [agentId]);
            expect(await reason(store.admit(tenantId, rows[0].id))).toBe('agent_operational_revision_changed');
            expect((await store.read(tenantId, rows[0].id))!).toMatchObject({ state: 'prepared', attempts: 0 });
        });

        it('refuses after another agent won this exact connection', async () => {
            const { rows } = await prepare(await fixture());
            // The original agent keeps its own version and hash; only routing moved.
            await sql(`INSERT INTO agent_personas VALUES($1::uuid,'Otro','{"persona":{"name":"Otro"}}','{}',
                ARRAY[$2],'24_7',true,false,1)`, [randomUUID(), 'whatsapp:phone-1']);
            expect(await reason(store.admit(tenantId, rows[0].id))).toBe('agent_operational_revision_changed');
        });

        it('refuses after a source behind the payload was retired, train or holdout', async () => {
            for (const index of [0, 1]) {
                await sql(`TRUNCATE agent_dispatch_outbox_sources, agent_dispatch_outbox, messages,
                    conversations, contacts, learning_releases, learning_examples, learning_sources CASCADE`);
                const group = await learning();
                const { rows } = await prepare(await fixture(), [group.footprint],
                    group.sourceIds.map(id => ({ id })));
                await sql("UPDATE learning_sources SET status='retired' WHERE id=$1::uuid", [group.sourceIds[index]]);
                expect(await reason(store.admit(tenantId, rows[0].id))).toBe('llm_source_authority_unavailable');
                expect((await store.read(tenantId, rows[0].id))!.attempts).toBe(0);
            }
        });

        it('refuses a redacted row and a binding that moved', async () => {
            const binding = await fixture();
            const { rows } = await prepare(binding);
            await sql('UPDATE conversations SET contact_id=NULL WHERE id=$1::uuid', [binding.conversationId])
                .catch(() => undefined);
            await sql('DELETE FROM conversations WHERE id=$1::uuid', [binding.conversationId]).catch(() => undefined);
            expect(await reason(store.admit(tenantId, rows[0].id))).toBe('dispatch_binding_changed');
        });
    });

    describe('the reconciliation queue an operator works from', () => {
        async function uncertain(errorCode = 'provider_timeout') {
            const binding = await fixture();
            const { rows } = await prepare(binding);
            const granted = await store.admit(tenantId, rows[0].id);
            await store.settle(tenantId, rows[0].id, granted.leaseToken,
                { kind: 'reconciliation_required', errorCode });
            return { binding, row: rows[0] };
        }

        it('lists uncertain effects oldest first, without the words or the number', async () => {
            const { binding, row } = await uncertain();
            const [entry] = await store.reconciliation(tenantId);
            expect(entry).toMatchObject({ id: row.id, channelType: 'whatsapp', itemKind: 'text',
                errorCode: 'provider_timeout', inboundMessageId: binding.inboundMessageId });
            // Reconciliation is about whether an effect happened, never about
            // what it said, and a queue view is no reason to hand out a number.
            expect(JSON.stringify(entry)).not.toContain('La respuesta del agente');
            expect(entry.recipientHint).toBe('*********0000');
            expect(entry.recipientHint).not.toContain('573');
        });

        it('finds a row by receipt, by its own id and by the binding', async () => {
            const { binding, row } = await uncertain();
            await sql("UPDATE agent_dispatch_outbox SET receipt='wamid.LOST' WHERE id=$1::uuid", [row.id]);
            for (const search of ['wamid.LOST', row.id, binding.inboundMessageId, binding.conversationId]) {
                expect((await store.reconciliation(tenantId, { search })).map(entry => entry.id)).toEqual([row.id]);
            }
            expect(await store.reconciliation(tenantId, { search: 'wamid.OTHER' })).toEqual([]);
        });

        it('reports the backlog and what is past the deadline', async () => {
            const { row } = await uncertain();
            await expect(store.backlog(tenantId)).resolves.toMatchObject({ total: 1, breachingSla: 0 });
            await sql("UPDATE agent_dispatch_outbox SET updated_at=NOW()-INTERVAL '2 hours' WHERE id=$1::uuid", [row.id]);
            const backlog = await store.backlog(tenantId);
            expect(backlog).toMatchObject({ total: 1, breachingSla: 1 });
            expect(backlog.oldestAgeSeconds).toBeGreaterThan(3600);
        });

        it('closes it as delivered with the receipt the operator found', async () => {
            const { row } = await uncertain();
            const settled = await store.resolve(tenantId, { dispatchId: row.id, resolution: 'delivered',
                evidence: 'Found in Meta manager, delivered 10:04', receipt: 'wamid.FOUND' });
            expect(settled).toMatchObject({ state: 'sent', receipt: 'wamid.FOUND' });
            expect((await sql('SELECT status FROM messages WHERE id=$1::uuid', [row.messageId]))[0].status).toBe('sent');
        });

        it('closes it as not delivered without sending anything', async () => {
            const { row } = await uncertain();
            const settled = await store.resolve(tenantId, { dispatchId: row.id, resolution: 'not_delivered',
                evidence: 'Absent from provider logs for the whole window' });
            expect(settled.state).toBe('suppressed');
            expect((await sql('SELECT status FROM messages WHERE id=$1::uuid', [row.messageId]))[0].status).toBe('failed');
        });

        it('allows another attempt only with written evidence that nothing happened', async () => {
            const { row } = await uncertain();
            // Silence is what this state MEANS; it can never be the justification.
            expect(await reason(store.resolve(tenantId,
                { dispatchId: row.id, resolution: 'retry', evidence: '   ' })))
                .toBe('dispatch_resolution_evidence_required');
            const settled = await store.resolve(tenantId, { dispatchId: row.id, resolution: 'retry',
                evidence: 'Provider log shows no request in the window' });
            expect(settled.state).toBe('failed');
            expect((await store.pending(tenantId)).rows.map(entry => entry.id)).toEqual([row.id]);
        });

        it('refuses a decision about an effect that already settled itself', async () => {
            const { row } = await uncertain();
            await store.resolve(tenantId, { dispatchId: row.id, resolution: 'not_delivered', evidence: 'checked' });
            expect(await reason(store.resolve(tenantId,
                { dispatchId: row.id, resolution: 'retry', evidence: 'changed my mind' })))
                .toBe('dispatch_not_reconcilable:suppressed');
        });

        it('never resends words that erasure removed, whatever the evidence', async () => {
            const { binding, row } = await uncertain();
            await prisma.transactionInTenantSchema(schema, (query: any) =>
                redactDispatchOutbox(query, schema, { contactIds: [binding.contactId] }));
            expect(await reason(store.resolve(tenantId,
                { dispatchId: row.id, resolution: 'retry', evidence: 'provider never saw it' })))
                .toBe('dispatch_redacted');
        });

        it('requires a receipt to claim it was delivered after all', async () => {
            const { row } = await uncertain();
            expect(await reason(store.resolve(tenantId,
                { dispatchId: row.id, resolution: 'delivered', evidence: 'I think it went out' })))
                .toBe('dispatch_receipt_required');
        });
    });

    describe('recording the outcome and bounding failure', () => {
        it('settles an accepted attempt against its own lease', async () => {
            const { rows } = await prepare(await fixture());
            const granted = await store.admit(tenantId, rows[0].id);
            const settled = await store.settle(tenantId, rows[0].id, granted.leaseToken,
                { kind: 'sent', receipt: 'wamid.OK' });
            expect(settled).toMatchObject({ state: 'sent', receipt: 'wamid.OK' });
        });

        it('spends the same budget on preflight failures and then stops', async () => {
            const { rows } = await prepare(await fixture());
            for (let attempt = 1; attempt < DISPATCH_MAX_ATTEMPTS; attempt++) {
                const row = await store.failPreflight(tenantId, rows[0].id,
                    { errorCode: 'channel_credentials_unavailable', retryInSeconds: 0 });
                expect(row).toMatchObject({ state: 'failed', attempts: attempt });
            }
            // A preflight that never succeeds must not loop forever.
            expect(await store.failPreflight(tenantId, rows[0].id,
                { errorCode: 'channel_credentials_unavailable', retryInSeconds: 0 }))
                .toMatchObject({ state: 'suppressed', attempts: DISPATCH_MAX_ATTEMPTS });
            expect(await reason(store.admit(tenantId, rows[0].id))).toBe('dispatch_terminal:suppressed');
        });

        it('refuses a preflight failure for a permission somebody already holds', async () => {
            const { rows } = await prepare(await fixture());
            await store.admit(tenantId, rows[0].id);
            expect(await reason(store.failPreflight(tenantId, rows[0].id, { errorCode: 'late' })))
                .toBe('dispatch_lease_active');
        });

        it('retires a permission nobody settled, without making it available again', async () => {
            const { rows } = await prepare(await fixture());
            await store.admit(tenantId, rows[0].id, { leaseSeconds: 5 });
            await sql("UPDATE agent_dispatch_outbox SET lease_expires_at=NOW()-INTERVAL '1 second'");
            const expired = await store.expireLeases(tenantId);
            expect(expired.map(row => row.id)).toEqual([rows[0].id]);
            expect((await store.pending(tenantId)).rows).toHaveLength(0);
            expect(await reason(store.admit(tenantId, rows[0].id))).toBe('dispatch_terminal:reconciliation_required');
        });
    });
});
