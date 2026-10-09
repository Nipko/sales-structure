import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import { randomUUID } from 'crypto';
import { classifyExplicitToolConfirmation } from './tool-execution-control.service';
import { ToolRetrievalService } from './tool-retrieval.service';

/**
 * Live Telegram test, production 065e004a (2026-10-08, "Salón QA Citas" and "Tienda QA Electrónica"):
 *   «quiero cancelar mi cita» → «¿Desea cancelarla?» (prose, NO writer call) → «sí, cancélala» → «Actualmente no puedo cancelar su
 *   cita directamente; necesito que alguien del equipo…». Same for «sí, reprográmala» and for the order («No he podido completar
 *   esa acción»). The model asked in prose, so there was no pending ledger row for the server to execute at the "yes".
 *
 * The model in this file behaves exactly like that production model: it NEVER calls a writer and answers any turn it is asked to
 * voice with the refusal. Everything that works must therefore come from the server.
 */
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const APPT = 'ae3d0c86-1111-4111-8111-111111111111';
const APPT2 = 'd5959ea9-2222-4222-8222-222222222222';
const ORDER = 'c03ebdd7-226a-40b0-afc1-cba45b5a0073';
const REFUSAL = 'Actualmente no puedo cancelar su cita directamente; para esta gestión necesito que alguien del equipo lo atienda. ¿Quiere que le pida a alguien del equipo que se encargue?';
const answer = (content: string) => ({ content, model: 'test', usage: { promptTokens: 1, completionTokens: 1 }, cost: 0 });

const appointment = (id: string, date: string, time: string) => ({ id, reference: id.slice(0, 8).toUpperCase(), serviceId: 'svc-1', staffId: 'staff-1',
    service: 'Corte y estilo', date, time, status: 'confirmed' });
const order = { id: ORDER, version: 1, status: 'pending', paymentStatus: 'pending', totalAmount: 119900, currency: 'COP',
    items: [{ productName: 'Audífono QA Aurora', quantity: 1 }] };

interface Options { tools: string[]; industry: string; appointments?: any[]; orders?: any[]; slots?: string[]; model?: (request: any) => string }

function world(options: Options) {
    const f = agentTurnFixture({ toolRetrieval: new ToolRetrievalService() });
    const namespace = { schemaName: 'tenant_eval_11111111_aaaaaaaaaaaaaaaaaaaaaaaa', sourceSchema: 'tenant_test', tenantId: 'tenant',
        token: '11111111-1111-4111-8111-111111111111', expiresAt: new Date(Date.now() + 60_000).toISOString(), tables: [] };
    const conversationId = randomUUID();
    (f.service as any).namespaces = { assertOwned: jest.fn() };
    f.personaService.getAgent.mockResolvedValue({ version: 1, config_json: {
        language: 'es', industry: options.industry, tools: { appointments: { enabled: true } }, rag: { enabled: false }, llm: {},
    } });
    f.verticalTurnContext.resolve.mockResolvedValue({ industry: options.industry, subType: 'general' });
    publishTools(f, options.tools);
    const calls: Array<{ name: string; args: any; result: any }> = [];
    let pending: { tool: string; args: any } | null = null;
    let done: Record<string, any> = {};
    f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string, args: any) => {
        let result: any;
        if (name === 'list_customer_appointments') result = { appointments: options.appointments ?? [] };
        else if (name === 'list_my_catalog_orders') result = { success: true, orders: options.orders ?? [] };
        else if (name === 'check_availability') result = { available: true, slots: (options.slots ?? ['09:00', '10:00']).map(time => ({ time })) };
        else if (['cancel_appointment', 'reschedule_appointment', 'cancel_catalog_order'].includes(name)) {
            if (pending && pending.tool === name && JSON.stringify(pending.args) === JSON.stringify(args) && done[name] === 'confirmed') {
                result = name === 'reschedule_appointment'
                    ? { success: true, appointment: { id: args.appointmentId, service: 'Corte y estilo', date: args.newDate, time: args.newTime, status: 'confirmed' } }
                    : name === 'cancel_catalog_order' ? { success: true, order: { id: args.orderId, status: 'cancelled' } } : { success: true, message: 'Appointment cancelled.', alternatives: [] };
            } else {
                pending = { tool: name, args };
                result = { error: 'confirmation_required', confirmationId: 'conf-1', message: 'Confirmación requerida' };
            }
        } else result = { items: [] };
        calls.push({ name, args, result });
        return result;
    });
    f.toolExecutionControl.findPendingConfirmation.mockImplementation(async (_s: string, _c: string, _k: string, reply: string, scope: any) => {
        if (!pending || scope?.expectedReply?.kind !== 'confirmation') return null;
        if (classifyExplicitToolConfirmation(reply, { effect: 'transactional', pendingTool: pending.tool }) !== 'confirmed') return null;
        done[pending.tool] = 'confirmed';
        return { ledgerId: 'conf-1', toolName: pending.tool, args: pending.args };
    });
    const voiced: string[] = [];
    f.llmRouter.execute.mockImplementation(async (request: any) => {
        if (!['conversation', 'tool_calling'].includes(request.task)) return answer('{}');
        voiced.push(String((request.messages ?? []).slice(-1)[0]?.content ?? ''));
        return answer(options.model ? options.model(request) : REFUSAL);
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
    const ran = (name: string) => calls.filter(call => call.name === name);
    const succeeded = (name: string) => ran(name).filter(call => call.result?.success === true);
    return { f, turn, ran, succeeded, voiced, calls };
}

const SALON = ['list_services', 'check_availability', 'create_appointment', 'cancel_appointment', 'reschedule_appointment', 'list_customer_appointments', 'search_faqs'];
const STORE = ['list_my_catalog_orders', 'get_catalog_order', 'cancel_catalog_order', 'search_products', 'check_stock'];

describe('cancelling an appointment does not depend on the model calling the writer', () => {
    it('«quiero cancelar mi cita» → the server proposes with the exact terms; «sí, cancélala» executes it and says so', async () => {
        const h = world({ tools: SALON, industry: 'salon', appointments: [appointment(APPT, '2026-10-12', '09:00')] });
        await h.turn('hola');
        const request = await h.turn('quiero cancelar mi cita');
        expect(request.debug.runtimeError).toBeUndefined();
        expect(h.ran('cancel_appointment').map(call => call.result.error)).toEqual(['confirmation_required']);
        expect(h.ran('cancel_appointment')[0].args).toEqual({ appointmentId: APPT });
        expect(request.reply).toContain('¿Confirma que desea cancelar su cita de Corte y estilo');
        expect(request.reply).toContain('AE3D0C86');
        expect(request.reply).not.toMatch(/equipo|no puedo/i);

        const yes = await h.turn('sí, cancélala');
        expect(yes.debug.runtimeError).toBeUndefined();
        expect(h.succeeded('cancel_appointment')).toHaveLength(1);
        expect(yes.reply).toBe('Su cita (Ref. AE3D0C86) quedó cancelada.');
    });

    it('with two appointments it lists both with their references and never guesses; the choice then gets its proposal', async () => {
        const h = world({ tools: SALON, industry: 'salon', appointments: [appointment(APPT, '2026-10-12', '09:00'), appointment(APPT2, '2026-10-13', '09:00')] });
        await h.turn('hola');
        const ask = await h.turn('quiero cancelar mi cita');
        expect(h.ran('cancel_appointment')).toHaveLength(0);
        expect(ask.reply).toContain('AE3D0C86');
        expect(ask.reply).toContain('D5959EA9');
        expect(ask.reply).toMatch(/¿Cuál desea cancelar\?/);
        const choice = await h.turn('la del martes');
        expect(h.ran('cancel_appointment')[0].args).toEqual({ appointmentId: APPT2 });
        expect(choice.reply).toContain('D5959EA9');
        expect(choice.reply).toContain('¿Confirma que desea cancelar');
        await h.turn('sí, cancélala');
        expect(h.succeeded('cancel_appointment').map(call => call.args.appointmentId)).toEqual([APPT2]);
    });

    it('«¿qué citas tengo?» is answered by the server in usted, with the references', async () => {
        const h = world({ tools: SALON, industry: 'salon', appointments: [appointment(APPT, '2026-10-12', '09:00')] });
        await h.turn('hola');
        const list = await h.turn('¿qué citas tengo?');
        expect(list.reply).toContain('Usted tiene una cita');
        expect(list.reply).toContain('AE3D0C86');
        expect(list.reply).not.toMatch(/\b(?:tienes|quieres|te ayude)\b/i);
        const none = world({ tools: SALON, industry: 'salon', appointments: [] });
        await none.turn('hola');
        expect((await none.turn('¿qué citas tengo?')).reply).toBe('Usted no tiene citas próximas. ¿Desea agendar una?');
    });
});

describe('rescheduling an appointment', () => {
    it('«quiero reprogramar mi cita al día siguiente a la misma hora» → proposal for the next day at the same time; «sí, reprográmala» moves it', async () => {
        const h = world({ tools: SALON, industry: 'salon', appointments: [appointment(APPT, '2026-10-12', '09:00')], slots: ['09:00', '09:30'] });
        await h.turn('hola');
        const request = await h.turn('quiero reprogramar mi cita al día siguiente a la misma hora');
        expect(request.debug.runtimeError).toBeUndefined();
        expect(h.ran('reschedule_appointment')[0].args).toEqual({ appointmentId: APPT, newDate: '2026-10-13', newTime: '09:00' });
        expect(request.reply).toContain('¿Confirma que movamos su cita de Corte y estilo (Ref. AE3D0C86)');
        expect(request.reply).toMatch(/martes 13 de octubre a las 09:00/);
        const yes = await h.turn('sí, reprográmala');
        expect(h.succeeded('reschedule_appointment')).toHaveLength(1);
        expect(h.ran('create_appointment')).toHaveLength(0);
        expect(yes.reply).toBe('Su cita (Ref. AE3D0C86) quedó reprogramada para el martes 13 de octubre a las 09:00.');
    });

    it('a slot that is not free is not proposed: the free ones are offered instead', async () => {
        const h = world({ tools: SALON, industry: 'salon', appointments: [appointment(APPT, '2026-10-12', '09:00')], slots: ['10:00', '10:30'] });
        await h.turn('hola');
        const request = await h.turn('quiero reprogramar mi cita al día siguiente a la misma hora');
        expect(h.ran('reschedule_appointment')).toHaveLength(0);
        expect(request.reply).toContain('no está disponible');
        expect(request.reply).toContain('10:00, 10:30');
    });

    it('with no new date or time named it asks for them and keeps the choice for the next message', async () => {
        const h = world({ tools: SALON, industry: 'salon', appointments: [appointment(APPT, '2026-10-12', '09:00')], slots: ['09:00', '10:00'] });
        await h.turn('hola');
        const ask = await h.turn('quiero reprogramar mi cita');
        expect(ask.reply).toMatch(/¿Para qué día y hora desea mover su cita/);
        expect(h.ran('reschedule_appointment')).toHaveLength(0);
        const target = await h.turn('mejor el día siguiente a la misma hora');
        expect(h.ran('reschedule_appointment')[0].args).toEqual({ appointmentId: APPT, newDate: '2026-10-13', newTime: '09:00' });
        expect(target.reply).toContain('¿Confirma que movamos');
    });
});

describe('cancelling an order', () => {
    it('«quiero cancelar mi pedido» → the server proposes with a SHORT reference, never the raw UUID; «sí, cancélalo» cancels it', async () => {
        const h = world({ tools: STORE, industry: 'retail', orders: [order] });
        await h.turn('hola');
        const request = await h.turn('quiero cancelar mi pedido');
        expect(h.ran('cancel_catalog_order')[0].args).toEqual({ orderId: ORDER });
        expect(request.reply).toContain('C03EBDD7');
        expect(request.reply).not.toContain(ORDER);
        expect(request.reply).toMatch(/¿Confirma que desea cancelar su pedido/);
        const yes = await h.turn('sí, cancélalo');
        expect(h.succeeded('cancel_catalog_order')).toHaveLength(1);
        expect(yes.reply).toBe('Su pedido (Ref. C03EBDD7) quedó cancelado.');
        expect(yes.reply).not.toMatch(/No he podido completar/);
    });
});

describe('two kinds of object', () => {
    it('«sí, cancela el pedido» while an APPOINTMENT cancellation is pending asks which one, naming both, and executes nothing', async () => {
        const h = world({ tools: [...SALON, ...STORE], industry: 'salon', appointments: [appointment(APPT, '2026-10-12', '09:00')], orders: [order] });
        await h.turn('hola');
        await h.turn('quiero cancelar mi cita');
        const mixed = await h.turn('sí, cancela el pedido');
        expect(h.succeeded('cancel_appointment')).toHaveLength(0);
        expect(h.succeeded('cancel_catalog_order')).toHaveLength(0);
        expect(mixed.reply).toMatch(/su cita o su pedido|su pedido o su cita/);
        expect(mixed.reply).toMatch(/¿Sobre cuál desea continuar\?/);
    });

    it('«quiero cancelar» alone, in a business with appointments AND orders, lists the two options instead of a bare «más de una gestión»', async () => {
        const h = world({ tools: [...SALON, ...STORE], industry: 'salon', appointments: [appointment(APPT, '2026-10-12', '09:00')], orders: [order] });
        await h.turn('hola');
        const result = await h.turn('quiero cancelar');
        expect(result.reply).toMatch(/su cita o su pedido|su pedido o su cita/);
        expect(result.reply).not.toBe('Hay más de una gestión posible. ¿Cuál desea continuar?');
    });
});

describe('references and register in what the model writes', () => {
    it('a raw UUID in a reply is shown as the short reference; a URL keeps its ids', async () => {
        const h = world({
            tools: STORE, industry: 'retail',
            model: () => `Su pedido ${ORDER} está pendiente. Detalle: https://x.example/orders/${ORDER}`,
        });
        await h.turn('hola');
        const result = await h.turn('¿cuál es el estado de mi pedido?');
        expect(result.reply).toContain('Su pedido C03EBDD7 está pendiente');
        expect(result.reply).toContain(`https://x.example/orders/${ORDER}`);
    });
});
