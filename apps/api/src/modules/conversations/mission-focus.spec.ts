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

describe('a clarification always says what the choice is between', () => {
    const pendingCancellation = (tool: string, domain: string) => {
        const state = newMissionFocus();
        state.selected = { id: 'pending', kind: 'tool', reference: 'ledger', toolName: tool, domain };
        state.expectedReply = { missionId: 'pending', proposalId: 'ledger', ledgerId: 'ledger', sourceMessageId: 'old', kind: 'confirmation' };
        return state;
    };
    it.each([
        ['cancel_appointment', 'appointment', 'sí, cancela el pedido', ['appointment', 'order']],
        ['cancel_catalog_order', 'order', 'sí, cancela la cita', ['order', 'appointment']],
    ])('%s pending + "%s": clarify, not consent, with both objects named', (tool, domain, text, options) => {
        const result = arbitrateMissionFocus({ state: pendingCancellation(tool, domain), candidates: [], text, messageId: 'next' });
        expect(result).toMatchObject({ route: 'clarify', action: 'clarify', invalidateConfirmation: true, clarifyOptions: options });
        expect(result.state.expectedReply).toBeNull();
        const spoken = missionDialogue('es', 'clarify', result.clarifyOptions);
        expect(spoken).toMatch(/su cita o su pedido|su pedido o su cita/);
        expect(spoken).toContain('¿Sobre cuál desea continuar?');
    });
    it('the matching object is still the answer to the pending proposal', () => {
        const result = arbitrateMissionFocus({ state: pendingCancellation('cancel_appointment', 'appointment'), candidates: [], text: 'sí, cancela la cita', messageId: 'next' });
        expect(result).toMatchObject({ route: 'tools', action: 'continue' });
    });
    it('one known gestión is still named; the bare question exists for nothing at all', () => {
        expect(missionDialogue('es', 'clarify', ['order'])).toContain('su pedido');
        expect(missionDialogue('es', 'clarify', ['order', 'order'])).toContain('su pedido');
        expect(missionDialogue('es', 'clarify')).toBe('Hay más de una gestión posible. ¿Cuál desea continuar?');
    });
});

// Production 2026-10-09 (Salón QA Citas): six finished cancellations / reschedules were parked as "paused tasks" and the seventh
// supersession answered every new «quiero agendar…» with «No me queda claro a qué gestión se refiere; tengo en curso su cita».
describe('the parked tasks are bounded and never a wall for a new task', () => {
    const toolMission = (n: number) => ({ id: `m${n}`, kind: 'tool' as const, domain: 'appointment', toolName: 'cancel_appointment', reference: `ledger-${n}` });
    const full = () => {
        const state = newMissionFocus();
        state.selected = toolMission(7);
        state.pausedTools = [1, 2, 3, 4, 5, 6].map(n => ({ ref: toolMission(n), pausedAt: new Date(Date.now() - (10 - n) * 60_000).toISOString() }));
        return state;
    };
    it.each([
        'quiero agendar corte y estilo',
        'Hola, quiero agendar una cita de corte y estilo',
        'quiero agendar corte y estilo el miércoles 21 de octubre a las 10:00, a nombre de Joaquin Sosa, correo qa.cliente@example.com',
    ])('with six parked and one in progress, «%s» opens a booking', text => {
        const result = arbitrateMissionFocus({ state: full(), candidates: [], text, messageId: 'inbound' });
        expect(result.route).not.toBe('clarify');
        expect(result.action).not.toBe('clarify');
        expect(result.state.selected).toMatchObject({ kind: expect.stringMatching(/booking|tool/) });
        expect(result.state.pausedTools).toHaveLength(6);
    });
    it('the OLDEST parked task makes room', () => {
        const result = arbitrateMissionFocus({ state: full(), candidates: [], text: 'quiero agendar corte y estilo', messageId: 'inbound' });
        const ids = (result.state.pausedTools || []).map(item => item.ref.id);
        expect(ids).not.toContain('m1');
        expect(ids).toContain('m7');
    });
    it('a task whose proposal was already carried out is dropped, not parked', () => {
        const state = full();
        state.lastConsumed = { messageId: 'earlier', missionId: 'm7', revision: 0 };
        const result = arbitrateMissionFocus({ state, candidates: [], text: 'quiero agendar corte y estilo', messageId: 'inbound' });
        expect((result.state.pausedTools || []).map(item => item.ref.id)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6']);
    });
});
