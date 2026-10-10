import { pinClock } from './__fixtures__/pinned-clock';
import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import { randomUUID } from 'crypto';
import type { AgentTurnSession } from './agent-turn-session';
import { classifyExplicitToolConfirmation } from './tool-execution-control.service';
import { ToolRetrievalService } from './tool-retrieval.service';

/**
 * Salón QA Citas, 2026-10-09 22:55 UTC (production 4bf7c6da): after cancellations had been carried out, «quiero corte y estilo el lunes 19
 * de octubre a las 9:30, a nombre de Joaquin Sosa, correo …» (no «agendar» in it) was not taken by the booking engine: the cancellation
 * that had consumed its write was still the selected task, and the booking engine only runs when no task of another kind is selected.
 * The model drove the booking, asked about the price, and the whole confirmation lost the engine's guarantees.
 *
 * Over the REAL turn (ConversationsService + mission arbiter + transition engine + booking engine); only the I/O boundaries are doubles.
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

describe('a task that was carried out no longer owns the conversation', () => {
    it('after a cancellation was carried out, a booking request without «agendar» is taken by the booking engine', async () => {
        const h = world({ appointments: [UPCOMING] });
        await h.turn('hola');
        await h.turn('quiero cancelar mi cita');
        const done = await h.turn('sí, cancélala');
        expect(done.reply).toBe('Su cita (Ref. 3C78ECA2) quedó cancelada.');
        await h.turn('quiero corte y estilo el lunes 19 de octubre a las 9:30, a nombre de Joaquin Sosa, correo qa.cliente@example.com');
        expect(h.session().metadata.bookingState).toMatchObject({ serviceId: SERVICE, date: '2026-10-19', time: '09:30' });
        expect(h.session().metadata.missionFocus.selected.kind).toBe('booking');
    });

    it('the finished task is released at the next message, and nothing is left waiting', async () => {
        const h = world({ appointments: [UPCOMING] });
        await h.turn('hola');
        await h.turn('quiero cancelar mi cita');
        await h.turn('sí, cancélala');
        await h.turn('gracias');
        const focus = h.session().metadata.missionFocus;
        expect(focus.expectedReply).toBeNull();
        expect(focus.selected?.reference).toBeUndefined();
        expect(focus.selected?.toolName).toBeUndefined();
        expect(focus.pausedTools || []).toHaveLength(0);
    });
});
