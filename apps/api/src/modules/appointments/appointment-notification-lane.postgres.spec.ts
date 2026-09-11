import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppointmentNotificationsService } from './appointment-notifications.service';
import { AgentDispatchOutboxStore } from '../channels/agent-dispatch-outbox.store';
import { ProactiveDispatchService } from '../channels/proactive-dispatch.service';
import { DISPATCH_OUTBOX_DDL } from '../channels/agent-dispatch-outbox';
import { proactivePolicyAuthority } from '../persona/proactive-policy-authority';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';

/**
 * ═══ THE APPOINTMENT CONFIRMATION, THROUGH THE REAL STORE ═══
 *
 * `appointment.created` fires once and nothing retries it, and the confirmation
 * went out through `outbound_queue` — a BullMQ job whose only record is Redis.
 * So the two failures this suite exists to pin were both live:
 *
 *   · a restart between the appointment committing and the job being taken lost
 *     the confirmation entirely, and the customer who just booked heard nothing;
 *   · a lost Redis acknowledgement produced the job twice, and the customer was
 *     confirmed twice — which from October is also charged twice.
 *
 * Everything is asserted against the DATABASE: the outbox row, the history row,
 * the operational scope. Never against the return value of the call that wrote
 * it, because the return value is exactly what was wrong before.
 */
const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl ? describe : describe.skip)('the appointment notice on the durable lane', () => {
    const tenantId = randomUUID();
    const schema = `tenant_apptnotice_${randomUUID().replace(/-/g, '')}`;
    /** The number the customer wrote to, and therefore the account Meta bills. */
    const BOOKED_ON = '15550001111';
    /** A second connection of the same tenant. Nothing may fall back to it. */
    const OTHER_NUMBER = '15559990000';

    let client: PrismaClient;
    let prisma: any;
    let store: AgentDispatchOutboxStore;
    let proactive: ProactiveDispatchService;
    let service: any;
    let published: string[] = [];
    let publishFails = false;
    /** What `ProactiveSendConnection.resolve` was asked for, in order. */
    let resolveAsked: Array<string | null> = [];
    /** When true the tenant has two numbers and nobody chose: the resolver refuses. */
    let connectionAmbiguous = false;
    let legacyEnqueued: any[] = [];
    jest.setTimeout(180_000);

    const sql = (text: string, params: any[] = []): Promise<any[]> =>
        prisma.executeInTenantSchema(schema, text, params);

    /** A confirmed appointment booked inside a live WhatsApp thread. */
    const book = async (over: {
        withThread?: boolean;
        threadChannel?: string;
        threadStatus?: string;
        threadAccount?: string;
    } = {}) => {
        const withThread = over.withThread !== false;
        const contactId = randomUUID();
        const conversationId = randomUUID();
        const id = randomUUID();
        await sql('INSERT INTO contacts(id,name,phone,channel_type) VALUES($1::uuid,$2,$3,$4)',
            [contactId, 'Ana', '+573001112233', 'whatsapp']);
        if (withThread) {
            await sql(`INSERT INTO conversations(id,contact_id,channel_type,channel_account_id,status)
                VALUES($1::uuid,$2::uuid,$3,$4,$5)`,
                [conversationId, contactId, over.threadChannel ?? 'whatsapp',
                    over.threadAccount ?? BOOKED_ON, over.threadStatus ?? 'active']);
        }
        await sql(`INSERT INTO appointments(id, contact_id, conversation_id, service_name,
                start_at, end_at, status)
            VALUES($1::uuid,$2::uuid,$3::uuid,'Consulta',
                (NOW() AT TIME ZONE 'America/Bogota') + interval '24 hours',
                (NOW() AT TIME ZONE 'America/Bogota') + interval '25 hours',
                'confirmed')`,
            [id, contactId, withThread ? conversationId : null]);
        return { id, contactId, conversationId: withThread ? conversationId : null };
    };

    const created = (appt: { id: string; contactId: string; conversationId: string | null }) => ({
        schemaName: schema,
        appointment: {
            id: appt.id, contactId: appt.contactId, conversationId: appt.conversationId,
            status: 'confirmed', serviceName: 'Consulta',
            startAt: new Date(Date.now() + 86_400_000).toISOString().slice(0, 19),
        },
    });

    const outboxRows = async () => sql(
        `SELECT id, item_kind, state, origin_kind, channel_account_id, conversation_id,
                contact_id, payload, error_code, attempts, operational_scope
           FROM agent_dispatch_outbox ORDER BY created_at`);

    const build = () => {
        const built: any = Object.create(AppointmentNotificationsService.prototype);
        Object.assign(built, {
            prisma,
            proactive,
            eventEmitter: { emit: () => undefined },
            outboundQueue: {
                enqueue: async (message: any) => { legacyEnqueued.push(message); },
            },
            channelToken: {},
            connections: {
                resolve: async (input: any) => {
                    resolveAsked.push(input.channelAccountId ?? null);
                    // The real contract: an unnamed connection on a
                    // multi-number tenant is refused, never "the oldest one".
                    if (connectionAmbiguous && !input.channelAccountId) return null;
                    return {
                        accessToken: 'token',
                        accountId: input.channelAccountId || BOOKED_ON,
                    };
                },
            },
            emailTemplates: { renderAndSend: async () => undefined },
            regionalProfile: {
                timezoneFor: async () => 'America/Bogota',
                timezoneForSchema: async () => 'America/Bogota',
            },
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        });
        return built;
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
        prisma.$queryRaw = client.$queryRaw.bind(client);
        prisma.getTenantSchemaName = async () => schema;
        (prisma as any).tenant = {
            findUnique: async () => ({ id: tenantId, schemaName: schema, language: 'es-CO' }),
            findFirst: async () => ({ id: tenantId, schemaName: schema }),
        };

        await sql(`CREATE TABLE contacts(id UUID PRIMARY KEY, name TEXT, phone TEXT,
            channel_type TEXT, email TEXT)`);
        // `DEFAULT gen_random_uuid()`, because production's `conversations.id`
        // has one and `conversationFor` INSERTs without naming the column. A
        // harness without the default writes NULL, the insert dies on the NOT
        // NULL, and "no thread could be opened" looks like correct behaviour
        // while actually being a broken fixture.
        await sql(`CREATE TABLE conversations(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            contact_id UUID REFERENCES contacts(id), channel_type TEXT, channel_account_id TEXT,
            status TEXT DEFAULT 'active', metadata JSONB DEFAULT '{}',
            updated_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE TABLE messages(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            conversation_id UUID REFERENCES conversations(id), direction TEXT, content_type TEXT,
            content_text TEXT, media_url TEXT, status TEXT, external_id TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE UNIQUE INDEX uidx_messages_external_id ON messages(external_id)
            WHERE external_id IS NOT NULL`);
        // `TIMESTAMP`, not `TIMESTAMPTZ`: production's `appointments.start_at`
        // is a NAIVE wall clock. A harness with the other type agrees with
        // itself and disagrees with production by the tenant's whole offset.
        await sql(`CREATE TABLE appointments(id UUID PRIMARY KEY, contact_id UUID,
            conversation_id UUID, service_name TEXT, start_at TIMESTAMP, end_at TIMESTAMP,
            location TEXT, metadata JSONB DEFAULT '{}', assigned_to TEXT, customer_name TEXT,
            customer_email TEXT, status TEXT, cancellation_reason TEXT,
            updated_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE TABLE agent_personas(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            is_active BOOLEAN DEFAULT true, config_json JSONB DEFAULT '{}')`);
        for (const statement of DISPATCH_OUTBOX_DDL) await sql(statement);

        store = new AgentDispatchOutboxStore(prisma,
            { getClient: () => ({ zadd: async () => 1, zremrangebyscore: async () => 0 }) } as any);
        (store as any).schemaFor = async () => schema;
        proactive = new ProactiveDispatchService(prisma, store, {
            enqueueDispatch: async (_t: string, id: string) => {
                if (publishFails) throw new Error('redis_unreachable');
                published.push(id);
            },
        } as any);
        service = build();
    });

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_apptnotice_[a-f0-9]{32}$/.test(schema)) {
                throw new Error('invalid_cleanup_scope');
            }
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe(
                'DELETE FROM public.tenants WHERE id=$1::uuid', tenantId);
        } finally { await client.$disconnect(); }
    });

    beforeEach(async () => {
        published = [];
        publishFails = false;
        resolveAsked = [];
        connectionAmbiguous = false;
        legacyEnqueued = [];
        await sql('TRUNCATE agent_dispatch_outbox, messages, appointments, conversations, contacts CASCADE');
    });

    // ── THE ROW THE REAL STORE ACCEPTS ──────────────────────────────────────

    it('commits one proactive row the real store accepts', async () => {
        // The reproduction of the whole migration: on `outbound_queue` there was
        // no row at all, so nothing here could exist.
        const appt = await book();
        await service.onAppointmentCreated(created(appt));
        const rows = await outboxRows();
        expect(rows).toHaveLength(1);
        expect({ kind: rows[0].item_kind, origin: rows[0].origin_kind, state: rows[0].state })
            .toEqual({ kind: 'text', origin: 'proactive', state: 'queued' });
        expect(rows[0].payload.text).toContain('Consulta');
        expect(rows[0].conversation_id).toBe(appt.conversationId);
        expect(rows[0].contact_id).toBe(appt.contactId);
        expect(legacyEnqueued).toEqual([]);
    });

    it('writes the history row in the same transaction, as pending', async () => {
        await service.onAppointmentCreated(created(await book()));
        const [message] = await sql(
            "SELECT status, direction, content_type FROM messages WHERE direction = 'outbound'");
        expect(message).toMatchObject({ status: 'pending', content_type: 'text' });
    });

    it('carries an authority the admission can revalidate', async () => {
        const appt = await book();
        await service.onAppointmentCreated(created(appt));
        const [row] = await outboxRows();
        expect(row.operational_scope).toMatchObject({
            kind: 'proactive_policy', producer: 'appointment_notification',
            entityId: appt.id, channelAccountId: BOOKED_ON, tenantId,
        });
        expect(String(row.operational_scope.entityRevision)).toMatch(/^[a-f0-9]{64}$/);
    });

    // ── THE PAYING NUMBER IS NAMED, NEVER INHERITED ─────────────────────────

    it('bills the number the customer actually wrote to', async () => {
        const appt = await book({ threadAccount: OTHER_NUMBER });
        await service.onAppointmentCreated(created(appt));
        // The resolver was ASKED for the booking thread's number rather than
        // left to pick, and the row carries it.
        expect(resolveAsked).toEqual([OTHER_NUMBER]);
        expect((await outboxRows())[0].channel_account_id).toBe(OTHER_NUMBER);
    });

    it('sends nothing when nobody has said which number pays', async () => {
        // A tenant with two numbers and no choice recorded. Picking one means
        // writing to their customers from a number they may never have seen,
        // billed to a WABA the business did not choose.
        connectionAmbiguous = true;
        await service.onAppointmentCreated(created(await book({ withThread: false })));
        expect(resolveAsked).toEqual([null]);
        expect(await outboxRows()).toEqual([]);
        expect(legacyEnqueued).toEqual([]);
    });

    it('does not lend a thread from another channel to a WhatsApp notice', async () => {
        // The same column holds whichever account the customer wrote to. An
        // Instagram id is a perfectly well-formed string to bill a WhatsApp
        // message to, and that is exactly the mistake.
        const appt = await book({ threadChannel: 'instagram', threadAccount: 'ig-17841' });
        await service.onAppointmentCreated(created(appt));
        expect(resolveAsked).toEqual([null]);
        const rows = await outboxRows();
        expect(rows[0].channel_account_id).toBe(BOOKED_ON);
        // And a NEW live WhatsApp thread was opened rather than the Instagram
        // one reused.
        expect(rows[0].conversation_id).not.toBe(appt.conversationId);
    });

    it('does not write into a thread somebody closed', async () => {
        const appt = await book({ threadStatus: 'resolved' });
        await service.onAppointmentCreated(created(appt));
        const rows = await outboxRows();
        expect(rows).toHaveLength(1);
        expect(rows[0].conversation_id).not.toBe(appt.conversationId);
        const [fresh] = await sql(
            'SELECT status FROM conversations WHERE id = $1::uuid', [rows[0].conversation_id]);
        expect(fresh.status).toBe('active');
    });

    // ── REPLAY AND RACE ─────────────────────────────────────────────────────

    it('commits one row when the same event arrives twice', async () => {
        // The duplicate a customer sees: "your appointment is confirmed",
        // twice. The origin is derived from the appointment, so the second
        // attempt collides on the row the first one committed.
        const appt = await book();
        await service.onAppointmentCreated(created(appt));
        await service.onAppointmentCreated(created(appt));
        expect(await outboxRows()).toHaveLength(1);
        expect(await sql("SELECT id FROM messages WHERE direction='outbound'")).toHaveLength(1);
    });

    it('commits one row when two listeners run at once', async () => {
        const appt = await book();
        await Promise.all([
            service.onAppointmentCreated(created(appt)),
            service.onAppointmentCreated(created(appt)),
        ]);
        expect(await outboxRows()).toHaveLength(1);
        expect(await sql("SELECT id FROM messages WHERE direction='outbound'")).toHaveLength(1);
    });

    it('gives two appointments of one contact two rows', async () => {
        // The control for the replay test: without it, "one row" could be
        // "never more than one row ever".
        const first = await book();
        const second = await book();
        await service.onAppointmentCreated(created(first));
        await service.onAppointmentCreated(created(second));
        expect(await outboxRows()).toHaveLength(2);
    });

    // ── NO THREAD MEANS NO MESSAGE ──────────────────────────────────────────

    it('opens a live thread for an appointment booked with none', async () => {
        const appt = await book({ withThread: false });
        await service.onAppointmentCreated(created(appt));
        const rows = await outboxRows();
        expect(rows).toHaveLength(1);
        const [thread] = await sql(
            'SELECT contact_id, channel_account_id FROM conversations WHERE id = $1::uuid',
            [rows[0].conversation_id]);
        expect(thread).toMatchObject({ contact_id: appt.contactId, channel_account_id: BOOKED_ON });
    });

    it('sends nothing when a thread cannot be opened', async () => {
        // `conversationFor` answering null is not "try harder": without a
        // thread there is no history row, and without a history row the effect
        // has no receipt and no way back.
        const appt = await book({ withThread: false });
        await sql('ALTER TABLE conversations ADD CONSTRAINT no_new_threads CHECK (false) NOT VALID');
        try {
            await service.onAppointmentCreated(created(appt));
        } finally {
            await sql('ALTER TABLE conversations DROP CONSTRAINT no_new_threads');
        }
        expect(await outboxRows()).toEqual([]);
        expect(legacyEnqueued).toEqual([]);
    });

    // ── THE ROW SURVIVES A QUEUE THAT DOES NOT ──────────────────────────────

    it('keeps the committed row when publishing fails', async () => {
        // The asymmetry the durable lane exists for: the row is the record and
        // the recovery pass reads it, so a Redis that is down costs a delay,
        // never the message.
        publishFails = true;
        await service.onAppointmentCreated(created(await book()));
        expect(published).toEqual([]);
        const rows = await outboxRows();
        expect(rows).toHaveLength(1);
        expect(['prepared', 'queued']).toContain(rows[0].state);
    });

    // ── THE APPOINTMENT THAT MOVED BETWEEN PREPARING AND ADMITTING ──────────

    it('suppresses a notice whose appointment was cancelled after preparing', async () => {
        const appt = await book();
        await service.onAppointmentCreated(created(appt));
        const [row] = await outboxRows();
        await sql("UPDATE appointments SET status = 'cancelled' WHERE id = $1::uuid", [appt.id]);

        await expect(store.admit(tenantId, row.id))
            .rejects.toMatchObject({ code: 'dispatch_effect_superseded' });
        const [after] = await outboxRows();
        expect(after.state).toBe('suppressed');
        expect(String(after.error_code)).toContain('proactive_gone');
    });

    it('suppresses a notice whose appointment was rescheduled after preparing', async () => {
        // "Your appointment is tomorrow at 3" about a row that now says
        // Thursday is worse than sending nothing, and a retry repeats it.
        const appt = await book();
        await service.onAppointmentCreated(created(appt));
        const [row] = await outboxRows();
        await sql(`UPDATE appointments
                      SET start_at = (NOW() AT TIME ZONE 'America/Bogota') + interval '72 hours'
                    WHERE id = $1::uuid`, [appt.id]);

        await expect(store.admit(tenantId, row.id))
            .rejects.toMatchObject({ code: 'dispatch_effect_superseded' });
        expect(String((await outboxRows())[0].error_code)).toContain('proactive_stale');
    });

    it('still admits one whose appointment has not moved', async () => {
        // The control. Without it, "suppress when stale" could be "never admit".
        await service.onAppointmentCreated(created(await book()));
        const [row] = await outboxRows();
        expect((await store.admit(tenantId, row.id)).row.state).toBe('admitted');
    });

    it('refuses to leave from a number the authority did not name', async () => {
        await service.onAppointmentCreated(created(await book()));
        const [row] = await outboxRows();
        await sql('UPDATE agent_dispatch_outbox SET channel_account_id = $1', [OTHER_NUMBER]);
        await expect(store.admit(tenantId, row.id))
            .rejects.toMatchObject({ code: 'dispatch_binding_changed' });
    });

    // ── WHAT THE PROVIDER ANSWERED ──────────────────────────────────────────

    it('records a provider failure without claiming the customer was told', async () => {
        await service.onAppointmentCreated(created(await book()));
        const [row] = await outboxRows();
        const admitted = await store.admit(tenantId, row.id);
        await store.settle(tenantId, row.id, admitted.leaseToken,
            { kind: 'failed', errorCode: 'meta_500' });
        const [after] = await outboxRows();
        expect({ state: after.state, code: after.error_code, attempts: after.attempts })
            .toEqual({ state: 'failed', code: 'meta_500', attempts: 1 });
        // The history row is still 'pending': the budget is not spent, and
        // marking it failed would say the customer definitely heard nothing.
        const [message] = await sql("SELECT status FROM messages WHERE direction='outbound'");
        expect(message.status).toBe('pending');
    });

    it('parks an uncertain outcome for a person instead of resending', async () => {
        // Silence is not evidence of failure. The provider may well have sent
        // it, so the row goes to reconciliation and no new admission is granted.
        await service.onAppointmentCreated(created(await book()));
        const [row] = await outboxRows();
        const admitted = await store.admit(tenantId, row.id);
        await store.settle(tenantId, row.id, admitted.leaseToken,
            { kind: 'reconciliation_required', errorCode: 'timeout_after_post' });
        const [after] = await outboxRows();
        expect(after.state).toBe('reconciliation_required');
        await expect(store.admit(tenantId, row.id)).rejects.toBeTruthy();
        const [message] = await sql("SELECT status FROM messages WHERE direction='outbound'");
        expect(message.status).toBe('pending');
    });

    it('never re-admits an accepted effect', async () => {
        await service.onAppointmentCreated(created(await book()));
        const [row] = await outboxRows();
        const admitted = await store.admit(tenantId, row.id);
        await store.settle(tenantId, row.id, admitted.leaseToken,
            { kind: 'sent', receipt: 'wamid.TEST' });
        await expect(store.admit(tenantId, row.id)).rejects.toBeTruthy();
        const [message] = await sql("SELECT status FROM messages WHERE direction='outbound'");
        expect(message.status).toBe('sent');
    });

    // ── THE CANCELLATION NOTICE, AND WHY IT IS STILL ON THE OLD LANE ────────

    it('BLOCKED: a cancellation notice can obtain no authority today', async () => {
        // THE BLOCKER, reproduced. `appointment_notification` is registered
        // against `appointmentRevision`, which answers null for anything that is
        // not pending or confirmed — and `AppointmentsService.cancel` commits
        // `status = 'cancelled'` BEFORE emitting `appointment.cancelled`.
        //
        // So migrating the cancellation notice would make `policyAuthority`
        // answer `undefined`, the lane would read that as "the entity no longer
        // justifies this message", and the customer would never be told their
        // appointment was cancelled. Deleting a customer-facing message is worse
        // than the duplicate the migration prevents, so it stays on the legacy
        // queue until the closed registry gains an `appointment_cancellation`
        // policy whose revision ACCEPTS `cancelled` and hashes `status`.
        //
        // `persona/proactive-policy-authority.ts` belongs to the integrator.
        const appt = await book();
        await sql("UPDATE appointments SET status = 'cancelled' WHERE id = $1::uuid", [appt.id]);
        const authority = await prisma.transactionInTenantSchema(schema, (query: any) =>
            proactivePolicyAuthority(query, schema, {
                tenantId, producer: 'appointment_notification', channelType: 'whatsapp',
                channelAccountId: BOOKED_ON, entityId: appt.id,
            }));
        expect(authority).toBeUndefined();

        // And the control that proves the same call works while the appointment
        // is confirmed — so the `undefined` above is about the status, not about
        // a broken fixture.
        await sql("UPDATE appointments SET status = 'confirmed' WHERE id = $1::uuid", [appt.id]);
        expect(await prisma.transactionInTenantSchema(schema, (query: any) =>
            proactivePolicyAuthority(query, schema, {
                tenantId, producer: 'appointment_notification', channelType: 'whatsapp',
                channelAccountId: BOOKED_ON, entityId: appt.id,
            }))).toBeDefined();
    });

    it('still delivers the cancellation notice, on the lane it has', async () => {
        // The regression guard for the blocker above: whatever else is true, the
        // customer must still be told. If somebody migrates this call site
        // without the registry entry, this goes red.
        const appt = await book();
        await sql("UPDATE appointments SET status = 'cancelled' WHERE id = $1::uuid", [appt.id]);
        await service.onAppointmentCancelled({
            schemaName: schema,
            appointment: { id: appt.id, contactId: appt.contactId, serviceName: 'Consulta',
                startAt: new Date().toISOString().slice(0, 19) },
            reason: 'el cliente no puede',
        });
        expect(legacyEnqueued).toHaveLength(1);
        expect(String(legacyEnqueued[0].content.text)).toContain('Consulta');
    });
});
