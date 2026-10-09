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

interface Options { tools: string[]; industry: string; appointments?: any[]; orders?: any[]; slots?: string[] | 'error'; model?: (request: any) => string; script?: (request: any) => any | undefined }

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
    const done: Record<string, any> = {};
    f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string, args: any) => {
        let result: any;
        if (name === 'list_customer_appointments') result = { appointments: options.appointments ?? [] };
        else if (name === 'list_my_catalog_orders') result = { success: true, orders: options.orders ?? [] };
        else if (name === 'check_availability') result = options.slots === 'error' ? { error: 'availability_unavailable' } : { available: true, slots: (options.slots ?? ['09:00', '10:00']).map(time => ({ time })) };
        else if (['cancel_appointment', 'reschedule_appointment', 'cancel_catalog_order', 'place_catalog_order'].includes(name)) {
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
        const scripted = options.script?.(request);
        if (scripted) return scripted;
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
const STORE = ['place_catalog_order', 'list_my_catalog_orders', 'get_catalog_order', 'cancel_catalog_order', 'search_products', 'check_stock'];

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
        expect(request.reply).toMatch(/¿Confirma que desea ANULAR su pedido/);
        expect(request.reply).toContain('El pedido no se entregará y no es un pago.');
        const yes = await h.turn('sí, cancélalo');
        expect(h.succeeded('cancel_catalog_order')).toHaveLength(1);
        expect(yes.reply).toBe('Su pedido (Ref. C03EBDD7) quedó anulado.');
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

// ── Opus review of dc0337fc: the engine must not hijack normal conversation ─────────────────────────────────────────────────────────
describe('ordinary conversation is left to the model', () => {
    const two = [appointment(APPT, '2026-10-12', '09:00'), appointment(APPT2, '2026-10-13', '09:00')];
    it.each([
        'Por favor no cancelen mi cita, voy en camino', 'No voy a cancelar mi cita, llego 10 minutos tarde', 'Me cancelaron la cita del martes sin avisar',
        'Ya cancelé el pedido por Nequi', 'Quiero cancelar el pedido con tarjeta', 'Tengo una cita mañana, ¿dónde queda el local?',
        'No quiero reprogramar, solo confirmar que voy', 'Me cambiaron la cita y nadie me avisó',
        '¿A qué hora abren mañana? Y quiero cancelar mi cita del viernes',
    ])('"%s": no record is read, no writer is called', async text => {
        const h = world({ tools: [...SALON, ...STORE], industry: 'salon', appointments: two, orders: [order] });
        await h.turn('hola');
        await h.turn(text);
        expect(h.calls.map(call => call.name).filter(name => /^(?:list_customer_appointments|list_my_catalog_orders|cancel_|reschedule_|check_availability)/.test(name))).toEqual([]);
    });

    it('the «¿cuál?» question is answered by the very next message only: greetings, thanks and questions drop it', async () => {
        for (const text of ['Hola, buenos días', 'gracias', '¿Cuánto cuesta la limpieza?', '¿el martes abren?']) {
            const h = world({ tools: SALON, industry: 'salon', appointments: two });
            await h.turn('hola');
            const ask = await h.turn('quiero cancelar mi cita');
            expect(ask.reply).toMatch(/¿Cuál desea cancelar\?/);
            await h.turn(text);
            await h.turn('la del martes'); // the question lapsed with the unrelated message: this is not an answer any more
            expect(h.ran('cancel_appointment')).toHaveLength(0);
        }
    });

    it('a pending proposal to CREATE an order: «no, cancélalo» / «mejor cancela el pedido» never propose cancelling an earlier order', async () => {
        for (const text of ['no, cancélalo', 'mejor cancela el pedido', 'cancélalo']) {
            const h = world({
                tools: STORE, industry: 'retail', orders: [order],
                script: request => {
                    const last = String((request.messages ?? []).slice(-1)[0]?.content ?? '');
                    if (request.task === 'tool_calling' && /quiero comprar/.test(last)) {
                        return { content: '', toolCalls: [{ id: 'c1', function: { name: 'place_catalog_order', arguments: JSON.stringify({ items: [{ productId: 'p1', quantity: 1 }] }) } }], model: 'test', usage: { promptTokens: 1, completionTokens: 1 }, cost: 0 };
                    }
                    if (JSON.stringify(request.messages ?? []).includes('confirmation_required')) return answer('Su pedido está listo para su confirmación. ¿Lo confirmo?');
                    return undefined;
                },
            });
            await h.turn('hola');
            const proposal = await h.turn('quiero comprar el audífono');
            expect(h.ran('place_catalog_order').map(call => call.result.error)).toEqual(['confirmation_required']);
            expect(proposal.reply).toContain('¿Lo confirmo?');
            await h.turn(text);
            expect(h.ran('cancel_catalog_order')).toHaveLength(0);
            expect(h.ran('list_my_catalog_orders')).toHaveLength(0);
        }
    });

    it('the only appointment contradicts the words («la del martes», it is a Thursday): the server shows it and asks, it does not propose', async () => {
        const h = world({ tools: SALON, industry: 'salon', appointments: [appointment(APPT, '2026-10-15', '09:00')] });
        await h.turn('hola');
        const reply = await h.turn('quiero cancelar la cita del martes');
        expect(h.ran('cancel_appointment')).toHaveLength(0);
        expect(reply.reply).toContain('No encuentro una cita con ese día u hora');
        expect(reply.reply).toContain('AE3D0C86');
        const yes = await h.turn('la del jueves');
        expect(h.ran('cancel_appointment')[0].args).toEqual({ appointmentId: APPT });
        expect(yes.reply).toContain('¿Confirma que desea cancelar');
    });
});

describe('a reschedule is never proposed unverified', () => {
    const base = [appointment(APPT, '2026-10-12', '09:00')];
    it.each([
        ['the agenda errors', { appointments: base, slots: 'error' as const }],
        ['the appointment has no service to check', { appointments: [{ ...base[0], serviceId: undefined }] }],
    ])('%s: nothing is proposed, the model\'s own flow takes over', async (_label, options) => {
        const h = world({ tools: SALON, industry: 'salon', ...options });
        await h.turn('hola');
        const result = await h.turn('quiero reprogramar mi cita al día siguiente a la misma hora');
        expect(h.ran('reschedule_appointment')).toHaveLength(0);
        expect(result.reply).not.toContain('¿Confirma que movamos');
    });
    it('a date that already passed is asked again, not checked or proposed', async () => {
        const h = world({ tools: SALON, industry: 'salon', appointments: [appointment(APPT, '2020-01-01', '09:00')] });
        await h.turn('hola');
        const result = await h.turn('quiero reprogramar mi cita al día siguiente a la misma hora');
        expect(result.reply).toContain('Esa fecha ya pasó');
        expect(h.ran('reschedule_appointment')).toHaveLength(0);
        expect(h.ran('check_availability')).toHaveLength(0);
    });
});

// ── Re-review of PR #76 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe('a pending proposal and the questions the engine asks', () => {
    const two = [appointment(APPT, '2026-10-12', '09:00'), appointment(APPT2, '2026-10-13', '09:00')];
    it('with two appointments and a proposal for one, «cancélala por favor» does not re-ask «¿cuál?»: the proposal stands and the next «sí» executes it', async () => {
        const h = world({ tools: SALON, industry: 'salon', appointments: two });
        await h.turn('hola');
        await h.turn('quiero cancelar mi cita');
        const proposal = await h.turn('la del lunes');
        expect(h.ran('cancel_appointment').map(call => call.args.appointmentId)).toEqual([APPT]);
        expect(proposal.reply).toContain('¿Confirma que desea cancelar');
        const bare = await h.turn('cancélala por favor');
        expect(bare.reply).not.toMatch(/¿Cuál desea cancelar\?/);
        expect(h.ran('cancel_appointment')).toHaveLength(1);
        await h.turn('sí, cancélala');
        expect(h.succeeded('cancel_appointment').map(call => call.args.appointmentId)).toEqual([APPT]);
    });

    it('«quiero cancelar» in a business with only orders asks «¿Se trata de su pedido?» and a bare «sí» is the request', async () => {
        const h = world({ tools: STORE, industry: 'retail', orders: [order] });
        await h.turn('hola');
        const ask = await h.turn('quiero cancelar');
        expect(ask.reply).toContain('¿Se trata de su pedido?');
        const yes = await h.turn('sí');
        expect(h.ran('cancel_catalog_order').map(call => call.args)).toEqual([{ orderId: ORDER }]);
        expect(yes.reply).toMatch(/¿Confirma que desea ANULAR su pedido/);
    });

    it('«¿Es esa la que desea?» (the words contradicted the only appointment) takes a bare «sí» as the choice', async () => {
        const h = world({ tools: SALON, industry: 'salon', appointments: [appointment(APPT, '2026-10-15', '09:00')] });
        await h.turn('hola');
        const ask = await h.turn('quiero cancelar la cita del martes');
        expect(ask.reply).toContain('¿Es esa la que desea?');
        const yes = await h.turn('sí');
        expect(h.ran('cancel_appointment').map(call => call.args)).toEqual([{ appointmentId: APPT }]);
        expect(yes.reply).toContain('¿Confirma que desea cancelar');
    });

    it('a question and a request in one message go to the model: nothing is read, nothing is proposed', async () => {
        const h = world({ tools: SALON, industry: 'salon', appointments: two });
        await h.turn('hola');
        await h.turn('¿A qué hora abren mañana? Y quiero cancelar mi cita del viernes');
        expect(h.ran('cancel_appointment')).toHaveLength(0);
        expect(h.ran('list_customer_appointments')).toHaveLength(0);
    });
});

// ── Opus final check of 53dc0343 ─────────────────────────────────────────────────────────────────────────────────────────────────────
describe('a pending proposal and a change of mind about the ACTION', () => {
    it.each(['no, mejor reprográmala para el viernes', 'mejor muévela al viernes', 'no la canceles, pásala al viernes'])(
        'a pending cancellation + "%s": never a cancel proposal; the server moves it or asks which', async text => {
            const h = world({ tools: SALON, industry: 'salon', appointments: [appointment(APPT, '2026-10-12', '09:00'), appointment(APPT2, '2026-10-16', '09:00')], slots: ['09:00', '10:00'] });
            await h.turn('hola');
            await h.turn('quiero cancelar mi cita');
            await h.turn('la del lunes');
            expect(h.ran('cancel_appointment').map(call => call.args.appointmentId)).toEqual([APPT]);
            const result = await h.turn(text);
            expect(h.ran('cancel_appointment')).toHaveLength(1);
            // two appointments: the Friday in the words is where it goes, so the server asks WHICH one to move
            expect(h.ran('reschedule_appointment')).toHaveLength(0);
            expect(result.reply).toMatch(/¿Cuál desea mover\?/);
            expect(result.reply).not.toMatch(/desea cancelar/);
        });

    it('with one appointment it proposes the move, and the «sí» executes the move, not the cancellation', async () => {
        const h = world({ tools: SALON, industry: 'salon', appointments: [appointment(APPT, '2026-10-12', '09:00')], slots: ['09:00', '10:00'] });
        await h.turn('hola');
        await h.turn('quiero cancelar mi cita');
        const pivot = await h.turn('quiero reprogramar mi cita al día siguiente a la misma hora');
        expect(h.ran('cancel_appointment')).toHaveLength(1);
        expect(h.ran('reschedule_appointment').map(call => call.args)).toEqual([{ appointmentId: APPT, newDate: '2026-10-13', newTime: '09:00' }]);
        expect(pivot.reply).toContain('¿Confirma que movamos');
        await h.turn('sí, reprográmala');
        expect(h.succeeded('reschedule_appointment')).toHaveLength(1);
        expect(h.succeeded('cancel_appointment')).toHaveLength(0);
    });

    it('a pending move + «mejor cancélela» becomes a cancel proposal', async () => {
        const h = world({ tools: SALON, industry: 'salon', appointments: [appointment(APPT, '2026-10-12', '09:00')], slots: ['09:00', '10:00'] });
        await h.turn('hola');
        await h.turn('quiero reprogramar mi cita al día siguiente a la misma hora');
        expect(h.ran('reschedule_appointment')).toHaveLength(1);
        const result = await h.turn('mejor cancélela');
        expect(h.ran('cancel_appointment').map(call => call.args)).toEqual([{ appointmentId: APPT }]);
        expect(result.reply).toContain('¿Confirma que desea cancelar');
        await h.turn('sí, cancélala');
        expect(h.succeeded('cancel_appointment')).toHaveLength(1);
        expect(h.succeeded('reschedule_appointment')).toHaveLength(0);
    });

    it('«el martes no» after «¿cuál?» is not the answer: nothing is proposed', async () => {
        const h = world({ tools: SALON, industry: 'salon', appointments: [appointment(APPT, '2026-10-12', '09:00'), appointment(APPT2, '2026-10-13', '09:00')] });
        await h.turn('hola');
        await h.turn('quiero cancelar mi cita');
        await h.turn('la del martes no');
        expect(h.ran('cancel_appointment')).toHaveLength(0);
    });
});
