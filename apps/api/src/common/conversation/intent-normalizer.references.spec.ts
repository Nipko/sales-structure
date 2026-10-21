import { normalizeCustomerIntent } from './intent-normalizer';

const classify = (text: string) => normalizeCustomerIntent(text, { country: 'CO', maxLength: Number.MAX_SAFE_INTEGER });
describe('human request boundaries around structured record references', () => {
    it.each(['QA04', 'QA09'])('does not escalate the exact task-title scenario for %s', account => {
        const text = `Esta es otra solicitud de seguimiento. Necesito que su equipo me contacte y quiero una tarea titulada "QA-AGENTE-${account}-SEGUIMIENTO-20261020-2112-FECHA-PASADA", con fecha exacta 2020-01-01T10:00:00Z. Esa fecha ya pasó. No cambie la fecha por su cuenta ni cree una tarea sin fecha: pregúnteme qué fecha futura quiero usar. No guarde notas ni transfiera la conversación.`;
        expect(classify(text).intent).not.toBe('request_human');
    });
    it.each([
        'Necesito información del registro REF-AGENTE-2026-17.',
        'Quiero revisar la referencia ref_agente_2026_17.',
        'I need information about REF-HUMAN-AGENT-2026-17.',
        'Preciso consultar REF-ATENDENTE-2026-17.',
        'Je veux consulter REF-CONSEILLER-2026-17.',
    ])('does not turn reference data into a human request: %s', text => {
        expect(classify(text).intent).not.toBe('request_human');
    });
    it.each([
        'Necesito hablar con un agente. Mi referencia es QA-AGENTE-2026-17.',
        'Quiero hablar con "un asesor".',
        'Necesito un agente de atención las 24 horas.',
        'Quiero hablar con un agente-experto.',
        'No quiero reservar, pero necesito hablar con un asesor.',
        'I need to talk to a human agent about REF-AGENT-2026-17.',
        'Preciso falar com um atendente sobre REF-ATENDENTE-2026-17.',
        'Je veux parler à un conseiller pour REF-CONSEILLER-2026-17.',
    ])('preserves a separate real person request: %s', text => {
        expect(classify(text).intent).toBe('request_human');
    });
});
