import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppointmentNotificationsService } from './appointment-notifications.service';
import { AppointmentRemindersService } from './appointment-reminders.service';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';

/**
 * ═══ TWO AGENTS, OPPOSITE SWITCHES, AND A VISIT THAT IS NOT A PLAIN CITA ═══
 *
 * `realEstate.emailConfirmations` and `pets.emailConfirmations` were declared by
 * the business-profile contract, rendered as a switch by the agent editor — the
 * editor even names the template each one promises — and read by NOTHING. An
 * estate agency could switch visit confirmations off, the screen would say it
 * had, and every visit went on being confirmed by email under the `appointments`
 * switch. That is the defect this suite reproduces and pins.
 *
 * ── WHY THREE AGENTS, EACH THE ODD ONE OUT IN A DIFFERENT FAMILY ────────────
 *
 * Every scenario here runs against ONE tenant with THREE connections, and each
 * agent says yes in exactly one family and no in the other two:
 *
 *            appointments   realEstate   pets
 *   agent A       on            off       off
 *   agent B       off           on        off
 *   agent C       off           off       on
 *
 * That shape is deliberate and it was arrived at by mutating the fix. With two
 * agents configured merely "oppositely", the `pets` assertions still passed
 * when the subject was forced to `null` — because `pets` happened to agree with
 * `appointments` on both connections, so the pre-fix fallback produced the same
 * answer. Here no two families agree on any connection, so:
 *
 *   · ignoring the subject and falling back to `appointments` flips an outcome
 *     on every marker scenario;
 *   · confusing `realEstate` with `pets` flips an outcome too, because the
 *     agent that says yes to one says no to the other.
 *
 * ── WHAT IS REAL AND WHAT IS NOT ────────────────────────────────────────────
 *
 * The database is real: the schema, the two agent rows, their saved
 * configuration, the two conversations, the appointments and their metadata
 * markers. The persona resolution and the origin-connection read run as
 * production runs them, against those rows. Only the SMTP transport is a
 * double, because sending mail is the one external effect a test may not have —
 * so the assertion is on the render-and-send call, which is where the decision
 * becomes a message.
 */
const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl ? describe : describe.skip)('the confirmation switch of the family the appointment belongs to', () => {
    const tenantId = randomUUID();
    const schema = `tenant_apptsubject_${randomUUID().replace(/-/g, '')}`;

    /** The three connections of one tenant, each with its own agent. */
    const ACCOUNT_A = '15550001111';
    const ACCOUNT_B = '15559990000';
    const ACCOUNT_C = '15557770000';

    const AGENT_A = randomUUID();
    const AGENT_B = randomUUID();
    const AGENT_C = randomUUID();

    let client: PrismaClient;
    let prisma: any;
    let renderAndSend: jest.Mock;
    /** Every statement production asked for, so a test can assert the question. */
    let asked: Array<{ sql: string; params: any[] }> = [];
    jest.setTimeout(180_000);

    const sql = (text: string, params: any[] = []): Promise<any[]> =>
        prisma.executeInTenantSchema(schema, text, params);

    /**
     * `tools` for one agent. Written as a whole object because that is how the
     * editor saves it, and because a partial merge is how a switch survives in
     * the row while meaning something else.
     */
    const tools = (over: {
        appointments: boolean; realEstate: boolean; pets: boolean;
    }) => ({
        appointments: { enabled: true, emailConfirmations: over.appointments },
        realEstate: { enabled: true, emailConfirmations: over.realEstate },
        pets: { enabled: true, emailConfirmations: over.pets },
    });

    const saveAgent = async (id: string, account: string, over: {
        appointments: boolean; realEstate: boolean; pets: boolean;
    }) => {
        await sql(`INSERT INTO agent_personas(id,name,config_json,version,channels,
                channel_bindings,schedule_mode,is_active,is_default)
            VALUES($1::uuid,$2,$3::jsonb,1,ARRAY['whatsapp'],ARRAY[$4],'24_7',true,false)
            ON CONFLICT (id) DO UPDATE SET config_json = EXCLUDED.config_json`,
            [id, `Agent ${account}`,
                JSON.stringify({ persona: { name: `Agent ${account}` }, tools: tools(over) }),
                `whatsapp:${account}`]);
    };

    /**
     * A confirmed appointment inside a live thread on one of the two
     * connections, carrying whichever subject marker the scenario is about.
     *
     * `metadata.listingId` and `metadata.petId` are stored here exactly as
     * `resolveAppointmentSubject` stores them in production: a validated id,
     * nothing else.
     */
    const book = async (account: string, metadata: Record<string, any> = {}) => {
        const contactId = randomUUID();
        const conversationId = randomUUID();
        const id = randomUUID();
        // No phone on purpose: the channel notice is a separate lane with its
        // own connection resolution, and this suite is about the email.
        await sql('INSERT INTO contacts(id,name,phone,email,channel_type) VALUES($1::uuid,$2,NULL,$3,$4)',
            [contactId, 'Ana', 'ana@example.com', 'whatsapp']);
        await sql(`INSERT INTO conversations(id,contact_id,channel_type,channel_account_id,status)
            VALUES($1::uuid,$2::uuid,'whatsapp',$3,'active')`,
            [conversationId, contactId, account]);
        await sql(`INSERT INTO appointments(id,contact_id,conversation_id,service_name,
                start_at,end_at,status,customer_name,customer_email,metadata)
            VALUES($1::uuid,$2::uuid,$3::uuid,'Visita',
                (NOW() AT TIME ZONE 'America/Bogota') + interval '24 hours',
                (NOW() AT TIME ZONE 'America/Bogota') + interval '25 hours',
                'confirmed','Ana','ana@example.com',$4::jsonb)`,
            [id, contactId, conversationId, JSON.stringify(metadata)]);
        return { id, contactId, conversationId };
    };

    /** The event payload the manual CRUD emitter hands over. */
    const created = (appt: { id: string; contactId: string; conversationId: string }) => ({
        schemaName: schema,
        appointment: {
            id: appt.id, contactId: appt.contactId, conversationId: appt.conversationId,
            status: 'confirmed', serviceName: 'Visita',
            startAt: new Date(Date.now() + 86_400_000).toISOString().slice(0, 19),
        },
    });

    const buildNotifications = () => {
        const built: any = Object.create(AppointmentNotificationsService.prototype);
        Object.assign(built, {
            prisma,
            eventEmitter: { emit: () => undefined },
            // Never reached: the contact has no phone.
            connections: { resolve: async () => null },
            emailTemplates: { renderAndSend },
            regionalProfile: {
                timezoneFor: async () => 'America/Bogota',
                timezoneForSchema: async () => 'America/Bogota',
            },
            proactive: { send: async () => undefined, conversationFor: async () => null },
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        });
        return built;
    };

    const buildReminders = () => {
        const built: any = Object.create(AppointmentRemindersService.prototype);
        Object.assign(built, {
            prisma,
            emailTemplates: { renderAndSend },
            regionalProfile: {
                timezoneFor: async () => 'America/Bogota',
                timezoneForSchema: async () => 'America/Bogota',
            },
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        });
        return built;
    };

    /** The row shape the reminder sweep hands to its own email sender. */
    const reminderRow = (account: string, metadata: Record<string, any> = {}) => ({
        id: randomUUID(), service_name: 'Visita',
        start_at: '2026-10-01T15:00:00', end_at: '2026-10-01T16:00:00',
        contact_email: 'ana@example.com', contact_name: 'Ana',
        metadata, location: null, staff_name: null,
        conversation_channel: 'whatsapp', conversation_account_id: account,
    });

    beforeAll(async () => {
        const url = new URL(databaseUrl!);
        if (!['localhost', '127.0.0.1'].includes(url.hostname)
            || !url.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        client = new PrismaClient({ datasourceUrl: databaseUrl });
        await ensureSyntheticGlobalTables(text => client.$executeRawUnsafe(text));
        await client.$executeRawUnsafe(
            'INSERT INTO public.tenants(id,schema_name,is_active,language) VALUES($1::uuid,$2,true,$3)',
            tenantId, schema, 'es-CO');
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);

        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        prisma.$queryRaw = client.$queryRaw.bind(client);
        prisma.tenant = {
            findUnique: async () => ({
                id: tenantId, schemaName: schema, language: 'es-CO',
                isInternal: false, subscriptionStatus: 'active',
                subscription: {
                    status: 'active', trialEndsAt: null, cancelAtPeriodEnd: false,
                    currentPeriodEnd: null, cancellationReason: null, dunningStartedAt: null,
                },
            }),
            findFirst: async () => ({ id: tenantId, schemaName: schema }),
        };
        // Production's own per-schema execution — `SET LOCAL search_path` and
        // all — wrapped ONLY to record the questions. Re-writing the statements
        // here would be a second reading of the same SQL, and a harness that
        // rewrites what it tests is how a suite starts agreeing with itself.
        const realExecute = PrismaService.prototype.executeInTenantSchema.bind(prisma);
        prisma.executeInTenantSchema = async (target: string, text: string, params: any[] = []) => {
            if (target !== schema) throw new Error(`unexpected schema ${target}`);
            asked.push({ sql: text, params });
            return realExecute(target, text, params);
        };

        // `TIMESTAMP`, not `TIMESTAMPTZ`: production's `appointments.start_at`
        // is a naive wall clock, and a harness with the other type agrees with
        // itself while disagreeing with production by the tenant's offset.
        await client.$executeRawUnsafe(`CREATE TABLE "${schema}".contacts(
            id UUID PRIMARY KEY, name TEXT, phone TEXT, email TEXT, channel_type TEXT)`);
        await client.$executeRawUnsafe(`CREATE TABLE "${schema}".conversations(
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            contact_id UUID REFERENCES "${schema}".contacts(id),
            channel_type TEXT, channel_account_id TEXT, status TEXT DEFAULT 'active',
            metadata JSONB DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW())`);
        await client.$executeRawUnsafe(`CREATE TABLE "${schema}".appointments(
            id UUID PRIMARY KEY, contact_id UUID, conversation_id UUID, service_name TEXT,
            start_at TIMESTAMP, end_at TIMESTAMP, location TEXT, metadata JSONB DEFAULT '{}',
            assigned_to TEXT, customer_name TEXT, customer_email TEXT, status TEXT,
            updated_at TIMESTAMPTZ DEFAULT NOW())`);
        // The real agent table shape `readServingPersona` ranks over.
        await client.$executeRawUnsafe(`CREATE TABLE "${schema}".agent_personas(
            id UUID PRIMARY KEY, name TEXT, config_json JSONB NOT NULL, version INTEGER NOT NULL,
            channels TEXT[] DEFAULT '{}', channel_bindings TEXT[] DEFAULT '{}',
            schedule_mode TEXT, is_active BOOLEAN DEFAULT true, is_default BOOLEAN DEFAULT false,
            updated_at TIMESTAMPTZ DEFAULT NOW())`);
        await client.$executeRawUnsafe(`CREATE TABLE "${schema}".persona_config(
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), config_json JSONB,
            is_active BOOLEAN DEFAULT true, version INTEGER DEFAULT 1)`);
    });

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_apptsubject_[a-f0-9]{32}$/.test(schema)) {
                throw new Error('invalid_cleanup_scope');
            }
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid', tenantId);
        } finally { await client.$disconnect(); }
    });

    beforeEach(async () => {
        asked = [];
        renderAndSend = jest.fn().mockResolvedValue(true);
        await client.$executeRawUnsafe(
            `TRUNCATE "${schema}".appointments, "${schema}".conversations,
                     "${schema}".contacts, "${schema}".agent_personas CASCADE`);
        // Saved through the same column the editor writes, then re-read by the
        // resolution below: nothing in this suite carries configuration in
        // memory from the write to the decision.
        await saveAgent(AGENT_A, ACCOUNT_A, { appointments: true, realEstate: false, pets: false });
        await saveAgent(AGENT_B, ACCOUNT_B, { appointments: false, realEstate: true, pets: false });
        await saveAgent(AGENT_C, ACCOUNT_C, { appointments: false, realEstate: false, pets: true });
    });

    /** The binding the persona resolution was actually asked about. */
    const resolvedBinding = () =>
        asked.find(entry => entry.sql.includes('WITH ranked AS'))?.params[0];

    describe('a property visit follows realEstate, not appointments', () => {
        it('stays silent on the agent whose realEstate switch is off, though its appointments switch is on', async () => {
            const service = buildNotifications();
            const appt = await book(ACCOUNT_A, { listingId: randomUUID() });

            await service.onAppointmentCreated(created(appt));

            expect(renderAndSend).not.toHaveBeenCalled();
            // Not by bailing out early: the resolution ran, and it ran against
            // the connection the visit was booked on.
            expect(resolvedBinding()).toBe(`whatsapp:${ACCOUNT_A}`);
        });

        it('sends on the agent whose realEstate switch is on, though its appointments switch is off', async () => {
            const service = buildNotifications();
            const appt = await book(ACCOUNT_B, { listingId: randomUUID() });

            await service.onAppointmentCreated(created(appt));

            expect(renderAndSend).toHaveBeenCalledTimes(1);
            expect(resolvedBinding()).toBe(`whatsapp:${ACCOUNT_B}`);
        });

        it('stays silent on the agent that says yes only to pets, so realEstate is not read as pets', async () => {
            const service = buildNotifications();
            const appt = await book(ACCOUNT_C, { listingId: randomUUID() });

            await service.onAppointmentCreated(created(appt));

            expect(renderAndSend).not.toHaveBeenCalled();
            expect(resolvedBinding()).toBe(`whatsapp:${ACCOUNT_C}`);
        });

        it('leaves a plain appointment on the appointments switch of its own agent', async () => {
            // The same agents, the same connections, no marker: the outcomes are
            // the exact opposite of the two above, which is what makes a crossed
            // family read visible instead of harmless.
            const service = buildNotifications();

            await service.onAppointmentCreated(created(await book(ACCOUNT_A)));
            expect(renderAndSend).toHaveBeenCalledTimes(1);

            renderAndSend.mockClear();
            await service.onAppointmentCreated(created(await book(ACCOUNT_B)));
            expect(renderAndSend).not.toHaveBeenCalled();
        });

        it('re-reads the switch from the row, so flipping it changes the next visit', async () => {
            const service = buildNotifications();
            await service.onAppointmentCreated(created(await book(ACCOUNT_B, { listingId: randomUUID() })));
            expect(renderAndSend).toHaveBeenCalledTimes(1);

            // The owner switches visit confirmations off on that same agent.
            await saveAgent(AGENT_B, ACCOUNT_B, { appointments: false, realEstate: false, pets: false });
            renderAndSend.mockClear();

            await service.onAppointmentCreated(created(await book(ACCOUNT_B, { listingId: randomUUID() })));
            expect(renderAndSend).not.toHaveBeenCalled();
        });
    });

    describe('a veterinary visit follows pets, crosswise to realEstate and appointments', () => {
        it('sends on the agent whose pets switch is on, though its appointments switch is off', async () => {
            const service = buildNotifications();
            const appt = await book(ACCOUNT_C, { petId: randomUUID() });

            await service.onAppointmentCreated(created(appt));

            expect(renderAndSend).toHaveBeenCalledTimes(1);
            expect(resolvedBinding()).toBe(`whatsapp:${ACCOUNT_C}`);
        });

        it('stays silent on the agent whose pets switch is off, though its appointments switch is on', async () => {
            const service = buildNotifications();
            const appt = await book(ACCOUNT_A, { petId: randomUUID() });

            await service.onAppointmentCreated(created(appt));

            expect(renderAndSend).not.toHaveBeenCalled();
            expect(resolvedBinding()).toBe(`whatsapp:${ACCOUNT_A}`);
        });

        it('stays silent on the agent that says yes only to realEstate, so pets is not read as realEstate', async () => {
            const service = buildNotifications();
            const appt = await book(ACCOUNT_B, { petId: randomUUID() });

            await service.onAppointmentCreated(created(appt));

            expect(renderAndSend).not.toHaveBeenCalled();
        });

        it('ignores an empty marker, which names nothing', async () => {
            // A stripped value leaves an empty string behind. It is not a pet,
            // so the appointment switch decides — which on agent C is off,
            // while its `pets` switch is on. Reading the empty string as a
            // marker would send.
            const service = buildNotifications();
            await service.onAppointmentCreated(created(await book(ACCOUNT_C, { petId: '' })));
            expect(renderAndSend).not.toHaveBeenCalled();
        });
    });

    /**
     * The reminder must read the SAME switch the confirmation of the same
     * booking read. Reading a different family for the reminder than for the
     * confirmation is the original defect wearing a second hat.
     */
    describe('the reminder reads the same family as the confirmation', () => {
        it('stays silent for a visit reminder on the agent whose realEstate switch is off', async () => {
            const service = buildReminders();
            await service.sendReminderEmail(tenantId, schema,
                reminderRow(ACCOUNT_A, { listingId: randomUUID() }));

            expect(renderAndSend).not.toHaveBeenCalled();
            expect(resolvedBinding()).toBe(`whatsapp:${ACCOUNT_A}`);
        });

        it('sends a plain reminder on that same agent', async () => {
            const service = buildReminders();
            await service.sendReminderEmail(tenantId, schema, reminderRow(ACCOUNT_A));

            expect(renderAndSend).toHaveBeenCalledTimes(1);
        });
    });
});
