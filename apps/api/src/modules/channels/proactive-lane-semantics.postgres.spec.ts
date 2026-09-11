import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { DelayedError } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { AgentDispatchOutboxStore } from './agent-dispatch-outbox.store';
import { ProactiveDispatchService } from './proactive-dispatch.service';
import { OutboundQueueProcessor } from './outbound-queue.processor';
import { DISPATCH_OUTBOX_DDL, prepareDispatchBatch } from './agent-dispatch-outbox';
import { proactivePolicyAuthority } from '../persona/proactive-policy-authority';
import { revisionHash } from '../evaluation-revision/evaluation-revision';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';

/**
 * ═══ WHAT THE DURABLE LANE HAS TO KNOW ABOUT WHAT IT IS CARRYING ═══
 *
 * Five things it was getting wrong, each invisible because the lane still
 * delivered the message:
 *
 *   · WHO STARTED IT. The processor decided `reactive` vs `proactive` from
 *     "does this row name an inbound message" — and a proactive origin derives
 *     a UUID for that same column, so every reminder and every campaign was
 *     billed as an ANSWER. Reactive traffic escapes the soft stop by design, so
 *     a ceiling meant to pause campaigns paused nothing at all. The producer
 *     name had the same shape of error: every proactive row reported
 *     `dispatch_template`, so a census could not tell a reminder from a
 *     campaign, and neither could an operator asking what filled their ceiling.
 *   · WHAT IT COSTS. Meta charges by the template's APPROVED category, which is
 *     synced into this tenant's own catalogue. The lane passed the name and no
 *     category, so every template arrived as `template_category_missing`:
 *     refused under `enforce`, priced at the ceiling under `observe` — for a
 *     fact one join away.
 *   · WHICH THREAD IT BELONGS TO. `conversationFor` read, then inserted, across
 *     two statements: two crons both read nothing and both inserted, and the
 *     person ended up with two threads on one number. It also settled for an
 *     ARCHIVED conversation, which puts a reminder where nobody is looking.
 *   · WHAT HAPPENS WHEN THE METER CANNOT ANSWER. The exception escaped with the
 *     lease still live, and the lease sweep later called the row
 *     `reconciliation_required` — the state meaning "somebody may have sent
 *     this". A meter outage was recorded as a possible duplicate delivery.
 *   · WHICH CONNECTION IT LEAVES FROM. The binding's four identifiers were
 *     checked two at a time, so a row could write its history into one thread
 *     and send out of another connection entirely.
 *
 * The first two are asserted by driving the REAL `processDispatch` against real
 * PostgreSQL and capturing what it asked the spend meter. Nothing here asserts
 * on a value this file computed.
 */
const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

/** The one persona a tenant who never split their agent into several has. */
const LEGACY_CONFIG = Object.freeze({ tone: 'cordial', goals: ['agendar'] });

(databaseUrl ? describe : describe.skip)('the durable lane knows what it is carrying', () => {
    const tenantId = randomUUID();
    const schema = `tenant_prolane_${randomUUID().replace(/-/g, '')}`;
    const contactId = randomUUID();
    const NUMBER = '15550001111';
    const WABA = '900900900';
    let client: PrismaClient;
    let prisma: any;
    let store: AgentDispatchOutboxStore;
    let proactive: ProactiveDispatchService;
    jest.setTimeout(180_000);

    const sql = (text: string, params: any[] = []): Promise<any[]> =>
        prisma.executeInTenantSchema(schema, text, params);
    const tx = <T>(work: (query: any) => Promise<T>): Promise<T> =>
        prisma.transactionInTenantSchema(schema, work);

    /**
     * The authority a REPLY carries. Its hash is taken with the production
     * function over the row the database holds — the same way the real producer
     * takes it — because an authority this file invented would be refused by
     * the store and would prove nothing about how the lane bills.
     */
    const legacyScope = () => ({
        kind: 'legacy' as const, tenantId, schemaName: schema,
        legacyConfigHash: revisionHash(LEGACY_CONFIG),
    });

    /**
     * A real authority over a real appointment, built exactly the way the
     * reminders service builds one — so the revision the store revalidates
     * against is the hash of a row that actually exists. A hand-made hash would
     * make every admission suppress, which proves nothing about the lane.
     */
    const policyScope = async (over: Record<string, unknown> = {}) => {
        const entityId = randomUUID();
        await sql(`INSERT INTO appointments(id, contact_id, service_name, start_at, status)
                   VALUES($1::uuid, $2::uuid, 'Consulta',
                          (NOW() AT TIME ZONE 'America/Bogota') + interval '24 hours', 'confirmed')`,
            [entityId, contactId]);
        const scope = await tx(query => proactivePolicyAuthority(query, schema, {
            tenantId, producer: 'appointment_reminder',
            channelType: 'whatsapp', channelAccountId: NUMBER, entityId,
        }));
        return { ...scope!, ...over };
    };

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
        prisma.getTenantSchemaName = async () => schema;
        // The processor asks whether the subscription still permits writes
        // before it touches anything. Answering it is setup, not the subject.
        prisma.tenant = {
            findUnique: async () => ({
                subscriptionStatus: 'active', isInternal: false,
                subscription: {
                    status: 'active', trialEndsAt: null, cancelAtPeriodEnd: false,
                    currentPeriodEnd: new Date(Date.now() + 86_400_000),
                    cancellationReason: null, dunningStartedAt: null,
                },
            }),
        };

        await sql('CREATE TABLE contacts(id UUID PRIMARY KEY, name TEXT)');
        await sql(`CREATE TABLE conversations(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            contact_id UUID REFERENCES contacts(id), channel_type TEXT, channel_account_id TEXT,
            status TEXT DEFAULT 'active', updated_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE TABLE messages(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            conversation_id UUID REFERENCES conversations(id), direction TEXT, content_type TEXT,
            content_text TEXT, media_url TEXT, status TEXT, external_id TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE UNIQUE INDEX uidx_messages_external_id ON messages(external_id)
            WHERE external_id IS NOT NULL`);
        // The catalogue the price is read from, shaped as the sync writes it.
        await sql(`CREATE TABLE whatsapp_channels(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            phone_number_id TEXT, meta_waba_id TEXT)`);
        await sql(`CREATE TABLE whatsapp_templates(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            channel_id UUID REFERENCES whatsapp_channels(id), name TEXT, language TEXT,
            category TEXT, approval_status TEXT, last_sync_at TIMESTAMPTZ DEFAULT NOW())`);
        // Naive TIMESTAMP, as production has it: a TIMESTAMPTZ here would make
        // the window predicates agree with a test that production disagrees with.
        await sql(`CREATE TABLE appointments(id UUID PRIMARY KEY, contact_id UUID,
            conversation_id UUID, service_name TEXT, start_at TIMESTAMP, end_at TIMESTAMP,
            status TEXT)`);
        // A REPLY carries a served-agent authority, and the store revalidates
        // it against these two. Empty `agent_personas` plus one active
        // `persona_config` is the LEGACY shape.
        await sql(`CREATE TABLE agent_personas(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name TEXT, config_json JSONB, version INT DEFAULT 1, channels TEXT[] DEFAULT '{}',
            channel_bindings TEXT[] DEFAULT '{}', schedule_mode TEXT, is_active BOOLEAN DEFAULT true,
            is_default BOOLEAN DEFAULT false)`);
        await sql(`CREATE TABLE persona_config(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            config_json JSONB, version INT DEFAULT 1, is_active BOOLEAN DEFAULT true)`);
        await sql('INSERT INTO persona_config(config_json) VALUES($1::jsonb)',
            [JSON.stringify(LEGACY_CONFIG)]);
        for (const statement of DISPATCH_OUTBOX_DDL) await sql(statement);
        await sql('INSERT INTO contacts(id,name) VALUES($1::uuid,$2)', [contactId, 'Ana']);
        await sql('INSERT INTO whatsapp_channels(phone_number_id, meta_waba_id) VALUES($1,$2)',
            [NUMBER, WABA]);
        await sql(`INSERT INTO whatsapp_templates(channel_id, name, language, category, approval_status)
                   SELECT id, 'recordatorio_24h', 'es', 'UTILITY', 'APPROVED'
                     FROM whatsapp_channels WHERE phone_number_id = $1`, [NUMBER]);

        store = new AgentDispatchOutboxStore(prisma,
            { getClient: () => ({ zadd: async () => 1, zremrangebyscore: async () => 0 }) } as any);
        (store as any).schemaFor = async () => schema;
        proactive = new ProactiveDispatchService(prisma, store,
            { enqueueDispatch: async () => undefined } as any);
    });

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_prolane_[a-f0-9]{32}$/.test(schema)) {
                throw new Error('invalid_cleanup_scope');
            }
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid', tenantId);
        } finally { await client.$disconnect(); }
    });

    beforeEach(async () => {
        await sql('TRUNCATE agent_dispatch_outbox, messages, conversations, appointments CASCADE');
        await sql(`DELETE FROM whatsapp_templates WHERE channel_id IN (
                       SELECT id FROM whatsapp_channels WHERE phone_number_id <> $1)`, [NUMBER]);
        await sql('DELETE FROM whatsapp_channels WHERE phone_number_id <> $1', [NUMBER]);
    });

    // ── The row, prepared the way its real producer prepares it ─────────────

    const rowFor = async (options: {
        originKind: 'inbound_reply' | 'proactive';
        item?: { kind: any; payload: Record<string, any> };
        inboundAgeHours?: number;
    }) => {
        const [conversation] = await sql(
            `INSERT INTO conversations(contact_id, channel_type, channel_account_id)
             VALUES($1::uuid,'whatsapp',$2) RETURNING id`, [contactId, NUMBER]);
        const origin = ProactiveDispatchService.originId(`x-${randomUUID()}`);
        if (options.originKind === 'inbound_reply') {
            await sql(`INSERT INTO messages(id, conversation_id, direction, content_type, created_at)
                       VALUES($1::uuid,$2::uuid,'inbound','text',
                              clock_timestamp() - make_interval(hours => $3::int))`,
                [origin, conversation.id, options.inboundAgeHours ?? 0]);
        } else if (options.inboundAgeHours !== undefined) {
            await sql(`INSERT INTO messages(conversation_id, direction, content_type, created_at)
                       VALUES($1::uuid,'inbound','text',
                              clock_timestamp() - make_interval(hours => $2::int))`,
                [conversation.id, options.inboundAgeHours]);
        }
        const operationalScope = options.originKind === 'proactive'
            ? await policyScope()
            : legacyScope();
        const { rows } = await tx(query => prepareDispatchBatch(query, schema, {
            binding: {
                conversationId: conversation.id, contactId,
                inboundMessageId: origin, channelType: 'whatsapp',
                channelAccountId: NUMBER, recipient: '15559998888',
            },
            items: [options.item ?? { kind: 'text', payload: { text: 'hola' } }],
            operationalScope, originKind: options.originKind,
        }));
        return { row: rows[0], conversationId: String(conversation.id) };
    };

    /**
     * The REAL processor, with only the collaborators one dispatch touches, and
     * a spend meter that records what it was asked and then refuses to answer.
     *
     * Refusing is what makes the question observable AND exercises the lease
     * hand-back at the same time: the run ends with the row settled, never
     * sent, and no transport is ever reached.
     */
    const driveDispatch = async (dispatchId: string) => {
        const asked: any[] = [];
        const delayed: number[] = [];
        const processor: any = Object.create(OutboundQueueProcessor.prototype);
        Object.assign(processor, {
            prisma,
            dispatchOutbox: store,
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
            throttle: { isOverLimit: async () => false },
            channelGateway: {
                getStrictTransport: () => ({
                    channelType: 'whatsapp',
                    sendStrict: async () => {
                        throw new Error('nothing may reach a provider in this suite');
                    },
                }),
            },
            channelToken: { getChannelToken: async () => ({ accessToken: 'token' }) },
        });
        processor.admitSpend = async (input: any) => {
            asked.push(input);
            throw new Error('meter_down');
        };
        const job: any = { moveToDelayed: async (at: number) => { delayed.push(at); } };
        let outcome: string | null = null;
        try {
            outcome = await processor.processDispatch({ tenantId, dispatchId }, job, 'tok');
        } catch (error) {
            // `waitUntil` re-schedules and throws; that IS the durable wait.
            if (!(error instanceof DelayedError)) throw error;
            outcome = 'dispatch:delayed';
        }
        return { asked, delayed, outcome };
    };

    // ── 1. WHO STARTED IT, AND WHAT IT IS CALLED ────────────────────────────

    describe('the origin decides how it is billed', () => {
        it('asks the meter to bill a reminder as proactive, under its policy name', async () => {
            // THE DEFECT. A proactive origin also derives a UUID, so "does it
            // name an inbound message" answered YES for both, and every
            // reminder was billed as an answer under `dispatch_template`.
            const { row } = await rowFor({
                originKind: 'proactive',
                item: { kind: 'template', payload: { templateName: 'recordatorio_24h', language: 'es' } },
            });
            expect(row.originKind).toBe('proactive');
            const { asked } = await driveDispatch(row.id);
            expect(asked).toHaveLength(1);
            expect(asked[0].disposition).toBe('proactive');
            expect(asked[0].producer).toBe('proactive_appointment_reminder');
        });

        it('asks the meter to bill an answer as reactive', async () => {
            const { row } = await rowFor({ originKind: 'inbound_reply' });
            const { asked } = await driveDispatch(row.id);
            expect(asked[0].disposition).toBe('reactive');
            expect(asked[0].producer).toBe('dispatch_text');
        });

        it('defaults a row written before the column existed to a reply', async () => {
            // Which is what they all are, by construction.
            const { row } = await rowFor({ originKind: 'inbound_reply' });
            await sql('UPDATE agent_dispatch_outbox SET origin_kind = DEFAULT WHERE id = $1::uuid',
                [row.id]);
            const [raw] = await sql(
                'SELECT origin_kind FROM agent_dispatch_outbox WHERE id = $1::uuid', [row.id]);
            expect(raw.origin_kind).toBe('inbound_reply');
        });
    });

    // ── 2. WHAT IT COSTS, READ FROM THE TENANT'S OWN CATALOGUE ──────────────

    describe('the facts that decide the price', () => {
        const template = { kind: 'template', payload: { templateName: 'recordatorio_24h', language: 'es' } };

        it('hands the meter the category Meta approved, not just the name', async () => {
            // THE DEFECT. `template: { name }` with no category resolves to
            // `template_category_missing` → `category_unknown`: a refusal under
            // `enforce` for a template this tenant has approved as UTILITY.
            const { row } = await rowFor({ originKind: 'proactive', item: template });
            const { asked } = await driveDispatch(row.id);
            expect(asked[0].template).toEqual({ name: 'recordatorio_24h', category: 'UTILITY' });
        });

        it('says the category is unestablished when the catalogue does not have it', async () => {
            // Honest, not cheap: the admission treats unknown as expensive.
            const { row } = await rowFor({
                originKind: 'proactive',
                item: { kind: 'template', payload: { templateName: 'no_sincronizada', language: 'es' } },
            });
            const { asked } = await driveDispatch(row.id);
            expect(asked[0].template).toEqual({ name: 'no_sincronizada', category: null });
        });

        it('does not take a sibling WABA’s idea of the same template name', async () => {
            // The same name approved as MARKETING on another number is a
            // four-fold price difference. Matching on the name alone returns
            // whichever synced last — which is what the newer row below is.
            await sql(`INSERT INTO whatsapp_channels(phone_number_id, meta_waba_id)
                       VALUES('15557770000','800800800')`);
            await sql(`INSERT INTO whatsapp_templates(channel_id, name, language, category,
                            approval_status, last_sync_at)
                       SELECT id, 'recordatorio_24h', 'es', 'MARKETING', 'APPROVED',
                              clock_timestamp() + interval '1 hour'
                         FROM whatsapp_channels WHERE phone_number_id = '15557770000'`);
            const { row } = await rowFor({ originKind: 'proactive', item: template });
            const { asked } = await driveDispatch(row.id);
            expect(asked[0].template.category).toBe('UTILITY');
        });

        it('reports the service window as open when the customer wrote an hour ago', async () => {
            // THE OTHER HALF OF THE DEFECT: the lane hardcoded `false` for
            // everything proactive, which refuses — under `enforce` — a message
            // Meta would have delivered as a free service reply.
            const { row } = await rowFor({ originKind: 'proactive', inboundAgeHours: 1 });
            const { asked } = await driveDispatch(row.id);
            expect(asked[0].insideServiceWindow).toBe(true);
        });

        it('reports it closed when the last inbound is older than the window', async () => {
            const { row } = await rowFor({ originKind: 'proactive', inboundAgeHours: 25 });
            const { asked } = await driveDispatch(row.id);
            expect(asked[0].insideServiceWindow).toBe(false);
        });

        it('reports it closed when nobody ever wrote', async () => {
            const { row } = await rowFor({ originKind: 'proactive' });
            const { asked } = await driveDispatch(row.id);
            expect(asked[0].insideServiceWindow).toBe(false);
        });

        it('carries no template at all for a message that is not one', async () => {
            const { row } = await rowFor({ originKind: 'inbound_reply' });
            const { asked } = await driveDispatch(row.id);
            expect(asked[0].template).toBeNull();
        });
    });

    // ── 3. WHEN THE METER CANNOT ANSWER ─────────────────────────────────────

    describe('a lease that outlived its decision', () => {
        it('is handed back, so the sweep cannot call a meter outage a maybe-send', async () => {
            // `admitSpend` raises BEFORE the POST, so the attempt provably sent
            // nothing. Letting it escape left the row `admitted` with a live
            // lease, and the sweep later turned it into
            // `reconciliation_required` — the state that means somebody may
            // have sent this. A person then had to resolve by hand something
            // nobody had attempted.
            const { row } = await rowFor({ originKind: 'proactive' });
            const { outcome, delayed } = await driveDispatch(row.id);
            const [raw] = await sql(
                `SELECT state, lease_token, error_code, available_at > clock_timestamp() AS waiting
                   FROM agent_dispatch_outbox WHERE id = $1::uuid`, [row.id]);
            expect(raw.state).toBe('failed');
            expect(raw.error_code).toBe('spend_meter_unavailable');
            // No live lease: there is nothing for the sweep to misread.
            expect(raw.lease_token).toBeNull();
            // And the work is not lost — it is parked on the durable date.
            expect(raw.waiting).toBe(true);
            expect(delayed).toHaveLength(1);
            expect(outcome).toBe('dispatch:delayed');
        });

        it('leaves the row claimable again once the date arrives', async () => {
            const { row } = await rowFor({ originKind: 'proactive' });
            await driveDispatch(row.id);
            await sql(`UPDATE agent_dispatch_outbox SET available_at = clock_timestamp()
                       WHERE id = $1::uuid`, [row.id]);
            const admitted = await store.admit(tenantId, row.id);
            expect(admitted.row.state).toBe('admitted');
            expect(admitted.row.attempts).toBe(2);
        });
    });

    // ── 4. WHICH THREAD IT BELONGS TO ───────────────────────────────────────

    describe('the thread a proactive message is written into', () => {
        const ask = () => proactive.conversationFor(schema, {
            contactId, channelType: 'whatsapp', channelAccountId: NUMBER,
        });

        it('creates one when the contact has none', async () => {
            expect(await ask()).toMatch(/^[0-9a-f-]{36}$/);
            expect(await sql('SELECT count(*)::int AS n FROM conversations')).toEqual([{ n: 1 }]);
        });

        it('reuses the live one rather than opening a second', async () => {
            const first = await ask();
            expect(await ask()).toBe(first);
            expect(await sql('SELECT count(*)::int AS n FROM conversations')).toEqual([{ n: 1 }]);
        });

        it('makes a second caller WAIT rather than both deciding there is none', async () => {
            // THE RACE, staged rather than hoped for.
            //
            // Launching two promises and checking the row count proves nothing:
            // they interleave when the machine feels like it, and this suite
            // watched that exact test stay green with the serialisation ripped
            // out. So the contention is made deterministic — a separate
            // connection holds the serialisation point, and the question is
            // whether `conversationFor` waits for it.
            //
            // Read-then-insert waits for nothing, so it answers immediately.
            // That is precisely how two crons both decided there was no thread
            // and both inserted one, leaving the person with two threads on one
            // number: the agent sees half their history and the identity
            // service sees two customers.
            const holder = new PrismaClient({ datasourceUrl: databaseUrl });
            let answered = false;
            try {
                let release: () => void = () => undefined;
                const releasable = new Promise<void>(resolve => { release = resolve; });
                const held = holder.$transaction(async (q: any) => {
                    await q.$queryRawUnsafe(
                        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text',
                        `proactive-conversation:${schema}:${contactId}:whatsapp:${NUMBER}`);
                    await releasable;
                }, { timeout: 30_000 });
                // Let the holder actually take the lock before asking.
                await new Promise(resolve => setTimeout(resolve, 400));
                const asking = ask().then(id => { answered = true; return id; });
                await new Promise(resolve => setTimeout(resolve, 800));
                expect(answered).toBe(false);
                release();
                await held;
                expect(await asking).toMatch(/^[0-9a-f-]{36}$/);
            } finally { await holder.$disconnect(); }
            expect(await sql('SELECT count(*)::int AS n FROM conversations')).toEqual([{ n: 1 }]);
        });

        it('still answers one id when two crons ask together', async () => {
            const [a, b] = await Promise.all([ask(), ask()]);
            expect(a).toBe(b);
            expect(await sql('SELECT count(*)::int AS n FROM conversations')).toEqual([{ n: 1 }]);
        });

        it.each(['resolved', 'archived'])('does not write into a %s conversation', async status => {
            // `ORDER BY (status = 'active') DESC` PREFERRED a live one and
            // settled for anything else, so a reminder landed in a thread
            // somebody had closed — the console does not show it, and the
            // customer's reply arrives from nowhere.
            const first = await ask();
            await sql('UPDATE conversations SET status = $1 WHERE id = $2::uuid', [status, first]);
            const second = await ask();
            expect(second).not.toBe(first);
            expect(await sql('SELECT count(*)::int AS n FROM conversations')).toEqual([{ n: 2 }]);
        });

        it('keeps one number’s thread separate from another’s', async () => {
            const first = await ask();
            expect(await proactive.conversationFor(schema, {
                contactId, channelType: 'whatsapp', channelAccountId: '15559990000',
            })).not.toBe(first);
        });
    });

    // ── 5. WHAT `queued` MEANS ──────────────────────────────────────────────

    describe('the state a row is left in when publishing fails', () => {
        it('stays `prepared` when the publish threw, because nothing was published', async () => {
            // The publish failure is swallowed on purpose: the row is the
            // record and the recovery pass republishes anything nothing ever
            // published. That asymmetry is why this lane exists.
            //
            // But the row was marked `queued` regardless — a state that says a
            // job exists for it. Nothing broke, because `queued` is still
            // available and recovery still finds it; the row simply said
            // something that had not happened, and an operator reading "queued"
            // while no job exists cannot tell that from a worker being behind.
            const { row } = await rowFor({ originKind: 'proactive' });
            const published = await store.publishBatch(tenantId, [row],
                async () => { throw new Error('redis is down'); });
            expect(published).toBe(1);
            const [raw] = await sql(
                'SELECT state FROM agent_dispatch_outbox WHERE id = $1::uuid', [row.id]);
            expect(raw.state).toBe('prepared');
        });

        it('says `queued` when the publish actually happened', async () => {
            const { row } = await rowFor({ originKind: 'proactive' });
            await store.publishBatch(tenantId, [row], async () => undefined);
            const [raw] = await sql(
                'SELECT state FROM agent_dispatch_outbox WHERE id = $1::uuid', [row.id]);
            expect(raw.state).toBe('queued');
        });

        it('leaves a row that failed to publish claimable by the recovery pass', async () => {
            // `prepared` is available, so this is not a regression in
            // behaviour — only in what the row claims about itself.
            const { row } = await rowFor({ originKind: 'proactive' });
            await store.publishBatch(tenantId, [row],
                async () => { throw new Error('redis is down'); });
            expect((await store.admit(tenantId, row.id)).row.state).toBe('admitted');
        });
    });

    // ── 6. WHAT HAPPENS WHEN THE AGENT IS EDITED MID-FLIGHT ─────────────────

    describe('a reply whose agent changed while it waited', () => {
        it('is suppressed, not retried against a rule it can never satisfy', async () => {
            // A changed `ServedAgentAuthority` used to escape as a retryable
            // preflight failure: the row stayed available and the next pass
            // tried again. But the condition is a configuration that CHANGED,
            // and no number of retries brings the old hash back — so an edited
            // agent's queued reply burned five attempts over hours against a
            // rule it could never satisfy, and only then stopped.
            //
            // The words were composed by a persona that no longer exists in
            // that form. Delivering them later is exactly what the authority is
            // for, so it suppresses like the other two kinds do.
            const { row } = await rowFor({ originKind: 'inbound_reply' });
            await sql('UPDATE persona_config SET config_json = $1::jsonb',
                [JSON.stringify({ ...LEGACY_CONFIG, tone: 'seco' })]);
            try {
                await expect(store.admit(tenantId, row.id))
                    .rejects.toMatchObject({ code: 'dispatch_effect_superseded' });
                const [raw] = await sql(
                    'SELECT state, error_code FROM agent_dispatch_outbox WHERE id = $1::uuid',
                    [row.id]);
                expect(raw.state).toBe('suppressed');
                expect(raw.error_code).toContain('agent_');
            } finally {
                await sql('UPDATE persona_config SET config_json = $1::jsonb',
                    [JSON.stringify(LEGACY_CONFIG)]);
            }
        });

        it('admits normally when the agent did not change', async () => {
            const { row } = await rowFor({ originKind: 'inbound_reply' });
            expect((await store.admit(tenantId, row.id)).row.state).toBe('admitted');
        });

        it('leaves a suppressed row terminal rather than available', async () => {
            // The point of suppressing instead of failing: nothing tries again.
            const { row } = await rowFor({ originKind: 'inbound_reply' });
            await sql('UPDATE persona_config SET config_json = $1::jsonb',
                [JSON.stringify({ ...LEGACY_CONFIG, tone: 'otro' })]);
            try {
                await store.admit(tenantId, row.id).catch(() => undefined);
                await expect(store.admit(tenantId, row.id))
                    .rejects.toMatchObject({ code: 'dispatch_terminal:suppressed' });
            } finally {
                await sql('UPDATE persona_config SET config_json = $1::jsonb',
                    [JSON.stringify(LEGACY_CONFIG)]);
            }
        });
    });

    // ── 7. THE TWO SHAPES THE LANE COULD NOT EXPRESS ────────────────────────

    describe('a menu and a map pin, on the durable lane', () => {
        const historyOf = async (conversationId: string) => (await sql(
            `SELECT content_type, content_text FROM messages
              WHERE conversation_id = $1::uuid AND direction = 'outbound'`,
            [conversationId]))[0];

        it('writes a row for an interactive message the database accepts', async () => {
            // `item_kind` refused anything outside five values, so a menu had no
            // row to write: it went straight to the adapter with no lease and no
            // receipt, and a restart between deciding and posting lost it or
            // repeated it.
            const { row, conversationId } = await rowFor({
                originKind: 'inbound_reply',
                item: { kind: 'interactive', payload: {
                    type: 'list', body: '¿Qué horario te sirve?',
                    action: { sections: [{ rows: [{ title: '10:00' }, { title: '15:00' }] }] },
                } },
            });
            expect(row.itemKind).toBe('interactive');
            const history = await historyOf(conversationId);
            expect(history.content_type).toBe('interactive');
            // The QUESTION and the options, because the customer's next message
            // is one of them: a thread holding only the body makes "10:00"
            // arrive as an answer to nothing.
            expect(history.content_text).toContain('¿Qué horario te sirve?');
            expect(history.content_text).toContain('10:00');
            expect(history.content_text).toContain('15:00');
        });

        it('writes a row for a location, recorded by the place rather than the numbers', async () => {
            const { row, conversationId } = await rowFor({
                originKind: 'inbound_reply',
                item: { kind: 'location', payload: {
                    latitude: 4.711, longitude: -74.0721,
                    name: 'Salón Centro', address: 'Cra 7 #12-34',
                } },
            });
            expect(row.itemKind).toBe('location');
            const history = await historyOf(conversationId);
            expect(history.content_type).toBe('location');
            expect(history.content_text).toContain('Salón Centro');
            expect(history.content_text).toContain('Cra 7 #12-34');
        });

        it('still refuses a kind nobody defined', async () => {
            await expect(rowFor({
                originKind: 'inbound_reply',
                item: { kind: 'carousel', payload: { text: 'hola' } },
            })).rejects.toMatchObject({ code: 'dispatch_invalid_batch' });
        });
    });

    // ── 8. THE FOUR IDENTIFIERS ARE ONE FACT ────────────────────────────────

    describe('a binding that names four things', () => {
        const bindingFor = (conversationId: string, over: Record<string, unknown>) => ({
            conversationId, contactId,
            inboundMessageId: ProactiveDispatchService.originId(`z-${randomUUID()}`),
            channelType: 'whatsapp', channelAccountId: NUMBER,
            recipient: '15559998888', ...over,
        });
        const thread = async () => (await sql(
            `INSERT INTO conversations(contact_id, channel_type, channel_account_id)
             VALUES($1::uuid,'whatsapp',$2) RETURNING id`, [contactId, NUMBER]))[0].id;

        it('refuses to prepare a batch whose channel is not the thread’s', async () => {
            // Writing history into a WhatsApp thread and sending out of a
            // Telegram connection: the console shows a reply the customer never
            // got, and the spend lands on the wrong number's meter.
            const conversationId = await thread();
            const operationalScope = await policyScope({ channelType: 'telegram' });
            await expect(tx(query => prepareDispatchBatch(query, schema, {
                binding: bindingFor(conversationId, { channelType: 'telegram' }) as any,
                items: [{ kind: 'text', payload: { text: 'hola' } }],
                operationalScope, originKind: 'proactive',
            }))).rejects.toMatchObject({ code: 'dispatch_binding_changed' });
        });

        it('refuses to prepare a batch whose number is not the thread’s', async () => {
            const conversationId = await thread();
            const operationalScope = await policyScope({ channelAccountId: '15557770000' });
            await expect(tx(query => prepareDispatchBatch(query, schema, {
                binding: bindingFor(conversationId, { channelAccountId: '15557770000' }) as any,
                items: [{ kind: 'text', payload: { text: 'hola' } }],
                operationalScope, originKind: 'proactive',
            }))).rejects.toMatchObject({ code: 'dispatch_binding_changed' });
        });

        it('refuses to admit a row whose thread moved to another number after it was prepared', async () => {
            // Hours pass between preparing a reminder and sending it. Prepare's
            // check answered about a moment that has passed; this one answers
            // inside the transaction that grants the lease.
            const { row, conversationId } = await rowFor({ originKind: 'proactive' });
            await sql('UPDATE conversations SET channel_account_id = $1 WHERE id = $2::uuid',
                ['15557770000', conversationId]);
            await expect(store.admit(tenantId, row.id))
                .rejects.toMatchObject({ code: 'dispatch_binding_changed' });
            const [raw] = await sql(
                'SELECT state FROM agent_dispatch_outbox WHERE id = $1::uuid', [row.id]);
            expect(raw.state).toBe('prepared');
        });

        it('admits normally when nothing about the thread changed', async () => {
            const { row } = await rowFor({ originKind: 'proactive' });
            expect((await store.admit(tenantId, row.id)).row.state).toBe('admitted');
        });

        it('refuses a thread that records no connection rather than guessing one', async () => {
            // Both channel columns are NOT NULL on `conversations`, so a null
            // one means the table is not the table this engine ships. Guessing
            // on its behalf is how a lane sends from a number nobody chose;
            // refusing is loud, diagnosable and sends nothing.
            const { row, conversationId } = await rowFor({ originKind: 'proactive' });
            await sql(`UPDATE conversations SET channel_account_id = NULL
                       WHERE id = $1::uuid`, [conversationId]);
            await expect(store.admit(tenantId, row.id))
                .rejects.toMatchObject({ code: 'dispatch_binding_changed' });
        });
    });
});
