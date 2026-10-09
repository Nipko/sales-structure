import { randomUUID } from 'crypto';
import { CRM_BASE_TABLES, N3_DATABASE_URL, openLive, seedCustomer } from './__fixtures__/n3-live-harness';
import { arbitrateMissionFocus, newMissionFocus, toolMissionDomain } from './mission-focus';
import { detectTransition, runTransition, transitionDoneText, TRANSITION_TOOLS } from './transition-engine';

/**
 * N3 · the transition engine against the REAL executor, the REAL central guard (ledger, signed confirmation, mission claims,
 * terms binding) and the real writers, on disposable PostgreSQL. Only the glue ConversationsService adds around them is
 * reproduced here (arbiter → engine → pending lookup → execution); nothing about the guard is mocked.
 *
 * Two appointments, a proposal for one, a bare «cancélala por favor» that must NOT re-ask «¿cuál?», and the «sí» that executes the
 * proposed one — and only that one.
 */
(N3_DATABASE_URL ? describe : describe.skip)('N3 transition engine: proposal → pending ledger → server-side yes', () => {
    jest.setTimeout(120_000);
    let h: Awaited<ReturnType<typeof openLive>>;
    let scope: any, staffId: string, serviceId: string;
    const TABLES = [...CRM_BASE_TABLES, 'staff_members', 'operational_locations', 'operational_resources', 'staff_operational_bindings', 'staff_resource_assignments',
        'services', 'service_staff', 'calendar_integrations', 'appointments', 'availability_slots', 'blocked_dates', 'calendar_sync_outbox', 'real_estate_listings',
        'listing_zone_agents', 'tool_execution_ledger', 'tool_approval_tickets', 'tool_approval_outbox', 'commitment_proposals', 'operational_notice_outbox'];
    const AVAILABLE = new Set(['cancel_appointment', 'reschedule_appointment', 'list_customer_appointments', 'check_availability']);
    const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

    beforeAll(async () => {
        h = await openLive({ prefix: 'n3trn', tables: TABLES });
        scope = await h.seedAgent();
        staffId = await h.seedStaff('Ana');
        serviceId = randomUUID();
        await h.q(`INSERT INTO services(id,name,is_active,duration_minutes,max_concurrent,price,currency,payment_policy)
            VALUES($1::uuid,'Corte y estilo',true,45,1,0,'COP','none')`, [serviceId]);
    });
    afterAll(async () => { if (h) await h.close(); });

    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    const weekdayOf = (date: string) => WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];

    /** One customer turn, the way ConversationsService orders it: arbiter, then the engine, then the server-side yes. */
    function conversation(contactId: string, conversationId: string) {
        let state = newMissionFocus();
        let loadedAt = Date.now();
        const turn = async (text: string) => {
            const messageId = await h.inbound(conversationId, text);
            const priorPendingTool = state.expectedReply?.kind === 'confirmation' && state.selected?.kind === 'tool' ? state.selected.toolName : undefined;
            const decision = arbitrateMissionFocus({ state, candidates: [], text, messageId });
            state = decision.state;
            const scopeOf = () => ({ version: 1, missionId: state.selected?.id || 'unselected', revision: state.revision, inboundMessageId: messageId,
                kind: state.selected?.kind || 'tool', executionOwner: 'tool', domain: state.selected?.domain, toolName: state.selected?.toolName,
                writeBlocked: decision.route === 'clarify', expectedReply: state.expectedReply ? structuredClone(state.expectedReply) : null });
            const execute = async (name: string, args: Record<string, unknown>) => {
                const result = await h.call(contactId, conversationId, name, args, scope, { missionScope: scopeOf() });
                if (result?.error === 'confirmation_required' && typeof result.confirmationId === 'string') {
                    state.selected ||= { id: randomUUID(), kind: 'tool' };
                    Object.assign(state.selected, { reference: result.confirmationId, toolName: name, domain: toolMissionDomain(name) });
                    state.expectedReply = { missionId: state.selected.id, proposalId: result.confirmationId, ledgerId: result.confirmationId, sourceMessageId: messageId, kind: 'confirmation' } as any;
                }
                return result;
            };
            const awaitingWriter = state.selected?.kind === 'tool' && !state.selected.reference && state.selected.toolName && TRANSITION_TOOLS.has(state.selected.toolName)
                && !state.expectedReply ? state.selected.toolName : undefined;
            const detected = detectTransition({ text, available: AVAILABLE, missionDomain: state.selected?.domain, missionToolName: priorPendingTool ?? state.selected?.toolName,
                awaitingWriter, awaitingFresh: Date.now() - loadedAt < 15 * 60_000, pendingConfirmation: !!priorPendingTool || state.expectedReply?.kind === 'confirmation' });
            loadedAt = Date.now();
            if (detected?.kind === 'request') {
                const outcome = await runTransition(detected.request, text, {
                    execute, interpretTarget: async () => null, todayIso: day(0), language: 'es', form: 'usted',
                });
                if (outcome.awaitingWriter && state.selected?.kind === 'tool' && !state.selected.reference) state.selected.toolName = outcome.awaitingWriter;
                if (outcome.handled) return { by: 'engine' as const, reply: outcome.text!, detected };
            }
            const pending = await h.control.findPendingConfirmation(h.schema, conversationId, contactId, text, scopeOf() as any);
            if (pending) {
                const result = await h.call(contactId, conversationId, pending.toolName, pending.args, scope, { missionScope: scopeOf() });
                return { by: 'server-yes' as const, reply: transitionDoneText(pending.toolName, pending.args, result, 'es', 'usted'), result, detected };
            }
            return { by: 'model' as const, reply: null, detected };
        };
        return { turn };
    }

    it('two appointments: «cancélala por favor» leaves the proposal alone, and «sí, cancélala» executes exactly the proposed one', async () => {
        const C = await seedCustomer(h.q, 'Dueña');
        const [first, second] = [day(10), day(11)];
        const insert = async (date: string) => {
            const id = randomUUID();
            await h.q(`INSERT INTO appointments(id,contact_id,conversation_id,assigned_to,service_id,service_name,start_at,end_at,status,customer_name,created_at,updated_at)
                VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,'Corte y estilo',$6::timestamp,$7::timestamp,'confirmed','Dueña',NOW(),NOW())`,
            [id, C.contactId, C.conversationId, staffId, serviceId, `${date} 10:00`, `${date} 10:45`]);
            return id;
        };
        const [idFirst, idSecond] = [await insert(first), await insert(second)];
        const status = async (id: string) => (await h.q<any[]>('SELECT status FROM appointments WHERE id=$1::uuid', [id]))[0].status as string;
        const ledger = () => h.q<any[]>('SELECT tool_name,status FROM tool_execution_ledger ORDER BY created_at');
        const chat = conversation(C.contactId, C.conversationId);

        // the request: two appointments, so the engine lists them and writes nothing
        const ask = await chat.turn('quiero cancelar mi cita');
        expect(ask.by).toBe('engine');
        expect(ask.reply).toContain(idFirst.slice(0, 8).toUpperCase());
        expect(ask.reply).toContain(idSecond.slice(0, 8).toUpperCase());
        expect(await ledger()).toEqual([]);

        // the choice: the REAL guard records a pending, signed, mission-bound ledger row for that appointment
        const proposal = await chat.turn(`la del ${weekdayOf(second)}`);
        expect(proposal.by).toBe('engine');
        expect(proposal.reply).toContain('¿Confirma que desea cancelar su cita');
        expect(await ledger()).toEqual([{ tool_name: 'cancel_appointment', status: 'awaiting_confirmation' }]);

        // «cancélala por favor»: the engine does NOT re-detect it (it would ask «¿cuál?» and 4c would never confirm); nothing changes
        const bare = await chat.turn('cancélala por favor');
        expect(bare.detected).toBeNull();
        expect(bare.reply === null || !/¿Cuál desea/.test(bare.reply)).toBe(true);
        expect(await ledger()).toEqual([{ tool_name: 'cancel_appointment', status: 'awaiting_confirmation' }]);
        expect(await status(idFirst)).toBe('confirmed');
        expect(await status(idSecond)).toBe('confirmed');

        // the yes: the server executes the pending row — the proposed appointment, once, and not the other one
        const yes = await chat.turn('sí, cancélala');
        expect(yes.by).toBe('server-yes');
        expect(yes.reply).toBe(`Su cita (Ref. ${idSecond.slice(0, 8).toUpperCase()}) quedó cancelada.`);
        expect(await status(idSecond)).toBe('cancelled');
        expect(await status(idFirst)).toBe('confirmed');
        expect(await ledger()).toEqual([{ tool_name: 'cancel_appointment', status: 'succeeded' }]);
    });
});
