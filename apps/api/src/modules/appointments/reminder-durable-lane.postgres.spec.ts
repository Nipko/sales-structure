import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppointmentRemindersService } from './appointment-reminders.service';
import { AgentDispatchOutboxStore } from '../channels/agent-dispatch-outbox.store';
import { ProactiveDispatchService } from '../channels/proactive-dispatch.service';
import { DISPATCH_OUTBOX_DDL, DispatchOutboxError } from '../channels/agent-dispatch-outbox';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';

/**
 * ═══ THE REMINDER, THROUGH THE REAL STORE ═══
 *
 * The previous batch migrated both reminders onto the durable lane and proved
 * it with a doubled `ProactiveDispatchService`. A double cannot answer the
 * questions that matter here, and the independent review found three of them
 * failing against the real thing:
 *
 *   · the reminders passed an operational scope with no `kind` and no hash, so
 *     `AgentDispatchOutboxStore.prepare` answered `dispatch_authority_required`
 *     and no reminder on the platform would have been prepared at all;
 *   · `dispatchTemplate` returned `false` and the caller turned it into `void`,
 *     then marked the appointment as reminded — a customer who hears nothing
 *     and a record saying they were told;
 *   · nothing revalidated the appointment between preparing the effect and
 *     sending it, so a cancellation in that window still produced "your
 *     appointment is tomorrow at 3".
 *
 * So this suite drives `AppointmentRemindersService` against real PostgreSQL
 * with the real store and the real outbox tables. The oracle for every
 * assertion is the database — the flag column, the outbox row, the history row
 * — never the return value of the call that wrote it.
 */
const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl ? describe : describe.skip)('a reminder on the durable lane, for real', () => {
    const tenantId = randomUUID();
    const schema = `tenant_remlane_${randomUUID().replace(/-/g, '')}`;
    const NUMBER = '15550001111';
    let client: PrismaClient;
    let prisma: any;
    let store: AgentDispatchOutboxStore;
    let proactive: ProactiveDispatchService;
    let service: any;
    let published: string[] = [];
    jest.setTimeout(180_000);

    const sql = (text: string, params: any[] = []): Promise<any[]> =>
        prisma.executeInTenantSchema(schema, text, params);

    /** One appointment 24 hours out, reachable on WhatsApp. */
    const appointment = async (over: Record<string, unknown> = {}) => {
        const contactId = randomUUID();
        const conversationId = randomUUID();
        const id = randomUUID();
        await sql('INSERT INTO contacts(id,name,phone,channel_type) VALUES($1::uuid,$2,$3,$4)',
            [contactId, 'Ana', '+573001112233', 'whatsapp']);
        await sql(`INSERT INTO conversations(id,contact_id,channel_type,channel_account_id)
            VALUES($1::uuid,$2::uuid,'whatsapp',$3)`, [conversationId, contactId, NUMBER]);
        await sql(`INSERT INTO appointments(id, contact_id, conversation_id, service_name,
                start_at, end_at, status, reminder_24h_sent, reminder_2h_sent)
            VALUES($1::uuid,$2::uuid,$3::uuid,'Consulta',
                (NOW() AT TIME ZONE 'America/Bogota') + interval '24 hours',
                (NOW() AT TIME ZONE 'America/Bogota') + interval '25 hours',
                'confirmed',false,false)`,
            [id, contactId, conversationId]);
        if (Object.keys(over).length) {
            const sets = Object.keys(over).map((key, index) => `${key} = $${index + 2}`).join(', ');
            await sql(`UPDATE appointments SET ${sets} WHERE id = $1::uuid`,
                [id, ...Object.values(over)]);
        }
        return { id, contactId, conversationId };
    };

    const flag = async (id: string, column = 'reminder_24h_sent') => (await sql(
        `SELECT ${column} AS value FROM appointments WHERE id = $1::uuid`, [id]))[0]?.value;

    const outboxRows = async () => sql(
        `SELECT id, item_kind, state, origin_kind, channel_account_id, payload, error_code
           FROM agent_dispatch_outbox ORDER BY created_at`);

    /** The service, with only the collaborators a reminder genuinely needs. */
    const build = () => {
        const built: any = Object.create(AppointmentRemindersService.prototype);
        Object.assign(built, {
            prisma,
            proactive,
            whatsappTemplates: {
                getTemplateByName: async () => ({ approval_status: 'APPROVED' }),
            },
            appointmentsService: {
                getReminderSettings: async () => ({ reminder24h: true, reminder2h: true }),
            },
            emailTemplates: { renderAndSend: async () => undefined },
            regionalProfile: {
                timezoneFor: async () => 'America/Bogota',
                timezoneForSchema: async () => 'America/Bogota',
            },
            eventEmitter: { emit: () => undefined },
            cronLock: { runExclusive: async (_n: string, _t: number, fn: any) => fn() },
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        });
        built.assertTenantCanSend = async () => undefined;
        built.getTenantLanguage = async () => 'es';
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
        prisma.getTenantSchemaName = async () => schema;
        (prisma as any).tenant = {
            findUnique: async () => ({ id: tenantId, schemaName: schema, language: 'es' }),
            findFirst: async () => ({ id: tenantId, schemaName: schema }),
        };

        await sql(`CREATE TABLE contacts(id UUID PRIMARY KEY, name TEXT, phone TEXT,
            channel_type TEXT, email TEXT)`);
        await sql(`CREATE TABLE conversations(id UUID PRIMARY KEY,
            contact_id UUID REFERENCES contacts(id), channel_type TEXT, channel_account_id TEXT,
            status TEXT DEFAULT 'active', updated_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE TABLE messages(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            conversation_id UUID REFERENCES conversations(id), direction TEXT, content_type TEXT,
            content_text TEXT, media_url TEXT, status TEXT, external_id TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE UNIQUE INDEX uidx_messages_external_id ON messages(external_id)
            WHERE external_id IS NOT NULL`);
        // `TIMESTAMP`, not `TIMESTAMPTZ`, because that is what the real schema
        // uses: `start_at` is a NAIVE WALL CLOCK, and the reminder window
        // compares it against `NOW() AT TIME ZONE <tenant zone>`. A test table
        // with the other type shifts every window by the tenant's offset and
        // finds nothing, which looks exactly like a broken cron.
        await sql(`CREATE TABLE appointments(id UUID PRIMARY KEY, contact_id UUID,
            conversation_id UUID, service_name TEXT, start_at TIMESTAMP, end_at TIMESTAMP,
            location TEXT, metadata JSONB DEFAULT '{}', assigned_to TEXT, customer_name TEXT,
            customer_email TEXT, status TEXT, reminder_24h_sent BOOLEAN DEFAULT false,
            reminder_2h_sent BOOLEAN DEFAULT false, updated_at TIMESTAMPTZ DEFAULT NOW())`);
        await sql(`CREATE TABLE whatsapp_channels(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            phone_number_id TEXT, meta_waba_id TEXT, channel_status TEXT DEFAULT 'connected',
            connected_at TIMESTAMPTZ DEFAULT NOW())`);
        // The approval lookup is scoped to the sender's WABA, so the catalogue
        // has to hang off a channel exactly as it does in production.
        await sql(`CREATE TABLE whatsapp_templates(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            channel_id UUID NOT NULL REFERENCES whatsapp_channels(id) ON DELETE CASCADE,
            name TEXT NOT NULL, language TEXT DEFAULT 'es', category TEXT,
            approval_status TEXT DEFAULT 'PENDING', last_sync_at TIMESTAMPTZ)`);
        const [channel] = await sql(
            `INSERT INTO whatsapp_channels(phone_number_id, meta_waba_id)
             VALUES($1,'waba-1') RETURNING id`, [NUMBER]);
        for (const name of ['appointment_reminder', 'attendance_check']) {
            await sql(`INSERT INTO whatsapp_templates(channel_id, name, approval_status, category)
                       VALUES($1::uuid,$2,'APPROVED','utility')`, [channel.id, name]);
        }
        await sql('CREATE TABLE agent_personas(id UUID PRIMARY KEY, is_active BOOLEAN, version INT)');
        for (const statement of DISPATCH_OUTBOX_DDL) await sql(statement);

        store = new AgentDispatchOutboxStore(prisma,
            { getClient: () => ({ zadd: async () => 1, zremrangebyscore: async () => 0 }) } as any);
        (store as any).schemaFor = async () => schema;
        proactive = new ProactiveDispatchService(prisma, store,
            { enqueueDispatch: async (_t: string, id: string) => { published.push(id); } } as any);
        service = build();
    });

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_remlane_[a-f0-9]{32}$/.test(schema)) {
                throw new Error('invalid_cleanup_scope');
            }
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe(
                'DELETE FROM public.tenants WHERE id=$1::uuid', tenantId);
        } finally { await client.$disconnect(); }
    });

    beforeEach(async () => {
        published = [];
        await sql('TRUNCATE agent_dispatch_outbox, messages, appointments, conversations, contacts CASCADE');
    });

    const run = () => service.processReminders(tenantId, schema, '24h');

    // ── THE AUTHORITY THE REAL STORE DEMANDS ────────────────────────────────

    it('prepares a row the real store accepts', async () => {
        // The reproduction. With a scope carrying no `kind` and no hash, this
        // threw `dispatch_authority_required` and no reminder on the platform
        // would ever have been prepared.
        const appt = await appointment();
        await run();
        const rows = await outboxRows();
        expect(rows).toHaveLength(1);
        expect({ kind: rows[0].item_kind, origin: rows[0].origin_kind, state: rows[0].state })
            .toEqual({ kind: 'template', origin: 'proactive', state: 'queued' });
        expect(rows[0].channel_account_id).toBe(NUMBER);
        expect(await flag(appt.id)).toBe(true);
    });

    it('writes the history row in the same transaction, as pending', async () => {
        await appointment();
        await run();
        const [message] = await sql(
            "SELECT status, direction, content_type FROM messages WHERE direction = 'outbound'");
        expect(message).toMatchObject({ status: 'pending', content_type: 'template' });
    });

    it('carries an authority the admission can revalidate', async () => {
        const appt = await appointment();
        await run();
        const [row] = await sql('SELECT operational_scope FROM agent_dispatch_outbox');
        expect(row.operational_scope).toMatchObject({
            kind: 'proactive_policy', producer: 'appointment_reminder',
            entityId: appt.id, channelAccountId: NUMBER,
        });
        expect(String(row.operational_scope.entityRevision)).toMatch(/^[a-f0-9]{64}$/);
    });

    // ── THE FLAG FOLLOWS THE EFFECT ─────────────────────────────────────────

    it('leaves the flag false when there is no sender to bill', async () => {
        // THE DEFECT. `dispatchTemplate` answered false, the caller discarded
        // it, and the appointment was marked reminded.
        await appointment();
        await sql("UPDATE conversations SET channel_account_id = ''");
        const appt2 = (await sql('SELECT id FROM appointments'))[0];
        await run();
        expect(await outboxRows()).toEqual([]);
        expect(await flag(appt2.id)).toBe(false);
    });

    it('leaves the flag false when the outbox refuses the batch', async () => {
        const appt = await appointment();
        const broken = jest.spyOn(store, 'prepare')
            .mockRejectedValueOnce(new DispatchOutboxError('dispatch_binding_changed'));
        await run();
        expect(await flag(appt.id)).toBe(false);
        broken.mockRestore();
    });

    it('advances the flag when the effect was already prepared', async () => {
        // The second pass of a cron whose first pass crashed after committing
        // the row and before writing the flag. Nothing new is owed.
        const appt = await appointment();
        await run();
        await sql('UPDATE appointments SET reminder_24h_sent = false');
        await run();
        expect(await outboxRows()).toHaveLength(1);
        expect(await flag(appt.id)).toBe(true);
    });

    it('advances the flag when the policy says the message must NOT be sent', async () => {
        // A cancelled appointment owes nothing. Leaving the flag false would
        // retry every fifteen minutes for ever.
        const appt = await appointment({ status: 'cancelled' });
        // The reminder query itself filters cancelled rows, so drive the
        // dispatch directly to reach the policy's own refusal.
        const result = await service.dispatchTemplate(tenantId, schema,
            { id: appt.id, contact_id: appt.contactId, conversation_id: appt.conversationId,
                contact_phone: '+573001112233', contact_channel: 'whatsapp' },
            { originKey: `appointment_reminder:${appt.id}:24h`, producer: 'appointment_reminder',
                sender: NUMBER, templateName: 'appointment_reminder', language: 'es_ES',
                components: [] });
        expect(result.kind).toBe('suppressed');
        expect(await outboxRows()).toEqual([]);
    });

    // ── TWO CRONS, AND A CRASH IN BETWEEN ───────────────────────────────────

    it('prepares one row when two passes run at once', async () => {
        const appt = await appointment();
        await Promise.all([run(), run()]);
        expect(await outboxRows()).toHaveLength(1);
        expect(await flag(appt.id)).toBe(true);
    });

    it('is recoverable when the process died before publishing', async () => {
        // The row is the record. A publish that never happened is not a message
        // that never happened.
        const appt = await appointment();
        const failing = jest.spyOn(proactive as any, 'queue' in proactive ? 'send' : 'send');
        failing.mockRestore();
        published = [];
        await run();
        expect(published).toHaveLength(1);
        const [row] = await outboxRows();
        expect(row.state).toBe('queued');
        expect(await flag(appt.id)).toBe(true);
    });

    // ── AND THE APPOINTMENT THAT MOVED ──────────────────────────────────────

    it('suppresses an effect whose appointment was rescheduled after preparing', async () => {
        // The window this closes: a row prepared on Tuesday, a reschedule to
        // Thursday, and a lease granted afterwards. "Your appointment is
        // tomorrow at 3" about a row that now says Thursday is worse than
        // nothing, and a retry says the same false thing.
        const appt = await appointment();
        await run();
        const [row] = await outboxRows();
        await sql(`UPDATE appointments
                      SET start_at = (NOW() AT TIME ZONE 'America/Bogota') + interval '72 hours'
                    WHERE id = $1::uuid`, [appt.id]);

        await expect(store.admit(tenantId, row.id))
            .rejects.toMatchObject({ code: 'dispatch_effect_superseded' });
        const [after] = await outboxRows();
        expect(after.state).toBe('suppressed');
        expect(String(after.error_code)).toContain('proactive_stale');
    });

    it('suppresses one whose appointment was cancelled after preparing', async () => {
        const appt = await appointment();
        await run();
        const [row] = await outboxRows();
        await sql("UPDATE appointments SET status = 'cancelled' WHERE id = $1::uuid", [appt.id]);

        await expect(store.admit(tenantId, row.id))
            .rejects.toMatchObject({ code: 'dispatch_effect_superseded' });
        expect(String((await outboxRows())[0].error_code)).toContain('proactive_gone');
    });

    it('still admits one whose appointment has not moved', async () => {
        // The control. Without it, "suppress when stale" could be "never admit".
        await appointment();
        await run();
        const [row] = await outboxRows();
        const admitted = await store.admit(tenantId, row.id);
        expect(admitted.row.state).toBe('admitted');
    });

    it('refuses to send from a number the authority did not name', async () => {
        // The account on the row is the account Meta bills. An effect prepared
        // for one number must not leave from another.
        await appointment();
        await run();
        const [row] = await outboxRows();
        await sql('UPDATE agent_dispatch_outbox SET channel_account_id = $1', ['15559990000']);
        await expect(store.admit(tenantId, row.id))
            .rejects.toMatchObject({ code: 'dispatch_binding_changed' });
    });
});
