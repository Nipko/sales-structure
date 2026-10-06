import { randomUUID } from 'crypto';
import { AppointmentRemindersService } from './appointment-reminders.service';
import { AppointmentsService } from './appointments.service';
import { TemporalCapacityContractService } from '../verticals/temporal-capacity-contract.service';
import { LANE_CHAT_DDL, N3_LANE_URL, openLane } from '../../common/__fixtures__/n3-lane-harness';

/**
 * N3 · REGRESSIONS (confirmed defects, fixed) of the appointment reminder sweeps — AUT-01 / AUT-03.
 * The assertions state the promise and are NOT adjusted to the product's behaviour.
 *
 *   D1  `processAttendanceChecks` writes `no_show_followed_up = true` for an
 *       appointment on which nothing was sent (a non-WhatsApp contact, or a tenant with
 *       no approved `attendance_check` template): `sendAttendanceTemplate` returns void
 *       on those paths and the caller flags regardless. The flag then makes
 *       `conversations.service` read the customer's next "sí" as attendance confirmation.
 *   D2  The attendance sweep has no lower bound: an appointment that ended weeks ago
 *       is still asked "did you attend?".
 *   D3  `AppointmentsService.update` moves `start_at` but never resets
 *       `reminder_24h_sent` / `reminder_2h_sent`, so an appointment rescheduled AFTER
 *       it was reminded is never reminded for its new time.
 *   D4  The WhatsApp template body renders the date/time from `new Date(start_at)`
 *       (a naive wall clock read as UTC) formatted in the tenant zone, shifting the time
 *       by the zone offset; the Telegram and email paths format the wall clock correctly.
 */
(N3_LANE_URL ? describe : describe.skip)('N3 regressions: appointment reminders and attendance checks', () => {
    jest.setTimeout(120_000);
    let lane: Awaited<ReturnType<typeof openLane>>;
    let service: any;
    let appointments: any;
    let hasAttendanceTemplate = true;
    const SENDER = '15550001111';

    beforeAll(async () => {
        lane = await openLane('n3remdef', [
            ...LANE_CHAT_DDL,
            `CREATE TABLE appointments(id UUID PRIMARY KEY, contact_id UUID, conversation_id UUID, service_name TEXT,
                start_at TIMESTAMP, end_at TIMESTAMP, location TEXT, notes TEXT, metadata JSONB DEFAULT '{}', assigned_to TEXT,
                customer_name TEXT, customer_email TEXT, status TEXT, cancellation_reason TEXT,
                reminder_24h_sent BOOLEAN DEFAULT false, reminder_2h_sent BOOLEAN DEFAULT false,
                no_show_followed_up BOOLEAN DEFAULT false, completed_at TIMESTAMPTZ, completed_by TEXT,
                updated_at TIMESTAMPTZ DEFAULT NOW())`,
            `CREATE TABLE whatsapp_channels(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), phone_number_id TEXT, meta_waba_id TEXT,
                channel_status TEXT DEFAULT 'connected', connected_at TIMESTAMPTZ DEFAULT NOW())`,
            `CREATE TABLE whatsapp_templates(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                channel_id UUID NOT NULL REFERENCES whatsapp_channels(id) ON DELETE CASCADE, name TEXT NOT NULL,
                language TEXT DEFAULT 'es', category TEXT, approval_status TEXT DEFAULT 'PENDING', last_sync_at TIMESTAMPTZ)`,
            'CREATE TABLE agent_personas(id UUID PRIMARY KEY, is_active BOOLEAN, version INT)',
        ]);
        const [channel] = await lane.sql("INSERT INTO whatsapp_channels(phone_number_id, meta_waba_id) VALUES($1,'waba-1') RETURNING id", [SENDER]);
        await lane.sql("INSERT INTO whatsapp_templates(channel_id,name,approval_status,category) VALUES($1::uuid,'appointment_reminder','APPROVED','utility')", [channel.id]);
        const regionalProfile = { timezoneFor: async () => 'America/Bogota', timezoneForSchema: async () => 'America/Bogota' };
        service = Object.create(AppointmentRemindersService.prototype);
        Object.assign(service, {
            prisma: lane.prisma, proactive: lane.proactive,
            appointmentsService: { getReminderSettings: async () => ({ reminder24h: true, reminder2h: true, attendanceCheck: true }) },
            emailTemplates: { renderAndSend: async () => undefined },
            regionalProfile,
            eventEmitter: { emit: () => undefined },
            cronLock: { runExclusive: async (_n: string, _t: number, fn: any) => fn() },
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        });
        service.assertTenantCanSend = async () => undefined;
        service.canSendTenantWork = async () => true;
        service.getTenantLanguage = async () => 'es';
        service.appointmentEmailsEnabled = async () => true;
        (lane.prisma as any).$queryRaw = async () => [{ id: lane.tenantId, schema_name: lane.schema, settings: {} }];
        appointments = Object.create(AppointmentsService.prototype);
        Object.assign(appointments, {
            prisma: lane.prisma, regionalProfile,
            calendarOutbox: { enqueueWithQuery: async () => undefined },
            eventEmitter: { emit: () => undefined },
            temporalContracts: new TemporalCapacityContractService(),
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        });
        appointments.getById = async () => ({});
    });
    afterAll(async () => { if (lane) await lane.close(); });
    beforeEach(async () => {
        await lane.sql('TRUNCATE agent_dispatch_outbox, messages, appointments, conversations, contacts CASCADE');
        await lane.sql("DELETE FROM whatsapp_templates WHERE name='attendance_check'");
        if (hasAttendanceTemplate) {
            const [c] = await lane.sql('SELECT id FROM whatsapp_channels LIMIT 1');
            await lane.sql("INSERT INTO whatsapp_templates(channel_id,name,approval_status,category) VALUES($1::uuid,'attendance_check','APPROVED','utility')", [c.id]);
        }
    });

    const book = async (startOffset: string, endOffset: string, over: { channel?: string; status?: string } = {}) => {
        const contactId = randomUUID(), conversationId = randomUUID(), id = randomUUID();
        const channel = over.channel ?? 'whatsapp';
        await lane.sql('INSERT INTO contacts(id,name,phone,channel_type,external_id) VALUES($1::uuid,$2,$3,$4,$5)',
            [contactId, 'Ana Perez', '+573001112233', channel, channel === 'telegram' ? 'tg-1' : null]);
        await lane.sql('INSERT INTO conversations(id,contact_id,channel_type,channel_account_id) VALUES($1::uuid,$2::uuid,$3,$4)',
            [conversationId, contactId, channel, channel === 'whatsapp' ? SENDER : `${channel}-bot-1`]);
        await lane.sql(`INSERT INTO appointments(id,contact_id,conversation_id,service_name,start_at,end_at,status)
            VALUES($1::uuid,$2::uuid,$3::uuid,'Consulta',(NOW() AT TIME ZONE 'America/Bogota') + interval '${startOffset}',
                   (NOW() AT TIME ZONE 'America/Bogota') + interval '${endOffset}',$4)`,
        [id, contactId, conversationId, over.status ?? 'confirmed']);
        return { id, contactId };
    };
    const att = async (id: string) => (await lane.sql('SELECT no_show_followed_up AS v FROM appointments WHERE id=$1::uuid', [id]))[0].v;
    const rowsFor = async (contactId: string) => (await lane.outboxRows()).filter((r: any) => r.contact_id === contactId);

    it('D1 AUT-03: a Telegram contact is flagged as followed-up although no attendance check exists for it', async () => {
        const tg = await book('-105 minutes', '-45 minutes', { channel: 'telegram' });
        await service.sendAttendanceChecks();
        const rows = await rowsFor(tg.contactId);
        const flagged = await att(tg.id);
        // eslint-disable-next-line no-console
        console.log(`[DEFECT-EVIDENCE AUT-03 D1a] telegram outboxRows=${rows.length} no_show_followed_up=${flagged}`);
        // The flag may be true only if an effect exists (the product's own rule: the flag follows the effect).
        expect(flagged === true ? rows.length > 0 : true).toBe(true);
    });

    it('D1 AUT-03: a WhatsApp appointment is flagged although the attendance_check template is not approved', async () => {
        hasAttendanceTemplate = false;
        await lane.sql("DELETE FROM whatsapp_templates WHERE name='attendance_check'");
        try {
            const wa = await book('-105 minutes', '-45 minutes');
            await service.sendAttendanceChecks();
            const rows = await rowsFor(wa.contactId);
            const flagged = await att(wa.id);
            // eslint-disable-next-line no-console
            console.log(`[DEFECT-EVIDENCE AUT-03 D1b] no-template outboxRows=${rows.length} no_show_followed_up=${flagged}`);
            expect(flagged === true ? rows.length > 0 : true).toBe(true);
        } finally { hasAttendanceTemplate = true; }
    });

    it('D2 AUT-03: an appointment that ended 40 days ago is not asked "did you attend?" now', async () => {
        const old = await book('-961 hours', '-960 hours');
        await service.sendAttendanceChecks();
        const rows = await rowsFor(old.contactId);
        // eslint-disable-next-line no-console
        console.log(`[DEFECT-EVIDENCE AUT-03 D2] 40-day-old appointment outboxRows=${rows.length}`);
        expect(rows).toHaveLength(0);
    });

    it('D3 AUT-01: an appointment rescheduled after its 24h reminder is reminded again for the new time', async () => {
        const a = await book('24 hours', '25 hours');
        await service.send24hReminders();
        expect((await lane.sql('SELECT reminder_24h_sent AS v FROM appointments WHERE id=$1::uuid', [a.id]))[0].v).toBe(true);
        // The customer asks to move it two days: the new slot is again 24 h away "in a while".
        const fmt = async (h: number) => (await lane.sql(
            `SELECT to_char((NOW() AT TIME ZONE 'America/Bogota') + interval '${h} hours','YYYY-MM-DD"T"HH24:MI:SS') AS t`))[0].t;
        await appointments.update(lane.schema, a.id, { startAt: await fmt(72), endAt: await fmt(73) });
        const [flags] = await lane.sql('SELECT reminder_24h_sent AS r24, reminder_2h_sent AS r2, no_show_followed_up AS ns FROM appointments WHERE id=$1::uuid', [a.id]);
        expect(flags).toEqual({ r24: false, r2: false, ns: false });
        // Time passes until the new slot is 24.5 hours out (a genuinely different time from the first one,
        // which was 24 h out: the same clock time is the same occasion and one reminder covers it).
        await lane.sql("UPDATE appointments SET start_at = start_at - interval '47 hours 30 minutes', end_at = end_at - interval '47 hours 30 minutes' WHERE id=$1::uuid", [a.id]);
        await service.send24hReminders();
        const rows = await rowsFor(a.contactId);
        // eslint-disable-next-line no-console
        console.log(`[DEFECT-EVIDENCE AUT-01 D3] reminder rows after reschedule=${rows.length} (expected 2)`);
        expect(rows).toHaveLength(2);
    });

    it('D4 AUT-01: the WhatsApp reminder body names the appointment wall-clock time, not the time shifted by the zone offset', async () => {
        const a = await book('24 hours', '25 hours');
        await service.send24hReminders();
        const [row] = await rowsFor(a.contactId);
        const [{ h, m }] = await lane.sql("SELECT EXTRACT(HOUR FROM start_at)::int AS h, EXTRACT(MINUTE FROM start_at)::int AS m FROM appointments WHERE id=$1::uuid", [a.id]);
        // The wall clock the business booked, rendered with the product's own format options.
        const expected = new Date(2000, 0, 1, h, m).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true });
        const params = (row?.payload?.components ?? [])[0]?.parameters ?? [];
        const shown = params[3]?.text;
        // eslint-disable-next-line no-console
        console.log(`[DEFECT-EVIDENCE AUT-01 D4] wall clock=${h}:${m} expected="${expected}" shown="${shown}"`);
        expect(shown).toBe(expected);
    });

    it('AUT-01: the attendance check names the wall-clock time and is flagged only because it was sent', async () => {
        const a = await book('-105 minutes', '-45 minutes');
        await service.sendAttendanceChecks();
        const rows = await rowsFor(a.contactId);
        expect(rows).toHaveLength(1);
        expect(await att(a.id)).toBe(true);
        const [{ h, m }] = await lane.sql('SELECT EXTRACT(HOUR FROM start_at)::int AS h, EXTRACT(MINUTE FROM start_at)::int AS m FROM appointments WHERE id=$1::uuid', [a.id]);
        const expected = new Date(2000, 0, 1, h, m).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true });
        expect(rows[0].payload.components[0].parameters[3].text).toBe(expected);
    });

    it('AUT-03: an appointment moved after its attendance check was sent is asked again for the new time (the origin key carries the time)', async () => {
        const a = await book('-105 minutes', '-45 minutes');
        await service.sendAttendanceChecks();
        expect(await rowsFor(a.contactId)).toHaveLength(1);
        // Rescheduled (flags re-armed as `update` does) to a different, still-elapsed time.
        await lane.sql(`UPDATE appointments SET no_show_followed_up=false, start_at = start_at - interval '7 minutes',
            end_at = end_at - interval '7 minutes' WHERE id=$1::uuid`, [a.id]);
        await service.sendAttendanceChecks();
        expect(await rowsFor(a.contactId)).toHaveLength(2);
    });
});
