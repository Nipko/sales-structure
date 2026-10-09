import { randomUUID } from 'crypto';
import { ChatIdentityService } from './chat-identity.service';
import { CRM_BASE_TABLES, N3_DATABASE_URL, openLive, seedCustomer } from './__fixtures__/n3-live-harness';
import { transitionChat } from './__fixtures__/n3-transition-chat';

/**
 * N3 · the transition engine and the identity policy, through the REAL guard, the REAL ChatIdentityService (challenge rows, the
 * transport is a recording function that never sends) and the real writers, on disposable PostgreSQL.
 *
 * PR #76's N3 stubbed identity as «always verified», so it never saw that the engine's own read of the customer's appointments
 * demanded a code in every business type — and the engine never acted in production. Here the chat is NOT verified:
 *   · a salon (moda_belleza) needs no code: the proposal comes at once and no challenge row is ever created;
 *   · a clinic (salud) does: the server asks for the code ONCE, says where it went, waits for it, resumes the request when it is
 *     right, and the yes then cancels the appointment — without the model;
 *   · cancel + create of the same service is not a reschedule the model may improvise: the guard refuses the second half.
 */
const TABLES = [...CRM_BASE_TABLES, 'staff_members', 'operational_locations', 'operational_resources', 'staff_operational_bindings', 'staff_resource_assignments',
    'services', 'service_staff', 'calendar_integrations', 'appointments', 'availability_slots', 'blocked_dates', 'calendar_sync_outbox', 'real_estate_listings',
    'listing_zone_agents', 'tool_execution_ledger', 'tool_approval_tickets', 'tool_approval_outbox', 'commitment_proposals', 'operational_notice_outbox'];
const AVAILABLE = new Set(['cancel_appointment', 'reschedule_appointment', 'list_customer_appointments', 'check_availability']);
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function openTenant(prefix: string, vertical: { industry: string; subType?: string }) {
    const smtp = jest.fn(async () => 'smtp-n3-receipt');
    const email = { prepareBoundedSend: jest.fn(() => smtp) };
    const sms = { send: jest.fn(async () => ({ sent: true, sid: 'SM-N3' })) };
    const holder: { prisma?: any } = {};
    const identity = new ChatIdentityService(new Proxy({}, { get: (_t, key) => holder.prisma[key as any] }) as any,
        email as any, sms as any, { phoneRegionFor: async () => 'CO' } as any);
    const h = await openLive({ prefix, chatIdentity: identity, vertical, tables: TABLES, workarounds: { commitmentDdl: true } });
    holder.prisma = h.prisma;
    jest.spyOn((identity as any).logger, 'warn').mockImplementation(() => undefined);
    const scope = await h.seedAgent();
    const staffId = await h.seedStaff('Ana');
    const services: Record<string, string> = {};
    for (const name of ['Corte y estilo', 'Tinte']) {
        const id = randomUUID();
        services[name] = id;
        await h.q(`INSERT INTO services(id,name,is_active,duration_minutes,max_concurrent,price,currency,payment_policy)
            VALUES($1::uuid,$2,true,45,1,0,'COP','none')`, [id, name]);
    }
    const challenges = () => h.client.$queryRawUnsafe<any[]>(
        'SELECT state,channel,verify_attempts,consumed_at FROM public.chat_identity_challenges WHERE tenant_id=$1::uuid ORDER BY created_at', h.tenantId);
    const seedAppointment = async (contactId: string, conversationId: string, date: string, service = 'Corte y estilo') => {
        const id = randomUUID();
        await h.q(`INSERT INTO appointments(id,contact_id,conversation_id,assigned_to,service_id,service_name,start_at,end_at,status,customer_name,created_at,updated_at)
            VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7::timestamp,$8::timestamp,'confirmed','Dora',NOW(),NOW())`,
        [id, contactId, conversationId, staffId, services[service], service, `${date} 10:00`, `${date} 10:45`]);
        return id;
    };
    const statusOf = async (id: string) => (await h.q<any[]>('SELECT status FROM appointments WHERE id=$1::uuid', [id]))[0].status as string;
    // The identity tools leave their own ledger rows (a code sent, a code checked); what the spec watches is the appointment writers.
    const ledger = () => h.q<any[]>(`SELECT tool_name,status FROM tool_execution_ledger
        WHERE tool_name NOT IN ('request_identity_code','verify_identity_code') ORDER BY created_at`);
    return { h, identity, smtp, sms, scope, staffId, services, challenges, seedAppointment, statusOf, ledger };
}

(N3_DATABASE_URL ? describe : describe.skip)('N3 salon: no code is needed to see or cancel one\'s own appointments', () => {
    jest.setTimeout(120_000);
    let t: Awaited<ReturnType<typeof openTenant>>;
    beforeAll(async () => { t = await openTenant('n3trsal', { industry: 'moda_belleza', subType: 'salon_belleza' }); });
    afterAll(async () => { if (t) await t.h.close(); });

    it('an UNVERIFIED chat: «quiero cancelar mi cita» → the proposal with its Ref; «sí, cancélala» cancels it; no challenge, no e-mail', async () => {
        const C = await seedCustomer(t.h.q, 'Dora', { email: 'dora@example.invalid' });
        const apptId = await t.seedAppointment(C.contactId, C.conversationId, day(10));
        expect(await t.identity.isVerified(C.conversationId, C.contactId)).toBe(false);
        const chat = transitionChat(t.h, t.scope, C.contactId, C.conversationId, { available: AVAILABLE, todayIso: day(0) });

        const ask = await chat.turn('quiero cancelar mi cita');
        expect(ask.by).toBe('engine');
        expect(ask.reply).toContain('¿Confirma que desea cancelar su cita de Corte y estilo');
        expect(ask.reply).toContain(`(Ref. ${apptId.slice(0, 8).toUpperCase()})`);
        expect(await t.ledger()).toEqual([{ tool_name: 'cancel_appointment', status: 'awaiting_confirmation' }]);

        const yes = await chat.turn('sí, cancélala');
        expect(yes.by).toBe('server-yes');
        expect(yes.reply).toBe(`Su cita (Ref. ${apptId.slice(0, 8).toUpperCase()}) quedó cancelada.`);
        expect(await t.statusOf(apptId)).toBe('cancelled');
        expect(await t.ledger()).toEqual([{ tool_name: 'cancel_appointment', status: 'succeeded' }]);

        expect(await t.challenges()).toEqual([]);
        expect(t.smtp).not.toHaveBeenCalled();
        expect(t.sms.send).not.toHaveBeenCalled();
    });

    it('the reads the prompt side already allows are open through the guard too: list and details, scoped to the same contact', async () => {
        const mine = await seedCustomer(t.h.q, 'Mía');
        const other = await seedCustomer(t.h.q, 'Otra');
        const apptId = await t.seedAppointment(mine.contactId, mine.conversationId, day(11));
        await t.seedAppointment(other.contactId, other.conversationId, day(12));
        await t.h.inbound(mine.conversationId, 'mis citas');
        const list = await t.h.call(mine.contactId, mine.conversationId, 'list_customer_appointments', {}, t.scope);
        expect(list.error).toBeUndefined();
        expect(list.appointments.map((a: any) => a.id)).toEqual([apptId]);
        const details = await t.h.call(mine.contactId, mine.conversationId, 'get_appointment_details', { appointmentId: apptId }, t.scope);
        expect(details).toMatchObject({ id: apptId });
        // another contact's appointment is not reachable by this one, with or without a code
        const [theirs] = await t.h.q<any[]>('SELECT id FROM appointments WHERE contact_id=$1::uuid', [other.contactId]);
        const denied = await t.h.call(mine.contactId, mine.conversationId, 'get_appointment_details', { appointmentId: theirs.id }, t.scope);
        expect(denied.id).toBeUndefined();
        expect(await t.challenges()).toEqual([]);
    });

    it('«¿qué citas tengo?» is the server\'s list, with the references, for an unverified chat', async () => {
        const C = await seedCustomer(t.h.q, 'Lista');
        const apptId = await t.seedAppointment(C.contactId, C.conversationId, day(13));
        const chat = transitionChat(t.h, t.scope, C.contactId, C.conversationId, { available: AVAILABLE, todayIso: day(0) });
        const list = await chat.turn('¿qué citas tengo?');
        expect(list.by).toBe('engine');
        expect(list.reply).toContain('Usted tiene una cita');
        expect(list.reply).toContain(apptId.slice(0, 8).toUpperCase());
    });
});

(N3_DATABASE_URL ? describe : describe.skip)('N3 clinic: the code is required, and the SERVER drives it', () => {
    jest.setTimeout(120_000);
    let t: Awaited<ReturnType<typeof openTenant>>;
    beforeAll(async () => { t = await openTenant('n3trcli', { industry: 'salud', subType: 'consultorio' }); });
    afterAll(async () => { if (t) await t.h.close(); });
    beforeEach(async () => {
        jest.clearAllMocks();
        await t.h.client.$executeRawUnsafe('DELETE FROM public.chat_identity_challenges WHERE tenant_id=$1::uuid', t.h.tenantId);
        await t.h.q('TRUNCATE appointments,tool_execution_ledger,messages CASCADE');
    });

    it('asks for the code ONCE with server text, keeps the request, verifies, proposes and cancels on the yes — never the model, never a second e-mail', async () => {
        const C = await seedCustomer(t.h.q, 'Dora', { email: 'dora@example.invalid' });
        const apptId = await t.seedAppointment(C.contactId, C.conversationId, day(10));
        const ref = apptId.slice(0, 8).toUpperCase();
        const chat = transitionChat(t.h, t.scope, C.contactId, C.conversationId, { available: AVAILABLE, todayIso: day(0) });

        const ask = await chat.turn('quiero cancelar mi cita');
        expect(ask.by).toBe('engine');
        expect(ask.reply).toMatch(/^Para ver o cambiar sus citas necesito verificar su identidad\. Le envié un código a d\*+@.*; escríbalo aquí para continuar\.$/);
        // the engine's read sent nothing; the explicit request sent exactly one code
        expect(await t.challenges()).toHaveLength(1);
        expect(t.smtp).toHaveBeenCalledTimes(1);
        expect(await t.ledger()).toEqual([]);
        expect(await t.statusOf(apptId)).toBe('confirmed');

        // the same request again, and the same request in other words: no second code
        const again = await chat.turn('quiero cancelar mi cita');
        expect(again.reply).toMatch(/^Ya le envié un código de verificación a d\*+@/);
        expect(await t.challenges()).toHaveLength(1);
        expect(t.smtp).toHaveBeenCalledTimes(1);

        // a wrong code
        const wrong = await chat.turn('000000');
        expect(wrong.reply).toBe('Ese código no coincide. Revíselo y escríbalo de nuevo.');
        expect((await t.challenges())[0].verify_attempts).toBe(1);

        // the right one: the held request resumes — the proposal, with the reference
        const [{ code }] = await t.h.client.$queryRawUnsafe<any[]>('SELECT code FROM public.chat_identity_challenges WHERE tenant_id=$1::uuid', t.h.tenantId);
        const proposal = await chat.turn(`el código es ${code}`);
        expect(proposal.by).toBe('engine');
        expect(proposal.reply).toContain('¿Confirma que desea cancelar su cita de Corte y estilo');
        expect(proposal.reply).toContain(`(Ref. ${ref})`);
        expect(await t.identity.isVerified(C.conversationId, C.contactId)).toBe(true);
        expect(await t.ledger()).toEqual([{ tool_name: 'cancel_appointment', status: 'awaiting_confirmation' }]);

        const yes = await chat.turn('sí, cancélala');
        expect(yes.by).toBe('server-yes');
        expect(yes.reply).toBe(`Su cita (Ref. ${ref}) quedó cancelada.`);
        expect(await t.statusOf(apptId)).toBe('cancelled');
        expect(await t.ledger()).toEqual([{ tool_name: 'cancel_appointment', status: 'succeeded' }]);
        expect(t.smtp).toHaveBeenCalledTimes(1);
    });

    it('the writers are held to the same code: unverified, the guard refuses cancel_appointment before anything is proposed', async () => {
        const C = await seedCustomer(t.h.q, 'Dora', { email: 'dora@example.invalid' });
        const apptId = await t.seedAppointment(C.contactId, C.conversationId, day(10));
        await t.h.inbound(C.conversationId, 'quiero cancelar mi cita');
        const refused = await t.h.call(C.contactId, C.conversationId, 'cancel_appointment', { appointmentId: apptId }, t.scope, { identityChallenge: 'none' });
        expect(refused).toMatchObject({ error: 'identity_verification_required', challengeSent: false });
        expect(await t.ledger()).toEqual([]);
        expect(t.smtp).not.toHaveBeenCalled();
        // the model's own loop is the only caller that lets the guard send the code (and it sends it once)
        const viaModel = await t.h.call(C.contactId, C.conversationId, 'list_customer_appointments', {}, t.scope);
        expect(viaModel).toMatchObject({ error: 'identity_verification_required' });
        await t.h.call(C.contactId, C.conversationId, 'list_customer_appointments', {}, t.scope);
        expect(t.smtp).toHaveBeenCalledTimes(1);
    });

    it('a locked verification OFFERS a person: no handoff text of its own, no code, nothing written', async () => {
        const C = await seedCustomer(t.h.q, 'Dora', { email: 'dora@example.invalid' });
        const apptId = await t.seedAppointment(C.contactId, C.conversationId, day(10));
        // three codes already issued this hour: the guard will not issue a fourth
        for (let i = 0; i < 3; i += 1) {
            await t.identity.startVerification(t.h.tenantId, t.h.schema, C.contactId, C.conversationId, 'whatsapp');
            await t.h.client.$executeRawUnsafe(`UPDATE public.chat_identity_challenges SET expires_at = NOW() - INTERVAL '1 minute' WHERE tenant_id=$1::uuid`, t.h.tenantId);
        }
        t.smtp.mockClear();
        const chat = transitionChat(t.h, t.scope, C.contactId, C.conversationId, { available: AVAILABLE, todayIso: day(0) });
        const reply = await chat.turn('quiero cancelar mi cita');
        expect(reply.by).toBe('engine');
        expect(reply.reply).toContain('Por seguridad no puedo verificar su identidad');
        expect(reply.reply).toMatch(/¿Desea que le pida a una persona del equipo que se encargue de su caso\?$/);
        expect(t.smtp).not.toHaveBeenCalled();
        expect(await t.statusOf(apptId)).toBe('confirmed');
        expect(await t.ledger()).toEqual([]);
    });
});

(N3_DATABASE_URL ? describe : describe.skip)('N3 reschedule is never cancel + create', () => {
    jest.setTimeout(120_000);
    let t: Awaited<ReturnType<typeof openTenant>>;
    beforeAll(async () => { t = await openTenant('n3trres', { industry: 'moda_belleza', subType: 'salon_belleza' }); });
    afterAll(async () => { if (t) await t.h.close(); });
    beforeEach(async () => { await t.h.q('TRUNCATE appointments,tool_execution_ledger,messages CASCADE'); });

    const book = (service: string, date: string, time = '11:00') => ({
        serviceId: t.services[service], staffId: t.staffId, date, time, customerName: 'Dora', customerEmail: 'dora@example.invalid',
    });

    it('the model proposes cancel_appointment, then create_appointment for the SAME service: the second is refused and routed to reschedule_appointment', async () => {
        const C = await seedCustomer(t.h.q, 'Dora');
        const apptId = await t.seedAppointment(C.contactId, C.conversationId, day(10));
        await t.h.inbound(C.conversationId, 'quiero mover mi cita al viernes a las 11');
        expect(await t.h.call(C.contactId, C.conversationId, 'cancel_appointment', { appointmentId: apptId }, t.scope)).toMatchObject({ error: 'confirmation_required' });
        const create = await t.h.call(C.contactId, C.conversationId, 'create_appointment', book('Corte y estilo', day(14)), t.scope);
        expect(create).toMatchObject({ error: 'reschedule_must_be_atomic', controlBlocked: true });
        expect(create.message).toContain('reschedule_appointment');
        // it does not push the move blindly: the customer is asked whether it is a move, for someone else, or an extra booking
        expect(create.message).toMatch(/Pregúntale al cliente/);
        expect(create.message).toMatch(/otra persona/);
        expect(create.message).toMatch(/adicional/);
        expect(create.shouldHandoff).toBeUndefined();
        expect(await t.ledger()).toEqual([{ tool_name: 'cancel_appointment', status: 'awaiting_confirmation' }]);
    });

    it('the other order too: create first, then the cancellation of the same service is refused', async () => {
        const C = await seedCustomer(t.h.q, 'Dora');
        const apptId = await t.seedAppointment(C.contactId, C.conversationId, day(10));
        await t.h.inbound(C.conversationId, 'quiero mover mi cita al viernes a las 11');
        expect(await t.h.call(C.contactId, C.conversationId, 'create_appointment', book('Corte y estilo', day(14)), t.scope)).toMatchObject({ error: 'confirmation_required' });
        const cancel = await t.h.call(C.contactId, C.conversationId, 'cancel_appointment', { appointmentId: apptId }, t.scope);
        expect(cancel).toMatchObject({ error: 'reschedule_must_be_atomic' });
        expect(await t.statusOf(apptId)).toBe('confirmed');
        expect(await t.ledger()).toEqual([{ tool_name: 'create_appointment', status: 'awaiting_confirmation' }]);
    });

    it('a cancellation proposal the customer walked away from (another task, a newer revision) does not forbid booking the same service', async () => {
        const C = await seedCustomer(t.h.q, 'Dora');
        const apptId = await t.seedAppointment(C.contactId, C.conversationId, day(10));
        const inbound = await t.h.inbound(C.conversationId, 'quiero cancelar mi cita');
        const mission = (missionId: string, revision: number) => ({ version: 1, missionId, revision, kind: 'tool', executionOwner: 'tool', inboundMessageId: inbound, expectedReply: null });
        expect(await t.h.call(C.contactId, C.conversationId, 'cancel_appointment', { appointmentId: apptId }, t.scope, { missionScope: mission('m1', 0) }))
            .toMatchObject({ error: 'confirmation_required' });
        // the same task and revision: the pair is a reschedule in the making
        expect(await t.h.call(C.contactId, C.conversationId, 'create_appointment', book('Corte y estilo', day(14)), t.scope, { missionScope: mission('m1', 0) }))
            .toMatchObject({ error: 'reschedule_must_be_atomic' });
        // another task (the arbiter dropped the proposal): booking is just booking
        await t.h.inbound(C.conversationId, 'mejor reserva otra para el viernes');
        expect(await t.h.call(C.contactId, C.conversationId, 'create_appointment', book('Corte y estilo', day(14)), t.scope, { missionScope: mission('m2', 0) }))
            .toMatchObject({ error: 'confirmation_required' });
        // and a newer revision of the same task
        expect(await t.h.call(C.contactId, C.conversationId, 'create_appointment', book('Corte y estilo', day(15)), t.scope, { missionScope: mission('m1', 3) }))
            .toMatchObject({ error: 'confirmation_required' });
    });

    it('cancelling one service and booking ANOTHER one is not a reschedule: both are proposed', async () => {
        const C = await seedCustomer(t.h.q, 'Dora');
        const apptId = await t.seedAppointment(C.contactId, C.conversationId, day(10));
        await t.h.inbound(C.conversationId, 'cancela mi corte y reserva un tinte');
        expect(await t.h.call(C.contactId, C.conversationId, 'cancel_appointment', { appointmentId: apptId }, t.scope)).toMatchObject({ error: 'confirmation_required' });
        expect(await t.h.call(C.contactId, C.conversationId, 'create_appointment', book('Tinte', day(14)), t.scope)).toMatchObject({ error: 'confirmation_required' });
        expect((await t.ledger()).map(row => row.tool_name).sort()).toEqual(['cancel_appointment', 'create_appointment']);
    });

    it('two proposals from one message and one «sí»: unbound, none is executed; bound to the mission\'s ledger id, exactly that one — and the yes is spent once', async () => {
        const C = await seedCustomer(t.h.q, 'Dora');
        const apptId = await t.seedAppointment(C.contactId, C.conversationId, day(10));
        await t.h.inbound(C.conversationId, 'cancela mi corte y reserva un tinte');
        const cancel = await t.h.call(C.contactId, C.conversationId, 'cancel_appointment', { appointmentId: apptId }, t.scope);
        const create = await t.h.call(C.contactId, C.conversationId, 'create_appointment', book('Tinte', day(14)), t.scope);
        expect(cancel.error).toBe('confirmation_required');
        expect(create.error).toBe('confirmation_required');
        await t.h.inbound(C.conversationId, 'sí');

        // nothing says which of the two the yes answers: none is executed
        expect(await t.h.control.findPendingConfirmation(t.h.schema, C.conversationId, C.contactId, 'sí')).toBeNull();

        // the mission waits on the cancellation's ledger row: that one, even though the creation is newer
        const claimScope = { version: 1, missionId: 'm1', revision: 0, kind: 'tool', executionOwner: 'tool', inboundMessageId: randomUUID(),
            expectedReply: { missionId: 'm1', proposalId: cancel.confirmationId, ledgerId: cancel.confirmationId, sourceMessageId: randomUUID(), kind: 'confirmation' } } as any;
        const bound = await t.h.control.findPendingConfirmation(t.h.schema, C.conversationId, C.contactId, undefined, claimScope);
        expect(bound).toMatchObject({ ledgerId: cancel.confirmationId, toolName: 'cancel_appointment' });

        // the yes executes the cancellation…
        const done = await t.h.call(C.contactId, C.conversationId, 'cancel_appointment', { appointmentId: apptId }, t.scope);
        expect(done).toMatchObject({ success: true });
        expect(await t.statusOf(apptId)).toBe('cancelled');
        // …and cannot be spent again on the creation: no second appointment appears from the same «sí»
        const second = await t.h.call(C.contactId, C.conversationId, 'create_appointment', book('Tinte', day(14)), t.scope);
        expect(second).toMatchObject({ error: 'confirmation_already_used' });
        expect((await t.h.q<any[]>(`SELECT COUNT(*)::int AS n FROM appointments WHERE status <> 'cancelled'`))[0].n).toBe(0);
    });
});
