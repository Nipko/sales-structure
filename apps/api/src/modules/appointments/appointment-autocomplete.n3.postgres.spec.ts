import { randomUUID } from 'crypto';
import { AppointmentRemindersService } from './appointment-reminders.service';
import { LANE_CHAT_DDL, N3_LANE_URL, openLane } from '../../common/__fixtures__/n3-lane-harness';

/**
 * N3 · AUT-04 — the hourly auto-complete: a confirmed appointment that ended more than two
 * hours ago becomes `completed` (by 'auto'), the contact's recall cycle restarts, and the
 * post-visit event (`appointment.completed`) is emitted exactly once per appointment, with
 * a durable marker that survives a failure of the listener.
 *
 *   window      ended 3 h ago: completed; ended 1 h ago: untouched; only `confirmed` qualifies.
 *   recall      `last_appointment_at` = now and `next_recall_at` cleared (a new cycle).
 *   event       one event per appointment, carrying the contact's phone and lead; a second
 *               pass emits nothing; a listener that throws leaves the marker pending and the
 *               next pass emits again (and only then closes it).
 *   switch      `autoComplete=false` stops the pass.
 *
 * Time is seeded relative to `NOW() AT TIME ZONE <tenant zone>`. Oracle: appointments and
 * contacts columns; the events recorded by the emitter double.
 */
(N3_LANE_URL ? describe : describe.skip)('N3 AUT-04: appointment auto-complete', () => {
    jest.setTimeout(120_000);
    let lane: Awaited<ReturnType<typeof openLane>>;
    let service: any;
    let events: any[] = [];
    let listenerFails = false;
    let settings: any;

    beforeAll(async () => {
        lane = await openLane('n3autoc', [
            ...LANE_CHAT_DDL,
            `CREATE TABLE appointments(id UUID PRIMARY KEY, contact_id UUID, conversation_id UUID, service_name TEXT,
                start_at TIMESTAMP, end_at TIMESTAMP, status TEXT, completed_at TIMESTAMPTZ, completed_by TEXT,
                completion_event_at TIMESTAMPTZ, updated_at TIMESTAMPTZ DEFAULT NOW())`,
        ]);
        await lane.sql('ALTER TABLE leads ADD COLUMN archived_at TIMESTAMP');
        await lane.sql('ALTER TABLE leads ADD COLUMN created_at TIMESTAMP DEFAULT NOW()');
        (lane.prisma as any).$queryRaw = async () => [{ id: lane.tenantId, schema_name: lane.schema }];
        service = Object.create(AppointmentRemindersService.prototype);
        Object.assign(service, {
            prisma: lane.prisma, proactive: lane.proactive,
            appointmentsService: { getReminderSettings: async () => settings },
            regionalProfile: { timezoneFor: async () => 'America/Bogota', timezoneForSchema: async () => 'America/Bogota' },
            eventEmitter: { emitAsync: async (name: string, payload: any) => { if (listenerFails) throw new Error('listener_down'); events.push({ name, payload }); } },
            logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        });
    });
    afterAll(async () => { if (lane) await lane.close(); });
    beforeEach(async () => {
        events = []; listenerFails = false;
        settings = { autoComplete: true };
        await lane.sql('TRUNCATE appointments, leads, conversations, contacts CASCADE');
    });

    const visit = async (endedAgo: string, status = 'confirmed') => {
        const contactId = randomUUID(), id = randomUUID(), leadId = randomUUID();
        await lane.sql(`INSERT INTO contacts(id,name,phone,channel_type,last_appointment_at,next_recall_at)
            VALUES($1::uuid,'Ana','+573001112233','whatsapp', NOW() - interval '200 days', NOW() + interval '30 days')`, [contactId]);
        await lane.sql('INSERT INTO leads(id,contact_id,phone) VALUES($1::uuid,$2::uuid,$3)', [leadId, contactId, '+573001112233']);
        await lane.sql(`INSERT INTO appointments(id,contact_id,service_name,start_at,end_at,status)
            VALUES($1::uuid,$2::uuid,'Consulta',(NOW() AT TIME ZONE 'America/Bogota') - interval '${endedAgo}' - interval '1 hour',
                   (NOW() AT TIME ZONE 'America/Bogota') - interval '${endedAgo}',$3)`, [id, contactId, status]);
        return { id, contactId, leadId };
    };
    const appt = async (id: string) => (await lane.sql('SELECT status, completed_by, completed_at, completion_event_at FROM appointments WHERE id=$1::uuid', [id]))[0];
    const contactRow = async (id: string) => (await lane.sql(
        "SELECT last_appointment_at > NOW() - interval '1 minute' AS fresh, next_recall_at FROM contacts WHERE id=$1::uuid", [id]))[0];

    it('AUT-04: only a confirmed appointment that ended more than 2 hours ago is completed, by "auto"', async () => {
        const old = await visit('3 hours');
        const recent = await visit('1 hour');
        const pending = await visit('3 hours', 'pending');
        const cancelled = await visit('3 hours', 'cancelled');
        await service.autoCompleteAppointments();
        expect(await appt(old.id)).toMatchObject({ status: 'completed', completed_by: 'auto' });
        expect((await appt(old.id)).completed_at).not.toBeNull();
        for (const a of [recent, pending, cancelled]) expect((await appt(a.id)).status).not.toBe('completed');
        expect((await appt(pending.id)).status).toBe('pending');
    });

    it('AUT-04: completing restarts the contact\'s recall cycle (last visit = now, cooldown cleared)', async () => {
        const old = await visit('3 hours');
        await service.autoCompleteAppointments();
        expect(await contactRow(old.contactId)).toMatchObject({ fresh: true, next_recall_at: null });
    });

    it('AUT-04: one appointment.completed event per appointment, with phone and lead; a second pass emits nothing', async () => {
        const old = await visit('3 hours');
        await service.autoCompleteAppointments();
        await service.autoCompleteAppointments();
        expect(events).toHaveLength(1);
        expect(events[0]).toMatchObject({ name: 'appointment.completed', payload: expect.objectContaining({
            tenantId: lane.tenantId, appointmentId: old.id, contactId: old.contactId, phone: '+573001112233', leadId: old.leadId }) });
        expect((await appt(old.id)).completion_event_at).not.toBeNull();
    });

    it('AUT-04: a listener that fails leaves the marker pending; the next pass emits again and only then closes it', async () => {
        const old = await visit('3 hours');
        listenerFails = true;
        await service.autoCompleteAppointments();
        expect(events).toHaveLength(0);
        expect(await appt(old.id)).toMatchObject({ status: 'completed', completion_event_at: null });
        listenerFails = false;
        await service.autoCompleteAppointments();
        expect(events).toHaveLength(1);
        expect((await appt(old.id)).completion_event_at).not.toBeNull();
    });

    it('AUT-04: autoComplete=false stops the pass', async () => {
        settings = { autoComplete: false };
        const old = await visit('3 hours');
        await service.autoCompleteAppointments();
        expect((await appt(old.id)).status).toBe('confirmed');
        expect(events).toHaveLength(0);
    });
});
