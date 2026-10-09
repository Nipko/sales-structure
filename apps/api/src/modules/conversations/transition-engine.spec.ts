import {
    appointmentCandidates, chooseCandidate, detectTransition, humanizeReferences, namedRequestOverridesClarify, orderCandidates, resolveTarget,
    shortReference, transitionDoneText, transitionTexts, addressFormOf,
} from './transition-engine';
import { appointmentChangeRequest } from './appointment-transition';

const ALL = new Set(['cancel_appointment', 'reschedule_appointment', 'cancel_catalog_order', 'list_customer_appointments']);
const ORD = new Set(['cancel_catalog_order']);
const detect = (text: string, over: Record<string, unknown> = {}) => detectTransition({ text, available: ALL, pendingConfirmation: false, ...over } as any);
const APPT_A = 'ae3d0c86-1111-4111-8111-111111111111';
const APPT_B = 'd5959ea9-2222-4222-8222-222222222222';
const appts = appointmentCandidates({ appointments: [
    { id: APPT_A, service: 'Corte y estilo', date: '2026-10-12', time: '09:00', status: 'confirmed' },
    { id: APPT_B, service: 'Corte y estilo', date: '2026-10-13', time: '15:30', status: 'confirmed' },
    { id: 'ffffffff-3333-4333-8333-333333333333', service: 'Tinte', date: '2026-10-14', time: '11:00', status: 'cancelled' },
] });
const nov = appointmentCandidates({ appointments: [
    { id: 'aaaaaaaa-1111-4111-8111-111111111111', service: 'Corte', date: '2026-11-03', time: '09:00', status: 'confirmed' },
    { id: 'bbbbbbbb-2222-4222-8222-222222222222', service: 'Corte', date: '2026-11-05', time: '10:00', status: 'confirmed' },
    { id: 'cccccccc-3333-4333-8333-333333333333', service: 'Corte', date: '2026-11-07', time: '11:00', status: 'confirmed' },
] });

describe('detectTransition: what is a request', () => {
    it.each([
        ['quiero cancelar mi cita', 'cancel', 'appointment'],
        ['Prueba QA X: no, gracias. Quiero cancelar mi cita', 'cancel', 'appointment'],
        ['necesito anular mi turno', 'cancel', 'appointment'],
        ['cancela mi cita por favor', 'cancel', 'appointment'],
        ['quiero cancelar mi pedido', 'cancel', 'order'],
        ['cancela mi pedido', 'cancel', 'order'],
        ['quiero reprogramar mi cita al día siguiente a la misma hora', 'reschedule', 'appointment'],
        ['necesito cambiar mi cita para el viernes', 'reschedule', 'appointment'],
        ['¿qué citas tengo?', 'list', 'appointment'],
        ['mis citas', 'list', 'appointment'],
        ['¿tengo alguna cita?', 'list', 'appointment'],
        ['necesito cancelar mi reserva', 'cancel', 'appointment'],
    ])('"%s" is %s %s', (text, verb, domain) => {
        expect(detect(text)).toEqual({ kind: 'request', request: { verb, domain }, continuation: false });
    });

    it.each(['hola', '¿puedo cancelar mi cita?', '¿cuál es la política de cancelación de la cita?', 'no quiero cancelar mi cita', 'cuánto cuesta cancelar mi pedido',
        'quiero agendar una cita', '¿cuál es el estado de mi pedido?', 'Quiero saber si puedo cancelar mi cita', '¿Se puede cancelar sin costo?'])('"%s" is not one', text => {
        expect(detect(text)).toBeNull();
    });

    // Opus review of dc0337fc, blocker 1: negations, and someone else's act
    it.each([
        'Por favor no cancelen mi cita, voy en camino', 'No voy a cancelar mi cita, llego 10 minutos tarde', 'No la cancele, ya voy', 'no, no cancele mi cita',
        'nunca cancelé mi cita', "I won't cancel my appointment, I'm just late", 'Não cancele minha consulta', "N'annulez pas mon rendez-vous",
        'No quiero reprogramar, solo confirmar que voy', 'Me cancelaron la cita del martes sin avisar', 'Me cambiaron la cita y nadie me avisó',
        'No quiero cambiar mi cita', 'Ya reprogramaron mi cita', 'Cancelé mi cita porque me surgió algo', 'Mi hermana movió su cita y la mía quedó igual',
    ])('negated, past or third-person: "%s" is not a request', text => {
        expect(detect(text)).toBeNull();
        expect(detect(text, { available: ORD })).toBeNull();
        expect(appointmentChangeRequest(text)).toBeNull();
    });

    // blocker 2: «cancelar» is also «to pay» in Latin America
    it.each([
        'Ya cancelé el pedido por Nequi', 'Quiero cancelar el pedido con tarjeta', 'quiero cancelar el saldo de mi pedido', 'quiero pagar, como cancelo el pedido',
        'ya cancele la compra, me envian la factura', 'la consulta la cancelo en efectivo', 'El banco me canceló la tarjeta y no pude pagar el pedido',
        'Cancelé mi tarjeta', 'cancelo contra entrega', 'quiero cancelar mi pedido con PSE', 'voy a cancelar la cuota de mi pedido',
    ])('payment context: "%s" is not a request', text => {
        expect(detect(text)).toBeNull();
        expect(detect(text, { available: ORD })).toBeNull();
    });

    // blocker 5: the list intent is the whole message
    it.each([
        'Tengo una cita mañana, ¿dónde queda el local?', 'No tengo cita, ¿puedo ir sin cita?', 'mis citas anteriores me las pueden facturar',
        'tengo una cita y quiero saber el precio', 'no tengo citas',
    ])('"%s" is not the list question', text => {
        expect(detect(text)).toBeNull();
    });

    it('a yes that answers a pending confirmation belongs to the confirmation, not to this engine', () => {
        expect(detect('sí, cancélala', { pendingConfirmation: true })).toBeNull();
        expect(detect('sí, reprográmala', { pendingConfirmation: true })).toBeNull();
    });

    // blocker 4: an object-less «cancélalo» never reaches back to an old record
    it('«cancélalo» names nothing: only a mission that is itself a cancel / reschedule lends its object', () => {
        expect(detect('cancélalo', { missionDomain: 'order', missionToolName: 'cancel_catalog_order' })).toMatchObject({ request: { verb: 'cancel', domain: 'order' } });
        expect(detect('cancélalo', { missionDomain: 'order' })).toBeNull();
        expect(detect('cancélalo', { missionDomain: 'order', missionToolName: 'place_catalog_order' })).toBeNull();
        for (const text of ['no, cancélalo', 'cancélalo', 'mejor cancélalo', 'mejor cancela eso']) {
            expect(detect(text)).toBeNull();
            expect(detect(text, { available: new Set(['cancel_catalog_order']) })).toBeNull();
        }
    });
    it.each(['no, cancélalo', 'cancélalo', 'mejor cancela el pedido', 'quiero cancelar el pedido'])(
        'a pending proposal to CREATE an order: "%s" is about that proposal, never about an earlier order', text => {
            expect(detect(text, { pendingConfirmation: true, missionToolName: 'place_catalog_order', missionDomain: 'order' })).toBeNull();
        });

    it('«quiero cancelar» as an explicit request, with no object: the options are named; one kind only → one option', () => {
        expect(detect('quiero cancelar')).toEqual({ kind: 'ambiguous', verb: 'cancel', options: ['appointment', 'order'] });
        expect(detect('quiero cancelar', { available: new Set(['cancel_appointment']) })).toEqual({ kind: 'ambiguous', verb: 'cancel', options: ['appointment'] });
        expect(detect('quiero cancelar mi cita y mi pedido')).toEqual({ kind: 'ambiguous', verb: 'cancel', options: ['appointment', 'order'] });
    });

    it('does nothing for a writer the turn does not publish', () => {
        expect(detect('quiero cancelar mi cita', { available: new Set(['list_customer_appointments']) })).toBeNull();
        expect(detect('quiero reprogramar mi cita', { available: new Set(['cancel_appointment']) })).toBeNull();
    });
});

describe('detectTransition: the «¿cuál?» state', () => {
    const awaiting = (text: string, over: Record<string, unknown> = {}) => detect(text, { awaitingWriter: 'cancel_appointment', awaitingFresh: true, ...over });
    it.each(['la del martes', 'la del 3 de noviembre', 'la de las 10:00', 'la referencia D5959EA9', 'la primera', 'la última', '2', 'el viernes a las 10'])(
        '"%s" picks something: it is the answer', text => {
            expect(awaiting(text)).toEqual({ kind: 'request', request: { verb: 'cancel', domain: 'appointment' }, continuation: true });
        });
    // blocker 3: it never swallows normal conversation
    it.each(['Hola, buenos días', 'gracias', '¿Cuánto cuesta la limpieza?', '¿el martes abren?', 'ok', 'no sé', 'quiero agendar una cita', 'espera un segundo',
        'primero dime, ¿cuál es la del jueves?', '¿a qué hora abren el martes?'])('"%s" is not an answer: it falls through', text => {
        expect(awaiting(text)).toBeNull();
    });
    it('after the window the choice has lapsed, even for a text that would pick', () => {
        expect(awaiting('la del martes', { awaitingFresh: false })).toBeNull();
    });
    it('a fresh request or a refusal is not a continuation', () => {
        expect(awaiting('mejor no')).toBeNull();
        expect(awaiting('quiero cancelar mi pedido')).toMatchObject({ request: { verb: 'cancel', domain: 'order' }, continuation: false });
    });
});

describe('chooseCandidate', () => {
    it('one candidate is the candidate; several need words that point at exactly one', () => {
        expect(chooseCandidate('cancélala', [appts[0]])).toBe(appts[0]);
        expect(chooseCandidate('quiero cancelar mi cita', appts)).toBeNull();
        expect(chooseCandidate('la del martes', appts)).toBe(appts[1]);
        expect(chooseCandidate('la del lunes 12 de octubre', appts)).toBe(appts[0]);
        expect(chooseCandidate('la de las 15:30', appts)).toBe(appts[1]);
        expect(chooseCandidate('la referencia D5959EA9', appts)).toBe(appts[1]);
        expect(chooseCandidate('la primera', appts)).toBe(appts[0]);
        expect(chooseCandidate('la última', appts)).toBe(appts[1]);
    });
    it('ignores appointments already cancelled', () => {
        expect(appts.map(c => c.ref)).toEqual(['AE3D0C86', 'D5959EA9']);
    });
    // blocker 6: dates and references before ordinals; an ordinal is (nearly) the whole message
    it.each([
        ['cancela mi cita, la que tengo el 3 de noviembre', 'AAAAAAAA'],
        ['la del 3 de noviembre', 'AAAAAAAA'],
        ['la de las 10', 'BBBBBBBB'],
        ['la del viernes 6', null],
        ['primero dime, ¿cuál es la del viernes?', null],
        ['espera un segundo', null],
        ['la segunda', 'BBBBBBBB'],
        ['la 3', 'CCCCCCCC'],
    ])('"%s" → %s', (text, ref) => {
        expect(chooseCandidate(text, nov)?.ref ?? null).toBe(ref);
    });
    // blocker 7: the words contradict the only record → ask, never assume
    it('«cancela la del martes» with only a Thursday does not pick it (cancel verifies the single candidate)', () => {
        expect(chooseCandidate('cancela la del martes', [nov[1]], { verifySingle: true })).toBeNull();
        expect(chooseCandidate('cancela la del martes', [nov[1]])).toBe(nov[1]);
        expect(chooseCandidate('cancela la del jueves', [appts[0]], { verifySingle: true })).toBeNull();
        expect(chooseCandidate('cancela la del lunes', [appts[0]], { verifySingle: true })).toBe(appts[0]);
        expect(chooseCandidate('cancélala', [appts[0]], { verifySingle: true })).toBe(appts[0]);
    });
});

describe('resolveTarget', () => {
    const base = appts[0];
    it('«al día siguiente a la misma hora» is relative to the appointment, not to today', () => {
        expect(resolveTarget('al día siguiente a la misma hora', base, null, '2026-10-08')).toEqual({ date: '2026-10-13', time: '09:00' });
    });
    it('uses the interpreter for the parts the words name and keeps the rest as the appointment has it', () => {
        expect(resolveTarget('para el viernes', base, { date: '2026-10-16', time: null }, '2026-10-08')).toEqual({ date: '2026-10-16', time: '09:00' });
        expect(resolveTarget('mejor a las 3', base, { date: null, time: '15:00' }, '2026-10-08')).toEqual({ date: '2026-10-12', time: '15:00' });
        expect(resolveTarget('mañana', base, { date: 'tomorrow' }, '2026-10-08')).toEqual({ date: '2026-10-09', time: '09:00' });
    });
    it('names nothing → null', () => {
        expect(resolveTarget('quiero reprogramarla', base, null, '2026-10-08')).toBeNull();
    });
});

describe('orders and references', () => {
    it('an order is cancellable only while pending/confirmed and unpaid (an unknown payment status is not); its label names the products', () => {
        const [a, b, c] = orderCandidates({ orders: [
            { id: 'c03ebdd7-226a-40b0-afc1-cba45b5a0073', status: 'pending', paymentStatus: 'pending', totalAmount: 119900, currency: 'COP', items: [{ productName: 'Audífono', quantity: 2 }] },
            { id: '2eace76f-c534-4aac-93e4-9292d2cd866a', status: 'confirmed', paymentStatus: 'paid', totalAmount: 5, currency: 'COP', items: [] },
            { id: '3eace76f-c534-4aac-93e4-9292d2cd866a', status: 'pending', paymentStatus: 'unknown', totalAmount: 5, currency: 'COP', items: [] },
        ] });
        expect(a).toMatchObject({ ref: 'C03EBDD7', cancellable: true, label: '2 Audífono' });
        expect(b.cancellable).toBe(false);
        expect(c.cancellable).toBe(false);
    });
    it('amounts follow the tenant locale', () => {
        const row = { id: 'c03ebdd7-226a-40b0-afc1-cba45b5a0073', status: 'pending', paymentStatus: 'pending', totalAmount: 1234.5, currency: 'usd', items: [] };
        expect(orderCandidates({ orders: [row] }, 'en-US')[0].total).toBe('1,234.5 USD');
        expect(orderCandidates({ orders: [row] }, 'es-CO')[0].total).toBe('1.234,5 USD');
    });
    it('the short reference is the first 8 hex characters, uppercase; a raw UUID outside a URL is replaced, a URL is kept', () => {
        expect(shortReference('c03ebdd7-226a-40b0-afc1-cba45b5a0073')).toBe('C03EBDD7');
        expect(humanizeReferences('Pedido c03ebdd7-226a-40b0-afc1-cba45b5a0073.')).toBe('Pedido C03EBDD7.');
        expect(humanizeReferences('(c03ebdd7-226a-40b0-afc1-cba45b5a0073)')).toBe('(C03EBDD7)');
        const url = 'https://x.example/o/c03ebdd7-226a-40b0-afc1-cba45b5a0073?id=c03ebdd7-226a-40b0-afc1-cba45b5a0073';
        expect(humanizeReferences(url)).toBe(url);
    });
    // blocker 10
    it.each([
        'Escríbanos a 123e4567-e89b-12d3-a456-426614174000@pay.example.com', 'user@123e4567-e89b-12d3-a456-426614174000.example.com',
        'pay.example.com/l/123e4567-e89b-12d3-a456-426614174000', 'ref_123e4567-e89b-12d3-a456-426614174000',
    ])('"%s" is left whole', text => {
        expect(humanizeReferences(text)).toBe(text);
    });
});

describe('the proposals say unambiguously what happens', () => {
    const order = orderCandidates({ orders: [{ id: 'c03ebdd7-226a-40b0-afc1-cba45b5a0073', status: 'pending', paymentStatus: 'pending', totalAmount: 119900, currency: 'COP', items: [{ productName: 'Audífono QA Aurora', quantity: 1 }] }] })[0];
    it('an order is ANULADO and "no es un pago" (in Latin America «cancelar» also means «pagar»)', () => {
        expect(transitionTexts('es', 'usted').proposeCancel('order', order)).toBe('¿Confirma que desea ANULAR su pedido (Ref. C03EBDD7): Audífono QA Aurora, total 119.900 COP? El pedido no se entregará y no es un pago.');
        expect(transitionTexts('es', 'tu').proposeCancel('order', order)).toContain('¿Confirmas que quieres ANULAR tu pedido');
        expect(transitionTexts('en', 'usted').proposeCancel('order', order)).toContain('VOID (cancel)');
        expect(transitionTexts('es', 'usted').proposeCancel('appointment', appts[0])).toContain('La cita se anula y el horario queda libre.');
    });
});

describe('texts follow the configured register', () => {
    const c = appts[0];
    const sample = (t: ReturnType<typeof transitionTexts>) => [t.noAppointments(), t.list([c]), t.askWhich('cancel', 'appointment', appts), t.proposeCancel('appointment', c),
        t.proposeReschedule(c, { date: '2026-10-13', time: '09:00' }), t.askTarget(c), t.slotTaken({ date: '2026-10-13', time: '09:00' }, ['10:00']),
        t.doneCancel('appointment', 'AE3D0C86', ['2026-10-14 10:00']), t.doneReschedule('AE3D0C86', { date: '2026-10-13', time: '09:00' }), t.ambiguous(['appointment', 'order']),
        t.ambiguous(['appointment']), t.noMatch('appointment', c), t.pastDate(c)].join('\n');
    it('usted by default, tú only when the regional address form says so; never both', () => {
        expect(sample(transitionTexts('es', 'usted'))).not.toMatch(/\b(?:tienes|quieres|tu|tus|te|confirmas|dime|puedes)\b/i);
        expect(sample(transitionTexts('es', 'usted'))).toMatch(/\busted\b|\bdesea\b|\bsu\b/);
        expect(sample(transitionTexts('es', 'tu'))).not.toMatch(/\b(?:usted|desea|su cita|su pedido|indíqueme|confirma que|le sirve)\b/i);
    });
    it('vos regions are addressed with tú as well: the API sends no voseo', () => {
        expect(addressFormOf('vos')).toBe('tu');
        expect(addressFormOf('tu')).toBe('tu');
        expect(addressFormOf('usted')).toBe('usted');
        expect(addressFormOf(undefined)).toBe('usted');
    });
    it('the executed account is deterministic in the writers', () => {
        expect(transitionDoneText('cancel_appointment', { appointmentId: 'ae3d0c86-1111-4111-8111-111111111111' }, { success: true, alternatives: [] }, 'es', 'usted'))
            .toBe('Su cita (Ref. AE3D0C86) quedó cancelada.');
        expect(transitionDoneText('reschedule_appointment', {}, { success: true, appointment: { id: APPT_A, date: '2026-10-13', time: '09:00' } }, 'es', 'usted'))
            .toBe('Su cita (Ref. AE3D0C86) quedó reprogramada para el martes 13 de octubre a las 09:00.');
        expect(transitionDoneText('cancel_catalog_order', { orderId: 'c03ebdd7-226a-40b0-afc1-cba45b5a0073' }, { success: true, order: { id: 'c03ebdd7-226a-40b0-afc1-cba45b5a0073' } }, 'es', 'usted'))
            .toBe('Su pedido (Ref. C03EBDD7) quedó anulado.');
        expect(transitionDoneText('cancel_catalog_order', { orderId: 'c03ebdd7-226a-40b0-afc1-cba45b5a0073' }, { success: true, order: { id: 'c03ebdd7-226a-40b0-afc1-cba45b5a0073' } }, 'en', 'usted'))
            .toBe('Your order (Ref. C03EBDD7) has been cancelled.');
        expect(transitionDoneText('cancel_appointment', {}, { error: 'x' }, 'es', 'usted')).toBeNull();
        expect(transitionDoneText('create_appointment', {}, { success: true }, 'es', 'usted')).toBeNull();
    });
});

describe('a clarification with nothing to choose between does not block a plain request', () => {
    const request = detect('quiero cancelar mi cita');
    it('fewer than two options + a request that names its object → the engine takes it', () => {
        expect(namedRequestOverridesClarify([], request)).toBe(true);
        expect(namedRequestOverridesClarify(['appointment'], request)).toBe(true);
        expect(namedRequestOverridesClarify(undefined, request)).toBe(true);
    });
    it('two options (a real choice, e.g. the mixed-objects question) or no request → the clarification stands', () => {
        expect(namedRequestOverridesClarify(['appointment', 'order'], request)).toBe(false);
        expect(namedRequestOverridesClarify([], detect('hola'))).toBe(false);
        expect(namedRequestOverridesClarify([], detect('quiero cancelar'))).toBe(false);
    });
});
