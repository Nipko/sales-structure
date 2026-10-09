import {
    appointmentCandidates, chooseCandidate, detectTransition, humanizeReferences, orderCandidates, resolveTarget, shortReference,
    transitionDoneText, transitionTexts,
} from './transition-engine';

const ALL = new Set(['cancel_appointment', 'reschedule_appointment', 'cancel_catalog_order', 'list_customer_appointments']);
const detect = (text: string, over: Record<string, unknown> = {}) => detectTransition({ text, available: ALL, pendingConfirmation: false, ...over } as any);
const APPT_A = 'ae3d0c86-1111-4111-8111-111111111111';
const APPT_B = 'd5959ea9-2222-4222-8222-222222222222';
const appts = appointmentCandidates({ appointments: [
    { id: APPT_A, service: 'Corte y estilo', date: '2026-10-12', time: '09:00', status: 'confirmed' },
    { id: APPT_B, service: 'Corte y estilo', date: '2026-10-13', time: '15:30', status: 'confirmed' },
    { id: 'ffffffff-3333-4333-8333-333333333333', service: 'Tinte', date: '2026-10-14', time: '11:00', status: 'cancelled' },
] });

describe('detectTransition', () => {
    it.each([
        ['quiero cancelar mi cita', 'cancel', 'appointment'],
        ['Prueba QA X: no, gracias. Quiero cancelar mi cita', 'cancel', 'appointment'],
        ['necesito anular mi turno', 'cancel', 'appointment'],
        ['quiero cancelar mi pedido', 'cancel', 'order'],
        ['quiero reprogramar mi cita al día siguiente a la misma hora', 'reschedule', 'appointment'],
        ['necesito cambiar mi cita para el viernes', 'reschedule', 'appointment'],
        ['¿qué citas tengo?', 'list', 'appointment'],
        ['mis citas', 'list', 'appointment'],
    ])('"%s" is %s %s', (text, verb, domain) => {
        expect(detect(text)).toEqual({ kind: 'request', request: { verb, domain }, continuation: false });
    });

    it.each(['hola', '¿puedo cancelar mi cita?', '¿cuál es la política de cancelación de la cita?', 'no quiero cancelar mi cita', 'cuánto cuesta cancelar mi pedido',
        'quiero agendar una cita', '¿cuál es el estado de mi pedido?'])('"%s" is not one', text => {
        expect(detect(text)).toBeNull();
    });

    it('a yes that answers a pending confirmation belongs to the confirmation, not to this engine', () => {
        expect(detect('sí, cancélala', { pendingConfirmation: true })).toBeNull();
        expect(detect('sí, reprográmala', { pendingConfirmation: true })).toBeNull();
    });

    it('«cancélalo» names nothing: the mission, or the only kind of object the business has, names it; with two kinds it asks', () => {
        expect(detect('cancélalo', { missionDomain: 'order' })).toMatchObject({ request: { verb: 'cancel', domain: 'order' } });
        expect(detect('quiero cancelar', { available: new Set(['cancel_appointment']) })).toMatchObject({ request: { verb: 'cancel', domain: 'appointment' } });
        expect(detect('quiero cancelar')).toEqual({ kind: 'ambiguous', verb: 'cancel', options: ['appointment', 'order'] });
        expect(detect('quiero cancelar mi cita y mi pedido')).toEqual({ kind: 'ambiguous', verb: 'cancel', options: ['appointment', 'order'] });
    });

    it('does nothing for a writer the turn does not publish', () => {
        expect(detect('quiero cancelar mi cita', { available: new Set(['list_customer_appointments']) })).toBeNull();
        expect(detect('quiero reprogramar mi cita', { available: new Set(['cancel_appointment']) })).toBeNull();
    });

    it('while the target is being chosen, the next message is the choice; a fresh request or a refusal is not', () => {
        expect(detect('la del martes', { awaitingWriter: 'cancel_appointment' })).toEqual({ kind: 'request', request: { verb: 'cancel', domain: 'appointment' }, continuation: true });
        expect(detect('mejor no', { awaitingWriter: 'cancel_appointment' })).toBeNull();
        expect(detect('quiero cancelar mi pedido', { awaitingWriter: 'cancel_appointment' })).toMatchObject({ request: { verb: 'cancel', domain: 'order' }, continuation: false });
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
    it('an order is cancellable only while pending/confirmed and unpaid; its label names the products', () => {
        const [a, b] = orderCandidates({ orders: [
            { id: 'c03ebdd7-226a-40b0-afc1-cba45b5a0073', status: 'pending', paymentStatus: 'pending', totalAmount: 119900, currency: 'COP', items: [{ productName: 'Audífono', quantity: 2 }] },
            { id: '2eace76f-c534-4aac-93e4-9292d2cd866a', status: 'confirmed', paymentStatus: 'paid', totalAmount: 5, currency: 'COP', items: [] },
        ] });
        expect(a).toMatchObject({ ref: 'C03EBDD7', cancellable: true, label: '2 Audífono' });
        expect(b.cancellable).toBe(false);
    });
    it('the short reference is the first 8 hex characters, uppercase; a raw UUID outside a URL is replaced, a URL is kept', () => {
        expect(shortReference('c03ebdd7-226a-40b0-afc1-cba45b5a0073')).toBe('C03EBDD7');
        expect(humanizeReferences('Pedido c03ebdd7-226a-40b0-afc1-cba45b5a0073.')).toBe('Pedido C03EBDD7.');
        expect(humanizeReferences('(c03ebdd7-226a-40b0-afc1-cba45b5a0073)')).toBe('(C03EBDD7)');
        const url = 'https://x.example/o/c03ebdd7-226a-40b0-afc1-cba45b5a0073?id=c03ebdd7-226a-40b0-afc1-cba45b5a0073';
        expect(humanizeReferences(url)).toBe(url);
    });
});

describe('texts follow the configured register', () => {
    const c = appts[0];
    it('usted by default, tú only when the regional address form says so; never both', () => {
        const usted = transitionTexts('es', 'usted');
        const tu = transitionTexts('es', 'tu');
        const sample = (t: ReturnType<typeof transitionTexts>) => [t.noAppointments(), t.list([c]), t.askWhich('cancel', 'appointment', appts), t.proposeCancel('appointment', c),
            t.proposeReschedule(c, { date: '2026-10-13', time: '09:00' }), t.askTarget(c), t.slotTaken({ date: '2026-10-13', time: '09:00' }, ['10:00']),
            t.doneCancel('appointment', 'AE3D0C86', ['2026-10-14 10:00']), t.doneReschedule('AE3D0C86', { date: '2026-10-13', time: '09:00' }), t.ambiguous(['appointment', 'order'])].join('\n');
        expect(sample(usted)).not.toMatch(/\b(?:tienes|quieres|tu|tus|te|confirmas|dime|puedes)\b/i);
        expect(sample(usted)).toMatch(/\busted\b|\bdesea\b|\bsu\b/);
        expect(sample(tu)).not.toMatch(/\b(?:usted|desea|su cita|su pedido|indíqueme|confirma que|le sirve)\b/i);
    });
    it('the executed account is deterministic in the four writers', () => {
        expect(transitionDoneText('cancel_appointment', { appointmentId: 'ae3d0c86-1111-4111-8111-111111111111' }, { success: true, alternatives: [] }, 'es', 'usted'))
            .toBe('Su cita (Ref. AE3D0C86) quedó cancelada.');
        expect(transitionDoneText('reschedule_appointment', {}, { success: true, appointment: { id: APPT_A, date: '2026-10-13', time: '09:00' } }, 'es', 'usted'))
            .toBe('Su cita (Ref. AE3D0C86) quedó reprogramada para el martes 13 de octubre a las 09:00.');
        expect(transitionDoneText('cancel_catalog_order', { orderId: 'c03ebdd7-226a-40b0-afc1-cba45b5a0073' }, { success: true, order: { id: 'c03ebdd7-226a-40b0-afc1-cba45b5a0073' } }, 'en', 'usted'))
            .toBe('Your order (Ref. C03EBDD7) has been cancelled.');
        expect(transitionDoneText('cancel_appointment', {}, { error: 'x' }, 'es', 'usted')).toBeNull();
        expect(transitionDoneText('create_appointment', {}, { success: true }, 'es', 'usted')).toBeNull();
    });
});
