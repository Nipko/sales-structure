import { pinClock } from './__fixtures__/pinned-clock';
import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import { randomUUID } from 'crypto';
import type { AgentTurnSession } from './agent-turn-session';
import { classifyExplicitToolConfirmation } from './tool-execution-control.service';
import { ToolRetrievalService } from './tool-retrieval.service';

/**
 * Service-level replays of the live regression of 2026-10-09 after PR #82 (Salón QA Citas, Telegram), over the REAL turn
 * (`ConversationsService` + mission arbiter + transition engine + booking engine); only the I/O boundaries are doubles.
 *
 *  · a booking request while an appointment that already STARTED sits in the account («No me queda claro a qué gestión se refiere;
 *    tengo en curso su cita») — the started appointment is a record to look at, not the task in progress;
 *  · the first «sí» to a reschedule proposal whose request had been repeated («necesito su confirmación final», nothing executed).
 *
 * The model in this file answers every turn it is asked to voice with a refusal: whatever works must come from the server.
 *
 * The clock is pinned to Friday 2026-10-09 13:30 in Bogotá (the campaign day): F0080B9A (11:00 that day) has started.
 */
pinClock('2026-10-09T18:30:00.000Z');

const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REFUSAL = 'Por ahora no puedo ayudarle con eso directamente; ¿le paso con alguien del equipo?';
const answer = (content: string) => ({ content, model: 'test', usage: { promptTokens: 1, completionTokens: 1 }, cost: 0 });
const SERVICE = '11111111-1111-4111-8111-111111111111';
const SERVICES = [
    { id: SERVICE, name: 'Corte y estilo', durationMinutes: 45, price: 40000, priceStatus: 'example', currency: 'COP' },
    { id: '33333333-3333-4333-8333-333333333333', name: 'Manicure y pedicure', durationMinutes: 60, price: 50000, priceStatus: 'example', currency: 'COP' },
];
const SLOTS = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30'].map(time => ({ time, endTime: time }));
const STARTED = { id: 'f0080b9a-1111-4111-8111-111111111111', reference: 'F0080B9A', serviceId: SERVICE, staffId: 'staff-1', service: 'Corte y estilo',
    date: '2026-10-09', time: '11:00', status: 'confirmed' };
const UPCOMING = { id: '3c78eca2-2222-4222-8222-222222222222', reference: '3C78ECA2', serviceId: SERVICE, staffId: 'staff-1', service: 'Corte y estilo',
    date: '2026-10-20', time: '10:00', status: 'confirmed' };

function world(options: { appointments: any[]; /** what the writer answers (its INSERT committed whatever it answers) */ createAnswer?: () => any; agendaHoldsTheWrite?: boolean }) {
    // The agenda the booking engine re-reads: it holds the new appointment from the moment the writer ran.
    let written = false;
    const prisma = {
        tenant: { findUnique: jest.fn().mockResolvedValue({ settings: {} }) },
        executeInTenantSchema: jest.fn(async (_schema: string, sql: string) => {
            if (!/^\s*(SELECT|WITH)\b/i.test(sql)) throw new Error(`unexpected SQL write: ${sql}`);
            return [];
        }),
        $queryRawUnsafe: jest.fn(async (sql: string) => (/FROM "[^"]+"\.appointments a/.test(sql) && written && options.agendaHoldsTheWrite !== false
            ? [{ id: 'd0adbd49-3333-4333-8333-333333333333', status: 'confirmed', payment_status: null, amount_due: null, hold_expires_at: null, price: null, currency: 'COP' }] : [])),
    };
    const f = agentTurnFixture({ toolRetrieval: new ToolRetrievalService(), prisma });
    const namespace = { schemaName: 'tenant_eval_11111111_aaaaaaaaaaaaaaaaaaaaaaaa', sourceSchema: 'tenant_test', tenantId: 'tenant',
        token: '11111111-1111-4111-8111-111111111111', expiresAt: new Date(Date.now() + 60_000).toISOString(), tables: [] };
    const conversationId = randomUUID();
    (f.service as any).namespaces = { assertOwned: jest.fn() };
    f.personaService.getAgent.mockResolvedValue({ version: 1, config_json: {
        language: 'es', industry: 'moda_belleza', tools: { appointments: { enabled: true } }, rag: { enabled: false }, llm: {},
    } });
    f.verticalTurnContext.resolve.mockResolvedValue({ industry: 'moda_belleza', subType: 'general' });
    publishTools(f, ['list_services', 'check_availability', 'create_appointment', 'cancel_appointment', 'reschedule_appointment', 'list_customer_appointments']);
    const calls: Array<{ name: string; args: any; result: any }> = [];
    let pending: { tool: string; args: any } | null = null;
    /** the ledger row the guard says is waiting (when it is not the one the focus is waiting on) */
    let waitingLedger: string | undefined;
    const done: Record<string, any> = {};
    f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string, args: any) => {
        let result: any;
        if (name === 'list_customer_appointments') result = { appointments: options.appointments };
        else if (name === 'list_services') result = { services: SERVICES };
        else if (name === 'check_availability') result = { available: true, slots: SLOTS };
        else if (name === 'create_appointment') {
            written = true;
            result = options.createAnswer ? options.createAnswer() : { success: true, appointment: { id: 'd0adbd49-3333-4333-8333-333333333333', status: 'confirmed' } };
        }
        else if (['cancel_appointment', 'reschedule_appointment'].includes(name)) {
            if (pending && pending.tool === name && JSON.stringify(pending.args) === JSON.stringify(args) && done[name] === 'confirmed') {
                result = { success: true, message: 'done', alternatives: [] };
                pending = null; delete done[name]; // one yes, one change
            } else {
                pending = { tool: name, args };
                result = { error: 'confirmation_required', confirmationId: `conf-${name}`, message: 'Confirmación requerida' };
            }
        } else result = { items: [] };
        calls.push({ name, args, result });
        return result;
    });
    // The guard's own rules for the lookup of «the proposal this yes answers»: bound to the focus the proposal is waiting under.
    f.toolExecutionControl.findPendingConfirmation.mockImplementation(async (_s: string, _c: string, _k: string, reply: string | undefined, scope: any) => {
        if (!pending) return null;
        if (reply === undefined) return { ledgerId: waitingLedger ?? `conf-${pending.tool}`, toolName: pending.tool, args: pending.args };
        if (scope?.expectedReply?.kind !== 'confirmation') return null;
        if (classifyExplicitToolConfirmation(reply, { effect: 'transactional', pendingTool: pending.tool }) !== 'confirmed') return null;
        done[pending.tool] = 'confirmed';
        return { ledgerId: `conf-${pending.tool}`, toolName: pending.tool, args: pending.args };
    });
    f.llmRouter.execute.mockImplementation(async (request: any) => {
        if (!['conversation', 'tool_calling'].includes(request.task)) return answer('{}');
        return answer(REFUSAL);
    });
    let id: string | undefined;
    const turn = async (message: string) => {
        const result = await f.service.test('tenant', AGENT, { message, channelType: 'telegram', runtimeSessionId: id }, {
            evalMode: true, sandboxContactId: '00000000-0000-4000-8000-00000000eba1', sandboxConversationId: conversationId,
            sandboxNamespace: namespace, sandboxInboundMessageId: randomUUID(),
        });
        id = result.debug.runtimeSessionId;
        return result;
    };
    const session = (): AgentTurnSession => (f.service as any).sessions.sessions.get(id).session;
    const ran = (name: string) => calls.filter(call => call.name === name);
    const succeeded = (name: string) => ran(name).filter(call => call.result?.success === true);
    return { f, turn, session, ran, succeeded, calls, setWaitingLedger: (id?: string) => { waitingLedger = id; } };
}

describe('a started appointment in the account is not the task in progress', () => {
    it('«quiero agendar corte y estilo» opens a booking, however the started one was last talked about', async () => {
        const h = world({ appointments: [STARTED] });
        await h.turn('hola');
        const list = await h.turn('¿qué citas tengo?');
        expect(list.reply).toContain('F0080B9A');
        const refused = await h.turn('cancela la cita F0080B9A');
        expect(refused.reply).toContain('ya comenzó o ya pasó');
        await h.turn('no, gracias');

        const booking = await h.turn('quiero agendar corte y estilo');
        expect(booking.reply).not.toMatch(/No me queda claro a qué gestión/);
        expect(h.session().metadata.bookingState).toMatchObject({ step: 'ask_date', serviceId: SERVICE, serviceName: 'Corte y estilo' });

        // the whole booking runs on the engine, and the unconfirmed price does not stop it nor sends the customer to a person
        await h.turn('el miércoles 21 de octubre');
        expect(h.session().metadata.bookingState).toMatchObject({ step: 'show_slots', date: '2026-10-21' });
        await h.turn('a las 10:00');
        expect(h.session().metadata.bookingState.time).toBe('10:00');
    });

    it('also when the customer asks for it with a date, a time and their data in one message', async () => {
        const h = world({ appointments: [STARTED] });
        await h.turn('hola');
        await h.turn('reprograma la cita F0080B9A para el sábado 17 de octubre a las 10:00');
        const booking = await h.turn('quiero agendar corte y estilo el miércoles 21 de octubre a las 10:00, a nombre de Joaquin Sosa, correo qa.cliente@example.com');
        expect(booking.reply).not.toMatch(/No me queda claro a qué gestión/);
        expect(h.session().metadata.bookingState).toMatchObject({ serviceId: SERVICE, date: '2026-10-21' });
    });

    it('«Hola, quiero agendar una cita de corte y estilo» (it names «cita») too', async () => {
        const h = world({ appointments: [STARTED] });
        await h.turn('hola');
        await h.turn('cancela la cita F0080B9A');
        const booking = await h.turn('Hola, quiero agendar una cita de corte y estilo');
        expect(booking.reply).not.toMatch(/No me queda claro a qué gestión/);
        expect(h.session().metadata.bookingState.step).not.toBe('idle');
    });
});

describe('finished cancellations and reschedules do not wall in the next task', () => {
    it('after eight of them, a new booking request still opens a booking (the parked list is bounded, never a wall)', async () => {
        const h = world({ appointments: [UPCOMING] });
        await h.turn('hola');
        for (let i = 0; i < 8; i++) {
            const proposal = await h.turn('quiero cancelar mi cita');
            expect(proposal.reply).toContain('¿Confirma que desea cancelar su cita de Corte y estilo');
            const done = await h.turn('sí, cancélala');
            expect(done.reply).toBe('Su cita (Ref. 3C78ECA2) quedó cancelada.');
        }
        const booking = await h.turn('quiero agendar corte y estilo');
        expect(booking.reply).not.toMatch(/No me queda claro a qué gestión/);
        expect(h.session().metadata.bookingState).toMatchObject({ step: 'ask_date', serviceId: SERVICE });
        // and what is parked stays bounded
        expect((h.session().metadata.missionFocus.pausedTools || []).length).toBeLessThanOrEqual(6);
    });

    it('a finished task is not parked as something to resume', async () => {
        const h = world({ appointments: [UPCOMING] });
        await h.turn('hola');
        await h.turn('quiero cancelar mi cita');
        await h.turn('sí, cancélala');
        expect(h.session().metadata.missionFocus.expectedReply).toBeNull();
        await h.turn('quiero agendar corte y estilo');
        expect(h.session().metadata.missionFocus.pausedTools || []).toHaveLength(0);
    });
});

describe('one «sí» after a reschedule proposal executes it, even when the request had been repeated', () => {
    const REQUEST = 'reprograma la cita 3C78ECA2 para el viernes 16 de octubre a las 11:00';

    it('the proposal, the same request again (the proposal is shown again), then ONE «sí»', async () => {
        const h = world({ appointments: [UPCOMING] });
        await h.turn('hola');
        const first = await h.turn(REQUEST);
        expect(first.reply).toContain('¿Confirma que movamos su cita de Corte y estilo (Ref. 3C78ECA2) del martes 20 de octubre a las 10:00 al viernes 16 de octubre a las 11:00?');
        const again = await h.turn(REQUEST);
        expect(again.reply).toBe(first.reply);
        expect(h.ran('reschedule_appointment')).toHaveLength(1);

        const yes = await h.turn('sí');
        expect(yes.reply).toBe('Su cita (Ref. 3C78ECA2) quedó reprogramada para el viernes 16 de octubre a las 11:00.');
        expect(h.succeeded('reschedule_appointment')).toHaveLength(1);
        expect(yes.reply).not.toMatch(/confirmación final/);
    });

    it('the plain path keeps working: proposal and ONE «sí»', async () => {
        const h = world({ appointments: [UPCOMING] });
        await h.turn('hola');
        await h.turn(REQUEST);
        const yes = await h.turn('sí');
        expect(yes.reply).toBe('Su cita (Ref. 3C78ECA2) quedó reprogramada para el viernes 16 de octubre a las 11:00.');
    });

    it('another proposal is the one waiting in the ledger: the focus is NOT handed back to the old one', async () => {
        const h = world({ appointments: [UPCOMING] });
        await h.turn('hola');
        await h.turn(REQUEST);
        h.setWaitingLedger('conf-another-row');
        const again = await h.turn(REQUEST);
        expect(again.reply).toContain('¿Confirma que movamos su cita');
        expect(h.session().metadata.missionFocus.expectedReply).toBeNull();
        const yes = await h.turn('sí');
        expect(h.succeeded('reschedule_appointment')).toHaveLength(0);
        expect(yes.reply).not.toMatch(/quedó reprogramada/);
    });

    it('a repeated request that names a DIFFERENT move is a new proposal: the old yes is not resurrected', async () => {
        const h = world({ appointments: [UPCOMING] });
        await h.turn('hola');
        await h.turn(REQUEST);
        const other = await h.turn('reprograma la cita 3C78ECA2 para el viernes 16 de octubre a las 10:30');
        expect(other.reply).toContain('al viernes 16 de octubre a las 10:30?');
        const yes = await h.turn('sí');
        expect(yes.reply).toBe('Su cita (Ref. 3C78ECA2) quedó reprogramada para el viernes 16 de octubre a las 10:30.');
    });
});

describe('the exact sequence of the false failure: the reply is what the agenda says', () => {
    // «quiero agendar corte y estilo» → «el lunes 19 de octubre» → «el 2» → name / e-mail → «¿Lo agendo?» → «sí, agéndala» (production 18:28–18:30)
    const run = async (createAnswer: () => any, agendaHoldsTheWrite = true) => {
        const h = world({ appointments: [STARTED], createAnswer, agendaHoldsTheWrite });
        await h.turn('hola');
        await h.turn('quiero agendar corte y estilo');
        await h.turn('el lunes 19 de octubre');
        await h.turn('el 2');
        for (let i = 0; i < 4 && h.session().metadata.bookingState?.step !== 'confirm'; i++) {
            const step = h.session().metadata.bookingState?.step;
            await h.turn(step === 'ask_name' ? 'Joaquin Sosa' : 'mi correo es qa.cliente@example.com');
        }
        expect(h.session().metadata.bookingState).toMatchObject({ step: 'confirm', date: '2026-10-19', time: '09:30' });
        const yes = await h.turn('sí, agéndala');
        return { h, yes, state: () => h.session().metadata.bookingState };
    };

    it.each([
        ['the ledger could not acknowledge the commit', { error: 'reconciliation_required', shouldHandoff: true, message: 'No pude verificar el resultado de la acción; requiere revisión antes de repetirla.' }],
        ['an internal failure after the INSERT', { error: 'tool_failed', message: 'No se pudo completar esta acción en este momento.' }],
    ])('%s → booked, with the reference of the appointment that exists (not «No pude agendar»)', async (_label, answer) => {
        const { h, yes, state } = await run(() => answer);
        expect(h.ran('create_appointment')).toHaveLength(1);
        expect(state()).toMatchObject({ step: 'booked', appointmentId: 'd0adbd49-3333-4333-8333-333333333333' });
        const told = JSON.stringify(yes.debug.turnContext?.directive ?? '');
        expect(told).toContain('D0ADBD49');
        expect(told).not.toMatch(/No pude|Error al crear|equipo/);
    });

    it('the agenda holds nothing: the failure is told as a failure and a person is arranged, not a booking', async () => {
        const { yes, state } = await run(() => ({ error: 'reconciliation_required', shouldHandoff: true }), false);
        expect(state().step).not.toBe('booked');
        expect(JSON.stringify(yes.debug.turnContext?.directive ?? '')).not.toContain('D0ADBD49');
    });
});
