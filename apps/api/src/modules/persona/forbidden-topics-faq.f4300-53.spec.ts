import { PersonaService } from './persona.service';

/**
 * F4300-53 (production QA 29-oct, «Agencia QA Viajes»): with «Información migratoria oficial» as a forbidden topic, «¿necesito pasaporte
 * para viajar?» was refused in four languages although search_faqs retrieved the business's own «¿Qué documentos necesito para viajar?».
 */
const config = {
    persona: { name: 'Maya', role: 'Asesora', personality: {} },
    behavior: { mainInstructions: 'Atiende', rules: [], forbiddenTopics: ['Información migratoria oficial', 'Vacunas requeridas'], handoffTriggers: [] },
    hours: {}, industry: 'turismo', language: 'es',
} as any;

describe('F4300-53 · a forbidden topic yields to the business own FAQ', () => {
    const persona = new PersonaService({} as any, {} as any, {} as any, {} as any, {} as any);

    it('the forbidden topics say that a retrieved business FAQ is answered with what it says', () => {
        const prompt = persona.buildSystemPrompt(config);
        expect(prompt).toContain('<topic>Información migratoria oficial</topic>');
        expect(prompt).toContain('When the business FAQs or documents retrieved this turn answer the question, answer with exactly what they say.');
    });
});
