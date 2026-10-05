import { randomUUID } from 'crypto';
import { ChatIdentityService } from './chat-identity.service';
import { CRM_BASE_TABLES, N3_DATABASE_URL, openLive, seedCustomer } from './__fixtures__/n3-live-harness';

/**
 * N3 · CORE-APT-06 — sensitive agenda reads demand an out-of-band code.
 *
 * Real: executor, central control, `ChatIdentityService`, `public.chat_identity_challenges`.
 * Simulated: the SMTP transport (a jest function that records, never sends) and SMS.
 */
(N3_DATABASE_URL ? describe : describe.skip)('N3 CORE-APT-06: step-up identity for agenda reads', () => {
    jest.setTimeout(120_000);
    let h: Awaited<ReturnType<typeof openLive>>;
    let scope: any, staffId: string, serviceId: string, date: string;
    const smtp = jest.fn(async () => 'smtp-n3-receipt');
    const email = { prepareBoundedSend: jest.fn(() => smtp) };
    const sms = { send: jest.fn(async () => ({ sent: true, sid: 'SM-N3' })) };
    let identity: ChatIdentityService;
    const warnings: string[] = [];

    beforeAll(async () => {
        const regional = { phoneRegionFor: async () => 'CO' };
        // The service needs a prisma with transactionInTenantSchema: the harness builds one,
        // but the service has to exist before the control does, so open lazily around it.
        const holder: { prisma?: any } = {};
        identity = new ChatIdentityService(new Proxy({}, { get: (_t, key) => holder.prisma[key as any] }) as any,
            email as any, sms as any, regional as any);
        h = await openLive({
            prefix: 'n3id', chatIdentity: identity,
            tables: [...CRM_BASE_TABLES, 'staff_members', 'operational_locations', 'operational_resources', 'staff_operational_bindings', 'staff_resource_assignments', 'services', 'service_staff', 'calendar_integrations', 'appointments',
                'availability_slots', 'blocked_dates', 'calendar_sync_outbox', 'tool_execution_ledger',
                'tool_approval_tickets', 'tool_approval_outbox', 'commitment_proposals', 'operational_notice_outbox'],
        });
        holder.prisma = h.prisma;
        jest.spyOn((identity as any).logger, 'warn').mockImplementation((...args: any[]) => { warnings.push(args.map(String).join(' ')); });
        scope = await h.seedAgent();
        staffId = await h.seedStaff('Ana');
        serviceId = randomUUID();
        await h.q(`INSERT INTO services(id,name,is_active,duration_minutes,max_concurrent,price,currency,payment_policy)
            VALUES($1::uuid,'Consulta',true,30,1,0,'COP','none')`, [serviceId]);
        date = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    });
    afterAll(async () => { if (h) await h.close(); });
    beforeEach(async () => {
        jest.clearAllMocks();
        await h.client.$executeRawUnsafe('DELETE FROM public.chat_identity_challenges WHERE tenant_id=$1::uuid', h.tenantId);
        await h.q('TRUNCATE appointments,tool_execution_ledger,messages CASCADE');
    });

    const seedAppointment = async (contactId: string, conversationId: string) => {
        const id = randomUUID();
        await h.q(`INSERT INTO appointments(id,contact_id,conversation_id,assigned_to,service_id,service_name,start_at,end_at,status,
                customer_name,customer_email,customer_phone,notes,created_at,updated_at)
            VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,'Consulta',$6::timestamp,$7::timestamp,'confirmed',
                'Dora Datos','dora-privada@example.invalid','+573009998877','nota-clinica-privada',NOW(),NOW())`,
        [id, contactId, conversationId, staffId, serviceId, `${date} 09:00`, `${date} 09:30`]);
        return id;
    };
    const challenges = () => h.client.$queryRawUnsafe<any[]>(
        'SELECT state,channel,verify_attempts FROM public.chat_identity_challenges WHERE tenant_id=$1::uuid', h.tenantId);
    const PII = /dora-privada|3009998877|nota-clinica-privada|Dora Datos/;

    it('refuses both reads before the code, leaks no PII, and sends exactly one code', async () => {
        const C = await seedCustomer(h.q, 'Dora', { email: 'dora@example.invalid', phone: '+573009998877' });
        const apptId = await seedAppointment(C.contactId, C.conversationId);
        await h.inbound(C.conversationId, 'quiero ver los datos de mi cita');

        const details = await h.call(C.contactId, C.conversationId, 'get_appointment_details', { appointmentId: apptId }, scope);
        expect(details).toMatchObject({ error: 'identity_verification_required', needsVerification: true });
        expect(JSON.stringify(details)).not.toMatch(PII);

        const list = await h.call(C.contactId, C.conversationId, 'list_customer_appointments', {}, scope);
        expect(list).toMatchObject({ error: 'identity_verification_required', needsVerification: true });
        expect(JSON.stringify(list)).not.toMatch(PII);

        // One live challenge, one transport call: the second read re-used it.
        const rows = await challenges();
        if (rows.length !== 1) console.log(warnings.join(' || '));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ channel: 'email', state: 'sent' });
        expect(smtp).toHaveBeenCalledTimes(1);
        expect(sms.send).not.toHaveBeenCalled();
    });

    it('locks the challenge after five wrong codes and demands a human', async () => {
        const C = await seedCustomer(h.q, 'Dora', { email: 'dora@example.invalid' });
        const apptId = await seedAppointment(C.contactId, C.conversationId);
        await h.inbound(C.conversationId, 'ver mi cita');
        await h.call(C.contactId, C.conversationId, 'get_appointment_details', { appointmentId: apptId }, scope);

        const reasons: string[] = [];
        let last: any;
        for (let attempt = 1; attempt <= 5; attempt += 1) {
            await h.inbound(C.conversationId, `el código es 00000${attempt}`);
            last = await h.call(C.contactId, C.conversationId, 'verify_identity_code', { code: `00000${attempt}` }, scope);
            reasons.push(last.reason);
            expect(last.verified).toBe(false);
        }
        expect(reasons.slice(0, 4)).toEqual(['wrong', 'wrong', 'wrong', 'wrong']);
        expect(last).toMatchObject({ reason: 'too_many', shouldHandoff: true });
        expect(await identity.isVerified(C.conversationId, C.contactId)).toBe(false);

        // Even the right code no longer opens a locked challenge.
        const secret = await h.client.$queryRawUnsafe<any[]>(
            'SELECT code FROM public.chat_identity_challenges WHERE tenant_id=$1::uuid', h.tenantId);
        expect(secret[0].code).toBeNull();
        await h.inbound(C.conversationId, 'ahora sí el correcto');
        const after = await h.call(C.contactId, C.conversationId, 'get_appointment_details', { appointmentId: apptId }, scope);
        expect(after.error).toBeDefined();
        expect(JSON.stringify(after)).not.toMatch(PII);
    });

    it('opens the reads with the right code, and only for the contact that earned it', async () => {
        const C = await seedCustomer(h.q, 'Dora', { email: 'dora@example.invalid' });
        const other = await seedCustomer(h.q, 'Otra', { email: 'otra@example.invalid' });
        const apptId = await seedAppointment(C.contactId, C.conversationId);
        await h.inbound(C.conversationId, 'ver mi cita');
        expect(await h.call(C.contactId, C.conversationId, 'get_appointment_details', { appointmentId: apptId }, scope))
            .toMatchObject({ error: 'identity_verification_required' });

        // A wrong code does not unlock; the code the transport carried does.
        const [{ code }] = await h.client.$queryRawUnsafe<any[]>(
            'SELECT code FROM public.chat_identity_challenges WHERE tenant_id=$1::uuid AND conversation_id=$2::uuid', h.tenantId, C.conversationId);
        await h.inbound(C.conversationId, 'es 123123');
        const wrongCode = code === '123123' ? '654321' : '123123';
        expect(await h.call(C.contactId, C.conversationId, 'verify_identity_code', { code: wrongCode }, scope))
            .toMatchObject({ verified: false, reason: 'wrong' });
        await h.inbound(C.conversationId, `es ${code}`);
        expect(await h.call(C.contactId, C.conversationId, 'verify_identity_code', { code }, scope))
            .toMatchObject({ verified: true });

        await h.inbound(C.conversationId, 'ahora sí, muéstrame');
        const details = await h.call(C.contactId, C.conversationId, 'get_appointment_details', { appointmentId: apptId }, scope);
        expect(details).toMatchObject({ id: apptId, customerEmail: 'dora-privada@example.invalid', notes: 'nota-clinica-privada' });
        const list = await h.call(C.contactId, C.conversationId, 'list_customer_appointments', {}, scope);
        expect(list.appointments.map((a: any) => a.id)).toEqual([apptId]);

        // The verification belongs to (conversation, contact): another conversation stays locked.
        await h.inbound(other.conversationId, 'ver mis citas');
        expect(await h.call(other.contactId, other.conversationId, 'list_customer_appointments', {}, scope))
            .toMatchObject({ error: 'identity_verification_required' });
    });
});
