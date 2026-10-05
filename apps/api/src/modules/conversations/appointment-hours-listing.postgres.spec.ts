import { randomUUID } from 'crypto';
import { CRM_BASE_TABLES, N3_DATABASE_URL, openLive, seedCustomer } from './__fixtures__/n3-live-harness';

/**
 * N3 · the two promises `appointment-gaps.defect.postgres.spec.ts` states, from the
 * other side: what create_appointment / reschedule_appointment DO accept and refuse
 * once they honour the opening hours and the listing they were handed.
 *
 *   HOURS    the whole block (duration + buffer) must sit inside one working window
 *            of the assigned staff (any staff when the visit is a shared resource),
 *            on a day that is not blocked.
 *   SUBJECT  an id the model sent must resolve: a placeholder, a malformed or an
 *            unknown id is refused instead of being dropped and booked anonymously.
 */
const TABLES = [...CRM_BASE_TABLES, 'staff_members', 'operational_locations', 'operational_resources', 'staff_operational_bindings',
    'staff_resource_assignments', 'services', 'service_staff', 'calendar_integrations', 'appointments',
    'availability_slots', 'blocked_dates', 'calendar_sync_outbox', 'real_estate_listings',
    'listing_zone_agents', 'tool_execution_ledger', 'tool_approval_tickets', 'tool_approval_outbox',
    'commitment_proposals', 'operational_notice_outbox'];

(N3_DATABASE_URL ? describe : describe.skip)('N3: appointment writers honour hours and subject', () => {
    jest.setTimeout(180_000);
    let h: Awaited<ReturnType<typeof openLive>>;
    let scope: any, staffId: string, lateStaffId: string, splitStaffId: string, bareStaffId: string, nightStaffId: string,
        serviceId: string, flexServiceId: string, date: string, listingId: string;

    beforeAll(async () => {
        h = await openLive({ prefix: 'n3hrs', workarounds: { commitmentDdl: true }, tables: TABLES });
        scope = await h.seedAgent();
        staffId = await h.seedStaff('Asesor');
        lateStaffId = await h.seedStaff('Tarde');
        splitStaffId = await h.seedStaff('Doble');
        bareStaffId = await h.seedStaff('SinHorario');
        nightStaffId = await h.seedStaff('Noche');
        serviceId = randomUUID();
        flexServiceId = randomUUID();
        await h.q(`INSERT INTO services(id,name,is_active,duration_minutes,buffer_minutes,max_concurrent,price,currency,payment_policy)
            VALUES($1::uuid,'Visita al inmueble',true,30,0,3,0,'COP','none')`, [serviceId]);
        await h.q(`INSERT INTO services(id,name,is_active,duration_minutes,duration_type,duration_minutes_max,buffer_minutes,max_concurrent,price,currency,payment_policy)
            VALUES($1::uuid,'Recorrido flexible',true,30,'flexible',120,0,3,0,'COP','none')`, [flexServiceId]);
        date = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
        for (let dow = 0; dow <= 6; dow += 1) {
            await h.q(`INSERT INTO availability_slots(user_id,day_of_week,start_time,end_time,is_active)
                VALUES($1::uuid,$2,'09:00','17:00',true)`, [staffId, dow]);
            await h.q(`INSERT INTO availability_slots(user_id,day_of_week,start_time,end_time,is_active)
                VALUES($1::uuid,$2,'13:00','15:00',true)`, [lateStaffId, dow]);
            // Two windows in one day: a lunch break in the middle.
            for (const [from, to] of [['08:00', '10:00'], ['14:00', '16:00']]) {
                await h.q(`INSERT INTO availability_slots(user_id,day_of_week,start_time,end_time,is_active)
                    VALUES($1::uuid,$2,$3,$4,true)`, [splitStaffId, dow, from, to]);
            }
            // A window that runs to midnight.
            await h.q(`INSERT INTO availability_slots(user_id,day_of_week,start_time,end_time,is_active)
                VALUES($1::uuid,$2,'18:00','00:00',true)`, [nightStaffId, dow]);
        }
        listingId = randomUUID();
        await h.q(`INSERT INTO real_estate_listings(id,name,transaction_type,assigned_agent_id,neighborhood,city)
            VALUES($1::uuid,'Casa Aurora','sale',$2::uuid,'Chapinero','Bogotá')`, [listingId, staffId]);
    });
    afterAll(async () => { if (h) await h.close(); });
    beforeEach(async () => {
        await h.q('TRUNCATE appointments,tool_execution_ledger,messages CASCADE');
        await h.q('DELETE FROM blocked_dates');
    });

    const confirmed = async (C: { contactId: string; conversationId: string }, tool: string, args: any) => {
        await h.inbound(C.conversationId, 'quiero hacerlo');
        expect(await h.call(C.contactId, C.conversationId, tool, args, scope)).toMatchObject({ error: 'confirmation_required' });
        await h.inbound(C.conversationId, 'sí, confirmo');
        return h.call(C.contactId, C.conversationId, tool, args, scope);
    };
    const book = (C: any, time: string, extra: Record<string, unknown> = {}) => confirmed(C, 'create_appointment', {
        serviceId, date, time, listingId, customerName: 'Comprador N3', customerEmail: 'c@example.invalid', ...extra,
    });
    const seedAppointment = async (C: any, assignedTo: string | null, time = '10:00', end = '10:30', service = serviceId) => {
        const id = randomUUID();
        await h.q(`INSERT INTO appointments(id,contact_id,conversation_id,assigned_to,service_id,service_name,start_at,end_at,
                status,customer_name,created_at,updated_at)
            VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,'Visita al inmueble',$6::timestamp,$7::timestamp,'confirmed',
                'Cliente',NOW(),NOW())`, [id, C.contactId, C.conversationId, assignedTo, service, `${date} ${time}`, `${date} ${end}`]);
        return id;
    };
    const rows = () => h.q<any[]>('SELECT assigned_to, start_at::text AS start_at, metadata FROM appointments ORDER BY start_at');

    describe('create_appointment hours', () => {
        it('books inside the window (control): 10:00 with the listing advisor', async () => {
            const C = await seedCustomer(h.q, 'Comprador');
            const result = await book(C, '10:00');
            expect(result.success).toBe(true);
            const [row] = await rows();
            expect(row.assigned_to).toBe(staffId);
            expect(row.start_at).toBe(`${date} 10:00:00`);
        });

        it('refuses 03:00: outside_business_hours, with the hours, and nothing written', async () => {
            const C = await seedCustomer(h.q, 'Comprador');
            const result = await book(C, '03:00');
            expect(result).toMatchObject({ error: 'outside_business_hours', persisted: false, businessHours: ['09:00-17:00'] });
            expect(await rows()).toHaveLength(0);
        });

        it('refuses a block that starts inside but ends after closing (16:45 + 30 min)', async () => {
            const C = await seedCustomer(h.q, 'Comprador');
            expect(await book(C, '16:45')).toMatchObject({ error: 'outside_business_hours' });
            expect(await rows()).toHaveLength(0);
        });

        it('accepts the last block that fits (16:30 + 30 min)', async () => {
            const C = await seedCustomer(h.q, 'Comprador');
            expect((await book(C, '16:30')).success).toBe(true);
        });

        it('counts the service buffer, as check_availability does', async () => {
            await h.q('UPDATE services SET buffer_minutes = 15 WHERE id = $1::uuid', [serviceId]);
            try {
                const C = await seedCustomer(h.q, 'Comprador');
                expect(await book(C, '16:30')).toMatchObject({ error: 'outside_business_hours' });
            } finally { await h.q('UPDATE services SET buffer_minutes = 0 WHERE id = $1::uuid', [serviceId]); }
        });

        it('refuses a date the whole business blocked (user_id NULL)', async () => {
            await h.q(`INSERT INTO blocked_dates(id,user_id,blocked_date,reason) VALUES(gen_random_uuid(),NULL,$1::date,'feriado')`, [date]);
            const C = await seedCustomer(h.q, 'Comprador');
            expect(await book(C, '10:00')).toMatchObject({ error: 'outside_business_hours', persisted: false });
            expect(await rows()).toHaveLength(0);
        });

        it('refuses a date the assigned staff member blocked', async () => {
            await h.q(`INSERT INTO blocked_dates(id,user_id,blocked_date,reason) VALUES(gen_random_uuid(),$1::uuid,$2::date,'vacaciones')`, [staffId, date]);
            const C = await seedCustomer(h.q, 'Comprador');
            expect(await book(C, '10:00')).toMatchObject({ error: 'outside_business_hours' });
        });

        it('an advisor with SEVERAL windows in a day may book any of them, and not the gap between', async () => {
            const C = await seedCustomer(h.q, 'Comprador');
            expect((await book(C, '14:30', { staffId: splitStaffId })).success).toBe(true);
            expect(await book(C, '12:00', { staffId: splitStaffId })).toMatchObject({ error: 'outside_business_hours' });
            expect(await book(C, '09:45', { staffId: splitStaffId })).toMatchObject({ error: 'outside_business_hours' });
        });

        it('an advisor with no weekly hours of their own is judged by the business windows, as check_availability offers them', async () => {
            const C = await seedCustomer(h.q, 'Comprador');
            expect((await book(C, '11:00', { staffId: bareStaffId })).success).toBe(true);
            expect(await book(C, '03:00', { staffId: bareStaffId })).toMatchObject({ error: 'outside_business_hours' });
        });

        it('a window that ends at 00:00 runs to the end of the day', async () => {
            const C = await seedCustomer(h.q, 'Comprador');
            expect((await book(C, '23:30', { staffId: nightStaffId })).success).toBe(true);
            expect(await book(C, '17:30', { staffId: nightStaffId })).toMatchObject({ error: 'outside_business_hours' });
        });

        it('check_availability also offers the slots of a window that ends at 00:00', async () => {
            const C = await seedCustomer(h.q, 'Comprador');
            const result = await h.call(C.contactId, C.conversationId, 'check_availability',
                { serviceId, date, staffId: nightStaffId, time: '23:00' }, scope);
            expect((result.slots || []).map((slot: any) => slot.time)).toContain('23:30');
        });

        it('judges the ASSIGNED staff member: 10:00 is open for the business but not for the advisor who works 13-15', async () => {
            const C = await seedCustomer(h.q, 'Comprador');
            expect(await book(C, '10:00', { staffId: lateStaffId })).toMatchObject({ error: 'outside_business_hours' });
            expect((await book(C, '13:30', { staffId: lateStaffId })).success).toBe(true);
        });
    });

    describe('reschedule_appointment hours', () => {
        it('moves inside the window (control)', async () => {
            const C = await seedCustomer(h.q, 'Cliente');
            const id = await seedAppointment(C, staffId);
            const result = await confirmed(C, 'reschedule_appointment', { appointmentId: id, newDate: date, newTime: '11:00', reason: 'prefiero más tarde' });
            expect(result.success).toBe(true);
            expect((await rows())[0].start_at).toBe(`${date} 11:00:00`);
        });

        it('refuses 03:00 and leaves the appointment where it was', async () => {
            const C = await seedCustomer(h.q, 'Cliente');
            const id = await seedAppointment(C, staffId);
            const result = await confirmed(C, 'reschedule_appointment', { appointmentId: id, newDate: date, newTime: '03:00', reason: 'madrugada' });
            expect(result).toMatchObject({ error: 'outside_business_hours', persisted: false });
            expect((await rows())[0].start_at).toBe(`${date} 10:00:00`);
        });

        it('refuses an end that overruns closing (16:45 + 30 min)', async () => {
            const C = await seedCustomer(h.q, 'Cliente');
            const id = await seedAppointment(C, staffId);
            expect(await confirmed(C, 'reschedule_appointment', { appointmentId: id, newDate: date, newTime: '16:45' }))
                .toMatchObject({ error: 'outside_business_hours' });
        });

        it('judges the appointment\'s own staff member, not the business', async () => {
            const C = await seedCustomer(h.q, 'Cliente');
            const id = await seedAppointment(C, lateStaffId, '13:00', '13:30');
            expect(await confirmed(C, 'reschedule_appointment', { appointmentId: id, newDate: date, newTime: '10:00' }))
                .toMatchObject({ error: 'outside_business_hours' });
            expect((await rows())[0].start_at).toBe(`${date} 13:00:00`);
        });

        it('a shared-resource appointment (no staff) may use any hour somebody works', async () => {
            const C = await seedCustomer(h.q, 'Cliente');
            const id = await seedAppointment(C, null);
            expect((await confirmed(C, 'reschedule_appointment', { appointmentId: id, newDate: date, newTime: '16:00' })).success).toBe(true);
        });

        it('counts the service buffer, as create does (16:30 + 30 + 15 > 17:00)', async () => {
            await h.q('UPDATE services SET buffer_minutes = 15 WHERE id = $1::uuid', [serviceId]);
            try {
                const C = await seedCustomer(h.q, 'Cliente');
                const id = await seedAppointment(C, staffId);
                expect(await confirmed(C, 'reschedule_appointment', { appointmentId: id, newDate: date, newTime: '16:30' }))
                    .toMatchObject({ error: 'outside_business_hours' });
                expect((await confirmed(C, 'reschedule_appointment', { appointmentId: id, newDate: date, newTime: '16:15' })).success).toBe(true);
            } finally { await h.q('UPDATE services SET buffer_minutes = 0 WHERE id = $1::uuid', [serviceId]); }
        });

        it('a flexible service blocks its MAXIMUM duration, as create does (15:30 + 120 > 17:00)', async () => {
            const C = await seedCustomer(h.q, 'Cliente');
            const id = await seedAppointment(C, staffId, '10:00', '12:00', flexServiceId);
            expect(await confirmed(C, 'reschedule_appointment', { appointmentId: id, newDate: date, newTime: '15:30' }))
                .toMatchObject({ error: 'outside_business_hours' });
            expect((await confirmed(C, 'reschedule_appointment', { appointmentId: id, newDate: date, newTime: '15:00' })).success).toBe(true);
            expect((await rows())[0].start_at).toBe(`${date} 15:00:00`);
        });

        it('rescheduling to the time it already has is idempotent, even if the hours changed since', async () => {
            const C = await seedCustomer(h.q, 'Cliente');
            const id = await seedAppointment(C, lateStaffId, '10:00', '10:30'); // 10:00 is outside the advisor's 13-15
            const result = await confirmed(C, 'reschedule_appointment', { appointmentId: id, newDate: date, newTime: '10:00' });
            expect(result.error).toBeUndefined();
            expect(result.success).toBe(true);
            expect((await rows())[0].start_at).toBe(`${date} 10:00:00`);
        });

        it('refuses a blocked date', async () => {
            await h.q(`INSERT INTO blocked_dates(id,user_id,blocked_date,reason) VALUES(gen_random_uuid(),NULL,$1::date,'feriado')`, [date]);
            const C = await seedCustomer(h.q, 'Cliente');
            const id = await seedAppointment(C, staffId);
            expect(await confirmed(C, 'reschedule_appointment', { appointmentId: id, newDate: date, newTime: '11:00' }))
                .toMatchObject({ error: 'outside_business_hours' });
        });
    });

    describe('create_appointment subject (listing)', () => {
        it.each([['N/A'], [''], ['casa aurora'], [42]])(
            'a real-estate tenant refuses listingId %p: appointment_subject_required, nothing written',
            async listing => {
                const C = await seedCustomer(h.q, 'Comprador');
                const result = await book(C, '10:00', { listingId: listing });
                expect(result).toMatchObject({ error: 'appointment_subject_required', persisted: false });
                expect(await rows()).toHaveLength(0);
            });

        // Decision (documented): a listingId that is ABSENT is not refused just because the tenant has
        // listings. The deterministic booking engine books a generic slot without one, and nothing in the
        // service model says "this service is a property visit". Only a PRESENT, invalid id is refused.
        it('an ABSENT listingId is not refused (the booking engine sends none)', async () => {
            const C = await seedCustomer(h.q, 'Comprador');
            const result = await book(C, '10:00', { listingId: undefined });
            expect(result.success).toBe(true);
            expect((await rows())[0].assigned_to).toBeNull();
        });

        it('a well-formed listingId that does not exist is refused, not dropped', async () => {
            const C = await seedCustomer(h.q, 'Comprador');
            const result = await book(C, '10:00', { listingId: randomUUID() });
            expect(result).toMatchObject({ error: 'appointment_subject_not_found', persisted: false });
            expect(await rows()).toHaveLength(0);
        });

        it('a valid listing books the visit WITH its advisor (control)', async () => {
            const C = await seedCustomer(h.q, 'Comprador');
            expect((await book(C, '10:00')).success).toBe(true);
            const [row] = await rows();
            expect(row.assigned_to).toBe(staffId);
            expect(row.metadata.listingId).toBe(listingId);
        });

        it('a malformed id for another subject (petId "N/A") is refused as invalid', async () => {
            const C = await seedCustomer(h.q, 'Comprador');
            const result = await book(C, '10:00', { petId: 'N/A' });
            expect(result).toMatchObject({ error: 'appointment_subject_invalid', persisted: false });
            expect(await rows()).toHaveLength(0);
        });
    });
});

(N3_DATABASE_URL ? describe : describe.skip)('N3: a tenant that sells no listings', () => {
    jest.setTimeout(120_000);
    let h: Awaited<ReturnType<typeof openLive>>;
    let scope: any, staffId: string, serviceId: string, date: string;

    beforeAll(async () => {
        h = await openLive({ prefix: 'n3nol', workarounds: { commitmentDdl: true }, tables: TABLES });
        scope = await h.seedAgent();
        staffId = await h.seedStaff('Doctora');
        serviceId = randomUUID();
        await h.q(`INSERT INTO services(id,name,is_active,duration_minutes,max_concurrent,price,currency,payment_policy)
            VALUES($1::uuid,'Consulta',true,30,1,0,'COP','none')`, [serviceId]);
        date = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
        for (let dow = 0; dow <= 6; dow += 1) {
            await h.q(`INSERT INTO availability_slots(user_id,day_of_week,start_time,end_time,is_active)
                VALUES($1::uuid,$2,'09:00','17:00',true)`, [staffId, dow]);
        }
    });
    afterAll(async () => { if (h) await h.close(); });
    beforeEach(async () => { await h.q('TRUNCATE appointments,tool_execution_ledger,messages CASCADE'); });

    const book = async (extra: Record<string, unknown>) => {
        const C = await seedCustomer(h.q, 'Paciente');
        const args = { serviceId, date, time: '10:00', customerName: 'Paciente N3', customerEmail: 'p@example.invalid', ...extra };
        await h.inbound(C.conversationId, 'quiero agendar');
        expect(await h.call(C.contactId, C.conversationId, 'create_appointment', args, scope)).toMatchObject({ error: 'confirmation_required' });
        await h.inbound(C.conversationId, 'sí, confirmo');
        return h.call(C.contactId, C.conversationId, 'create_appointment', args, scope);
    };

    it.each([[''], [null], [undefined]])('an empty listingId %p is "no listing": the booking goes through', async listingId => {
        expect((await book({ listingId })).success).toBe(true);
    });

    it('a placeholder listingId ("N/A") is not an id: refused so the model retries without it', async () => {
        const result = await book({ listingId: 'N/A' });
        expect(result).toMatchObject({ error: 'appointment_subject_required', persisted: false });
        expect(await h.q<any[]>('SELECT id FROM appointments')).toHaveLength(0);
    });

    // Decision (documented, the owner's to change): a tenant that never configured weekly hours has
    // nothing to validate against, so it keeps booking as before. The defect was validating when hours
    // EXIST, not changing tenants that never set them. check_availability still reports it as not configured.
    it('no availability configured at all: the booking is not validated against hours (unchanged behaviour)', async () => {
        await h.q('DELETE FROM availability_slots');
        expect((await book({ time: '03:00' })).success).toBe(true);
    });
});
