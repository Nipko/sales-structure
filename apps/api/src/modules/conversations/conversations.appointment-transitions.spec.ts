import { pinClock } from './__fixtures__/pinned-clock';
import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import { randomUUID } from 'crypto';
import { classifyExplicitToolConfirmation } from './tool-execution-control.service';
import { containsHumanOffer } from './human-offer';
import { offersHumanHandoff } from '../../common/utils/outcome-claim.util';

/**
 * Round-2 end-to-end write test (2026-10-08), service level through ConversationsService:
 *  1. «reprogramar mi cita» was routed to the booking engine, which opened a NEW booking (and denied reschedule_appointment
 *     as another mission's tool): it must reach reschedule_appointment, after its normal confirmation, with no create.
 *  2/3. «sí, cancélala» / «sí, cancélalo» answering a pending cancellation was read as a cancel REQUEST (unclear / rejected /
 *     a clarification with no options): it must confirm exactly that cancellation, once.
 */
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CORTE = { id: '11111111-1111-4111-8111-111111111111', name: 'Corte y estilo', durationMinutes: 45, price: 40000, priceStatus: 'confirmed', currency: 'COP' };
const answer = (content: string, toolCalls?: any[]) => ({ content, ...(toolCalls ? { toolCalls } : {}), model: 'test', usage: { promptTokens: 1, completionTokens: 1 }, cost: 0 });
const call = (name: string, args: Record<string, unknown>) => ({ id: `call-${name}`, function: { name, arguments: JSON.stringify(args) } });

interface World {
    tools: string[];
    industry: string;
    /** The pending tool the server executes after the customer's yes. */
    pendingTool: string;
    pendingArgs: Record<string, unknown>;
    /** The tool call the model makes on the request turn. */
    requestCall: { name: string; args: Record<string, unknown> };
    requestPattern: RegExp;
    summary: string;
    done: string;
    results: Record<string, any>;
}

function world(w: World) {
    const f = agentTurnFixture();
    const namespace = { schemaName: 'tenant_eval_11111111_aaaaaaaaaaaaaaaaaaaaaaaa', sourceSchema: 'tenant_test', tenantId: 'tenant',
        token: '11111111-1111-4111-8111-111111111111', expiresAt: new Date(Date.now() + 60_000).toISOString(), tables: [] };
    const conversationId = randomUUID();
    (f.service as any).namespaces = { assertOwned: jest.fn() };
    f.personaService.getAgent.mockResolvedValue({ version: 1, config_json: {
        language: 'es', industry: w.industry, tools: { appointments: { enabled: true } }, rag: { enabled: false }, llm: {},
    } });
    f.verticalTurnContext.resolve.mockResolvedValue({ industry: w.industry, subType: 'general' });
    publishTools(f, w.tools);
    const executed: Array<{ name: string; args: any; result: any }> = [];
    let confirmed = false;
    f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string, args: any) => {
        let result: any;
        if (name === w.pendingTool) {
            result = confirmed ? w.results[name] : { error: 'confirmation_required', confirmationId: 'conf-1', message: 'Confirmación requerida' };
        } else if (name === 'list_services') result = { services: [CORTE] };
        else if (name === 'check_availability') result = { available: true, slots: [{ time: '10:00', endTime: '10:45' }, { time: '16:00', endTime: '16:45' }, { time: '17:00', endTime: '17:45' }] };
        else result = w.results[name] ?? { items: [] };
        executed.push({ name, args, result });
        return result;
    });
    f.toolExecutionControl.findPendingConfirmation.mockImplementation(async (_s: string, _c: string, _k: string, reply: string, scope: any) => {
        if (scope?.expectedReply?.kind !== 'confirmation') return null;
        if (classifyExplicitToolConfirmation(reply, { effect: 'transactional', pendingTool: w.pendingTool }) !== 'confirmed') return null;
        confirmed = true;
        return { ledgerId: 'conf-1', toolName: w.pendingTool, args: w.pendingArgs };
    });
    f.llmRouter.execute.mockImplementation(async (request: any) => {
        const text = JSON.stringify(request.messages ?? []);
        const system = String(request.systemPrompt ?? '');
        if (!['conversation', 'tool_calling'].includes(request.task)) return answer('{}');
        if (text.includes('confirmation_required')) return answer(w.summary);
        if (w.requestPattern.test(String((request.messages ?? []).slice(-1)[0]?.content ?? '')) && (request.tools?.length ?? 0) > 0) {
            return answer('', [call(w.requestCall.name, w.requestCall.args)]);
        }
        if (/YA quedó realizada|ya se realizó|has been executed|resultado/i.test(system)) return answer(w.done);
        return answer('Con gusto le ayudo.');
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
    const ran = (name: string) => executed.filter(item => item.name === name);
    return { f, turn, executed, ran };
}

const RESCHEDULE: World = {
    tools: ['list_services', 'check_availability', 'create_appointment', 'reschedule_appointment', 'cancel_appointment', 'list_customer_appointments', 'search_faqs'],
    industry: 'salon',
    pendingTool: 'reschedule_appointment',
    pendingArgs: { appointmentId: 'apt-9', date: '2027-01-08', time: '10:00' },
    requestCall: { name: 'reschedule_appointment', args: { appointmentId: 'apt-9', date: '2027-01-08', time: '10:00' } },
    requestPattern: /reprogramar|reagendar|cambiar|mover|pasar|reschedule/i,
    summary: '¿Confirma que movamos su cita de Corte y estilo al viernes 8 de enero a las 10:00?',
    done: 'Listo, su cita quedó reprogramada para el viernes 8 de enero a las 10:00.',
    results: { reschedule_appointment: { success: true, appointment: { id: 'apt-9', status: 'confirmed' } } },
};


// The scenarios below are dated against a calendar and the turn reads the real clock: pinned, so they do not turn red the day
// they were written for goes by (see __fixtures__/pinned-clock.ts). Only Date is faked.
pinClock();
describe('changing an existing appointment goes to reschedule_appointment, never to a new booking', () => {
    it.each([
        'quiero reprogramar mi cita para el viernes 8 de enero a las 10:00',
        'Necesito cambiar mi cita para el viernes a las 10',
        'puedes mover mi cita al viernes 8 de enero a las 10?',
        'quiero reagendar mi cita al viernes a las 10',
        'quiero pasar mi cita para el viernes a las 10',
    ])('"%s": reschedule_appointment after the normal confirmation, exactly one appointment, no create_appointment', async text => {
        const h = world(RESCHEDULE);
        await h.turn('hola');
        const request = await h.turn(text);
        expect(request.debug.runtimeError).toBeUndefined();
        // the model had the tools: the booking engine did not take the turn
        expect(h.ran('reschedule_appointment')).toHaveLength(1);
        expect(h.ran('reschedule_appointment')[0].result.error).toBe('confirmation_required');
        expect(request.reply).toBe(RESCHEDULE.summary);
        const yes = await h.turn('sí');
        expect(yes.debug.runtimeError).toBeUndefined();
        expect(h.ran('reschedule_appointment').map(item => item.result.success ?? item.result.error)).toEqual(['confirmation_required', true]);
        expect(h.ran('create_appointment')).toHaveLength(0);
        expect(yes.reply).toContain('reprogramada');
    });

    it('«sí, confírmala» after the reschedule summary confirms the same change once', async () => {
        const h = world(RESCHEDULE);
        await h.turn('hola');
        await h.turn('quiero reprogramar mi cita para el viernes 8 de enero a las 10:00');
        await h.turn('sí, confírmala');
        expect(h.ran('reschedule_appointment').filter(item => item.result.success === true)).toHaveLength(1);
        expect(h.ran('create_appointment')).toHaveLength(0);
    });

    it('a new booking request is still the booking engine\'s', async () => {
        const h = world(RESCHEDULE);
        await h.turn('hola');
        await h.turn('Quiero agendar Corte y estilo');
        expect(h.ran('reschedule_appointment')).toHaveLength(0);
        // the engine took the turn: the model only voices its text, with no tools
        const voiced = h.f.llmRouter.execute.mock.calls.filter((c: any[]) => ['conversation', 'tool_calling'].includes(c[0].task)).pop()![0];
        expect(voiced.tools ?? []).toHaveLength(0);
        expect(String(voiced.systemPrompt)).toContain('Corte y estilo');
    });
});

const CANCEL_ORDER: World = {
    tools: ['list_my_catalog_orders', 'get_catalog_order', 'cancel_catalog_order', 'search_products'],
    industry: 'retail',
    pendingTool: 'cancel_catalog_order',
    pendingArgs: { orderId: 'ord-1' },
    requestCall: { name: 'cancel_catalog_order', args: { orderId: 'ord-1' } },
    requestPattern: /cancelar/i,
    summary: '¿Confirma que cancelo su pedido ORD-1?',
    done: 'Listo, su pedido ORD-1 quedó cancelado.',
    results: { cancel_catalog_order: { success: true, order: { id: 'ord-1', status: 'cancelled' } } },
};
const CANCEL_APPOINTMENT: World = {
    tools: ['list_services', 'check_availability', 'create_appointment', 'cancel_appointment', 'list_customer_appointments', 'search_faqs'],
    industry: 'salon',
    pendingTool: 'cancel_appointment',
    pendingArgs: { appointmentId: 'apt-9' },
    requestCall: { name: 'cancel_appointment', args: { appointmentId: 'apt-9' } },
    requestPattern: /cancelar/i,
    summary: '¿Confirma que cancelo su cita de Corte y estilo del viernes 8 de enero a las 10:00?',
    done: 'Listo, su cita quedó cancelada.',
    results: { cancel_appointment: { success: true, appointment: { id: 'apt-9', status: 'cancelled' } } },
};

describe('«sí + cancel verb» answers the pending cancellation', () => {
    it.each([
        ['order', CANCEL_ORDER, 'quiero cancelar mi pedido ORD-1', 'sí, cancélalo', 'cancel_catalog_order'],
        ['order', CANCEL_ORDER, 'quiero cancelar mi pedido ORD-1', 'si, cancelalo', 'cancel_catalog_order'],
        ['appointment', CANCEL_APPOINTMENT, 'quiero cancelar mi cita del viernes', 'sí, cancélala', 'cancel_appointment'],
        ['appointment', CANCEL_APPOINTMENT, 'quiero cancelar mi cita del viernes', 'sí, anúlala', 'cancel_appointment'],
        ['appointment', CANCEL_APPOINTMENT, 'quiero cancelar mi cita del viernes', 'sí', 'cancel_appointment'],
    ])('%s: "%s" → "%s" executes %s once', async (_label, scenario, request, yes, tool) => {
        const h = world(scenario);
        await h.turn('hola');
        const first = await h.turn(request);
        expect(first.reply).toBe(scenario.summary);
        const second = await h.turn(yes);
        expect(second.debug.runtimeError).toBeUndefined();
        expect(h.ran(tool).map(item => item.result.success ?? item.result.error)).toEqual(['confirmation_required', true]);
        expect(second.reply).not.toMatch(/más de una gestión|no he podido|alguien del equipo/i);
        expect(second.reply).toMatch(/cancelad|anulad/);
    });

    it('with nothing pending, «sí, cancélalo» is still just a cancel request: nothing is executed, and it asks which one', async () => {
        const h = world(CANCEL_ORDER);
        await h.turn('hola');
        const result = await h.turn('sí, cancélalo');
        expect(h.ran('cancel_catalog_order')).toHaveLength(0);
        expect(result.reply).not.toContain('cancelado');
    });

    it('a cancel request that names no domain while ONE mission is current keeps that mission', async () => {
        const h = world(CANCEL_ORDER);
        await h.turn('hola');
        await h.turn('quiero cancelar mi pedido ORD-1');
        const result = await h.turn('mejor déjalo así, cancélalo');
        expect(result.reply).not.toMatch(/más de una gestión posible\. ¿Cuál quieres continuar\?/);
    });
});

const BOOKING: World = {
    tools: ['list_services', 'check_availability', 'create_appointment', 'search_faqs'],
    industry: 'salon',
    pendingTool: 'create_appointment',
    pendingArgs: {},
    requestCall: { name: 'search_faqs', args: {} },
    requestPattern: /^$/,
    summary: '',
    done: '',
    results: { create_appointment: { success: true, appointment: { id: 'apt-1', status: 'confirmed' } } },
};

describe('a yes that answers an offer of a person is not consent to the open booking summary', () => {
    async function toConfirm(h: ReturnType<typeof world>) {
        for (const text of ['hola', 'Quiero agendar Corte y estilo', 'el 5 de enero a las 16:00', 'Joaquin Sosa', 'joaquin@example.com']) await h.turn(text);
    }
    // the booking engine, not the tool loop, creates this appointment: count the engine's own call
    const created = (h: ReturnType<typeof world>) => h.f.toolExecutor.execute.mock.calls.filter((c: any[]) => c[3] === 'create_appointment').length;

    it('after the model offered a person at the summary, «sí» creates nothing', async () => {
        const h = world({ ...BOOKING, pendingTool: 'none' });
        await toConfirm(h);
        const offer = 'No tengo información de pagos con tarjeta. ¿Quiere que le pida a una persona del equipo que lo confirme?';
        h.f.llmRouter.execute.mockImplementation(async (request: any) => !['conversation', 'tool_calling'].includes(request.task) ? answer('{}') : answer(offer));
        await h.turn('tengo una duda sobre el pago con tarjeta');
        await h.turn('sí');
        expect(created(h)).toBe(0);
    });

    it('control: without that offer the same «sí» books once', async () => {
        const h = world({ ...BOOKING, pendingTool: 'none' });
        await toConfirm(h);
        await h.turn('sí');
        expect(created(h)).toBe(1);
        // the booked confirmation the model voices carries the short reference
        expect(h.f.llmRouter.execute.mock.calls.some((c: any[]) => String(c[0].systemPrompt ?? '').includes('Referencia: APT1'))).toBe(true);
    });
});

describe('follow-ups', () => {
    it.each(['sí, muévela', 'sí, cámbiala', 'sí, reprográmala', 'si, reagendala'])('"%s" after the reschedule summary confirms the same change once', async yes => {
        const h = world(RESCHEDULE);
        await h.turn('hola');
        await h.turn('quiero reprogramar mi cita para el viernes 8 de enero a las 10:00');
        const result = await h.turn(yes);
        expect(result.debug.runtimeError).toBeUndefined();
        expect(h.ran('reschedule_appointment').map(item => item.result.success ?? item.result.error)).toEqual(['confirmation_required', true]);
        expect(h.ran('create_appointment')).toHaveLength(0);
    });

    it.each(['sí, cancela el pedido', 'sí, cancélalo, el pedido', 'sí, cancela mi orden'])('"%s" does not cancel the appointment whose cancellation is pending', async yes => {
        const h = world(CANCEL_APPOINTMENT);
        await h.turn('hola');
        await h.turn('quiero cancelar mi cita del viernes');
        await h.turn(yes);
        expect(h.ran('cancel_appointment').filter(item => item.result.success === true)).toHaveLength(0);
    });

    it('«sí, cancela el pedido» does not execute the pending order cancellation when it names an appointment', async () => {
        const h = world(CANCEL_ORDER);
        await h.turn('hola');
        await h.turn('quiero cancelar mi pedido ORD-1');
        await h.turn('sí, cancela la cita');
        expect(h.ran('cancel_catalog_order').filter(item => item.result.success === true)).toHaveLength(0);
    });

    it('a free-text offer of a person («¿Quiere que le pida a alguien del equipo que lo revise?») is remembered: the next «sí» is not booking consent', async () => {
        const offer = 'Entiendo su duda. ¿Quiere que le pida a alguien del equipo que lo revise?';
        expect(containsHumanOffer(offer)).toBe(false);
        expect(offersHumanHandoff(offer)).toBe(true);
        const h = world({ ...BOOKING, pendingTool: 'none' });
        for (const text of ['hola', 'Quiero agendar Corte y estilo', 'el 5 de enero a las 16:00', 'Joaquin Sosa', 'joaquin@example.com']) await h.turn(text);
        h.f.llmRouter.execute.mockImplementation(async (request: any) => !['conversation', 'tool_calling'].includes(request.task) ? answer('{}') : answer(offer));
        await h.turn('tengo una duda sobre el pago con tarjeta');
        await h.turn('sí');
        expect(h.f.toolExecutor.execute.mock.calls.filter((c: any[]) => c[3] === 'create_appointment')).toHaveLength(0);
    });

    it.each([
        ['pending', { success: true, appointment: { id: '3f9a1c2b-0000-4000-8000-000000000000', status: 'pending' } }],
        ['awaiting payment', { success: true, appointment: { id: '3f9a1c2b-0000-4000-8000-000000000000', status: 'pending_payment', awaitingPayment: true, amountDueToConfirm: 10000, currency: 'COP' } }],
    ])('the %s booking text carries the short reference too', async (_label, result) => {
        const h = world({ ...BOOKING, pendingTool: 'none', results: { create_appointment: result } });
        for (const text of ['hola', 'Quiero agendar Corte y estilo', 'el 5 de enero a las 16:00', 'Joaquin Sosa', 'joaquin@example.com', 'sí']) await h.turn(text);
        expect(h.f.llmRouter.execute.mock.calls.some((c: any[]) => String(c[0].systemPrompt ?? '').includes('Referencia: 3F9A1C2B'))).toBe(true);
    });
});
