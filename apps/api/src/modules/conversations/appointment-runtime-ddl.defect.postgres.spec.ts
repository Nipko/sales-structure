import { randomUUID } from 'crypto';
import { ChatIdentityService } from './chat-identity.service';
import { CRM_BASE_TABLES, N3_DATABASE_URL, openLive, seedCustomer } from './__fixtures__/n3-live-harness';

/**
 * N3 · DEFECTS found while building the appointment contracts. RED on purpose:
 * no workaround is applied, so the product is seen exactly as shipped on the
 * canonical tenant schema (`prisma/tenant-schema.sql`).
 *
 *   D1  The customer's own, legitimate "yes" to cancel_appointment and to
 *       reschedule_appointment ends in `tool_failed`. `resolveCommitment` runs
 *       `ensureCommitmentProposals` (`CREATE TABLE IF NOT EXISTS ...`) inside the
 *       preflight transaction; `PrismaService.transactionInTenantSchema` refuses
 *       DDL after the first query (`runtime_schema_lock_required_at_transaction_start`).
 *   D2  CORE-APT-06: the identity step-up never starts. `ChatIdentityService`
 *       selects `contacts.is_active`, a column the canonical `contacts` table does
 *       not have; the admission is swallowed and answered as "pending": no
 *       challenge row, no code sent, for a customer who has an e-mail on file.
 *
 * Since 1c904cc9 whether a contact needs a code to cancel or move her own
 * appointment depends on the business type (`getToolPolicyForContext`): a
 * tenant row without a vertical fails closed to A2. D1 is about the runtime DDL,
 * not identity, so it runs on a salon (A1: the contact bound to the chat is
 * enough), and D2 keeps the tenant without a vertical, where an agenda read
 * still needs the step-up it is about.
 */
(N3_DATABASE_URL ? describe : describe.skip)('N3 DEFECT: runtime DDL and a missing column on the canonical schema', () => {
    jest.setTimeout(120_000);
    let h: Awaited<ReturnType<typeof openLive>>;
    let scope: any, staffId: string, serviceId: string, date: string;
    // D1's tenant: same canonical schema, a business type whose appointments are not sensitive.
    let salon: Awaited<ReturnType<typeof openLive>>;
    let salonScope: any, salonStaffId: string, salonServiceId: string;
    const smtp = jest.fn(async () => 'smtp-n3-receipt');
    const email = { prepareBoundedSend: jest.fn(() => smtp) };
    const sms = { send: jest.fn(async () => ({ sent: true, sid: 'SM-N3' })) };
    const warnings: string[] = [];

    beforeAll(async () => {
        const holder: { prisma?: any } = {};
        const identity = new ChatIdentityService(new Proxy({}, { get: (_t, key) => holder.prisma[key as any] }) as any,
            email as any, sms as any, { phoneRegionFor: async () => 'CO' } as any);
        jest.spyOn((identity as any).logger, 'warn').mockImplementation((...args: any[]) => { warnings.push(args.map(String).join(' ')); });
        h = await openLive({
            prefix: 'n3ddl', chatIdentity: identity,
            tables: [...CRM_BASE_TABLES, 'staff_members', 'operational_locations', 'operational_resources', 'staff_operational_bindings', 'staff_resource_assignments', 'services', 'service_staff', 'calendar_integrations', 'appointments',
                'availability_slots', 'blocked_dates', 'calendar_sync_outbox', 'tool_execution_ledger',
                'tool_approval_tickets', 'tool_approval_outbox', 'commitment_proposals', 'operational_notice_outbox'],
        });
        holder.prisma = h.prisma;
        scope = await h.seedAgent();
        staffId = await h.seedStaff('Ana');
        serviceId = randomUUID();
        await h.q(`INSERT INTO services(id,name,is_active,duration_minutes,max_concurrent,price,currency,payment_policy)
            VALUES($1::uuid,'Consulta',true,30,1,0,'COP','none')`, [serviceId]);
        date = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);

        const salonHolder: { prisma?: any } = {};
        const salonIdentity = new ChatIdentityService(new Proxy({}, { get: (_t, key) => salonHolder.prisma[key as any] }) as any,
            email as any, sms as any, { phoneRegionFor: async () => 'CO' } as any);
        salon = await openLive({
            prefix: 'n3ddls', chatIdentity: salonIdentity, vertical: { industry: 'moda_belleza', subType: 'salon_belleza' },
            tables: [...CRM_BASE_TABLES, 'staff_members', 'operational_locations', 'operational_resources', 'staff_operational_bindings', 'staff_resource_assignments', 'services', 'service_staff', 'calendar_integrations', 'appointments',
                'availability_slots', 'blocked_dates', 'calendar_sync_outbox', 'tool_execution_ledger',
                'tool_approval_tickets', 'tool_approval_outbox', 'commitment_proposals', 'operational_notice_outbox'],
        });
        salonHolder.prisma = salon.prisma;
        salonScope = await salon.seedAgent();
        salonStaffId = await salon.seedStaff('Ana');
        // Open every day, so the reschedule's availability check is not what decides D1.
        for (let dow = 0; dow <= 6; dow += 1) {
            await salon.q(`INSERT INTO availability_slots(user_id,day_of_week,start_time,end_time,is_active)
                VALUES($1::uuid,$2,'09:00','17:00',true)`, [salonStaffId, dow]);
        }
        salonServiceId = randomUUID();
        await salon.q(`INSERT INTO services(id,name,is_active,duration_minutes,max_concurrent,price,currency,payment_policy)
            VALUES($1::uuid,'Corte y estilo',true,30,1,0,'COP','none')`, [salonServiceId]);
    });
    afterAll(async () => {
        if (h) await h.close();
        if (salon) await salon.close();
    });

    const ownAppointment = async (contactId: string, conversationId: string) => {
        const id = randomUUID();
        await h.q(`INSERT INTO appointments(id,contact_id,conversation_id,assigned_to,service_id,service_name,start_at,end_at,status,
                customer_name,created_at,updated_at)
            VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,'Consulta',$6::timestamp,$7::timestamp,'confirmed','Dueña',NOW(),NOW())`,
        [id, contactId, conversationId, staffId, serviceId, `${date} 10:00`, `${date} 10:30`]);
        return id;
    };
    const salonAppointment = async (contactId: string, conversationId: string) => {
        const id = randomUUID();
        await salon.q(`INSERT INTO appointments(id,contact_id,conversation_id,assigned_to,service_id,service_name,start_at,end_at,status,
                customer_name,created_at,updated_at)
            VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,'Corte y estilo',$6::timestamp,$7::timestamp,'confirmed','Dueña',NOW(),NOW())`,
        [id, contactId, conversationId, salonStaffId, salonServiceId, `${date} 10:00`, `${date} 10:30`]);
        return id;
    };
    const rootCause = (live = salon) => live.stacks.slice(-1)[0]?.split(' <- ').slice(0, 5).join(' <- ') ?? '(no transaction error recorded)';

    it('D1: the owner confirming her own cancellation gets a cancelled appointment, not tool_failed', async () => {
        const C = await seedCustomer(salon.q, 'Dueña');
        const apptId = await salonAppointment(C.contactId, C.conversationId);
        const args = { appointmentId: apptId, reason: 'ya no puedo' };
        await salon.inbound(C.conversationId, 'quiero cancelar mi cita');
        expect(await salon.call(C.contactId, C.conversationId, 'cancel_appointment', args, salonScope)).toMatchObject({ error: 'confirmation_required' });
        await salon.inbound(C.conversationId, 'sí, confirmo');
        const result = await salon.call(C.contactId, C.conversationId, 'cancel_appointment', args, salonScope);
        const row = (await salon.q<any[]>('SELECT status FROM appointments WHERE id=$1::uuid', [apptId]))[0];
        // eslint-disable-next-line no-console
        console.log(`[DEFECT-EVIDENCE D1 cancel] result=${JSON.stringify(result)} status=${row.status} cause=${rootCause()}`);
        expect(result).toMatchObject({ success: true });
        expect(row.status).toBe('cancelled');
    });

    it('D1: the owner confirming her own reschedule gets the new time, not tool_failed', async () => {
        const C = await seedCustomer(salon.q, 'Dueña');
        const apptId = await salonAppointment(C.contactId, C.conversationId);
        const args = { appointmentId: apptId, newDate: date, newTime: '11:00', reason: 'mejor más tarde' };
        await salon.inbound(C.conversationId, 'quiero moverla a las 11');
        expect(await salon.call(C.contactId, C.conversationId, 'reschedule_appointment', args, salonScope)).toMatchObject({ error: 'confirmation_required' });
        await salon.inbound(C.conversationId, 'sí, confirmo');
        const result = await salon.call(C.contactId, C.conversationId, 'reschedule_appointment', args, salonScope);
        const row = (await salon.q<any[]>('SELECT start_at::text AS start_at FROM appointments WHERE id=$1::uuid', [apptId]))[0];
        // eslint-disable-next-line no-console
        console.log(`[DEFECT-EVIDENCE D1 reschedule] result=${JSON.stringify(result)} start_at=${row.start_at} cause=${rootCause()}`);
        expect(result).toMatchObject({ success: true });
        expect(row.start_at).toBe(`${date} 11:00:00`);
    });

    it('D2 (CORE-APT-06): a customer with an e-mail on file gets a challenge row and one code before an agenda read', async () => {
        const C = await seedCustomer(h.q, 'Dora', { email: 'dora@example.invalid' });
        const apptId = await ownAppointment(C.contactId, C.conversationId);
        await h.inbound(C.conversationId, 'quiero ver mi cita');
        const result = await h.call(C.contactId, C.conversationId, 'get_appointment_details', { appointmentId: apptId }, scope);
        const rows = await h.client.$queryRawUnsafe<any[]>(
            'SELECT state,channel FROM public.chat_identity_challenges WHERE tenant_id=$1::uuid', h.tenantId);
        // eslint-disable-next-line no-console
        console.log(`[DEFECT-EVIDENCE D2] result=${JSON.stringify(result).slice(0, 200)} challengeRows=${rows.length} smtpCalls=${smtp.mock.calls.length} warn=${(warnings[0] ?? '').replace(/\s+/g, ' ').slice(-120)}`);
        expect(result).toMatchObject({ error: 'identity_verification_required', needsVerification: true });
        expect(rows).toHaveLength(1);
        expect(smtp).toHaveBeenCalledTimes(1);
    });
});
