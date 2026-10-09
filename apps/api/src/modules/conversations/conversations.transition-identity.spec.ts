import { pinClock } from './__fixtures__/pinned-clock';
import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
// The evaluation session blocks the identity tools (it never sends or accepts a real code); this spec exercises the production
// glue, whose executor is a double, so they are let through here.
jest.mock('./agent-test-tool-policy', () => {
    const actual = jest.requireActual('./agent-test-tool-policy');
    return { ...actual, isAgentTestSafeToolName: (name: unknown) => actual.isAgentTestSafeToolName(name) || name === 'request_identity_code' || name === 'verify_identity_code' };
});
import { randomUUID } from 'crypto';
import { classifyExplicitToolConfirmation } from './tool-execution-control.service';
import { ToolRetrievalService } from './tool-retrieval.service';

/**
 * The service-level glue of the transition engine around the REAL ConversationsService turn: the verification the server drives
 * where a code is required, the proposal that is shown again when the request is repeated, the report of a write that failed
 * after the yes, and the hygiene of a rewritten reply. The tool executor is a double that behaves like the guard (identity
 * errors, confirmation challenge); the guard itself is covered by tool-execution-control.appointment-identity.spec.ts and the N3
 * suites.
 *
 * The model in this file is the production model of 2026-10-09: it answers any turn it is asked to voice with a refusal. Whatever
 * works must come from the server.
 */
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const APPT = 'ae3d0c86-1111-4111-8111-111111111111';
const ORDER = 'c03ebdd7-226a-40b0-afc1-cba45b5a0073';
const REFUSAL = 'Por ahora no puedo completar la cancelación directamente; ¿le paso con alguien del equipo?';
const answer = (content: string) => ({ content, model: 'test', usage: { promptTokens: 1, completionTokens: 1 }, cost: 0 });
const appointment = { id: APPT, reference: 'AE3D0C86', serviceId: 'svc-1', staffId: 'staff-1', service: 'Consulta general', date: '2026-10-12', time: '09:00', status: 'confirmed' };
const order = { id: ORDER, version: 1, status: 'pending', paymentStatus: 'pending', totalAmount: 119900, currency: 'COP', items: [{ productName: 'Audífono QA Aurora', quantity: 1 }] };

interface Options {
    tools: string[]; industry: string;
    /** the business type needs a code to read appointments */ sensitive?: boolean;
    verified?: boolean; sent?: any; appointments?: any[]; orders?: any[];
    /** the confirmed writer fails */ failAfterYes?: boolean;
    /** the writer fails whenever it is called (the model's own attempt) */ failCancel?: boolean;
    model?: (request: any) => string; script?: (request: any) => any | undefined;
}

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
    const calls: Array<{ name: string; args: any; result: any; challenge?: string }> = [];
    let verified = options.verified !== false;
    let appointments = options.appointments ?? [appointment];
    let pending: { tool: string; args: any } | null = null;
    const done: Record<string, any> = {};
    f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string, args: any, _cid: string, opts: any) => {
        let result: any;
        const gated = options.sensitive === true && !verified;
        if (name === 'list_customer_appointments') result = gated ? { error: 'identity_verification_required', needsVerification: true, challengeSent: false } : { appointments };
        else if (name === 'list_my_catalog_orders') result = { success: true, orders: options.orders ?? [] };
        else if (name === 'request_identity_code') result = options.sent ?? { sent: true, via: 'email', sentTo: 'j***@example.com' };
        else if (name === 'verify_identity_code') {
            if (args.code === '123456') { verified = true; result = { verified: true }; } else result = { verified: false, reason: 'wrong' };
        } else if (name === 'check_availability') result = { available: true, slots: [{ time: '11:00' }] };
        else if (options.failCancel && name === 'cancel_appointment') result = { error: 'tool_failed', message: 'No se pudo ejecutar esta acción.' };
        else if (['cancel_appointment', 'reschedule_appointment', 'cancel_catalog_order'].includes(name)) {
            if (gated) result = { error: 'identity_verification_required', needsVerification: true };
            else if (pending && pending.tool === name && JSON.stringify(pending.args) === JSON.stringify(args) && done[name] === 'confirmed') {
                result = options.failAfterYes ? { error: 'tool_failed', message: 'No se pudo completar.' }
                    : name === 'cancel_catalog_order' ? { success: true, order: { id: args.orderId, status: 'cancelled' } } : { success: true, message: 'Appointment cancelled.', alternatives: [] };
            } else {
                pending = { tool: name, args };
                result = { error: 'confirmation_required', confirmationId: `conf-${name}`, message: 'Confirmación requerida' };
            }
        } else result = { items: [] };
        calls.push({ name, args, result, challenge: opts?.identityChallenge });
        return result;
    });
    f.toolExecutionControl.findPendingConfirmation.mockImplementation(async (_s: string, _c: string, _k: string, reply: string | undefined, scope: any) => {
        if (!pending) return null;
        if (reply === undefined) return { ledgerId: `conf-${pending.tool}`, toolName: pending.tool, args: pending.args };
        if (scope?.expectedReply?.kind !== 'confirmation') return null;
        if (classifyExplicitToolConfirmation(reply, { effect: 'transactional', pendingTool: pending.tool }) !== 'confirmed') return null;
        done[pending.tool] = 'confirmed';
        return { ledgerId: `conf-${pending.tool}`, toolName: pending.tool, args: pending.args };
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
    return { f, turn, ran, succeeded, voiced, calls, setAppointments: (rows: any[]) => { appointments = rows; }, lapse: () => { verified = false; } };
}

const CLINIC = ['list_services', 'check_availability', 'create_appointment', 'cancel_appointment', 'reschedule_appointment', 'list_customer_appointments', 'request_identity_code', 'verify_identity_code'];
const SALON = ['list_services', 'check_availability', 'create_appointment', 'cancel_appointment', 'reschedule_appointment', 'list_customer_appointments'];
const STORE = ['place_catalog_order', 'list_my_catalog_orders', 'get_catalog_order', 'cancel_catalog_order', 'search_products', 'check_stock'];
const VERIFY_NEEDED = 'Para ver o cambiar sus citas necesito verificar su identidad. Le envié un código a j***@example.com; escríbalo aquí para continuar.';


// The scenarios below are dated against a calendar and the turn reads the real clock: pinned, so they do not turn red the day
// they were written for goes by (see __fixtures__/pinned-clock.ts). Only Date is faked.
pinClock();
describe('a business type that needs a code: the server drives the verification and resumes the request', () => {
    it('«quiero cancelar mi cita» → the server asks for the code (once), keeps the request, verifies, proposes, and the «sí» cancels', async () => {
        const h = world({ tools: CLINIC, industry: 'salud', sensitive: true, verified: false });
        await h.turn('hola');
        const ask = await h.turn('quiero cancelar mi cita');
        expect(ask.debug.runtimeError).toBeUndefined();
        expect(ask.reply).toBe(VERIFY_NEEDED);
        expect(h.ran('request_identity_code')).toHaveLength(1);
        expect(h.ran('cancel_appointment')).toHaveLength(0);
        // the engine's reads never send a code by themselves
        expect(h.ran('list_customer_appointments').every(call => call.challenge === 'none')).toBe(true);

        // the request again: the code already sent is not sent again
        const again = await h.turn('quiero cancelar mi cita');
        expect(again.reply).toBe('Ya le envié un código de verificación a j***@example.com; escríbalo aquí para continuar.');
        expect(h.ran('request_identity_code')).toHaveLength(1);

        const wrong = await h.turn('654321');
        expect(wrong.reply).toBe('Ese código no coincide. Revíselo y escríbalo de nuevo.');
        expect(h.ran('cancel_appointment')).toHaveLength(0);

        const proposal = await h.turn('123456');
        expect(proposal.reply).toContain('¿Confirma que desea cancelar su cita de Consulta general');
        expect(proposal.reply).toContain('(Ref. AE3D0C86)');
        expect(h.ran('cancel_appointment').map(call => call.result.error)).toEqual(['confirmation_required']);
        expect(h.ran('request_identity_code')).toHaveLength(1);

        const yes = await h.turn('sí, cancélala');
        expect(yes.reply).toBe('Su cita (Ref. AE3D0C86) quedó cancelada.');
        expect(h.succeeded('cancel_appointment')).toHaveLength(1);
    });

    it('the verification lapses between the proposal and the «sí»: the code is asked for again with server text, nothing is cancelled', async () => {
        const h = world({ tools: CLINIC, industry: 'salud', sensitive: true, verified: false });
        await h.turn('hola');
        await h.turn('quiero cancelar mi cita');
        await h.turn('123456');
        h.lapse();
        const yes = await h.turn('sí, cancélala');
        expect(yes.reply).toBe(VERIFY_NEEDED);
        expect(h.succeeded('cancel_appointment')).toHaveLength(0);
        expect(h.ran('request_identity_code')).toHaveLength(2);
    });

    it('a salon: the same request needs no code at all (no request_identity_code, the proposal comes at once)', async () => {
        const h = world({ tools: SALON, industry: 'moda_belleza', sensitive: false, verified: false });
        await h.turn('hola');
        const request = await h.turn('quiero cancelar mi cita');
        expect(request.reply).toContain('¿Confirma que desea cancelar su cita de Consulta general');
        expect(h.ran('request_identity_code')).toHaveLength(0);
        expect(h.ran('verify_identity_code')).toHaveLength(0);
        const yes = await h.turn('sí, cancélala');
        expect(yes.reply).toBe('Su cita (Ref. AE3D0C86) quedó cancelada.');
    });

    it('«¿qué citas tengo?» in a sensitive business is also answered by the server, with the code first', async () => {
        const h = world({ tools: CLINIC, industry: 'salud', sensitive: true, verified: false });
        await h.turn('hola');
        expect((await h.turn('¿qué citas tengo?')).reply).toBe(VERIFY_NEEDED);
        const list = await h.turn('123456');
        expect(list.reply).toContain('Usted tiene una cita');
        expect(list.reply).toContain('AE3D0C86');
    });

    it('no code can be issued (locked, no channel): a person is OFFERED, never opened, and the model is not asked', async () => {
        const h = world({ tools: CLINIC, industry: 'salud', sensitive: true, verified: false, sent: { error: 'identity_locked', shouldHandoff: true } });
        await h.turn('hola');
        const reply = await h.turn('quiero cancelar mi cita');
        expect(reply.reply).toContain('Por seguridad no puedo verificar su identidad');
        expect(reply.reply).toMatch(/¿Desea que le pida a una persona del equipo que se encargue de su caso\?$/);
        expect(h.ran('cancel_appointment')).toHaveLength(0);
    });

    it('a message that is not the code ends the wait: the turn goes on as a normal one', async () => {
        const h = world({ tools: CLINIC, industry: 'salud', sensitive: true, verified: false, model: () => 'Abrimos a las 9.' });
        await h.turn('hola');
        await h.turn('quiero cancelar mi cita');
        const other = await h.turn('¿a qué hora abren mañana?');
        expect(other.reply).toBe('Abrimos a las 9.');
        expect(h.ran('verify_identity_code')).toHaveLength(0);
        expect(h.ran('request_identity_code')).toHaveLength(1);
    });
});

describe('repeating the request over a pending proposal', () => {
    it('order: «quiero cancelar mi pedido» twice → the same proposal both times, then «sí» annuls it (no «No he podido completar»)', async () => {
        const h = world({ tools: STORE, industry: 'retail', orders: [order] });
        await h.turn('hola');
        const first = await h.turn('quiero cancelar mi pedido');
        expect(first.reply).toContain('¿Confirma que desea ANULAR su pedido (Ref. C03EBDD7)');
        const again = await h.turn('quiero cancelar mi pedido');
        expect(again.reply).toBe(first.reply);
        expect(h.ran('cancel_catalog_order')).toHaveLength(1);
        const yes = await h.turn('sí, cancélalo');
        expect(yes.reply).toBe('Su pedido (Ref. C03EBDD7) quedó anulado.');
        expect(yes.reply).not.toMatch(/No he podido completar/);
        expect(h.succeeded('cancel_catalog_order')).toHaveLength(1);
    });

    it('appointment: the same three transitions', async () => {
        const h = world({ tools: SALON, industry: 'moda_belleza' });
        await h.turn('hola');
        const first = await h.turn('quiero cancelar mi cita');
        const again = await h.turn('quiero cancelar mi cita');
        expect(again.reply).toBe(first.reply);
        expect(h.ran('cancel_appointment')).toHaveLength(1);
        const yes = await h.turn('sí, cancélala');
        expect(yes.reply).toBe('Su cita (Ref. AE3D0C86) quedó cancelada.');
    });
});

describe('«¿qué pedidos tengo?» and the status of an order are the server\'s, with the reference', () => {
    it('lists every order with its status and short reference; nothing is left to the model', async () => {
        const h = world({ tools: STORE, industry: 'retail', orders: [order, { ...order, id: 'd1d0d14a-2222-4222-8222-222222222222', status: 'cancelled' }],
            model: () => 'El otro es un Audífono QA Aurora, cuyo estado es cancelado' });
        await h.turn('hola');
        const list = await h.turn('¿qué pedidos tengo?');
        expect(list.reply).toBe('Usted tiene 2 pedidos:\n- Audífono QA Aurora (119.900 COP) — pendiente (Ref. C03EBDD7)\n- Audífono QA Aurora (119.900 COP) — anulado (Ref. D1D0D14A)\nSi desea anular alguno, indíqueme la referencia.');
    });
});

describe('after the yes the write fails: the reply is what the records say now', () => {
    it('the appointment is still there → «sigue programada» (verified by a re-read) and a person is offered', async () => {
        const h = world({ tools: SALON, industry: 'moda_belleza', failAfterYes: true });
        await h.turn('hola');
        await h.turn('quiero cancelar mi cita');
        const failed = await h.turn('sí, cancélala');
        expect(h.ran('cancel_appointment').map(call => call.result.error)).toEqual(['confirmation_required', 'tool_failed']);
        expect(failed.reply).toContain('No pude cancelar su cita de Consulta general (Ref. AE3D0C86): sigue programada para el lunes 12 de octubre a las 09:00.');
        expect(failed.reply).toMatch(/¿Desea que le pida a una persona del equipo que se encargue de su caso\?$/);
    });

    it('the appointment is gone → it is NOT described as «sigue tal como está»', async () => {
        const h = world({ tools: SALON, industry: 'moda_belleza', failAfterYes: true, model: () => 'Su cita sigue tal como está.' });
        await h.turn('hola');
        await h.turn('quiero cancelar mi cita');
        h.setAppointments([]);
        const failed = await h.turn('sí, cancélala');
        expect(failed.reply).toContain('ya no aparece entre sus citas próximas, pero no pude confirmar que el cambio se hiciera');
        expect(failed.reply).not.toMatch(/sigue tal como está/);
    });
});

describe('a write the MODEL ran and that failed: the reply is what the records say, not what the model assumes', () => {
    const toolCall = (name: string, args: any) => ({ content: '', toolCalls: [{ id: 'c1', function: { name, arguments: JSON.stringify(args) } }], model: 'test', usage: { promptTokens: 1, completionTokens: 1 }, cost: 0 });

    it('the cancellation failed and the model says «sigue tal como está»: the appointment is read again and described as it is', async () => {
        const h = world({
            tools: SALON, industry: 'moda_belleza', failCancel: true,
            script: request => {
                const last = String((request.messages ?? []).slice(-1)[0]?.content ?? '');
                if (request.task === 'tool_calling' && /quítala/.test(last)) return toolCall('cancel_appointment', { appointmentId: APPT });
                if (JSON.stringify(request.messages ?? []).includes('tool_failed')) return answer('Su cita sigue tal como está.');
                return undefined;
            },
        });
        await h.turn('hola');
        const reply = await h.turn('la cita de las 9, por favor quítala');
        expect(h.ran('cancel_appointment').map(call => call.result.error)).toEqual(['tool_failed']);
        expect(reply.reply).toContain('No pude cancelar su cita de Consulta general (Ref. AE3D0C86): sigue programada para el lunes 12 de octubre a las 09:00.');
        expect(reply.reply).not.toMatch(/sigue tal como está/);
    });

    it('and when the appointment is gone from the list it is not claimed to be unchanged', async () => {
        const h = world({
            tools: SALON, industry: 'moda_belleza', failCancel: true, appointments: [],
            script: request => {
                const last = String((request.messages ?? []).slice(-1)[0]?.content ?? '');
                if (request.task === 'tool_calling' && /quítala/.test(last)) return toolCall('cancel_appointment', { appointmentId: APPT });
                if (JSON.stringify(request.messages ?? []).includes('tool_failed')) return answer('Su cita sigue tal como está.');
                return undefined;
            },
        });
        await h.turn('hola');
        const reply = await h.turn('la cita de las 9, por favor quítala');
        expect(reply.reply).toContain('ya no aparece entre sus citas próximas');
        expect(reply.reply).not.toMatch(/sigue tal como está/);
    });
});

describe('a corrective rewrite never reaches the customer with its own commentary', () => {
    it('the quoted message followed by an English comment is sent as the message only', async () => {
        const h = world({
            tools: STORE, industry: 'retail',
            model: () => 'Su pedido quedó cancelado.',
            script: request => /afirmó que una reserva/.test(String((request.messages ?? []).slice(-1)[0]?.content ?? ''))
                ? answer('"Para cancelar su pedido necesito su confirmación: ¿desea anular el pedido C03EBDD7?"\n\nThis seems to address the concern about claiming an action. It reports the *')
                : undefined,
        });
        await h.turn('hola');
        const reply = await h.turn('mi pedido?');
        expect(reply.reply).toBe('Para cancelar su pedido necesito su confirmación: ¿desea anular el pedido C03EBDD7?');
        expect(reply.reply).not.toMatch(/This seems|It reports/);
    });

    it('a rewrite that is in English altogether is replaced by the fixed text', async () => {
        const h = world({
            tools: STORE, industry: 'retail',
            model: () => 'Su pedido quedó cancelado.',
            script: request => /afirmó que una reserva/.test(String((request.messages ?? []).slice(-1)[0]?.content ?? ''))
                ? answer('Your order is waiting for your confirmation, please tell us whether you want to cancel it and we will do it for you.')
                : undefined,
        });
        await h.turn('hola');
        const reply = await h.turn('mi pedido?');
        expect(reply.reply).not.toMatch(/Your order/);
        expect(reply.reply).toMatch(/[áéíóúñ¿]| el | la | su /i);
    });
});
