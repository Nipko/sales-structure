import { pinClock } from './__fixtures__/pinned-clock';
import { PRODUCT, ORDER, STORE, SALON, AURORA, world, type Options, type Product } from './__fixtures__/live-world';

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
pinClock();

const DATA = '1 unidad, a nombre de Joaquin Sosa, correo qa.cliente@example.com, sin envío por ahora';
// «sin envío» is a pickup: the delivery is one canonical line at the end of the notes, and what else the customer said stays as written
const DATA_NOTES = '1 unidad, a nombre de Joaquin Sosa, correo qa.cliente@example.com. Recojo en tienda';
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
        expect(h.ran('place_catalog_order')[1].args).toEqual({ items: [{ productId: PRODUCT, quantity: 1 }], notes: DATA_NOTES });
        expect(data.reply).toContain('- Entrega: recojo en tienda');
        expect(data.reply).toContain('- Notas: 1 unidad, a nombre de Joaquin Sosa, correo qa.cliente@example.com');
        expect(data.reply).toContain('¿Confirma que desea realizar este pedido?');

        await h.turn('Prueba QA marcador 3');
        const yes = await h.turn('sí, confirmo el pedido');
        expect(h.created).toBe(1);
        expect(h.executed[0].args.notes).toBe(DATA_NOTES);
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

    it('the delivery in the order message itself is the delivery of the proposal and of the order', async () => {
        const h = store();
        const proposal = await h.turn('Quiero pedir 1 Audífono QA Aurora, envíelo a la Calle 5 #4-3');
        expect(h.ran('place_catalog_order')[0].args).toEqual({ items: [{ productId: PRODUCT, quantity: 1 }], notes: 'Envío a: Calle 5 #4-3' });
        expect(proposal.reply).toContain('- Entrega: envío a Calle 5 #4-3');
        await h.turn('sí');
        expect(h.executed[0].args.notes).toBe('Envío a: Calle 5 #4-3');
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

    it.each(['hola, buenas tardes', 'apartamento en Usaquén', 'qué marca tienen', 'ok gracias', 'sí', 'confirmo que llegué', 'quiero cambiar de tema'])(
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
