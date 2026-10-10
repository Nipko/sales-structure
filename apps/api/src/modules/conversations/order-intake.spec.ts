import { createdDoneText, detectOrderIntake, isOrderDetails, mergeOrderNotes, mightBeOrderRequest, orderProposalText, orderStockText, formatCents, type IntakeProduct } from './order-intake';
import { resolveListChoice } from './list-choice';

const AURORA: IntakeProduct = { id: 'p-aurora', title: 'Audífono QA Aurora', price: 119900, currency: 'COP', stock: 2 };
const NOVA: IntakeProduct = { id: 'p-nova', title: 'Cargador QA Nova', price: 45000, currency: 'COP', stock: 10 };
const PRO: IntakeProduct = { id: 'p-pro', title: 'Audífono QA Aurora Pro', price: 229900, currency: 'COP', stock: 4 };
const CATALOG = [AURORA, NOVA];

describe('a request to buy a product of the catalogue', () => {
    it.each([
        ['Quiero pedir 1 Audífono QA Aurora', 'p-aurora', 1],
        ['quiero pedir 2 unidades de audifono qa aurora', 'p-aurora', 2],
        ['Quisiera comprar el Audífono QA Aurora', 'p-aurora', 1],
        ['Quiero comprar tres Cargador QA Nova', 'p-nova', 3],
        ['Hola, necesito pedir 4 cargadores qa nova por favor', 'p-nova', 4],
        ['Me llevo 2 Audífono QA Aurora', 'p-aurora', 2],
        ['I want to buy 2 Cargador QA Nova', 'p-nova', 2],
        ['Quero comprar 1 Audífono QA Aurora', 'p-aurora', 1],
        ['Je voudrais commander 3 Cargador QA Nova', 'p-nova', 3],
        ['quiero pedir audifonos aurora qa', 'p-aurora', 1],
    ])('«%s» → %s × %s', (text, id, quantity) => {
        expect(detectOrderIntake(text, CATALOG)).toEqual({ product: expect.objectContaining({ id }), quantity });
    });

    it.each([
        '¿Cuánto cuesta el Audífono QA Aurora?', 'Quiero información del Audífono QA Aurora', 'No quiero pedir el Audífono QA Aurora',
        'Quiero saber si hay Audífono QA Aurora', '¿Quiero pedir el Audífono QA Aurora?', 'Quiero pedir una cotización del Audífono QA Aurora',
        'Ya pedí el Audífono QA Aurora ayer', 'Pedí el Audífono QA Aurora y no llegó', 'Quiero cancelar mi pedido del Audífono QA Aurora',
        'Quiero devolver el Audífono QA Aurora', 'Quiero agendar una cita para el Audífono QA Aurora', 'El Audífono QA Aurora',
        'Quiero pedir 1 Audífono QA Aurora y 1 Cargador QA Nova', 'Quiero pedir ayuda', 'Quiero comprar', 'Quiero pedir un teclado',
        'Quiero pedir 150 Audífono QA Aurora', 'Quiero pedir 0 Audífono QA Aurora', 'Quiero ver las opciones de Audífono QA Aurora',
        'Hay Audífono QA Aurora disponible para comprar?', 'tienen el Audífono QA Aurora? quiero comprarlo',
    ])('«%s» is not an order', text => {
        expect(detectOrderIntake(text, CATALOG)).toBeNull();
    });

    it('two names where one contains the other: the longer one is what was said; two different products are ambiguous', () => {
        expect(detectOrderIntake('Quiero pedir 1 Audífono QA Aurora Pro', [AURORA, PRO])).toEqual({ product: expect.objectContaining({ id: 'p-pro' }), quantity: 1 });
        expect((detectOrderIntake('Quiero pedir 1 Audífono QA Aurora', [AURORA, PRO]) as any)?.product.id).toBe('p-aurora');
        expect(detectOrderIntake('Quiero pedir el Audífono QA Aurora y el Cargador QA Nova', [AURORA, NOVA])).toBeNull();
    });

    it('without a catalogue there is nothing to propose, and the words alone are not enough', () => {
        expect(detectOrderIntake('Quiero pedir 1 Audífono QA Aurora', [])).toBeNull();
        expect(mightBeOrderRequest('Quiero pedir 1 Audífono QA Aurora')).toBe(true);
        expect(mightBeOrderRequest('sí, confirmo el pedido')).toBe(false);
        expect(mightBeOrderRequest('¿Quieren que pida el Audífono?')).toBe(false);
    });
});

describe('delivery details given while the proposal waits', () => {
    it.each([
        'mejor enviar a Calle 123 #45-67, Bogotá (dirección de prueba)', 'sin envío por ahora', '1 unidad, a nombre de Joaquin Sosa, correo qa.cliente@example.com, sin envío por ahora',
        'envíelo a la carrera 7 con 45', 'lo recojo en la tienda', 'ship it to 12 Main Street', 'la dirección es Avenida 68 # 12-30',
    ])('«%s» belongs to the order', text => expect(isOrderDetails(text)).toBe(true));

    it.each([
        'sí', 'sí, confirmo el pedido', 'no, gracias', '¿cuánto cuesta el envío?', '¿hacen envíos a Medellín?', 'gracias', 'cancela el pedido',
        'quiero cambiar mi cita', '', 'x'.repeat(500),
    ])('«%s» does not', text => expect(isOrderDetails(text)).toBe(false));

    it('the notes keep what the order had and add what was said once, bounded', () => {
        // the delivery is ONE canonical line, the last sentence of the notes; a new delivery replaces it (see live-findings-20261010.spec.ts)
        expect(mergeOrderNotes(undefined, ' sin envío por ahora ')).toBe('Recojo en tienda');
        expect(mergeOrderNotes('Recojo en tienda', 'Calle 5 # 6-7')).toBe('Envío a: Calle 5 # 6-7');
        expect(mergeOrderNotes('Calle 5 # 6-7', 'calle 5 # 6-7')).toBe('Envío a: calle 5 # 6-7');
        expect(mergeOrderNotes('regalo', 'con tarjeta')).toBe('regalo. con tarjeta');
        expect(mergeOrderNotes('a'.repeat(590), 'b'.repeat(300)).length).toBeLessThanOrEqual(600);
        expect(mergeOrderNotes('algo', '')).toBe('algo');
    });
});

describe('what the customer reads', () => {
    const terms = { currency: 'COP', totalAmountCents: '23980000', notes: 'Calle 5 # 6-7',
        items: [{ productName: 'Audífono QA Aurora', quantity: 2, unitAmountCents: '11990000', totalAmountCents: '23980000' }] };

    it('the proposal states the exact terms of the guard, in the customer\'s language and register', () => {
        const usted = orderProposalText(terms, 'es', 'usted')!;
        expect(usted).toContain('Este es su pedido:');
        expect(usted).toContain('- 2 × Audífono QA Aurora (119.900 COP c/u)');
        expect(usted).toContain('- Total: 239.800 COP');
        expect(usted).toContain('- Notas: Calle 5 # 6-7');
        expect(usted).toContain('¿Confirma que desea realizar este pedido?');
        expect(orderProposalText(terms, 'es', 'tu')).toContain('¿Confirmas que quieres realizar este pedido?');
        expect(orderProposalText(terms, 'en')).toContain('Do you confirm you want to place this order?');
        expect(orderProposalText(terms, 'pt')).toContain('Confirma que deseja fazer este pedido?');
        expect(orderProposalText(terms, 'fr')).toContain('Confirmez-vous cette commande ?');
        expect(orderProposalText({ ...terms, notes: '' }, 'es')).not.toContain('Notas');
    });

    it('terms that cannot be read are not turned into a proposal', () => {
        expect(orderProposalText(undefined, 'es')).toBeNull();
        expect(orderProposalText({ ...terms, items: [] }, 'es')).toBeNull();
        expect(orderProposalText({ ...terms, totalAmountCents: 'x' }, 'es')).toBeNull();
        expect(formatCents('11990000', 'COP', 'es')).toBe('119.900 COP');
        expect(formatCents('abc', 'COP', 'es')).toBe('');
    });

    it('not enough stock is said with the stock the catalogue holds', () => {
        expect(orderStockText({ ...AURORA, stock: 1 }, 3, 'es', 'usted')).toBe('Solo tengo 1 unidad de Audífono QA Aurora (pidió 3). ¿Desea esa cantidad?');
        expect(orderStockText({ ...AURORA, stock: 0 }, 1, 'es', 'usted')).toContain('no tengo unidades disponibles');
    });

    it('the created order is told from the record, with its reference', () => {
        const result = { success: true, order: { id: 'c03ebdd7-226a-40b0-afc1-cba45b5a0073', status: 'pending', currency: 'COP', totalAmount: 239800,
            items: [{ productName: 'Audífono QA Aurora', quantity: 2 }] } };
        const text = createdDoneText('place_catalog_order', {}, result, 'es', 'usted')!;
        expect(text).toContain('Su pedido (Ref. C03EBDD7) quedó registrado:');
        expect(text).toContain('- 2 × Audífono QA Aurora');
        expect(text).toContain('- Total: 239.800 COP');
        expect(text).toContain('Estado: pendiente. Pago: pendiente. Entrega: por registrar.');
        expect(createdDoneText('place_catalog_order', {}, { ...result, order: { ...result.order, id: undefined } }, 'es')).toBeNull();
        expect(createdDoneText('place_catalog_order', {}, { error: 'catalog_stock_insufficient' }, 'es')).toBeNull();
    });

    it('the created appointment is told with its day, time and reference; a payment, a link or a vehicle are left to the model', () => {
        const result = { success: true, appointment: { id: '17f69a1b-3333-4333-8333-333333333333', service: 'Corte y estilo', date: '2026-10-19', time: '09:30', status: 'confirmed' } };
        expect(createdDoneText('create_appointment', {}, result, 'es', 'usted', '2026-10-09'))
            .toBe('Su cita de Corte y estilo quedó confirmada para el lunes 19 de octubre a las 09:30. Ref. 17F69A1B.');
        expect(createdDoneText('create_appointment', {}, result, 'es', 'tu', '2026-10-09')).toContain('Tu cita de Corte y estilo');
        expect(createdDoneText('create_appointment', {}, result, 'en', 'usted', '2026-10-09')).toContain('Your appointment for Corte y estilo is confirmed for Monday, October 19 at 09:30. Ref. 17F69A1B.'.replace('Monday, October 19', 'Monday October 19'));
        expect(createdDoneText('create_appointment', {}, { success: true, appointment: { ...result.appointment, awaitingPayment: true } }, 'es')).toBeNull();
        expect(createdDoneText('create_appointment', {}, { success: true, appointment: { ...result.appointment, meetingUrl: 'https://meet.example/x' } }, 'es')).toBeNull();
        expect(createdDoneText('create_appointment', {}, { success: true, appointment: { ...result.appointment, vehicleId: 'v1' } }, 'es')).toBeNull();
        expect(createdDoneText('create_appointment', {}, { success: true, appointment: { id: 'x' } }, 'es')).toBeNull();
        expect(createdDoneText('create_appointment', {}, { error: 'slot_taken' }, 'es')).toBeNull();
        expect(createdDoneText('send_booking_link', {}, { success: true }, 'es')).toBeNull();
    });
});

describe('«el 2» after a list of times', () => {
    const PROSE = 'Para el lunes 19 de octubre, estos son los horarios disponibles para Corte y estilo: 9:00, 9:30, 10:00, 10:30, 11:00 y 11:30. ¿Cuál le gustaría reservar?';
    const RANGES = 'Horarios disponibles para Corte y estilo el 2026-10-12: 09:00 - 09:45, 09:30 - 10:15, 10:00 - 10:45, 10:30 - 11:15. ¿Cuál horario prefiere?';

    it.each([['el 2', '9:30'], ['la 1', '9:00'], ['opción 3', '10:00'], ['2', '9:30'], ['el número 4', '10:30'], ['EL 6', '11:30']])('«%s» → %s', (text, time) => {
        expect(resolveListChoice(text, PROSE)?.time).toBe(time);
    });

    it('a range is ONE option, named by where it starts', () => {
        expect(resolveListChoice('el 2', RANGES)?.time).toBe('9:30');
        expect(resolveListChoice('el 4', RANGES)?.time).toBe('10:30');
        expect(resolveListChoice('el 5', RANGES)).toBeNull();
    });

    it('12-hour times keep their period', () => {
        expect(resolveListChoice('el 2', 'Tengo libre: 9:00 a. m., 9:30 a. m. y 3:00 p. m. ¿Cuál prefiere?')?.time).toBe('9:30 a. m.');
    });

    it.each([
        ['el 10', PROSE], ['el 11', PROSE], ['el 7', PROSE], ['el 0', PROSE], ['a las 2', PROSE], ['el 2 de octubre', PROSE], ['sí', PROSE],
        ['el 2', 'Claro, ¿para qué hora?'], ['el 2', 'Tenemos Corte y estilo, Color y tratamiento. ¿Cuál prefiere?'], ['el 2', '¿Le sirve las 9:30? Es el único horario disponible.'],
        ['el 2', undefined], ['el 2', ''],
    ])('«%s» after %j is left as written', (text, reply) => {
        expect(resolveListChoice(text, reply as any)).toBeNull();
    });

    it('when 2:00 is itself one of the times offered, «el 2» is that time or cannot be told: left to the model', () => {
        expect(resolveListChoice('el 2', 'Tengo libre: 1:00 p. m., 2:00 p. m., 3:00 p. m. ¿Cuál prefiere?')).toBeNull();
    });
});
