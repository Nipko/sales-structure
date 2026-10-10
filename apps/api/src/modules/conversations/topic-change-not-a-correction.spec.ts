import { pinClock } from './__fixtures__/pinned-clock';
import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import { randomUUID } from 'crypto';
import type { AgentTurnSession } from './agent-turn-session';
import { classifyExplicitToolConfirmation } from './tool-execution-control.service';
import { ToolRetrievalService } from './tool-retrieval.service';
import { arbitrateMissionFocus, newMissionFocus } from './mission-focus';
import { appointmentChangeRequest } from './appointment-transition';

/**
 * A customer who changes the topic, the payment method, the plan, the colour of an order or their mind is not asking to change an
 * appointment, and has nothing in progress to correct: none of those starts a reschedule, a cancellation or a «hay más de una gestión
 * posible» that withdraws the tools. (A real correction of a task in progress is unchanged.)
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


const TEXTS = ['quiero cambiar de tema', 'cambiemos de tema', 'mejor cambio de idea', 'quiero cambiar mi pedido de color', 'cambiar el método de pago',
    'cambié de opinión', 'quiero cambiar de plan', 'cambia de tema por favor'];

describe('changing the topic, the payment method or a change of mind is not a change of appointment', () => {
    it.each(TEXTS)('«%s» is not read as a request to change an appointment', text => {
        expect(appointmentChangeRequest(text)).toBeNull();
    });
    it('a real request to change the appointment still is one', () => {
        expect(appointmentChangeRequest('quiero cambiar mi cita al viernes')).toBe('ambiguous');
        expect(appointmentChangeRequest('reprograma mi cita')).toBe('explicit');
    });
});

describe('with no task in progress there is nothing to correct', () => {
    it.each(TEXTS)('«%s» is neither a correction nor a clarification', text => {
        const result = arbitrateMissionFocus({ state: newMissionFocus(), candidates: [], text, messageId: 'm' });
        expect(result.route).not.toBe('clarify');
        expect(result.action).not.toBe('correct');
        expect(result.action).not.toBe('clarify');
    });

    it('a correction of the task in progress is still a correction', () => {
        const state = newMissionFocus();
        state.selected = { id: 'm1', kind: 'tool', domain: 'order', toolName: 'place_catalog_order', reference: 'ledger-1' };
        state.expectedReply = { missionId: 'm1', proposalId: 'ledger-1', ledgerId: 'ledger-1', sourceMessageId: 'x', kind: 'confirmation' };
        const result = arbitrateMissionFocus({ state, candidates: [], text: 'mejor cambia el pedido a 3 unidades', messageId: 'm' });
        expect(result.action).toBe('correct');
        expect(result.invalidateConfirmation).toBe(true);
        expect(result.state.expectedReply).toBeNull();
    });
});

describe.each([[true], [false]])('the whole turn, customer with an upcoming appointment: %s', withAppointment => {
    it.each(TEXTS)('«%s» starts no reschedule, no cancellation and no clarification: the model answers with its tools', async text => {
        const h = world({ appointments: withAppointment ? [UPCOMING] : [] });
        await h.turn('hola');
        const before = h.f.llmRouter.execute.mock.calls.length;
        await h.turn(text);
        expect(h.calls.map(call => call.name).filter(name => /^(?:cancel_|reschedule_|create_)/.test(name))).toEqual([]);
        const requests = h.f.llmRouter.execute.mock.calls.slice(before).map((call: any[]) => call[0]).filter((request: any) => ['conversation', 'tool_calling'].includes(request.task));
        expect(requests.length).toBeGreaterThan(0);
        expect(requests[0].task).toBe('tool_calling');
    });
});
