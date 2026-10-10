import { pinClock } from './__fixtures__/pinned-clock';
import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import { randomUUID } from 'crypto';
import { classifyExplicitToolConfirmation } from './tool-execution-control.service';
import { ToolRetrievalService } from './tool-retrieval.service';
import { missionToolAllowed } from './mission-focus';

/**
 * Live Telegram test on 4bf7c6da (PR #83), 2026-10-09 22:51-23:25 UTC.
 *
 * «Tienda QA Electrónica»: «Quiero pedir 1 Audífono QA Aurora» → data → «¿Confirma que desea realizar este pedido?» → «sí, confirmo
 * el pedido» → the same summary again, for every «sí» (with and without a shipping address), and no order was ever created. The
 * model summarised the order in prose and the «sí» found no proposal for the server to execute.
 * «Salón QA Citas»: «sí, agéndala» was answered «Entiendo que desea agendar la cita. ¿Para qué servicio…?» while the appointment
 * (Ref. 17F69A1B) existed, and «el 2», written after a list of times in prose, was read as 2:00 p.m.
 *
 * The central guard is reproduced with the rules that matter (production: tool-execution-control.service.ts):
 *   - a proposal is signed with the mission {id, revision} it was issued under;
 *   - the server-side «sí» (findPendingConfirmation) and the guard's own check both require the focus' expected reply to be bound to
 *     THAT ledger, the same mission and revision, and a reply that is not the proposal's own source message;
 *   - anything else is answered with a challenge (confirmation_required), never with the record.
 * The prose model in this file behaves like the production model of that round: it NEVER calls a writer on its own unless the spec
 * says so, and it answers any turn it is asked to voice in prose.
 */
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRODUCT = 'b1b48c4a-0000-4000-8000-000000000001';
const ORDER = 'c03ebdd7-226a-40b0-afc1-cba45b5a0073';
const APPOINTMENT = '17f69a1b-3333-4333-8333-333333333333';
const STORE = ['place_catalog_order', 'list_my_catalog_orders', 'get_catalog_order', 'cancel_catalog_order', 'search_products', 'check_stock'];
const SALON = ['list_services', 'check_availability', 'create_appointment', 'cancel_appointment', 'reschedule_appointment', 'list_customer_appointments', 'search_faqs'];
const answer = (content: string) => ({ content, model: 'test', usage: { promptTokens: 1, completionTokens: 1 }, cost: 0 });
const toolCall = (name: string, args: any) => ({ content: '', toolCalls: [{ id: 'c' + Math.random(), function: { name, arguments: JSON.stringify(args) } }], model: 'test', usage: { promptTokens: 1, completionTokens: 1 }, cost: 0 });
const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

interface Product { id: string; name: string; price: number; currency: string; stock: number | null; category: string }
const AURORA: Product = { id: PRODUCT, name: 'Audífono QA Aurora', price: 119900, currency: 'COP', stock: 2, category: 'Audio' };
const WRITERS = ['place_catalog_order', 'cancel_catalog_order', 'create_appointment'];

interface Ledger { id: string; tool: string; args: any; missionId: string; revision: number; source: string; status: 'awaiting' | 'done' }
interface Options {
    tools: string[]; industry: string; products?: Product[]; orders?: any[];
    /** What the model does with the turn: the production model of that round never calls a writer by itself. */
    writes?: (message: string) => { name: string; args: any } | null;
    voice?: (outcome: any) => string;
    prose?: (message: string) => string;
    /** The conversation so far is handed to the model on every turn (what a live conversation does). */
    history?: boolean;
    /** The tenant has spent its monthly LLM budget (the router is clamped to the cheap tiers). */
    overBudget?: boolean;
}

function world(options: Options) {
    const f = agentTurnFixture({ toolRetrieval: new ToolRetrievalService() });
    const products = options.products ?? [];
    const namespace = { schemaName: 'tenant_eval_11111111_aaaaaaaaaaaaaaaaaaaaaaaa', sourceSchema: 'tenant_test', tenantId: 'tenant',
        token: '11111111-1111-4111-8111-111111111111', expiresAt: new Date(Date.now() + 60_000).toISOString(), tables: [] };
    const conversationId = randomUUID();
    (f.service as any).namespaces = { assertOwned: jest.fn() };
    f.personaService.getAgent.mockResolvedValue({ version: 1, config_json: { language: 'es', industry: options.industry, tools: {}, rag: { enabled: false }, llm: {} } });
    f.verticalTurnContext.resolve.mockResolvedValue({ industry: options.industry, subType: 'general' });
    publishTools(f, options.tools);
    if (options.overBudget) {
        f.throttle.getPlanFeatures.mockResolvedValue({ llmTier: 'tier_2', llmCostBudgetUsdCents: 100 });
        f.throttle.getLlmSpendUsdCents.mockResolvedValue(500);
    }
    // The tenant's own catalogue, as `loadOwnCatalogForTurn` reads it.
    const readRows = f.prisma.executeInTenantSchema.getMockImplementation()!;
    f.prisma.executeInTenantSchema.mockImplementation(async (schema: string, sql: string, params?: any[]) => {
        if (/FROM products/.test(sql)) {
            const said = fold(String(params?.[0] ?? ''));
            return products.map(p => ({ id: p.id, name: p.name, price: p.price, currency: p.currency, stock: p.stock, category: p.category,
                mentioned: said.includes(fold(p.name)), total: products.length }));
        }
        return (readRows as any)(schema, sql, params);
    });

    const calls: Array<{ name: string; args: any; result: any }> = [];
    const ledgers: Ledger[] = [];
    let latestText = '';
    const executed: Array<{ name: string; args: any; result: any }> = [];
    const key = (a: any) => JSON.stringify(a);
    const termsOf = (args: any) => {
        const items = (args.items ?? []).map((item: any) => {
            const p = products.find(candidate => candidate.id === item.productId)!;
            return { productId: p.id, productName: p.name, quantity: item.quantity, unitAmountCents: String(p.price * 100),
                totalAmountCents: String(p.price * item.quantity * 100), tracksStock: p.stock !== null };
        });
        const total = items.reduce((sum: number, item: any) => sum + Number(item.totalAmountCents), 0);
        return { version: 1, action: 'create', currency: products[0]?.currency ?? 'COP', totalAmountCents: String(total), items, notes: String(args.notes ?? '').trim() };
    };
    const successOf = (name: string, args: any) => name === 'place_catalog_order'
        ? { success: true, order: { id: ORDER, status: 'pending', paymentStatus: 'pending', currency: 'COP', totalAmount: termsOf(args).items.reduce((s: number, i: any) => s + Number(i.totalAmountCents), 0) / 100,
            items: termsOf(args).items.map((i: any) => ({ productId: i.productId, productName: i.productName, quantity: i.quantity })) } }
        : name === 'create_appointment'
            ? { success: true, appointment: { id: APPOINTMENT, service: 'Corte y estilo', date: args.date, time: args.time, status: 'confirmed', customerName: args.customerName } }
            : { success: true, order: { id: args.orderId, status: 'cancelled' } };

    f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string, args: any, _cid: string, opts: any) => {
        let result: any;
        const scope = opts?.missionScope;
        if (name === 'list_my_catalog_orders') result = { success: true, orders: options.orders ?? [] };
        else if (name === 'list_customer_appointments') result = { appointments: [] };
        else if (WRITERS.includes(name)) {
            if (scope && !missionToolAllowed(scope, name)) {
                result = { error: 'mission_selection_required', controlBlocked: true, persisted: false };
            } else {
                const ledger = ledgers.find(l => l.status === 'awaiting' && l.tool === name && key(l.args) === key(args));
                const challenge = (existing?: Ledger) => {
                    const l = existing ?? { id: randomUUID(), tool: name, args, missionId: '', revision: 0, source: '', status: 'awaiting' as const };
                    l.missionId = scope?.missionId; l.revision = scope?.revision; l.source = scope?.inboundMessageId;
                    if (!existing) ledgers.push(l);
                    return { error: 'confirmation_required', confirmationId: l.id, message: 'Confirmación requerida',
                        ...(name === 'place_catalog_order' ? { catalogTerms: termsOf(args) } : {}) };
                };
                if (!ledger) result = challenge();
                else {
                    const expected = scope?.expectedReply;
                    const answers = !!scope && ledger.missionId === scope.missionId && ledger.revision === scope.revision
                        && expected?.kind === 'confirmation' && expected.missionId === scope.missionId && expected.ledgerId === ledger.id
                        && expected.sourceMessageId !== scope.inboundMessageId && ledger.source !== scope.inboundMessageId;
                    if (answers && classifyExplicitToolConfirmation(latestText, { effect: 'transactional', pendingTool: name }) === 'confirmed') {
                        ledger.status = 'done';
                        result = successOf(name, args);
                        executed.push({ name, args, result });
                    } else result = challenge(ledger);
                }
            }
        } else result = { items: [] };
        calls.push({ name, args, result });
        return result;
    });
    f.toolExecutionControl.findPendingConfirmation.mockImplementation(async (_s: string, _c: string, _k: string, reply: string | undefined, scope: any) => {
        const bound = scope?.expectedReply?.kind === 'confirmation' ? scope.expectedReply.ledgerId : undefined;
        const row = ledgers.filter(l => l.status === 'awaiting' && (!bound || l.id === bound)).slice(-1)[0];
        if (!row) return null;
        if (reply !== undefined) {
            if (!scope || row.missionId !== scope.missionId || row.revision !== scope.revision || scope.expectedReply?.kind !== 'confirmation'
                || scope.expectedReply.ledgerId !== row.id || scope.expectedReply.missionId !== scope.missionId) return null;
            if (classifyExplicitToolConfirmation(reply, { effect: 'transactional', pendingTool: row.tool }) !== 'confirmed') return null;
        }
        return { ledgerId: row.id, toolName: row.tool, args: row.args };
    });

    const modelSaw: string[] = [];
    const routed: Array<{ task: string; allowedTiers: string[]; budgetConstrained: boolean }> = [];
    f.llmRouter.execute.mockImplementation(async (request: any) => {
        if (!['conversation', 'tool_calling'].includes(request.task)) return answer('{}');
        routed.push({ task: request.task, allowedTiers: request.allowedTiers, budgetConstrained: request.budgetConstrained === true });
        const last = String((request.messages ?? []).slice(-1)[0]?.content ?? '');
        const thread = JSON.stringify(request.messages ?? []);
        if (thread.includes('confirmation_required') || thread.includes('"success":true')) {
            const lastCall = calls[calls.length - 1];
            return answer(options.voice?.(lastCall) ?? (lastCall?.result?.success === true ? '¡Listo! Todo quedó registrado.'
                : 'Para confirmar su pedido, estos son los detalles: 1 Audífono QA Aurora. ¿Confirma que desea realizar este pedido?'));
        }
        modelSaw.push(last);
        const write = options.writes?.(last);
        if (write) return toolCall(write.name, write.args);
        return answer(options.prose?.(last) ?? 'Entiendo que desea hacer el pedido. ¿Confirma que desea realizar este pedido?');
    });
    let id: string | undefined;
    const thread: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    const turn = async (message: string) => {
        latestText = message;
        const result = await f.service.test('tenant', AGENT, { message, channelType: 'telegram', runtimeSessionId: id,
            ...(options.history ? { conversationHistory: thread.map(row => ({ ...row })) } : {}) }, {
            evalMode: true, sandboxContactId: '00000000-0000-4000-8000-00000000eba1', sandboxConversationId: conversationId,
            sandboxNamespace: namespace, sandboxInboundMessageId: randomUUID(),
        });
        id = result.debug.runtimeSessionId;
        thread.push({ role: 'user', content: message }, { role: 'assistant', content: result.reply });
        return result;
    };
    const ran = (name: string) => calls.filter(call => call.name === name);
    return { f, turn, ran, calls, executed, modelSaw, routed, get created() { return executed.filter(call => call.name === 'place_catalog_order').length; } };
}

pinClock();

const DATA = '1 unidad, a nombre de Joaquin Sosa, correo qa.cliente@example.com, sin envío por ahora';
const store = (extra: Partial<Options> = {}) => world({ tools: STORE, industry: 'retail', products: [AURORA], ...extra });

describe('an order is placed even when the model only ever asks in prose (production 2026-10-09, Tienda QA Electrónica)', () => {
    it('the live sequence: request → data → «sí, confirmo el pedido» creates the order, and the reply is the record', async () => {
        const h = store();
        await h.turn('Prueba QA marcador 1');
        const request = await h.turn('Quiero pedir 1 Audífono QA Aurora');
        // The server proposed: the writer was called with the product of the catalogue and the quantity of the words.
        expect(h.ran('place_catalog_order').map(call => call.result.error)).toEqual(['confirmation_required']);
        expect(h.ran('place_catalog_order')[0].args).toEqual({ items: [{ productId: PRODUCT, quantity: 1 }] });
        expect(request.reply).toContain('1 × Audífono QA Aurora');
        expect(request.reply).toContain('119.900 COP');
        expect(request.reply).toContain('¿Confirma que desea realizar este pedido?');

        await h.turn('Prueba QA marcador 2');
        const data = await h.turn(DATA);
        // The delivery the customer gave belongs to THAT order: the proposal is made again with it in the notes.
        expect(h.ran('place_catalog_order')[1].args).toEqual({ items: [{ productId: PRODUCT, quantity: 1 }], notes: DATA });
        expect(data.reply).toContain('Notas: ' + DATA);
        expect(data.reply).toContain('¿Confirma que desea realizar este pedido?');

        await h.turn('Prueba QA marcador 3');
        const yes = await h.turn('sí, confirmo el pedido');
        expect(h.created).toBe(1);
        expect(h.executed[0].args.notes).toBe(DATA);
        expect(yes.reply).toContain('Ref. C03EBDD7');
        expect(yes.reply).toContain('1 × Audífono QA Aurora');
        expect(yes.reply).toContain('Total: 119.900 COP');
        expect(yes.reply).not.toContain('¿Confirma');
    });

    it.each(['sí', 'sí, confirmo', 'sí, proceda', 'sí, confirmo el pedido'])('«%s» to the proposal made by the server creates the order once', async yes => {
        const h = store();
        await h.turn('Quiero pedir 1 Audífono QA Aurora');
        await h.turn('Prueba QA marcador');
        const done = await h.turn(yes);
        expect(h.created).toBe(1);
        expect(done.reply).toContain('Ref. C03EBDD7');
        // A second «sí» finds nothing waiting: it never creates a second order.
        await h.turn(yes);
        expect(h.created).toBe(1);
    });

    it('with a shipping address: the address is in the notes of the order that is created', async () => {
        const h = store();
        await h.turn('Quiero pedir 1 Audífono QA Aurora');
        const withAddress = await h.turn('mejor enviar a Calle 123 #45-67, Bogotá (dirección de prueba)');
        expect(withAddress.reply).toContain('Calle 123 #45-67');
        await h.turn('sí, confirmo el pedido');
        expect(h.created).toBe(1);
        expect(h.executed[0].args.notes).toContain('Calle 123 #45-67');
    });

    it('the quantity is the one the words state; more than the stock is told by the server, with the stock', async () => {
        const two = store();
        const proposal = await two.turn('Quiero pedir 2 unidades de Audífono QA Aurora');
        expect(two.ran('place_catalog_order')[0].args.items).toEqual([{ productId: PRODUCT, quantity: 2 }]);
        expect(proposal.reply).toContain('2 × Audífono QA Aurora');
        expect(proposal.reply).toContain('239.800 COP');
        const short = store({ products: [{ ...AURORA, stock: 1 }] });
        const refusal = await short.turn('Quiero pedir 2 Audífono QA Aurora');
        expect(short.ran('place_catalog_order')).toHaveLength(0);
        expect(refusal.reply).toBe('Solo tengo 1 unidad de Audífono QA Aurora (pidió 2). ¿Desea esa cantidad?');
    });

    it.each([
        '¿Cuánto cuesta el Audífono QA Aurora?', 'Quiero información del Audífono QA Aurora', 'No quiero pedir el Audífono QA Aurora',
        'Quiero pedir una cotización del Audífono QA Aurora', 'Ya pedí el Audífono QA Aurora ayer', 'Quiero cancelar mi pedido del Audífono QA Aurora',
        'Quiero pedir un Cargador QA Nova', 'Quiero pedir ayuda', 'Quiero comprar',
    ])('«%s» is not an order: no writer is called', async text => {
        const h = store();
        await h.turn(text);
        expect(h.ran('place_catalog_order')).toHaveLength(0);
    });

    it('a «no» to the proposal creates nothing, and a «sí» after the proposal was left behind does not resurrect it', async () => {
        const h = store();
        await h.turn('Quiero pedir 1 Audífono QA Aurora');
        await h.turn('no, gracias, por ahora no quiero pedir');
        expect(h.created).toBe(0);
        await h.turn('¿cuántas unidades hay del Audífono QA Aurora?');
        await h.turn('sí');
        expect(h.created).toBe(0);
    });

    it('after a cancellation of an earlier order was carried out, the new order is proposed under a mission of its own', async () => {
        const h = store({ orders: [{ id: ORDER, version: 1, status: 'pending', paymentStatus: 'pending', totalAmount: 119900, currency: 'COP', items: [{ productName: 'Audífono QA Aurora', quantity: 1 }] }] });
        await h.turn('quiero cancelar mi pedido');
        await h.turn('sí, cancélalo');
        expect(h.executed.filter(call => call.name === 'cancel_catalog_order')).toHaveLength(1);
        await h.turn('¿qué pedidos tengo?');
        await h.turn('Quiero pedir 1 Audífono QA Aurora');
        await h.turn('sí, confirmo el pedido');
        expect(h.created).toBe(1);
    });

    it('the delivery in the order message itself is in the notes of the proposal and of the order', async () => {
        const h = store();
        const proposal = await h.turn('Quiero pedir 1 Audífono QA Aurora, envíelo a la Calle 5 #4-3');
        expect(h.ran('place_catalog_order')[0].args).toEqual({ items: [{ productId: PRODUCT, quantity: 1 }], notes: 'envíelo a la Calle 5 #4-3' });
        expect(proposal.reply).toContain('Notas: envíelo a la Calle 5 #4-3');
        await h.turn('sí');
        expect(h.executed[0].args.notes).toBe('envíelo a la Calle 5 #4-3');
    });

    it('a complaint that shares a verb and a product with an order is left to the model: no writer is called', async () => {
        const h = store();
        await h.turn('quiero pedir perdón, el Audífono QA Aurora llegó roto');
        expect(h.ran('place_catalog_order')).toHaveLength(0);
        expect(h.modelSaw.length).toBeGreaterThan(0);
    });

    it('a partial name that two products answer to is asked, and nothing is proposed', async () => {
        const pro: Product = { id: 'b1b48c4a-0000-4000-8000-000000000002', name: 'Audífono QA Aurora Pro', price: 229900, currency: 'COP', stock: 4, category: 'Audio' };
        const h = store({ products: [AURORA, pro] });
        const asked = await h.turn('quisiera comprar audífonos aurora');
        expect(h.ran('place_catalog_order')).toHaveLength(0);
        expect(asked.reply).toBe('Tengo más de un producto con ese nombre: Audífono QA Aurora o Audífono QA Aurora Pro. ¿Cuál desea?');
    });
});

describe('the model that does call the writer by itself keeps working', () => {
    const writes = (message: string) => /a nombre de|s[ií]\b|confirmo|proceda/i.test(message) && !/pedir|quiero/i.test(message)
        ? { name: 'place_catalog_order', args: { items: [{ productId: PRODUCT, quantity: 1 }], notes: 'Sin envío por ahora' } } : null;

    it.each(['sí, confirmo el pedido', 'sí, confirmo', 'sí', 'sí, proceda'])('«%s» after the model\'s own proposal creates the order', async yes => {
        const h = store({ writes, prose: () => 'El Audífono QA Aurora está disponible. ¿Me confirma la cantidad y si quiere envío?' });
        await h.turn('Prueba QA marcador');
        await h.turn('hola, ¿tienen audífonos?');
        const summary = await h.turn(DATA);
        expect(h.ran('place_catalog_order').map(call => call.result.error)).toEqual(['confirmation_required']);
        expect(summary.reply).toContain('¿Confirma que desea realizar este pedido?');
        await h.turn('Prueba QA marcador 2');
        const done = await h.turn(yes);
        expect(h.created).toBe(1);
        expect(done.reply).toContain('Ref. C03EBDD7');
    });

    it('the model rewording the notes at the «sí» does not make a second proposal: the server executes the one shown', async () => {
        let turns = 0;
        const h = store({
            writes: message => /a nombre de|s[ií]\b|confirmo/i.test(message) && !/pedir|quiero/i.test(message)
                ? { name: 'place_catalog_order', args: { items: [{ productId: PRODUCT, quantity: 1 }], notes: ++turns > 1 ? 'Sin envío' : 'Sin envío por ahora' } } : null,
            prose: () => 'Entendido.',
        });
        await h.turn('hola, ¿tienen audífonos?');
        await h.turn(DATA);
        await h.turn('sí, confirmo el pedido');
        expect(h.created).toBe(1);
    });
});

describe('the reply is what the record says (production 2026-10-09, Salón QA Citas, Ref. 17F69A1B)', () => {
    const book = { name: 'create_appointment', args: { serviceId: 'svc-1', date: '2026-10-12', time: '09:30', customerName: 'Joaquin Sosa' } };
    const WONT = 'Entiendo que desea agendar la cita. ¿Para qué servicio le gustaría reservar? Tenemos disponibles Corte y estilo (45 min).';

    it('«sí, agéndala» books it and the reply is the booking with its reference, not a question about the service', async () => {
        const h = world({
            tools: SALON, industry: 'salon',
            writes: message => /continúe|continue|reserva/i.test(message) ? book : null,
            voice: outcome => outcome?.result?.success === true
                ? WONT : 'Su cita de Corte y estilo para el lunes 12 de octubre a las 9:30 a.m. está lista para reservar con el precio pendiente. ¿Desea que proceda a finalizar la reserva?',
            prose: () => 'Para confirmar, desea agendar una cita de Corte y estilo el lunes 12 de octubre a las 9:30 a.m. ¿Desea que continúe con la reserva con el precio pendiente?',
        });
        await h.turn('me interesa corte y estilo el lunes 12 de octubre a las 9:30, a nombre de Joaquin Sosa');
        const proposal = await h.turn('sí, continúe con la reserva con el precio pendiente');
        expect(h.ran('create_appointment').map(call => call.result.error)).toEqual(['confirmation_required']);
        expect(proposal.reply).toContain('¿Desea que proceda a finalizar la reserva?');
        const yes = await h.turn('sí, agéndala');
        expect(h.executed.filter(call => call.name === 'create_appointment')).toHaveLength(1);
        expect(yes.reply).toBe('Su cita de Corte y estilo quedó confirmada para el lunes 12 de octubre a las 09:30. Ref. 17F69A1B.');
        expect(yes.reply).not.toMatch(/servicio le gustar/i);
    });
});

describe('«el 2» after a list of times written in prose is the second of them (production 2026-10-09, Salón QA Citas)', () => {
    const LIST = 'Para el lunes 19 de octubre, estos son los horarios disponibles para Corte y estilo: 9:00, 9:30, 10:00, 10:30, 11:00 y 11:30. ¿Cuál le gustaría reservar?';

    it('the model is shown the option, not a bare number', async () => {
        const h = world({ tools: SALON, industry: 'salon', history: true, prose: message => (/horarios/i.test(message) ? LIST : 'Entendido.') });
        await h.turn('¿qué horarios hay disponibles el lunes?');
        await h.turn('el 2');
        expect(h.modelSaw.slice(-1)[0]).toBe('9:30');
    });

    it.each([['el 1', '9:00'], ['la 3', '10:00'], ['opción 5', '11:00']])('«%s» is the option at that position', async (text, option) => {
        const h = world({ tools: SALON, industry: 'salon', history: true, prose: message => (/horarios/i.test(message) ? LIST : 'Entendido.') });
        await h.turn('¿qué horarios hay disponibles el lunes?');
        await h.turn(text);
        expect(h.modelSaw.slice(-1)[0]).toBe(option);
    });

    it('a number that is itself one of the times offered, or no list at all, is left as written', async () => {
        const hours = world({ tools: SALON, industry: 'salon', history: true, prose: message => (/horarios/i.test(message) ? LIST : 'Entendido.') });
        await hours.turn('¿qué horarios hay disponibles el lunes?');
        await hours.turn('el 10');
        expect(hours.modelSaw.slice(-1)[0]).toBe('el 10');
        const none = world({ tools: SALON, industry: 'salon', history: true, prose: () => 'Claro, ¿para qué hora?' });
        await none.turn('quiero ir el lunes');
        await none.turn('el 2');
        expect(none.modelSaw.slice(-1)[0]).toBe('el 2');
    });
});

describe('over the monthly LLM budget, a turn with a write in play keeps the tool-calling floor (production 2026-10-09)', () => {
    const toolTurn = (h: ReturnType<typeof world>) => h.routed.filter(call => call.task === 'tool_calling').slice(-1)[0];

    const CLAMPED = { task: 'tool_calling', allowedTiers: ['tier_3_efficient', 'tier_4_budget'], budgetConstrained: true };
    const FLOOR = { task: 'tool_calling', allowedTiers: ['tier_2_standard', 'tier_3_efficient', 'tier_4_budget'], budgetConstrained: false };
    const proposalWaiting = async (overBudget: boolean) => {
        const h = store({ overBudget, writes: message => (/a nombre de/i.test(message) ? { name: 'place_catalog_order', args: { items: [{ productId: PRODUCT, quantity: 1 }], notes: 'Sin envío' } } : null), prose: () => 'Entendido.' });
        await h.turn('hola');
        await h.turn(DATA);
        expect(h.ran('place_catalog_order').map(call => call.result.error)).toEqual(['confirmation_required']);
        return h;
    };

    it.each(['hola, buenas tardes', 'apartamento en Usaquén', 'qué marca tienen', 'ok gracias', 'sí', 'confirmo que llegué'])(
        '«%s» with nothing waiting stays clamped to the cheap tiers, the floor stays down', async text => {
            const h = store({ overBudget: true });
            await h.turn(text);
            expect(toolTurn(h)).toEqual(CLAMPED);
        });

    it('a proposal waiting for its yes keeps the tiers of the plan and the floor, whatever the next message says', async () => {
        const h = await proposalWaiting(true);
        await h.turn('dame un momento');
        expect(toolTurn(h)).toEqual(FLOOR);
    });

    it('the same message once nothing waits is clamped again', async () => {
        const h = store({ overBudget: true });
        await h.turn('dame un momento');
        expect(toolTurn(h)).toEqual(CLAMPED);
    });

    it('under budget nothing changes', async () => {
        const h = await proposalWaiting(false);
        await h.turn('dame un momento');
        expect(toolTurn(h)).toEqual(FLOOR);
    });
});
