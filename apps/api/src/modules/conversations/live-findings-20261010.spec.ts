import { pinClock } from './__fixtures__/pinned-clock';
import { PRODUCT, STORE, SALON, AURORA, world, type Options } from './__fixtures__/live-world';
import { createdDoneText, deliveryFrom, detectOrderIntake, isOrderDetails, mergeOrderNotes, orderProposalText, replyStillAsksConfirmation } from './order-intake';

/**
 * Live Telegram round after PR #84 (b0a2d79d), 2026-10-09/10: Tienda QA Electrónica and Salón QA Citas.
 *
 * 1. «sí, agéndala» was answered by «¿Me confirma si agendo la cita…?» and, right after, «¡Cita confirmada! … Ref. A72599D6». A turn is ONE
 *    message; when a booking / an order was created in it the customer reads one message that states the record. (The first message of
 *    that pair was, in all likelihood, the late answer to the QA marker the harness sends before each case, which the engine answers by
 *    re-asking the pending confirmation; the guard is hardened regardless: a reply that carries the reference and still asks to confirm
 *    is the same contradiction.)
 * 2. «Quiero comprar 1 Audífono QA Aurora, envíelo a la Calle 5 #4-3»: the address went to «Notas» and the proposal asked for it again.
 * 3. «quisiera comprar audífonos aurora»: plural / lower case / no «QA» in the middle (see also catalog-search-tolerant.spec.ts).
 */
pinClock();

const store = (extra: Partial<Options> = {}) => world({ tools: STORE, industry: 'retail', products: [AURORA], ...extra });

/** The server-side lookup of the pending «sí» misses (an expired row, another process): the model's own call is what executes. */
function modelExecutes(h: ReturnType<typeof world>) {
    const real = h.f.toolExecutionControl.findPendingConfirmation.getMockImplementation()!;
    let skip = false;
    h.f.toolExecutionControl.findPendingConfirmation.mockImplementation(async (...args: any[]) => (skip && args[3] !== undefined ? null : (real as any)(...args)));
    return { on: () => { skip = true; }, off: () => { skip = false; } };
}
/** The last thing the customer wrote (the model's second call of a turn sees the tool result instead). */
const said = { user: '' };
const saying = (message: string) => { if (!message.startsWith('{')) said.user = message; };
const outbound = (h: ReturnType<typeof world>, reply: string): string[] => (h.f.runtime as any).splitResponseIntoChunks(reply);

describe('1. a record created in the turn is told in ONE message that states it', () => {
    const book = { name: 'create_appointment', args: { serviceId: 'svc-1', date: '2026-10-12', time: '09:30', customerName: 'Joaquin Sosa' } };
    const DONE = 'Su cita de Corte y estilo quedó confirmada para el lunes 12 de octubre a las 09:30. Ref. 17F69A1B.';

    it('a booking the model creates after the yes: a reply with the reference that still asks «¿Me confirma si agendo…?» is replaced by the record', async () => {
        const h = world({
            tools: SALON, industry: 'salon',
            writes: message => { saying(message); return /agéndala|continúe/i.test(message) ? book : null; },
            // what the model says once its own call has succeeded (the tool result is in its thread) vs. before
            voice: () => 'Para confirmar, la cita de Corte y estilo el lunes 12 de octubre a las 9:30. ¿Desea que proceda?',
            prose: () => (/agéndala/i.test(said.user) ? '¡Cita confirmada! Ref. 17F69A1B. ¿Me confirma si agendo la cita de Corte y estilo el 2026-10-12 a las 09:30?' : 'Claro.'),
        });
        const gate = modelExecutes(h);
        await h.turn('me interesa corte y estilo el lunes 12 de octubre a las 9:30, a nombre de Joaquin Sosa');
        await h.turn('sí, continúe con la reserva con el precio pendiente');
        gate.on();
        const yes = await h.turn('sí, agéndala');
        expect(h.executed.filter(call => call.name === 'create_appointment')).toHaveLength(1);
        expect(yes.reply).toBe(DONE);
        expect(yes.reply).not.toContain('¿');
        expect(outbound(h, yes.reply)).toEqual([DONE]);
    });

    it('a booking the model creates and voices correctly (reference, nothing asked) is left as the model wrote it', async () => {
        const voiced = '¡Cita confirmada! Corte y estilo, el lunes 12 de octubre a las 9:30. Ref. 17F69A1B. ¿Algo más?';
        const h = world({
            tools: SALON, industry: 'salon',
            writes: message => { saying(message); return /agéndala|continúe/i.test(message) ? book : null; },
            voice: () => 'Para confirmar, ¿desea que proceda?',
            prose: () => (/agéndala/i.test(said.user) ? voiced : 'Claro.'),
        });
        const gate = modelExecutes(h);
        await h.turn('me interesa corte y estilo el lunes 12 de octubre a las 9:30, a nombre de Joaquin Sosa');
        await h.turn('sí, continúe con la reserva con el precio pendiente');
        gate.on();
        const yes = await h.turn('sí, agéndala');
        expect(yes.reply).toBe(voiced);
        expect(outbound(h, yes.reply)).toEqual([voiced]);
    });

    it('an order the model places after the yes: the reference AND «¿Confirma que desea realizar este pedido?» is replaced by the record', async () => {
        const h = store({
            writes: message => { saying(message); return /confirmo/i.test(message) ? { name: 'place_catalog_order', args: { items: [{ productId: PRODUCT, quantity: 1 }] } } : null; },
            voice: () => 'Confirme su pedido.',
            prose: () => (/confirmo/i.test(said.user) ? 'Su pedido (Ref. C03EBDD7) quedó registrado. ¿Confirma que desea realizar este pedido?' : 'Claro.'),
        });
        const gate = modelExecutes(h);
        await h.turn('Quiero pedir 1 Audífono QA Aurora');
        gate.on();
        const yes = await h.turn('sí, confirmo el pedido');
        expect(h.created).toBe(1);
        expect(yes.reply).toBe('Su pedido (Ref. C03EBDD7) quedó registrado:\n- 1 × Audífono QA Aurora\n- Total: 119.900 COP\nEstado: pendiente. Pago: pendiente. Entrega: por registrar.');
        expect(yes.reply).not.toContain('¿Confirma');
        expect(outbound(h, yes.reply)).toHaveLength(1);
    });

    it('a booking voiced with its reference and a follow-up about something else keeps the words of the model', async () => {
        const voiced = '¡Cita confirmada! Ref. 17F69A1B. ¿Desea que le agende otra para su hijo?';
        const h = world({
            tools: SALON, industry: 'salon',
            writes: message => { saying(message); return /agéndala|continúe/i.test(message) ? book : null; },
            voice: () => 'Para confirmar, ¿desea que proceda?',
            prose: () => (/agéndala/i.test(said.user) ? voiced : 'Claro.'),
        });
        const gate = modelExecutes(h);
        await h.turn('me interesa corte y estilo el lunes 12 de octubre a las 9:30, a nombre de Joaquin Sosa');
        await h.turn('sí, continúe con la reserva con el precio pendiente');
        gate.on();
        expect((await h.turn('sí, agéndala')).reply).toBe(voiced);
    });

    it('the server-side yes (the usual path) already answers once, with the record', async () => {
        const h = store();
        await h.turn('Quiero pedir 1 Audífono QA Aurora');
        const yes = await h.turn('sí, confirmo el pedido');
        expect(h.created).toBe(1);
        expect(yes.reply).toContain('Ref. C03EBDD7');
        expect(yes.reply).not.toContain('¿');
        expect(outbound(h, yes.reply)).toHaveLength(1);
    });

    it.each([
        ['¿Me confirma si agendo la cita de Corte y estilo el 2026-10-12 a las 09:30?', true],
        ['¿Lo agendo?', true],
        ['¿Confirma que desea realizar este pedido?', true],
        ['¿Desea que proceda a finalizar la reserva?', true],
        ['Shall I book it?', true],
        ['Do you confirm this order?', true],
        ['Confirmez-vous cette commande ?', true],
        ['Confirma que deseja fazer este pedido?', true],
        ['Su cita quedó confirmada. Ref. A72599D6. ¿Algo más?', false],
        // a follow-up about something else is not a request to confirm THIS record (PR #85 review)
        ['¡Listo! Ref. A72599D6. ¿Desea que le agende otra para su hijo?', false],
        ['Pedido Ref. 20FD6A98 registrado. ¿Quiere que le confirme por correo?', false],
        ['Cita confirmada (Ref. A72599D6). ¿Le confirmo la dirección del local?', false],
        ['¡Cita confirmada! Ref. A72599D6. ¿Desea agendar otra cita?', false],
        ['Pedido registrado. ¿Desea que le envíe un recordatorio?', false],
        ['Cita confirmada. Ref. A72599D6. ¿Quiere que le confirme la cita por correo?', false],
        ['Pedido Ref. 20FD6A98 registrado. ¿Le confirmo también la dirección del pedido?', false],
        ['Cita confirmada. ¿Quiere que le agende también el masaje?', false],
        ['¿Me confirma si agendo la cita? ¡Cita confirmada! Ref. A72599D6', true],
        ['¿Le agendo la cita de Corte y estilo?', true],
        ['Su pedido quedó registrado. ¿Desea que le ayude con otro producto?', false],
        ['Quedó confirmada para el lunes. Le llegará un recordatorio.', false],
    ])('«%s» is a confirmation question: %s', (text, expected) => {
        expect(replyStillAsksConfirmation(text)).toBe(expected);
    });
});

describe('2. the delivery in the order message is a delivery, not only a note', () => {
    it.each([
        ['envíelo a la Calle 5 #4-3', { kind: 'ship', address: 'Calle 5 #4-3' }],
        ['mejor enviar a Calle 123 #45-67, Bogotá (dirección de prueba)', { kind: 'ship', address: 'Calle 123 #45-67, Bogotá (dirección de prueba)' }],
        ['mi dirección es Carrera 7 # 32-16 apto 501', { kind: 'ship', address: 'Carrera 7 # 32-16 apto 501' }],
        ['envíalo a mi casa', { kind: 'ship', address: 'mi casa' }],
        ['quiero que me lo envíen', { kind: 'ship' }],
        ['con envío a domicilio', { kind: 'ship' }],
        ['sin envío por ahora', { kind: 'pickup' }],
        ['no quiero envío', { kind: 'pickup' }],
        ['lo recojo en la tienda', { kind: 'pickup' }],
        ['paso a recogerlo mañana', { kind: 'pickup' }],
        ['retiro en tienda', { kind: 'pickup' }],
        ['a nombre de Joaquin Sosa', null],
        ['hola', null],
    ])('«%s» is read as %j', (text, expected) => {
        expect(deliveryFrom(text)).toEqual(expected);
    });

    it('the notes carry one canonical delivery line, replaced when the customer changes it, and the rest of what was said', () => {
        expect(mergeOrderNotes(undefined, 'envíelo a la Calle 5 #4-3')).toBe('Envío a: Calle 5 #4-3');
        expect(mergeOrderNotes('Envío a: Calle 5 #4-3', 'mejor lo recojo en la tienda')).toBe('Recojo en tienda');
        expect(mergeOrderNotes('Recojo en tienda', 'envíelo a la Carrera 9 #1-2')).toBe('Envío a: Carrera 9 #1-2');
        expect(mergeOrderNotes(undefined, '1 unidad, a nombre de Joaquin Sosa, sin envío por ahora')).toBe('1 unidad, a nombre de Joaquin Sosa. Recojo en tienda');
        expect(mergeOrderNotes('Envío a: Calle 5 #4-3', 'envíelo a la Calle 5 #4-3')).toBe('Envío a: Calle 5 #4-3');
        // nothing about delivery: the old behaviour (the words are kept, bounded)
        expect(mergeOrderNotes('regalo', 'con tarjeta de felicitación')).toBe('regalo. con tarjeta de felicitación');
    });

    it.each([
        'me envían la factura por favor', 'envíenme info de la garantía', 'envíame el recibo al correo', 'mándame el catálogo por whatsapp',
        'Quiero pedir 1 Audífono QA Aurora y envíenme la factura al correo', 'me pueden enviar las instrucciones',
    ])('«%s» says nothing about how the order reaches the customer', text => {
        expect(deliveryFrom(text)).toBeNull();
        expect(isOrderDetails(text)).toBe(false);
    });

    it.each([
        'quiero que me lo envíen', 'me lo pueden mandar', 'envíelo a la Calle 5 #4-3', 'con envío', 'a domicilio', 'mándemelo a mi casa', 'ship it to 12 Main Street',
        'envíenme el pedido a la Carrera 7 # 32-16',
    ])('«%s» is a shipment of the order', text => {
        expect(deliveryFrom(text)).toMatchObject({ kind: 'ship' });
    });

    it('while the proposal waits, a message about an invoice or the warranty leaves the delivery of the order alone', async () => {
        const h = store();
        await h.turn('Quiero pedir 1 Audífono QA Aurora, lo recojo en la tienda');
        const before = h.ran('place_catalog_order').length;
        await h.turn('me envían la factura por favor');
        await h.turn('envíenme info de la garantía');
        expect(h.ran('place_catalog_order')).toHaveLength(before);
        const yes = await h.turn('sí, confirmo el pedido');
        expect(h.executed[0].args.notes).toBe('Recojo en tienda');
        expect(yes.reply).toContain('Entrega: recojo en tienda');
    });

    it('«Quiero comprar 1 Audífono QA Aurora, envíelo a la Calle 5 #4-3»: the proposal shows the delivery and does not ask for the address again', async () => {
        const h = store();
        const proposal = await h.turn('Quiero comprar 1 Audífono QA Aurora, envíelo a la Calle 5 #4-3');
        expect(h.ran('place_catalog_order')[0].args).toEqual({ items: [{ productId: PRODUCT, quantity: 1 }], notes: 'Envío a: Calle 5 #4-3' });
        expect(proposal.reply).toBe([
            'Este es su pedido:', '- 1 × Audífono QA Aurora (119.900 COP c/u)', '- Total: 119.900 COP', '- Entrega: envío a Calle 5 #4-3',
            '¿Confirma que desea realizar este pedido? Queda registrado como pendiente y no es un pago.',
        ].join('\n'));
        expect(proposal.reply).not.toMatch(/indíqueme la dirección|Notas:/);
    });

    it('«sin envío / lo recojo en la tienda» is a pickup, and the proposal does not offer or ask for a shipment', async () => {
        const h = store();
        const proposal = await h.turn('Quiero comprar 1 Audífono QA Aurora, lo recojo en la tienda');
        expect(h.ran('place_catalog_order')[0].args.notes).toBe('Recojo en tienda');
        expect(proposal.reply).toContain('- Entrega: recojo en tienda');
        expect(proposal.reply).not.toMatch(/dirección/i);
    });

    it('with no delivery said, the proposal still asks (once) for it', async () => {
        const h = store();
        const proposal = await h.turn('Quiero comprar 1 Audífono QA Aurora');
        expect(proposal.reply).toContain('Si lo quiere con envío, indíqueme la dirección.');
        expect(proposal.reply).not.toContain('Entrega:');
    });

    it('a delivery given while the proposal waits is mapped into the same line and the order that is created carries it', async () => {
        const h = store();
        await h.turn('Quiero pedir 1 Audífono QA Aurora');
        const withAddress = await h.turn('mejor enviar a Calle 123 #45-67, Bogotá');
        expect(withAddress.reply).toContain('- Entrega: envío a Calle 123 #45-67, Bogotá');
        expect(withAddress.reply).not.toMatch(/indíqueme la dirección|Notas:/);
        const yes = await h.turn('sí, confirmo el pedido');
        expect(h.created).toBe(1);
        expect(h.executed[0].args.notes).toBe('Envío a: Calle 123 #45-67, Bogotá');
        expect(yes.reply).toContain('Entrega: envío a Calle 123 #45-67, Bogotá (por coordinar con el equipo)');
        expect(yes.reply).not.toContain('Entrega: por registrar');
    });

    it('the record text states the delivery that was asked for, and says «por registrar» only when none was', () => {
        const result = (notes?: string) => ({ success: true, order: { id: 'c03ebdd7-226a-40b0-afc1-cba45b5a0073', totalAmount: 119900, currency: 'COP',
            items: [{ productName: 'Audífono QA Aurora', quantity: 1 }], ...(notes !== undefined ? { notes } : {}) } });
        expect(createdDoneText('place_catalog_order', {}, result('Envío a: Calle 5 #4-3'), 'es')).toContain('Entrega: envío a Calle 5 #4-3 (por coordinar con el equipo)');
        expect(createdDoneText('place_catalog_order', {}, result('Recojo en tienda'), 'es')).toContain('Entrega: recojo en tienda (por coordinar con el equipo)');
        expect(createdDoneText('place_catalog_order', {}, result(''), 'es')).toContain('Entrega: por registrar.');
        expect(createdDoneText('place_catalog_order', { notes: 'Recojo en tienda' }, result(), 'es')).toContain('Entrega: recojo en tienda');
        expect(createdDoneText('place_catalog_order', {}, result('Envío a: Calle 5 #4-3'), 'en')).toContain('Delivery: shipping to Calle 5 #4-3 (to be arranged with the team)');
    });

    it('notes the model wrote («Sin envío por ahora», a street) are read as the delivery they state, and stay as notes', () => {
        const terms = (notes: string) => ({ currency: 'COP', totalAmountCents: '11990000', notes,
            items: [{ productName: 'Audífono QA Aurora', quantity: 1, unitAmountCents: '11990000', totalAmountCents: '11990000' }] });
        const pickup = orderProposalText(terms('Sin envío por ahora'), 'es')!;
        expect(pickup).toContain('- Entrega: recojo en tienda');
        expect(pickup).toContain('- Notas: Sin envío por ahora');
        expect(pickup).not.toContain('indíqueme la dirección');
        expect(orderProposalText(terms('regalo para mi mamá'), 'es')).toContain('Si lo quiere con envío, indíqueme la dirección.');
        expect(createdDoneText('place_catalog_order', {}, { success: true, order: { id: 'c03ebdd7-226a-40b0-afc1-cba45b5a0073', totalAmount: 1, currency: 'COP',
            items: [{ productName: 'Audífono QA Aurora', quantity: 1 }], notes: 'Calle 5 #4-3' } }, 'es')).toContain('Entrega: envío a Calle 5 #4-3 (por coordinar con el equipo)');
    });

    it('the proposal in the other languages shows the delivery too', () => {
        const terms = { currency: 'COP', totalAmountCents: '11990000', notes: 'Envío a: Calle 5 #4-3',
            items: [{ productName: 'Audífono QA Aurora', quantity: 1, unitAmountCents: '11990000', totalAmountCents: '11990000' }] };
        expect(orderProposalText(terms, 'en')).toContain('- Delivery: shipping to Calle 5 #4-3');
        expect(orderProposalText(terms, 'en')).not.toContain('tell me the address');
        expect(orderProposalText(terms, 'es', 'tu')).toContain('- Entrega: envío a Calle 5 #4-3');
        expect(orderProposalText(terms, 'pt')).toContain('- Entrega: envio para Calle 5 #4-3');
        expect(orderProposalText(terms, 'fr')).toContain('- Livraison : envoi à Calle 5 #4-3');
    });
});

describe('3. a product is found by its words, not by the whole name', () => {
    const catalog = (...titles: string[]) => titles.map((title, index) => ({ id: `p${index}`, title, price: 100, stock: 3, inStock: true }));

    it.each([
        ['quisiera comprar audífonos aurora', 'Audífono QA Aurora'],
        ['quisiera comprar Audifono Aurora', 'Audífono QA Aurora'],
        ['Quiero comprar 2 audífonos Aurora', 'Audífono QA Aurora'],
        ['quisiera comprar audífonos aurora', 'Audífono Inalámbrico Aurora'],
        ['quiero comprar los cargadores nova', 'Cargador QA Nova'],
        ['quiero comprar una mesa plegable', 'Mesas plegables'],
    ])('«%s» is an order for «%s»', (said, title) => {
        const read: any = detectOrderIntake(said, catalog(title, 'Funda QA Delta'));
        expect(read?.product?.title).toBe(title);
    });

    it('a name that two products answer to is asked, and another product is not an answer', () => {
        const two: any = detectOrderIntake('quisiera comprar audífonos aurora', catalog('Audífono QA Aurora', 'Audífono QA Aurora Pro'));
        expect(two.choose.map((product: any) => product.title)).toEqual(['Audífono QA Aurora', 'Audífono QA Aurora Pro']);
        expect(detectOrderIntake('quisiera comprar cargadores aurora', catalog('Audífono QA Aurora'))).toBeNull();
        expect(detectOrderIntake('quisiera comprar audífonos', catalog('Audífono QA Aurora'))).toBeNull();
    });

    it('the live sequence: a proposal is pending and the customer names the product in the plural: the order is proposed, never «no hay»', async () => {
        const h = store();
        await h.turn('Quiero pedir 1 Audífono QA Aurora');
        const again = await h.turn('quisiera comprar audífonos aurora');
        expect(again.reply).toContain('1 × Audífono QA Aurora');
        expect(again.reply).not.toMatch(/no hay|no tengo/i);
        expect(h.created).toBe(0);
    });
});
