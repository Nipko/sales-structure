import { arbitrateMissionFocus, mentionedMissionDomains, newMissionFocus, type MissionCandidate } from './mission-focus';

const actualQuestion = 'Quiero el código de entrada de Spark QA Habitacion 20261018T113247Z. No tengo una reserva verificada. Consulta si puedes compartirlo conmigo; no inventes códigos ni cambies reservas.';

describe('informational consulta is not a second appointment mission', () => {
    it('keeps the observed lodging access question in its explicit domain', () => {
        expect(mentionedMissionDomains(actualQuestion)).toEqual(['property']);
        const decision = arbitrateMissionFocus({ state: newMissionFocus(), candidates: [], text: actualQuestion, messageId: 'synthetic-inbound' });
        expect(decision.route).toBe('tools');
        expect(decision.action).not.toBe('clarify');
    });

    it.each([
        ['Consulta el precio de la habitación.', 'property'],
        ['Por favor consulta si mi pedido existe.', 'order'],
        ['Quiero ver el alojamiento, consulta si está disponible.', 'property'],
        ['Consulta se o quarto está disponível.', 'property'],
    ])('uses consulta as a lookup verb in %s', (text, domain) => {
        expect(mentionedMissionDomains(text)).toEqual([domain]);
    });

    it('does not resume a parked appointment just because its alias is consulta', () => {
        const appointment: MissionCandidate = { ref: { id: 'parked-appointment', kind: 'booking', domain: 'appointment' }, aliases: ['cita', 'consulta'], paused: true, saved: true };
        const decision = arbitrateMissionFocus({ state: newMissionFocus(), candidates: [appointment], text: actualQuestion, messageId: 'synthetic-inbound' });
        expect(decision.route).toBe('tools');
        expect(decision.state.selected?.id).not.toBe(appointment.ref.id);
    });

    it.each([
        'Quiero una cita y una habitación. Consulta si hay disponibilidad.',
        'Quiero una consulta médica y una habitación.',
        'Quero uma consulta se houver vaga no hotel.',
    ])('preserves a genuine appointment mention in %s', text => {
        expect(mentionedMissionDomains(text)).toContain('appointment');
        expect(mentionedMissionDomains(text)).toContain('property');
    });

    it('preserves a consultation as the only domain and a named appointment resume', () => {
        expect(mentionedMissionDomains('Quiero una consulta.')).toEqual(['appointment']);
        expect(mentionedMissionDomains('Retoma mi cita.')).toEqual(['appointment']);
    });
});
