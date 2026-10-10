import { arbitrateMissionFocus, newMissionFocus } from './mission-focus';

/**
 * Production 2026-10-09 (Salón QA Citas, Tienda QA Electrónica): a tool task whose write had been carried out stayed selected and kept
 * owning every later message. The booking engine (which runs only when no task of another kind is selected) never saw the next booking
 * request, and a new order was proposed under the mission of the cancellation that had consumed it.
 */
const mission = (id: string, toolName = 'cancel_appointment', domain = 'appointment') => ({ id, kind: 'tool' as const, domain, toolName, reference: `ledger-${id}` });
const decide = (state: ReturnType<typeof newMissionFocus>, text: string, extra: { orderRequest?: boolean } = {}) =>
    arbitrateMissionFocus({ state, candidates: [], text, messageId: 'next', ...extra });

describe('a task that was carried out is finished', () => {
    const finished = () => {
        const state = newMissionFocus();
        state.selected = mission('m-cancel');
        state.lastConsumed = { messageId: 'earlier', missionId: 'm-cancel', revision: 0 };
        state.pausedTools = [{ ref: mission('m-other', 'cancel_catalog_order', 'order'), pausedAt: new Date().toISOString() }];
        return state;
    };

    it.each(['quiero corte y estilo el lunes 19 de octubre a las 9:30, a nombre de Joaquin Sosa', 'gracias', 'hola', '¿qué horarios hay?', 'sí'])('«%s» finds no task of the finished kind in charge', text => {
        const result = decide(finished(), text);
        expect(result.state.selected?.reference).toBeUndefined();
        expect(result.state.selected?.toolName).toBeUndefined();
        expect(result.state.selected?.domain).toBeUndefined();
        expect(result.state.selected?.id).not.toBe('m-cancel');
        expect(result.state.expectedReply).toBeNull();
        // what is parked for later stays; the finished one is not parked as something to resume (it is not even parked twice)
        expect((result.state.pausedTools || []).map(item => item.ref.id)).toEqual(['m-other']);
    });

    it('a task that was carried out but has a NEW proposal waiting is still in progress', () => {
        const state = finished();
        state.expectedReply = { missionId: 'm-cancel', proposalId: 'ledger-new', ledgerId: 'ledger-new', sourceMessageId: 'x', kind: 'confirmation' };
        const result = decide(state, 'sí, cancélala');
        expect(result.state.selected?.id).toBe('m-cancel');
        expect(result.state.selected?.reference).toBe('ledger-m-cancel');
    });

    it('a task whose write was NOT carried out is untouched', () => {
        const state = finished();
        state.lastConsumed = { messageId: 'earlier', missionId: 'another-mission', revision: 0 };
        const result = decide(state, 'gracias');
        expect(result.state.selected?.id).toBe('m-cancel');
    });
});

describe('a request to buy a product of the catalogue is a task of its own', () => {
    it('it never inherits the finished or the parked task it follows', () => {
        const state = newMissionFocus();
        state.selected = mission('m-cancel', 'cancel_catalog_order', 'order');
        state.lastConsumed = { messageId: 'earlier', missionId: 'm-cancel', revision: 0 };
        const result = decide(state, 'Quiero pedir 1 Audífono QA Aurora', { orderRequest: true });
        expect(result.route).toBe('tools');
        expect(result.action).toBe('select');
        expect(result.state.selected).toMatchObject({ kind: 'tool', domain: 'order' });
        expect(result.state.selected?.id).not.toBe('m-cancel');
        expect(result.state.selected?.reference).toBeUndefined();
        expect(result.invalidateConfirmation).toBe(true);
    });

    it('a proposal of another kind that was waiting is parked, not dropped', () => {
        const state = newMissionFocus();
        state.selected = mission('m-reschedule', 'reschedule_appointment', 'appointment');
        state.expectedReply = { missionId: 'm-reschedule', proposalId: 'ledger-r', ledgerId: 'ledger-r', sourceMessageId: 'x', kind: 'confirmation' };
        const result = decide(state, 'Quiero pedir 1 Audífono QA Aurora', { orderRequest: true });
        expect((result.state.pausedTools || []).map(item => item.ref.id)).toContain('m-reschedule');
        expect(result.state.expectedReply).toBeNull();
        expect(result.state.revision).toBe(state.revision + 1);
    });

    it('without the server having read an order in it, the same words select nothing', () => {
        const state = newMissionFocus();
        const result = decide(state, 'Quiero pedir 1 Audífono QA Aurora');
        expect(result.state.selected?.domain).toBeUndefined();
        expect(result.action).toBe('continue');
    });

    it('the order task does not hijack the yes that answers a pending cancellation', () => {
        const state = newMissionFocus();
        state.selected = mission('m-cancel');
        state.expectedReply = { missionId: 'm-cancel', proposalId: 'ledger-c', ledgerId: 'ledger-c', sourceMessageId: 'x', kind: 'confirmation' };
        const result = decide(state, 'sí, cancélala', { orderRequest: false });
        expect(result.state.selected?.id).toBe('m-cancel');
        expect(result.state.expectedReply?.ledgerId).toBe('ledger-c');
    });
});
