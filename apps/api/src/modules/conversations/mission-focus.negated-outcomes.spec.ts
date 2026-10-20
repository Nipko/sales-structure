import { arbitrateMissionFocus, mentionedMissionDomains, newMissionFocus, type MissionCandidate } from './mission-focus';

const actual = 'Quiero cancelar una reserva de alojamiento, pero todavía no he indicado ni elegido cuál. Antes de buscar en historiales o cancelar nada, dime qué referencia de la reserva necesitas; no inventes un código ni confirmes cancelación o devolución.';
const savedReturn: MissionCandidate = { ref: { id: 'synthetic-return', kind: 'procedure', reference: 'synthetic-procedure' }, aliases: ['devolucion'], saved: true, paused: true };
describe('negated outcome claims do not request another mission', () => {
    it('keeps the actual cancellation request in its lodging domain', () => {
        expect(mentionedMissionDomains(actual)).toEqual(['property']);
        expect(arbitrateMissionFocus({ state: newMissionFocus(), candidates: [], text: actual, messageId: 'synthetic-live-repro' }).route).toBe('tools');
    });
    it('does not resume a saved return procedure named only inside the prohibition', () => {
        const result = arbitrateMissionFocus({ state: newMissionFocus(), candidates: [savedReturn], text: actual, messageId: 'synthetic-saved' });
        expect(result.route).toBe('tools'); expect(result.state.selected?.domain).toBe('property');
    });
    it.each(['no confirmes una devolución', 'ni confirme cancelación o reembolso', 'no confirmar ninguna devolución'])('ignores only the narrow forbidden outcome claim: %s', constraint => {
        expect(mentionedMissionDomains('Quiero cancelar mi reserva de alojamiento; ' + constraint + '.')).toEqual(['property']);
    });
    it.each(['Quiero cancelar mi reserva de alojamiento y gestionar una devolución.', 'Quiero una devolución y una habitación; no confirmes cancelación.'])('preserves an actual second task: %s', text => {
        expect(mentionedMissionDomains(text)).toEqual(['property', 'return']);
        expect(arbitrateMissionFocus({ state: newMissionFocus(), candidates: [], text, messageId: 'synthetic-positive' }).route).toBe('clarify');
    });
    it('preserves a positive task after the narrow negated outcome', () => {
        const text = 'Quiero una habitación; no confirmes cancelación y quiero gestionar una devolución.';
        expect(mentionedMissionDomains(text)).toEqual(['property', 'return']);
    });
});
