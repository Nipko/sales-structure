import { arbitrateMissionFocus, newMissionFocus } from './mission-focus';
import {
    detectTransition, humanizeReferences, knownRecordFacts, knownRecordIds, restatesPendingProposal, runTransition, transitionDoneText,
    type TransitionIO,
} from './transition-engine';

/**
 * Production 2026-10-09, «Tienda QA Electrónica»: with the proposal to annul the order pending, «quiero cancelar mi pedido» was
 * read by the arbiter as a NEW task (the pending confirmation was dropped) while the engine returned null expecting the yes
 * path to execute the proposal. The next «sí» had nothing to confirm → «No he podido completar esa acción».
 * The same sequence for an appointment.
 */
const ORDER = 'c03ebdd7-226a-40b0-afc1-cba45b5a0073';
const ORDER_2 = 'd1d0d14a-2222-4222-8222-222222222222';
const APPT = 'ae3d0c86-1111-4111-8111-111111111111';
const APPT_2 = 'd5959ea9-2222-4222-8222-222222222222';
const AVAILABLE = new Set(['cancel_appointment', 'reschedule_appointment', 'cancel_catalog_order', 'list_customer_appointments', 'list_my_catalog_orders']);
const order = (id: string, status = 'pending', name = 'Audífono QA Aurora') => ({ id, status, paymentStatus: 'pending', totalAmount: 119900, currency: 'COP', items: [{ productName: name, quantity: 1 }] });
const appointment = (id: string, date: string, time: string) => ({ id, reference: id.slice(0, 8).toUpperCase(), serviceId: 'svc-1', service: 'Corte y estilo', date, time, status: 'confirmed' });

function io(data: { orders?: any[]; appointments?: any[] }, calls: Array<{ name: string; args: any }>): TransitionIO {
    return {
        execute: async (name, args) => {
            calls.push({ name, args });
            if (name === 'list_my_catalog_orders') return { success: true, orders: data.orders ?? [] };
            if (name === 'list_customer_appointments') return { appointments: data.appointments ?? [] };
            if (name === 'check_availability') return { slots: [{ time: '11:00' }] };
            return { error: 'confirmation_required', confirmationId: 'conf-1' };
        },
        interpretTarget: async () => ({ date: '2026-10-16', time: '11:00' }), todayIso: '2026-10-09', language: 'es', form: 'usted',
    };
}

describe('restating the request over a pending proposal', () => {
    it.each([
        ['quiero cancelar mi pedido', { verb: 'cancel', domain: 'order' }, true],
        ['necesito cancelar mi pedido por favor', { verb: 'cancel', domain: 'order' }, true],
        ['cancela mi pedido', { verb: 'cancel', domain: 'order' }, true],
        ['quiero cancelar mi cita', { verb: 'cancel', domain: 'appointment' }, true],
        ['quiero reprogramar mi cita', { verb: 'reschedule', domain: 'appointment' }, true],
        // not restatements
        ['cancélala', { verb: 'cancel', domain: 'order' }, false],
        ['sí, quiero cancelar mi pedido', { verb: 'cancel', domain: 'order' }, false],
        ['quiero cancelar mi cita', { verb: 'cancel', domain: 'order' }, false],
        ['quiero cancelar mi pedido', { verb: 'cancel', domain: 'appointment' }, false],
        ['quiero cancelar mi cita del martes', { verb: 'cancel', domain: 'appointment' }, false],
        ['quiero reprogramar mi cita para el viernes', { verb: 'reschedule', domain: 'appointment' }, false],
        ['¿puedo cancelar mi pedido?', { verb: 'cancel', domain: 'order' }, false],
        ['no quiero cancelar mi pedido', { verb: 'cancel', domain: 'order' }, false],
    ])('"%s" over a pending %j restates it: %s', (text, pending, expected) => {
        expect(restatesPendingProposal(text, pending as any)).toBe(expected);
    });

    it('the detector reports it as a restatement (not a new request, not an answer)', () => {
        expect(detectTransition({ text: 'quiero cancelar mi pedido', available: AVAILABLE, missionToolName: 'cancel_catalog_order', pendingConfirmation: true }))
            .toEqual({ kind: 'request', request: { verb: 'cancel', domain: 'order' }, continuation: false, restate: true });
        // a bare «cancélala» is still the ANSWER, left to the yes path
        expect(detectTransition({ text: 'cancélala', available: AVAILABLE, missionToolName: 'cancel_catalog_order', pendingConfirmation: true })).toBeNull();
    });

    it('the arbiter keeps the focus and the pending confirmation (it used to open a new task and invalidate it)', () => {
        const state = newMissionFocus();
        state.selected = { id: 'mission-1', kind: 'tool', domain: 'order', toolName: 'cancel_catalog_order', reference: 'ledger-1' };
        state.expectedReply = { missionId: 'mission-1', proposalId: 'ledger-1', ledgerId: 'ledger-1', sourceMessageId: 'm1', kind: 'confirmation' };
        state.revision = 3;
        const decision = arbitrateMissionFocus({ state, candidates: [], text: 'quiero cancelar mi pedido', messageId: 'm2' });
        expect(decision.invalidateConfirmation).toBe(false);
        expect(decision.state.selected?.id).toBe('mission-1');
        expect(decision.state.expectedReply?.ledgerId).toBe('ledger-1');
        expect(decision.state.revision).toBe(3);
        expect(decision.route).toBe('tools');
        // while the same sentence about the OTHER object still asks which one
        const other = arbitrateMissionFocus({ state: structuredClone(state), candidates: [], text: 'quiero cancelar mi cita', messageId: 'm3' });
        expect(other.invalidateConfirmation).toBe(true);
    });

    it('the order proposal is shown again with the SAME reference, the writer is not called again, and the yes path stays valid', async () => {
        const calls: Array<{ name: string; args: any }> = [];
        const out = await runTransition({ verb: 'cancel', domain: 'order' }, 'quiero cancelar mi pedido', io({ orders: [order(ORDER)] }, calls),
            { restate: true, pending: { toolName: 'cancel_catalog_order', args: { orderId: ORDER }, ledgerId: 'ledger-1' } });
        expect(out.handled).toBe(true);
        expect(out.awaitsConsent).toBe(true);
        expect(out.text).toContain('¿Confirma que desea ANULAR su pedido (Ref. C03EBDD7)');
        expect(calls.map(call => call.name)).toEqual(['list_my_catalog_orders']);
        // and the next «sí» executes it: done text
        expect(transitionDoneText('cancel_catalog_order', { orderId: ORDER }, { success: true, order: { id: ORDER, status: 'cancelled' } }, 'es', 'usted'))
            .toBe('Su pedido (Ref. C03EBDD7) quedó anulado.');
    });

    it('with two orders the restated request re-shows the PENDING one instead of asking «¿cuál?»', async () => {
        const calls: Array<{ name: string; args: any }> = [];
        const out = await runTransition({ verb: 'cancel', domain: 'order' }, 'quiero cancelar mi pedido', io({ orders: [order(ORDER_2, 'pending', 'Otro'), order(ORDER)] }, calls),
            { restate: true, pending: { toolName: 'cancel_catalog_order', args: { orderId: ORDER } } });
        expect(out.text).toContain('(Ref. C03EBDD7)');
        expect(calls.filter(call => call.name === 'cancel_catalog_order')).toHaveLength(0);
    });

    it('the appointment proposal is shown again; a reschedule is shown with its new date and time', async () => {
        const calls: Array<{ name: string; args: any }> = [];
        const data = { appointments: [appointment(APPT, '2026-10-14', '10:00'), appointment(APPT_2, '2026-10-15', '10:00')] };
        const cancel = await runTransition({ verb: 'cancel', domain: 'appointment' }, 'quiero cancelar mi cita', io(data, calls),
            { restate: true, pending: { toolName: 'cancel_appointment', args: { appointmentId: APPT_2 } } });
        expect(cancel.text).toBe('¿Confirma que desea cancelar su cita de Corte y estilo del jueves 15 de octubre a las 10:00 (Ref. D5959EA9)? La cita se anula y el horario queda libre.');
        expect(calls.filter(call => call.name === 'cancel_appointment')).toHaveLength(0);

        const move = await runTransition({ verb: 'reschedule', domain: 'appointment' }, 'quiero reprogramar mi cita', io(data, calls),
            { restate: true, pending: { toolName: 'reschedule_appointment', args: { appointmentId: APPT, newDate: '2026-10-16', newTime: '11:00' } } });
        expect(move.text).toContain('(Ref. AE3D0C86)');
        expect(move.text).toContain('viernes 16 de octubre a las 11:00');
        expect(calls.filter(call => call.name === 'reschedule_appointment')).toHaveLength(0);
    });

    it('picking the SAME record again by its date does not call the writer either (the guard would read the repeated request as a refusal)', async () => {
        const calls: Array<{ name: string; args: any }> = [];
        const data = { appointments: [appointment(APPT, '2026-10-14', '10:00'), appointment(APPT_2, '2026-10-15', '10:00')] };
        const out = await runTransition({ verb: 'cancel', domain: 'appointment' }, 'quiero cancelar mi cita del jueves', io(data, calls),
            { continuation: true, pending: { toolName: 'cancel_appointment', args: { appointmentId: APPT_2 } } });
        expect(out.text).toContain('(Ref. D5959EA9)');
        expect(calls.filter(call => call.name === 'cancel_appointment')).toHaveLength(0);
        // a DIFFERENT record is a new proposal
        const other = await runTransition({ verb: 'cancel', domain: 'appointment' }, 'cancela la del miércoles', io(data, calls),
            { continuation: true, pending: { toolName: 'cancel_appointment', args: { appointmentId: APPT_2 } } });
        expect(other.text).toContain('(Ref. AE3D0C86)');
        expect(calls.filter(call => call.name === 'cancel_appointment')).toHaveLength(1);
    });

    it('without a live pending row the restated request is an ordinary new request', async () => {
        const calls: Array<{ name: string; args: any }> = [];
        const out = await runTransition({ verb: 'cancel', domain: 'order' }, 'quiero cancelar mi pedido', io({ orders: [order(ORDER)] }, calls), { restate: true, pending: null });
        expect(out.text).toContain('¿Confirma que desea ANULAR su pedido (Ref. C03EBDD7)');
        expect(calls.filter(call => call.name === 'cancel_catalog_order')).toHaveLength(1);
    });
});

describe('listing orders and their status is the server\'s, with the reference', () => {
    it.each(['¿qué pedidos tengo?', 'mis pedidos', '¿cuál es el estado de mi pedido?', 'cuales son mis pedidos', 'hola, ¿qué pedidos tengo?'])('"%s" is the order list', text => {
        expect(detectTransition({ text, available: AVAILABLE, pendingConfirmation: false })).toEqual({ kind: 'request', request: { verb: 'list', domain: 'order' }, continuation: false });
    });

    it('is not taken when the turn does not publish the order read, nor for a question that merely mentions orders', () => {
        expect(detectTransition({ text: '¿qué pedidos tengo?', available: new Set(['cancel_catalog_order']), pendingConfirmation: false })).toBeNull();
        expect(detectTransition({ text: 'mis pedidos anteriores me los pueden facturar', available: AVAILABLE, pendingConfirmation: false })).toBeNull();
    });

    it('lists EVERY order with its status and reference, including the cancelled one (that is a status, not an action)', async () => {
        const out = await runTransition({ verb: 'list', domain: 'order' }, '¿qué pedidos tengo?',
            io({ orders: [order(ORDER, 'pending'), order(ORDER_2, 'cancelled', 'Audífono QA Aurora')] }, []));
        expect(out.text).toBe('Usted tiene 2 pedidos:\n- Audífono QA Aurora (119.900 COP) — pendiente (Ref. C03EBDD7)\n- Audífono QA Aurora (119.900 COP) — anulado (Ref. D1D0D14A)\nSi desea anular alguno, indíqueme la referencia.');
        expect(out.text).not.toMatch(/\bcuyo estado\b/);
        const none = await runTransition({ verb: 'list', domain: 'order' }, 'mis pedidos', io({ orders: [] }, []));
        expect(none.text).toBe('No encuentro pedidos suyos.');
    });
});

describe('references', () => {
    it('a bare 8-hex prefix of a KNOWN record is shown as the short reference; arbitrary hex is never touched', () => {
        const known = [ORDER_2];
        expect(humanizeReferences('Su pedido ID d1d0d14a está pendiente.', known)).toBe('Su pedido Ref. D1D0D14A está pendiente.');
        expect(humanizeReferences('Su pedido (d1d0d14a) está pendiente.', known)).toBe('Su pedido (D1D0D14A) está pendiente.');
        expect(humanizeReferences('Ref. d1d0d14a', known)).toBe('Ref. D1D0D14A');
        expect(humanizeReferences('Ref. D1D0D14A', known)).toBe('Ref. D1D0D14A');
        // not a known record: a color, a hash fragment, a phone number
        expect(humanizeReferences('El color #deadbeef y el código cafebabe', known)).toBe('El color #deadbeef y el código cafebabe');
        expect(humanizeReferences('Llame al 12345678', ['12345678-1111-4111-8111-111111111111'])).toBe('Llame al 12345678');
        // inside a URL it stays whole
        expect(humanizeReferences('https://x.example/orders/d1d0d14a', known)).toBe('https://x.example/orders/d1d0d14a');
        // without known ids the behaviour is the old one
        expect(humanizeReferences(`Pedido ${ORDER}`)).toBe('Pedido C03EBDD7');
        expect(humanizeReferences('Pedido d1d0d14a')).toBe('Pedido d1d0d14a');
    });

    it('the turn\'s known ids come from tool results and the active objects, and the read statuses from the same places', () => {
        const executed = [
            { name: 'list_my_catalog_orders', result: { orders: [order(ORDER, 'cancelled')] } },
            { name: 'cancel_catalog_order', result: { success: true, order: { id: ORDER_2, status: 'cancelled' } } },
        ];
        const context = { activeObjects: { items: [{ kind: 'appointment', id: APPT, status: 'confirmed', statusClass: 'active' }, { kind: 'catalog_item', id: 'x' }] } };
        expect(knownRecordIds(executed, context).sort()).toEqual([ORDER, ORDER_2, APPT].sort());
        // a write's own result is the thing the claim guard audits, never evidence of a read state
        expect(knownRecordFacts(executed, context)).toEqual([
            { status: 'cancelled', tokens: ['C03EBDD7', 'Audífono QA Aurora'] },
            { status: 'confirmed', tokens: ['AE3D0C86'] },
        ]);
        expect(knownRecordFacts([{ name: 'cancel_catalog_order', result: { order: { id: ORDER_2, status: 'cancelled' } } }])).toEqual([]);
    });
});
