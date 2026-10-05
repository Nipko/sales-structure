import { randomUUID } from 'crypto';
import { CRM_BASE_TABLES, N3_DATABASE_URL, openLive, seedCustomer } from './__fixtures__/n3-live-harness';

/**
 * N3 · When the identity admission itself breaks (no challenge row, no code), the
 * customer must be told the truth and handed off, never `tool_failed` and never
 * "a verification is in progress".
 */
(N3_DATABASE_URL ? describe : describe.skip)('N3: identity admission failure is reported as unverifiable', () => {
    jest.setTimeout(120_000);
    let h: Awaited<ReturnType<typeof openLive>>;
    let scope: any, staffId: string, serviceId: string, date: string;
    const startVerification = jest.fn(async () => { throw new Error('identity_challenge_admission_failed'); });

    beforeAll(async () => {
        h = await openLive({
            prefix: 'n3idf', chatIdentity: { isVerified: async () => false, startVerification },
            tables: [...CRM_BASE_TABLES, 'staff_members', 'operational_locations', 'operational_resources', 'staff_operational_bindings', 'staff_resource_assignments', 'services', 'service_staff', 'calendar_integrations', 'appointments',
                'availability_slots', 'blocked_dates', 'calendar_sync_outbox', 'tool_execution_ledger',
                'tool_approval_tickets', 'tool_approval_outbox', 'commitment_proposals', 'operational_notice_outbox'],
        });
        scope = await h.seedAgent();
        staffId = await h.seedStaff('Ana');
        serviceId = randomUUID();
        await h.q(`INSERT INTO services(id,name,is_active,duration_minutes,max_concurrent,price,currency,payment_policy)
            VALUES($1::uuid,'Consulta',true,30,1,0,'COP','none')`, [serviceId]);
        date = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    });
    afterAll(async () => { if (h) await h.close(); });

    it('the control layer (identity-gated agenda read) answers identity_unverifiable with handoff', async () => {
        const C = await seedCustomer(h.q, 'Dora', { email: 'dora@example.invalid' });
        const apptId = randomUUID();
        await h.q(`INSERT INTO appointments(id,contact_id,conversation_id,assigned_to,service_id,service_name,start_at,end_at,status,
                customer_name,created_at,updated_at)
            VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,'Consulta',$6::timestamp,$7::timestamp,'confirmed','Dora',NOW(),NOW())`,
        [apptId, C.contactId, C.conversationId, staffId, serviceId, `${date} 10:00`, `${date} 10:30`]);
        await h.inbound(C.conversationId, 'quiero ver mi cita');
        const result = await h.call(C.contactId, C.conversationId, 'get_appointment_details', { appointmentId: apptId }, scope);
        expect(startVerification).toHaveBeenCalled();
        expect(result).toMatchObject({ error: 'identity_unverifiable', shouldHandoff: true });
        expect(String(result.message)).toContain('no se envió ningún código');
    });

    it('request_identity_code answers identity_unverifiable with handoff', async () => {
        const C = await seedCustomer(h.q, 'Dora', { email: 'dora2@example.invalid' });
        await h.inbound(C.conversationId, 'mándame el código');
        const result = await h.call(C.contactId, C.conversationId, 'request_identity_code', {}, scope);
        expect(result).toMatchObject({ error: 'identity_unverifiable', shouldHandoff: true });
    });
});
