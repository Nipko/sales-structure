import { appointmentChangeRequest } from './appointment-transition';
import { BookingEngineService } from './booking-engine.service';
import { arbitrateMissionFocus, newMissionFocus, missionDialogue } from './mission-focus';

describe('appointmentChangeRequest', () => {
    it.each([
        'quiero reprogramar mi cita', 'Necesito reagendar mi cita para el viernes', 'puedo remarcar mi turno?', 'reprogramar',
        'I want to reschedule my appointment', 'please reschedule', 'je voudrais reporter mon rendez-vous', 'quero remarcar a minha consulta',
    ])('"%s" is an explicit change of an existing appointment', text => {
        expect(appointmentChangeRequest(text)).toBe('explicit');
    });

    it.each([
        'quiero cambiar mi cita al viernes', 'necesito mover mi cita para otro día', 'quiero pasar mi cita para el lunes', 'can you move my appointment to friday?',
        'change my appointment please', 'je veux déplacer mon rendez-vous', 'quero mudar a minha consulta',
    ])('"%s" is an ambiguous change (a draft correction when a booking is open)', text => {
        expect(appointmentChangeRequest(text)).toBe('ambiguous');
    });

    it.each([
        'quiero agendar una cita', 'quiero cancelar mi cita', 'cambia la hora a las 5', 'cambiar mi pedido', 'reprogramar mi pedido', 'quiero reportar un problema',
        'hola', 'mejor el sábado', 'el reporte de ventas', '¿a qué hora abren?', 'quiero cambiar de plan', 'move on please',
    ])('"%s" is not', text => {
        expect(appointmentChangeRequest(text)).toBeNull();
    });
});

const NOW = '2026-10-08T10:00:00.000Z';
const arbitrate = (text: string, state = newMissionFocus(NOW), candidates: any[] = []) =>
    arbitrateMissionFocus({ state, candidates, text, messageId: 'm-1' });
const draft = { ref: { id: 'b-1', kind: 'booking' as const, domain: 'appointment' }, aliases: ['cita'], paused: false, saved: true };

describe('the mission arbiter routes changes of an existing appointment as an appointment tool task', () => {
    it('no draft: reprogramar / cambiar mi cita → kind tool, domain appointment (never kind booking)', () => {
        for (const text of ['quiero reprogramar mi cita', 'quiero cambiar mi cita al viernes']) {
            const d = arbitrate(text);
            expect(d.route).toBe('tools');
            expect(d.state.selected).toMatchObject({ kind: 'tool', domain: 'appointment' });
        }
    });
    it('an open draft: the explicit verb still switches to the existing appointment; the generic one corrects the draft', () => {
        const state = { ...newMissionFocus(NOW), selected: { ...draft.ref } };
        expect(arbitrate('quiero reprogramar mi cita', state, [draft]).state.selected).toMatchObject({ kind: 'tool', domain: 'appointment' });
        expect(arbitrate('quiero cambiar mi cita al viernes', state, [draft]).state.selected).toMatchObject({ kind: 'booking' });
    });
    it('a new booking request is still the booking mission', () => {
        expect(arbitrate('quiero agendar una cita').state.selected).toMatchObject({ kind: 'booking', domain: 'appointment' });
    });
});

describe('«sí, cancélalo» answers a pending cancellation in the arbiter', () => {
    const pending = (toolName: string) => ({
        ...newMissionFocus(NOW), revision: 3,
        selected: { id: 't-1', kind: 'tool' as const, domain: toolName.includes('order') ? 'order' : 'appointment', toolName, reference: 'conf-1' },
        expectedReply: { missionId: 't-1', proposalId: 'conf-1', ledgerId: 'conf-1', sourceMessageId: 'm-0', kind: 'confirmation' as const },
    });
    it.each([['cancel_catalog_order', 'sí, cancélalo'], ['cancel_appointment', 'sí, cancélala'], ['cancel_appointment', 'sí, anúlala']])('%s + "%s": continues, keeps the proposal', (tool, text) => {
        const d = arbitrate(text, pending(tool));
        expect(d.action).toBe('continue');
        expect(d.route).toBe('tools');
        expect(d.invalidateConfirmation).toBe(false);
        expect(d.state.expectedReply).not.toBeNull();
    });
    it('the same phrase with another pending effect is a cancel request (clarify, no domain)', () => {
        const state = pending('create_payment_link');
        const d = arbitrate('sí, cancélalo', state);
        expect(d.action).not.toBe('continue');
    });
    it('a cancel with no domain and ONE current mission keeps that mission; with none it asks and lists the options', () => {
        const state = { ...newMissionFocus(NOW), selected: { id: 't-1', kind: 'tool' as const, domain: 'order', toolName: 'place_catalog_order' } };
        const current = { ref: state.selected, aliases: ['pedido'], paused: false, saved: true };
        const keep = arbitrate('mejor no, cancélalo ya mismo por favor', state, [current]);
        expect(keep.route).not.toBe('clarify');
        expect(keep.state.selected?.id).toBe('t-1');
        const none = arbitrate('sí, cancélalo');
        expect(none.route).toBe('clarify');
    });
    it('the clarify text lists the candidate missions (usted)', () => {
        expect(missionDialogue('es', 'clarify', ['appointment', 'order'])).toBe('Hay más de una gestión posible: su cita o su pedido. ¿Sobre cuál desea continuar?');
        expect(missionDialogue('en', 'clarify', ['appointment', 'order'])).toContain('your appointment or your order');
        expect(missionDialogue('es', 'clarify')).toContain('más de una gestión');
        expect(missionDialogue('es', 'clarify', ['appointment'])).toContain('más de una gestión');
    });
});

describe('the booking engine never takes a change of an existing appointment', () => {
    // process() answers before it touches Redis, the database or the tools: nothing is needed behind it
    const engine = new BookingEngineService({} as any, {} as any, {} as any);
    const process = (text: string, step: string) => engine.process('tenant_x', 'tenant', 'contact', { intent: 'unknown' } as any, text,
        { step } as any, {}, '2026-10-08', 'es', {} as any);

    it.each([
        ['quiero reprogramar mi cita', 'idle'], ['quiero reprogramar mi cita', 'confirm'], ['necesito reagendar', 'show_slots'],
        ['quiero cambiar mi cita al viernes', 'idle'], ['puedo mover mi cita?', 'idle'],
    ])('"%s" (step %s) → handled:false, state untouched', async (text, step) => {
        const result = await process(text, step);
        expect(result.handled).toBe(false);
        expect(result.state.step).toBe(step);
    });
});
