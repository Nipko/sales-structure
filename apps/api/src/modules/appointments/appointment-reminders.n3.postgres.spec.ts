import { randomUUID } from 'crypto';
import { AppointmentRemindersService } from './appointment-reminders.service';
import { AppointmentsService } from './appointments.service';
import { TemporalCapacityContractService } from '../verticals/temporal-capacity-contract.service';
import { CronLockService } from '../redis/cron-lock.service';
import { LANE_CHAT_DDL, N3_LANE_URL, openLane } from '../../common/__fixtures__/n3-lane-harness';

/**
 * N3 · AUT-01 / AUT-02 / AUT-03 — the reminder sweeps, as a promise made to the
 * customer: told once, at the right moment, about an appointment that still
 * stands, in the tenant's own clock.
 *
 *   window      24 h pass: start_at in [now+23h, now+25h]; 2 h pass: [now+1h45, now+2h15].
 *   standing    cancelled / completed appointments are not reminded; one moved out of the
 *               window by the real `AppointmentsService.update` is not reminded either.
 *   once        a second (or concurrent) pass writes no second row; the 24h and the 2h are
 *               two different effects of one appointment.
 *   email       goes out on the 24 h pass only.
 *   timezone    the window is read in the tenant's zone, not the server's.
 *   attendance  AUT-03: one `attendance_check` per ended appointment, status untouched.
 *
 * Time is seeded: PostgreSQL's NOW() cannot be faked, so every `start_at` is placed
 * relative to `NOW() AT TIME ZONE <tenant zone>` (a naive wall clock, as in production).
 * Oracle: the flag columns and the outbox rows — never a return value.
 */
(N3_LANE_URL ? describe : describe.skip)('N3 AUT-01/02/03: appointment reminder sweeps', () => {
    jest.setTimeout(120_000);
    let lane: Awaited<ReturnType<typeof openLane>>;
    let service: any;
    let appointments: any;
    let emailSent: jest.Mock;
    let zone = 'America/Bogota';
    let settings: any;
    /** Milliseconds each reminder waits before dispatching: forces two simultaneous passes to overlap. */
    let slow = 0;
    const SENDER = '15550001111';

    beforeAll(async () => {
        lane = await openLane('n3remsweep', [
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
        for (const name of ['appointment_reminder', 'attendance_check']) {
            await lane.sql("INSERT INTO whatsapp_templates(channel_id,name,approval_status,category) VALUES($1::uuid,$2,'APPROVED','utility')", [channel.id, name]);
        }
        (lane.prisma as any).$queryRaw = async () => [{ id: lane.tenantId, schema_name: lane.schema, settings: {} }];
        emailSent = jest.fn(async () => undefined);
        const regionalProfile = {
            timezoneFor: async () => zone, timezoneForSchema: async () => zone,
        };
        service = Object.create(AppointmentRemindersService.prototype);
        Object.assign(service, {
            prisma: lane.prisma, proactive: lane.proactive,
            whatsappTemplates: { getTemplateByName: async () => ({ approval_status: 'APPROVED' }) },
            appointmentsService: { getReminderSettings: async () => settings },
            emailTemplates: { renderAndSend: emailSent },
            regionalProfile,
            eventEmitter: { emit: () => undefined, emitAsync: async () => undefined },
            cronLock: { runExclusive: async (_n: string, _t: number, fn: any) => fn() },
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        });
        service.assertTenantCanSend = async () => undefined;
        service.canSendTenantWork = async () => true;
        service.getTenantLanguage = async () => { if (slow) await new Promise(r => setTimeout(r, slow)); return 'es'; };
        service.appointmentEmailsEnabled = async () => true;

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
        zone = 'America/Bogota';
        slow = 0;
        settings = { reminder24h: true, reminder2h: true, attendanceCheck: true, autoComplete: true };
        emailSent.mockClear();
        await lane.sql('TRUNCATE agent_dispatch_outbox, messages, appointments, conversations, contacts CASCADE');
    });

    /** An appointment `startOffset` from now in the tenant zone's wall clock, lasting one hour. */
    const book = async (startOffset: string, over: {
        status?: string; channel?: string; email?: string | null; phone?: string | null; zoneOverride?: string;
        endOffset?: string; startNaive?: string;
    } = {}) => {
        const contactId = randomUUID(), conversationId = randomUUID(), id = randomUUID();
        const channel = over.channel ?? 'whatsapp';
        await lane.sql('INSERT INTO contacts(id,name,phone,email,channel_type,external_id) VALUES($1::uuid,$2,$3,$4,$5,$6)',
            [contactId, 'Ana Perez', over.phone === undefined ? '+573001112233' : over.phone, over.email ?? null, channel,
                channel === 'telegram' ? `tg-${contactId.slice(0, 8)}` : null]);
        await lane.sql('INSERT INTO conversations(id,contact_id,channel_type,channel_account_id) VALUES($1::uuid,$2::uuid,$3,$4)',
            [conversationId, contactId, channel, channel === 'whatsapp' ? SENDER : `${channel}-bot-1`]);
        const z = over.zoneOverride ?? zone;
        const start = over.startNaive ? `$4::timestamp` : `(NOW() AT TIME ZONE '${z}') + interval '${startOffset}'`;
        const end = over.endOffset
            ? `(NOW() AT TIME ZONE '${z}') + interval '${over.endOffset}'`
            : over.startNaive ? `$4::timestamp + interval '1 hour'` : `(NOW() AT TIME ZONE '${z}') + interval '${startOffset}' + interval '1 hour'`;
        await lane.sql(`INSERT INTO appointments(id,contact_id,conversation_id,service_name,start_at,end_at,status)
            VALUES($1::uuid,$2::uuid,$3::uuid,'Consulta',${start},${end},$${over.startNaive ? 5 : 4})`,
        over.startNaive ? [id, contactId, conversationId, over.startNaive, over.status ?? 'confirmed']
            : [id, contactId, conversationId, over.status ?? 'confirmed']);
        return { id, contactId, conversationId };
    };
    const flags = async (id: string) => (await lane.sql(
        'SELECT reminder_24h_sent AS h24, reminder_2h_sent AS h2, no_show_followed_up AS att, status FROM appointments WHERE id=$1::uuid', [id]))[0];
    const rowsFor = async (contactId: string) => (await lane.outboxRows()).filter((r: any) => r.contact_id === contactId);

    // ── AUT-01 · the 24 h window ───────────────────────────────────────────────

    it('AUT-01: only the appointment inside [now+23h, now+25h] is reminded; the 2h flag is not touched', async () => {
        const early = await book('22 hours');
        const inside = await book('24 hours');
        const late = await book('26 hours 30 minutes');
        await service.send24hReminders();
        expect((await flags(inside.id))).toMatchObject({ h24: true, h2: false });
        expect(await rowsFor(inside.contactId)).toHaveLength(1);
        expect(await flags(early.id)).toMatchObject({ h24: false });
        expect(await rowsFor(early.contactId)).toHaveLength(0);
        expect(await flags(late.id)).toMatchObject({ h24: false });
        expect(await rowsFor(late.contactId)).toHaveLength(0);
    });

    it('AUT-01: the row is the approved appointment_reminder template, on the number the appointment was booked through', async () => {
        const a = await book('24 hours');
        await service.send24hReminders();
        const [row] = await rowsFor(a.contactId);
        expect(row).toMatchObject({ item_kind: 'template', channel_account_id: SENDER });
        expect(JSON.stringify(row.payload)).toContain('appointment_reminder');
    });

    it('AUT-01: the tenant switch reminder24h=false stops the 24h pass entirely', async () => {
        settings = { ...settings, reminder24h: false };
        const a = await book('24 hours');
        await service.send24hReminders();
        expect(await rowsFor(a.contactId)).toHaveLength(0);
        expect((await flags(a.id)).h24).toBe(false);
    });

    // ── AUT-02 · the 2 h window ────────────────────────────────────────────────

    it('AUT-02: only the appointment inside [now+1h45, now+2h15] is reminded, with its own flag', async () => {
        const soon = await book('1 hour 20 minutes');
        const inside = await book('2 hours');
        const later = await book('3 hours');
        await service.send2hReminders();
        expect(await flags(inside.id)).toMatchObject({ h2: true, h24: false });
        expect(await rowsFor(inside.contactId)).toHaveLength(1);
        expect((await flags(soon.id)).h2).toBe(false);
        expect(await rowsFor(soon.contactId)).toHaveLength(0);
        expect((await flags(later.id)).h2).toBe(false);
        expect(await rowsFor(later.contactId)).toHaveLength(0);
    });

    it('AUT-02: the 2h pass sends no email; only the 24h pass does', async () => {
        const mailOnly = await book('2 hours', { phone: null, email: 'ana@example.invalid' });
        await service.send2hReminders();
        expect(emailSent).not.toHaveBeenCalled();
        expect((await flags(mailOnly.id)).h2).toBe(false);
        const day = await book('24 hours', { phone: null, email: 'bea@example.invalid' });
        await service.send24hReminders();
        expect(emailSent).toHaveBeenCalledTimes(1);
        expect(emailSent.mock.calls[0][2]).toBe('bea@example.invalid');
        expect((await flags(day.id)).h24).toBe(true);
    });

    // ── standing: cancelled, completed, moved ──────────────────────────────────

    it('AUT-01/02: a cancelled or completed appointment is not reminded, on either pass', async () => {
        const cancelled = await book('24 hours', { status: 'cancelled' });
        const completed = await book('24 hours', { status: 'completed' });
        const noShow = await book('2 hours', { status: 'no_show' });
        await service.send24hReminders();
        await service.send2hReminders();
        for (const a of [cancelled, completed, noShow]) expect(await rowsFor(a.contactId)).toHaveLength(0);
        expect((await flags(cancelled.id))).toMatchObject({ h24: false, h2: false });
    });

    it('AUT-01: an appointment cancelled by the real AppointmentsService.cancel before the sweep is not reminded', async () => {
        const a = await book('24 hours');
        await appointments.cancel(lane.schema, a.id, 'cliente cancela');
        await service.send24hReminders();
        expect(await rowsFor(a.contactId)).toHaveLength(0);
        expect(await flags(a.id)).toMatchObject({ status: 'cancelled', h24: false });
    });

    it('AUT-01: an appointment moved OUT of the window by the real update() is not reminded for its old slot', async () => {
        const a = await book('24 hours');
        await appointments.update(lane.schema, a.id, {
            startAt: (await lane.sql("SELECT to_char((NOW() AT TIME ZONE 'America/Bogota') + interval '72 hours','YYYY-MM-DD\"T\"HH24:MI:SS') AS t"))[0].t,
            endAt: (await lane.sql("SELECT to_char((NOW() AT TIME ZONE 'America/Bogota') + interval '73 hours','YYYY-MM-DD\"T\"HH24:MI:SS') AS t"))[0].t,
        });
        await service.send24hReminders();
        expect(await rowsFor(a.contactId)).toHaveLength(0);
        expect((await flags(a.id)).h24).toBe(false);
    });

    it('AUT-01: an appointment moved INTO the window is reminded once, for its new slot', async () => {
        const a = await book('72 hours');
        await appointments.update(lane.schema, a.id, {
            startAt: (await lane.sql("SELECT to_char((NOW() AT TIME ZONE 'America/Bogota') + interval '24 hours','YYYY-MM-DD\"T\"HH24:MI:SS') AS t"))[0].t,
            endAt: (await lane.sql("SELECT to_char((NOW() AT TIME ZONE 'America/Bogota') + interval '25 hours','YYYY-MM-DD\"T\"HH24:MI:SS') AS t"))[0].t,
        });
        await service.send24hReminders();
        expect(await rowsFor(a.contactId)).toHaveLength(1);
        expect((await flags(a.id)).h24).toBe(true);
    });

    // ── once ────────────────────────────────────────────────────────────────────

    it('AUT-01: a second pass and two concurrent passes leave exactly one row', async () => {
        const a = await book('24 hours');
        await service.send24hReminders();
        await service.send24hReminders();
        expect(await rowsFor(a.contactId)).toHaveLength(1);
        const b = await book('24 hours');
        slow = 60;
        await Promise.all([service.send24hReminders(), service.send24hReminders()]);
        slow = 0;
        expect(await rowsFor(b.contactId)).toHaveLength(1);
        expect((await flags(b.id)).h24).toBe(true);
    });

    it('AUT-01/02: the 24h and the 2h reminders of one appointment are two different effects', async () => {
        const a = await book('24 hours');
        await service.send24hReminders();
        // Twenty-two hours pass.
        await lane.sql("UPDATE appointments SET start_at = start_at - interval '22 hours', end_at = end_at - interval '22 hours' WHERE id=$1::uuid", [a.id]);
        await service.send2hReminders();
        expect(await rowsFor(a.contactId)).toHaveLength(2);
        expect(await flags(a.id)).toMatchObject({ h24: true, h2: true });
    });

    // ── the cron on two processes ───────────────────────────────────────────────

    it('AUT-01: the 24h cron firing on the API AND on the worker (shared lock) sends the customer email once', async () => {
        const held = new Set<string>();
        const lock = new CronLockService({ acquireLock: async (key: string) => { if (held.has(key)) return false; held.add(key); return true; } } as any);
        const api: any = Object.assign(Object.create(AppointmentRemindersService.prototype), service, { cronLock: lock });
        const worker: any = Object.assign(Object.create(AppointmentRemindersService.prototype), service, { cronLock: lock });
        const a = await book('24 hours', { phone: null, email: 'ana@example.invalid' });
        slow = 60;
        await Promise.all([api.send24hRemindersCron(), worker.send24hRemindersCron()]);
        expect(emailSent).toHaveBeenCalledTimes(1);
        expect((await flags(a.id)).h24).toBe(true);
    });

    // ── the tenant's clock ──────────────────────────────────────────────────────

    it('AUT-01: the window is read in the TENANT zone (Asia/Tokyo), not the server zone', async () => {
        zone = 'Asia/Tokyo';
        const mine = await book('24 hours');                                        // 24 h ahead on a Tokyo wall clock
        const bogota = await book('24 hours', { zoneOverride: 'America/Bogota' });  // 14 h earlier on the same instant scale
        await service.send24hReminders();
        expect(await rowsFor(mine.contactId)).toHaveLength(1);
        expect(await rowsFor(bogota.contactId)).toHaveLength(0);
        expect((await flags(bogota.id)).h24).toBe(false);
    });

    // ── AUT-03 · attendance check ───────────────────────────────────────────────

    it('AUT-03: an appointment that ended 45 min ago gets ONE attendance_check; status is not changed', async () => {
        const a = await book('-105 minutes', { endOffset: '-45 minutes' });
        const fresh = await book('-40 minutes', { endOffset: '-10 minutes' });
        await service.sendAttendanceChecks();
        await service.sendAttendanceChecks();
        const rows = await rowsFor(a.contactId);
        expect(rows).toHaveLength(1);
        expect(JSON.stringify(rows[0].payload)).toContain('attendance_check');
        expect(await flags(a.id)).toMatchObject({ att: true, status: 'confirmed' });
        expect(await rowsFor(fresh.contactId)).toHaveLength(0);
        expect((await flags(fresh.id)).att).toBe(false);
    });

    it('AUT-03: attendanceCheck=false stops the pass; a cancelled appointment is never asked', async () => {
        const cancelled = await book('-105 minutes', { endOffset: '-45 minutes', status: 'cancelled' });
        await service.sendAttendanceChecks();
        expect(await rowsFor(cancelled.contactId)).toHaveLength(0);
        settings = { ...settings, attendanceCheck: false };
        const a = await book('-105 minutes', { endOffset: '-45 minutes' });
        await service.sendAttendanceChecks();
        expect(await rowsFor(a.contactId)).toHaveLength(0);
        expect((await flags(a.id)).att).toBe(false);
    });

    it('AUT-03: an appointment with no conversation (no sender) is not flagged as followed up', async () => {
        const a = await book('-105 minutes', { endOffset: '-45 minutes' });
        await lane.sql('UPDATE appointments SET conversation_id = NULL WHERE id=$1::uuid', [a.id]);
        await lane.sql('DELETE FROM conversations WHERE id=$1::uuid', [a.conversationId]);
        await service.sendAttendanceChecks();
        expect(await rowsFor(a.contactId)).toHaveLength(0);
        expect((await flags(a.id)).att).toBe(false);
    });
});
