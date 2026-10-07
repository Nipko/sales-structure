import { randomUUID } from 'crypto';
import { CRM_BASE_TABLES, N3_DATABASE_URL, memoryRedis, openLive, seedCustomer } from './__fixtures__/n3-live-harness';

/**
 * N3 · citas — the booking contracts, through the real executor and the real
 * central control, against disposable PostgreSQL.
 *
 *   CORE-APT-03  create_appointment never writes without a LATER explicit yes,
 *                and a repeated call returns the same appointment.
 *   CORE-APT-04  one customer cannot read, cancel or reschedule another's.
 *   CORE-APT-07  two customers confirming the same slot at once: one row.
 *   CORE-APT-09  (healthy half) a valid listing routes to ITS agent. The broken
 *                half lives in appointment-gaps.defect.postgres.spec.ts.
 *
 * Oracles are rows (appointments, tool_execution_ledger, calendar_sync_outbox),
 * the before/after state of the victim's row and the events emitted — never the
 * wording of a reply.
 */
(N3_DATABASE_URL ? describe : describe.skip)('N3 appointments: confirmation, ownership, contention', () => {
    jest.setTimeout(120_000);
    let h: Awaited<ReturnType<typeof openLive>>;
    let scope: any, staffId: string, serviceId: string, date: string;
    const TABLES = [...CRM_BASE_TABLES, 'staff_members', 'operational_locations', 'operational_resources', 'staff_operational_bindings', 'staff_resource_assignments', 'services', 'service_staff', 'calendar_integrations',
        'appointments', 'availability_slots', 'blocked_dates', 'calendar_sync_outbox', 'real_estate_listings',
        'listing_zone_agents', 'tool_execution_ledger', 'tool_approval_tickets', 'tool_approval_outbox',
        'commitment_proposals', 'operational_notice_outbox'];

    beforeAll(async () => {
        // commitmentDdl: cancel/reschedule would otherwise die at the "yes" with tool_failed
        // (pinned in appointment-runtime-ddl.defect.postgres.spec.ts); the ownership guard
        // under test is only reachable past that point.
        h = await openLive({ prefix: 'n3apt', tables: TABLES, workarounds: { commitmentDdl: true } });
        scope = await h.seedAgent();
        staffId = await h.seedStaff('Ana');
        serviceId = randomUUID();
        await h.q(`INSERT INTO services(id,name,is_active,duration_minutes,max_concurrent,price,currency,payment_policy)
            VALUES($1::uuid,'Consulta',true,30,1,0,'COP','none')`, [serviceId]);
        date = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    });
    afterAll(async () => { if (h) await h.close(); });
    beforeEach(async () => {
        h.events.emit.mockClear();
        await h.q('TRUNCATE appointments,calendar_sync_outbox,tool_execution_ledger,messages CASCADE');
    });

    const book = (time = '10:00', over: any = {}) => ({
        serviceId, staffId, date, time, customerName: 'Cliente N3', customerEmail: 'n3@example.invalid', ...over,
    });
    const count = async (where = 'TRUE') =>
        (await h.q<any[]>(`SELECT COUNT(*)::int AS n FROM appointments WHERE ${where}`))[0].n as number;

    // ── CORE-APT-03 ──────────────────────────────────────────────────────────
    it('CORE-APT-03: no row before an explicit later yes; one row after it; the replay is the same row', async () => {
        const { contactId, conversationId } = await seedCustomer(h.q, 'Alicia');
        const call = (args = book()) => h.call(contactId, conversationId, 'create_appointment', args, scope);

        // (a) the customer only said they want to book: a challenge, not a booking.
        await h.inbound(conversationId, 'quiero reservar una consulta');
        const challenge = await call();
        expect(challenge).toMatchObject({ error: 'confirmation_required' });
        expect(await count()).toBe(0);
        expect((await h.q('SELECT status,tool_name,confirmed_at FROM tool_execution_ledger')))
            .toEqual([{ status: 'awaiting_confirmation', tool_name: 'create_appointment', confirmed_at: null }]);

        // The same inbound turn cannot answer its own challenge, however often it retries.
        expect(await call()).toMatchObject({ error: 'confirmation_required' });
        expect(await count()).toBe(0);

        // An answer that is not a yes does not write either.
        await h.inbound(conversationId, 'mmm no sé todavía, déjame pensarlo');
        expect(await call()).toMatchObject({ error: 'confirmation_required' });
        expect(await count()).toBe(0);

        // (b) the explicit yes.
        await h.inbound(conversationId, 'sí, confirmo');
        const done = await call();
        expect(done).toMatchObject({ success: true, operationStatus: 'confirmed' });
        expect(await count()).toBe(1);
        const ledger = (await h.q<any[]>('SELECT status,confirmed_at IS NOT NULL AS confirmed FROM tool_execution_ledger'));
        expect(ledger).toEqual([{ status: 'succeeded', confirmed: true }]);

        // (c) the model repeats the very same call: same appointment, still one row.
        const replay = await call();
        expect(replay).toMatchObject({ success: true, appointment: { id: done.appointment.id } });
        expect(await count()).toBe(1);
        expect(await count(`contact_id='${contactId}' AND status='confirmed'`)).toBe(1);
    });

    it('CORE-APT-03: a "no" after the challenge is rejected and leaves zero rows', async () => {
        const { contactId, conversationId } = await seedCustomer(h.q, 'Beto');
        const call = () => h.call(contactId, conversationId, 'create_appointment', book('11:00'), scope);
        await h.inbound(conversationId, 'quiero reservar');
        expect(await call()).toMatchObject({ error: 'confirmation_required' });
        await h.inbound(conversationId, 'no');
        expect(await call()).toMatchObject({ error: 'action_rejected' });
        expect(await count()).toBe(0);
        expect((await h.q('SELECT status FROM tool_execution_ledger'))).toEqual([{ status: 'rejected' }]);
        // A rejected operation stays rejected: it does not resurrect on the next call.
        expect(await call()).toMatchObject({ error: expect.any(String) });
        expect(await count()).toBe(0);
    });

    it('CORE-APT-03: a yes given for one slot cannot be spent on another slot', async () => {
        const { contactId, conversationId } = await seedCustomer(h.q, 'Carla');
        await h.inbound(conversationId, 'quiero reservar a las 10');
        expect(await h.call(contactId, conversationId, 'create_appointment', book('10:00'), scope))
            .toMatchObject({ error: 'confirmation_required' });
        await h.inbound(conversationId, 'sí, confirmo');
        // The model drifts the time between the challenge and the yes.
        const drifted = await h.call(contactId, conversationId, 'create_appointment', book('15:00'), scope);
        expect(drifted).toMatchObject({ error: 'confirmation_required' });
        expect(await count()).toBe(0);
    });

    // ── CORE-APT-04 ──────────────────────────────────────────────────────────
    it('CORE-APT-04: customer B cannot view, cancel or reschedule customer A\'s appointment', async () => {
        const A = await seedCustomer(h.q, 'Alicia');
        const B = await seedCustomer(h.q, 'Intruso');
        const apptId = randomUUID();
        await h.q(`INSERT INTO appointments(id,contact_id,conversation_id,assigned_to,service_id,service_name,start_at,end_at,
                status,customer_name,customer_email,notes,created_at,updated_at)
            VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,'Consulta',$6::timestamp,$7::timestamp,'confirmed',
                'Alicia','alicia@example.invalid','nota privada de A',NOW(),NOW())`,
        [apptId, A.contactId, A.conversationId, staffId, serviceId, `${date} 09:00`, `${date} 09:30`]);
        const snapshot = async () => (await h.q<any[]>(
            `SELECT status, start_at::text AS start_at, end_at::text AS end_at, notes, contact_id FROM appointments WHERE id=$1::uuid`, [apptId]))[0];
        const before = await snapshot();
        const outboxBefore = (await h.q<any[]>('SELECT COUNT(*)::int AS n FROM calendar_sync_outbox'))[0].n;

        // View (read, identity verified for B — and still refused: ownership, not identity).
        await h.inbound(B.conversationId, 'dame los datos de esa cita');
        const view = await h.call(B.contactId, B.conversationId, 'get_appointment_details', { appointmentId: apptId }, scope);
        expect(view.error).toMatch(/only view your own/i);
        expect(JSON.stringify(view)).not.toMatch(/alicia|nota privada/i);

        // Cancel: challenge first, then the yes reaches the handler, which must still refuse.
        await h.inbound(B.conversationId, 'quiero cancelar esa cita');
        const cancelArgs = { appointmentId: apptId, reason: 'no la quiero' };
        expect(await h.call(B.contactId, B.conversationId, 'cancel_appointment', cancelArgs, scope))
            .toMatchObject({ error: 'confirmation_required' });
        await h.inbound(B.conversationId, 'sí, confirmo');
        const cancel = await h.call(B.contactId, B.conversationId, 'cancel_appointment', cancelArgs, scope);
        expect(cancel.error).toMatch(/only cancel your own/i);

        // Reschedule: same walk.
        await h.inbound(B.conversationId, 'mejor muévela a las 3');
        const moveArgs = { appointmentId: apptId, newDate: date, newTime: '15:00', reason: 'cambio' };
        expect(await h.call(B.contactId, B.conversationId, 'reschedule_appointment', moveArgs, scope))
            .toMatchObject({ error: 'confirmation_required' });
        await h.inbound(B.conversationId, 'sí, confirmo');
        const move = await h.call(B.contactId, B.conversationId, 'reschedule_appointment', moveArgs, scope);
        expect(move.error).toMatch(/only reschedule your own/i);

        // The victim's row is untouched and nothing leaked downstream.
        expect(await snapshot()).toEqual(before);
        expect(h.events.emit.mock.calls.filter(([name]) => name === 'appointment.cancelled')).toHaveLength(0);
        expect(h.events.emit.mock.calls.filter(([name]) => name === 'appointment.rescheduled')).toHaveLength(0);
        expect((await h.q<any[]>('SELECT COUNT(*)::int AS n FROM calendar_sync_outbox'))[0].n).toBe(outboxBefore);

        // Control: the owner CAN cancel it, so the refusals above are about ownership.
        await h.inbound(A.conversationId, 'cancela mi cita');
        const ownArgs = { appointmentId: apptId, reason: 'ya no puedo' };
        expect(await h.call(A.contactId, A.conversationId, 'cancel_appointment', ownArgs, scope))
            .toMatchObject({ error: 'confirmation_required' });
        await h.inbound(A.conversationId, 'sí, confirmo');
        expect(await h.call(A.contactId, A.conversationId, 'cancel_appointment', ownArgs, scope))
            .toMatchObject({ success: true });
        expect((await snapshot()).status).toBe('cancelled');
    });

    // ── CORE-APT-07 ──────────────────────────────────────────────────────────
    const race = async (label: string) => {
        const A = await seedCustomer(h.q, `Ana-${label}`);
        const B = await seedCustomer(h.q, `Beto-${label}`);
        for (const c of [A, B]) {
            await h.inbound(c.conversationId, 'quiero esa franja');
            expect(await h.call(c.contactId, c.conversationId, 'create_appointment', book('14:00'), scope))
                .toMatchObject({ error: 'confirmation_required' });
            await h.inbound(c.conversationId, 'sí, confirmo');
        }
        const results = await Promise.all([A, B].map(c =>
            h.call(c.contactId, c.conversationId, 'create_appointment', book('14:00'), scope)));
        return { results, A, B };
    };

    it('CORE-APT-07: two customers confirming the same slot at once get exactly one appointment', async () => {
        const { results } = await race('lock');
        const winners = results.filter(r => r.success === true);
        const losers = results.filter(r => r.success !== true);
        expect(winners).toHaveLength(1);
        expect(losers).toHaveLength(1);
        expect(losers[0].error).toMatch(/just taken|booking slot is being updated/i);
        expect(losers[0].retryable).toBe(true);
        expect(await count(`start_at='${date} 14:00:00' AND status<>'cancelled'`)).toBe(1);
        expect(await count()).toBe(1);
    });

    it('CORE-APT-07: the database alone serializes them when the lock service grants everybody', async () => {
        // Redis down / lock lost: every caller is told "yes, you hold the lock".
        // The canonical writer must still refuse the second booking.
        h.executor.redis = memoryRedis({ alwaysGrant: true });
        try {
            const { results } = await race('dbonly');
            expect(results.filter(r => r.success === true)).toHaveLength(1);
            expect(results.find(r => r.success !== true)!.error).toMatch(/just taken|booking slot is being updated/i);
            expect(await count(`start_at='${date} 14:00:00' AND status<>'cancelled'`)).toBe(1);
        } finally { h.executor.redis = h.redis; }
    });

    // ── CORE-APT-09 (healthy half) ───────────────────────────────────────────
    it('CORE-APT-09: a visit about a valid listing is assigned to THAT listing\'s advisor, not another zone\'s', async () => {
        const advisorNorte = await h.seedStaff('Norte'), advisorSur = await h.seedStaff('Sur');
        const listingNorte = randomUUID(), listingSur = randomUUID();
        await h.q(`INSERT INTO real_estate_listings(id,name,transaction_type,assigned_agent_id,neighborhood,city)
            VALUES($1::uuid,'Casa Norte','sale',$2::uuid,'Chapinero','Bogotá'),
                  ($3::uuid,'Casa Sur','sale',$4::uuid,'Kennedy','Bogotá')`,
        [listingNorte, advisorNorte, listingSur, advisorSur]);
        const C = await seedCustomer(h.q, 'Comprador');
        const args = (listingId: string, time: string) => book(time, { listingId, staffId: undefined });
        for (const [listingId, time, advisor] of [[listingSur, '09:00', advisorSur], [listingNorte, '11:00', advisorNorte]] as const) {
            await h.inbound(C.conversationId, `quiero visitar la propiedad ${time}`);
            expect(await h.call(C.contactId, C.conversationId, 'create_appointment', args(listingId, time), scope))
                .toMatchObject({ error: 'confirmation_required' });
            await h.inbound(C.conversationId, 'sí, confirmo');
            expect(await h.call(C.contactId, C.conversationId, 'create_appointment', args(listingId, time), scope))
                .toMatchObject({ success: true });
            const row = (await h.q<any[]>(`SELECT assigned_to, metadata FROM appointments WHERE start_at='${date} ${time}:00'`))[0];
            expect(row.assigned_to).toBe(advisor);
            expect(row.metadata.listingId).toBe(listingId);
        }
    });
});
