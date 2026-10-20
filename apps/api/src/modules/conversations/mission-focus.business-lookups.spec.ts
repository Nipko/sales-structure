import { arbitrateMissionFocus, mentionedMissionDomains, newMissionFocus } from './mission-focus';
describe('owned lodging fact lookups do not create an appointment mission', () => {
    it.each(["Quiero alojar a 3 huéspedes en Spark QA Habitacion 20261018T113247Z. Consulta la capacidad máxima configurada y dime si caben los tres. No he indicado fechas: no confundas capacidad con disponibilidad y no reserves.", "Para Spark QA Habitacion 20261018T113247Z, consulta la tarifa por noche y el cargo de limpieza configurados. Calcula una estimación para 2 noches, desglosa ambos conceptos y di la moneda. No he dado fechas; esto no es una consulta de disponibilidad ni una reserva.", "¿Cuál es la estancia mínima en noches configurada para Spark QA Habitacion 20261018T113247Z? Consulta la ficha y dime solo ese requisito. No te estoy pidiendo disponibilidad para fechas ni que hagas una reserva."])('routes the actual customer question as lodging facts: %s', text => {
        expect(mentionedMissionDomains(text)).toEqual(['property']);
        const decision = arbitrateMissionFocus({ state: newMissionFocus(), candidates: [], text, messageId: 'synthetic-facts' });
        expect(decision.action).not.toBe('clarify');
    });
    it.each(['Consulta la capacidad configurada de la habitación.', 'Consulta el cargo de limpieza del alojamiento.'])('looks up a property attribute: %s', text => {
        expect(mentionedMissionDomains(text)).toEqual(['property']);
    });
    it.each(['Quiero una consulta médica y una habitación. Consulta la tarifa.', 'Quiero una cita y una habitación. Consulta la capacidad.'])('retains a real medical task alongside lodging: %s', text => {
        expect(mentionedMissionDomains(text)).toContain('appointment');
        expect(mentionedMissionDomains(text)).toContain('property');
    });
});
