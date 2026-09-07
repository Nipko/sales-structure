import { arbitrateMissionFocus, missionDialogue, newMissionFocus, parseDirectedSlotCorrection, type MissionCandidate } from './mission-focus';

const booking: MissionCandidate = { ref: { id: 'booking', kind: 'booking', domain: 'appointment' },
    aliases: ['cita', 'appointment', 'consulta', 'rendez-vous'], saved: true, paused: true };
const procedure: MissionCandidate = { ref: { id: 'procedure', kind: 'procedure', reference: 'return' },
    aliases: ['devolucion', 'return', 'devolucao', 'retour'], saved: true, paused: true };
const languages = [
    ['es', 'Continuemos', 'Retoma la cita', 'Quiero cancelar mi pedido', 'Cambia mi correo a nuevo@example.test', 'Quiero una cita y una devolucion'],
    ['en', 'Continue', 'Resume the appointment', 'I want to cancel my order', 'Change my email to new@example.test', 'I want an appointment and a return'],
    ['pt', 'Vamos continuar', 'Retomar a consulta', 'Quero cancelar meu pedido', 'Altere meu email para novo@example.test', 'Quero uma consulta e uma devolucao'],
    ['fr', 'Continuons', 'Reprenez le rendez-vous', 'Je veux annuler ma commande', 'Modifiez mon courriel: nouveau@example.test', 'Je veux un rendez-vous et un retour'],
];

describe('shared mission focus ownership', () => {
    it.each(languages)('%s requires a choice between two paused tasks', (lang, resume) => {
        const state = newMissionFocus(); state.selected = booking.ref;
        const result = arbitrateMissionFocus({ state, candidates: [booking, procedure], text: resume, messageId: 'inbound' });
        expect(result.route).toBe('clarify'); expect(result.state.expectedReply).toBeNull();
        expect(state.selected).toEqual(booking.ref); expect(missionDialogue(lang, 'clarify')).toContain('?');
    });
    it.each(languages)('%s selects the named paused booking, never an arbitrary engine', (_lang, _resume, named) => {
        const result = arbitrateMissionFocus({ state: newMissionFocus(), candidates: [booking, procedure], text: named, messageId: 'inbound' });
        expect(result).toMatchObject({ route: 'booking', action: 'resume', state: { selected: booking.ref, expectedReply: null } });
    });
    it.each(languages)('%s routes a named domain cancellation without deleting a collection', (_lang, _resume, _named, cancel) => {
        const result = arbitrateMissionFocus({ state: newMissionFocus(), candidates: [{ ...booking, paused: false }, procedure], text: cancel, messageId: 'inbound' });
        expect(result).toMatchObject({ route: 'tools', action: 'cancel', pauseBooking: true, state: { selected: { kind: 'tool', domain: 'order' } } });
    });
    it.each(languages)('%s identifies the corrected field and preserves the actual value', (_lang, _resume, _named, _cancel, correction) => {
        expect(parseDirectedSlotCorrection(correction, [{ field: 'email', type: 'email' }, { field: 'reason', type: 'string' }]))
            .toEqual({ field: 'email', value: expect.stringMatching(/@example\.test$/) });
    });
    it.each(languages)('%s never consumes a multi-task message as a slot', (_lang, _resume, _named, _cancel, _correction, multi) => {
        const result = arbitrateMissionFocus({ state: newMissionFocus(), candidates: [{ ...booking, paused: false }, procedure], text: multi, messageId: 'inbound' });
        expect(result.route).toBe('clarify'); expect(result.state.expectedReply).toBeNull();
    });
    it('does not reinterpret yes after pausing a pending ledger and restarting', () => {
        const state = newMissionFocus(); state.selected = { id: 'enrollment', kind: 'tool', reference: 'ledger', toolName: 'enroll_student', domain: 'education' };
        state.expectedReply = { missionId: 'enrollment', proposalId: 'ledger', ledgerId: 'ledger', sourceMessageId: 'old', kind: 'confirmation' };
        const paused = arbitrateMissionFocus({ state, candidates: [], text: 'más tarde', messageId: 'pause' }).state;
        expect(paused.pausedTools).toHaveLength(1); expect(paused.expectedReply).toBeNull();
        const resumed = arbitrateMissionFocus({ state: structuredClone(paused), candidates: [], text: 'retomar la matricula', messageId: 'resume' });
        expect(resumed.action).toBe('resume'); expect(resumed.state.expectedReply).toBeNull();
        expect(resumed.state.revision).toBeGreaterThan(state.revision);
    });
    it('refuses a correction that names two fields or hides a new task after prose', () => {
        expect(parseDirectedSlotCorrection('Corrijo: mi correo es a@example.test y mi nombre es Ana', [{ field: 'email', type: 'email' }, { field: 'name', type: 'name' }])).toBeNull();
        const result = arbitrateMissionFocus({ state: newMissionFocus(), candidates: [booking, procedure], text: 'Llegó roto y además quiero reservar una cita y consultar la devolución', messageId: 'multi' });
        expect(result.route).toBe('clarify');
    });
});
