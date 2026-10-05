import { randomUUID } from 'crypto';
import { CRM_BASE_TABLES, N3_DATABASE_URL, openLive, seedCustomer } from './__fixtures__/n3-live-harness';

/**
 * N3 · DEFECTS — promises the product does not keep today. These tests are RED
 * on purpose: they state the promise and fail against the current behaviour.
 * Do not "fix" them by relaxing the assertion; fix the product, or delete the
 * promise on purpose.
 *
 *   CORE-APT-09        a visit without a valid listing / without an advisor is
 *                      still booked, with assigned_to NULL.
 *   RESCHEDULE-HOURS   reschedule_appointment moves an appointment to an hour
 *                      the staff member does not work.
 */
(N3_DATABASE_URL ? describe : describe.skip)('N3 DEFECT: appointment writers that skip a rule', () => {
    jest.setTimeout(120_000);
    let h: Awaited<ReturnType<typeof openLive>>;
    let scope: any, staffId: string, serviceId: string, date: string;

    beforeAll(async () => {
        h = await openLive({
            prefix: 'n3gap',
            workarounds: { commitmentDdl: true }, // isolate these defects from the DDL one
            tables: [...CRM_BASE_TABLES, 'staff_members', 'operational_locations', 'operational_resources', 'staff_operational_bindings', 'staff_resource_assignments', 'services', 'service_staff', 'calendar_integrations', 'appointments',
                'availability_slots', 'blocked_dates', 'calendar_sync_outbox', 'real_estate_listings',
                'listing_zone_agents', 'tool_execution_ledger', 'tool_approval_tickets', 'tool_approval_outbox',
                'commitment_proposals', 'operational_notice_outbox'],
        });
        scope = await h.seedAgent();
        staffId = await h.seedStaff('Asesor');
        serviceId = randomUUID();
        await h.q(`INSERT INTO services(id,name,is_active,duration_minutes,max_concurrent,price,currency,payment_policy)
            VALUES($1::uuid,'Visita al inmueble',true,30,3,0,'COP','none')`, [serviceId]);
        date = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
        // The staff member works 09:00-17:00 every day of the week.
        for (let dow = 0; dow <= 6; dow += 1) {
            await h.q(`INSERT INTO availability_slots(user_id,day_of_week,start_time,end_time,is_active)
                VALUES($1::uuid,$2,'09:00','17:00',true)`, [staffId, dow]);
        }
    });
    afterAll(async () => { if (h) await h.close(); });
    beforeEach(async () => { await h.q('TRUNCATE appointments,tool_execution_ledger,messages CASCADE'); });

    const confirmed = async (C: { contactId: string; conversationId: string }, tool: string, args: any) => {
        await h.inbound(C.conversationId, 'quiero hacerlo');
        expect(await h.call(C.contactId, C.conversationId, tool, args, scope)).toMatchObject({ error: 'confirmation_required' });
        await h.inbound(C.conversationId, 'sí, confirmo');
        return h.call(C.contactId, C.conversationId, tool, args, scope);
    };

    it.each([['N/A'], ['']])(
        'CORE-APT-09: create_appointment with listingId %p must not book an unassigned visit',
        async listingId => {
            // The tenant is a real-estate agency: it has listings and advisors.
            await h.q(`INSERT INTO real_estate_listings(id,name,transaction_type,assigned_agent_id,neighborhood,city)
                VALUES($1::uuid,'Casa Aurora','sale',$2::uuid,'Chapinero','Bogotá')`, [randomUUID(), staffId]);
            const C = await seedCustomer(h.q, 'Comprador');
            const result = await confirmed(C, 'create_appointment', {
                serviceId, date, time: '10:00', listingId, customerName: 'Comprador N3', customerEmail: 'c@example.invalid',
            });
            const rows = await h.q<any[]>('SELECT assigned_to, metadata FROM appointments');
            // Promise: either the tool refuses (appointment_subject_* / assignment error) and nothing is written,
            // or the visit is written WITH an advisor. A visit with no advisor and no listing is the defect.
            const refused = typeof result.error === 'string' && rows.length === 0;
            const assigned = rows.length === 1 && rows[0].assigned_to !== null;
            // eslint-disable-next-line no-console
            console.log(`[DEFECT-EVIDENCE CORE-APT-09 listingId=${JSON.stringify(listingId)}] result=${JSON.stringify(result).slice(0, 220)} rows=${JSON.stringify(rows)}`);
            expect(refused || assigned).toBe(true);
        });

    it('RESCHEDULE-HOURS: reschedule_appointment must not move a visit to 03:00, when nobody works', async () => {
        const C = await seedCustomer(h.q, 'Cliente');
        const apptId = randomUUID();
        await h.q(`INSERT INTO appointments(id,contact_id,conversation_id,assigned_to,service_id,service_name,start_at,end_at,
                status,customer_name,created_at,updated_at)
            VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,'Visita al inmueble',$6::timestamp,$7::timestamp,'confirmed',
                'Cliente',NOW(),NOW())`,
        [apptId, C.contactId, C.conversationId, staffId, serviceId, `${date} 10:00`, `${date} 10:30`]);
        const result = await confirmed(C, 'reschedule_appointment',
            { appointmentId: apptId, newDate: date, newTime: '03:00', reason: 'prefiero de madrugada' });
        const row = (await h.q<any[]>('SELECT start_at::text AS start_at FROM appointments WHERE id=$1::uuid', [apptId]))[0];
        // eslint-disable-next-line no-console
        console.log(`[DEFECT-EVIDENCE RESCHEDULE-HOURS] result=${JSON.stringify(result).slice(0, 220)} start_at=${row.start_at} (staff works 09:00-17:00)`);
        expect(result.success).not.toBe(true);
        expect(row.start_at).toBe(`${date} 10:00:00`);
    });
});
