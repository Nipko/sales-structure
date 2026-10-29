import { pickTopicFallbackFaq } from './faq-search';

/**
 * F4300-53 (production QA 29-oct, FAQ bank generated from the tenants' published FAQs): «what languages is the tour in?» asked which
 * tour instead of answering «¿En qué idiomas se hace el tour?», and «Qual é o horário de funcionamento?» / «What are your operating
 * hours?» were told the hours are not configured next to the business's own hours FAQ.
 */
const faq = (id: string, question: string) => ({ id, question, answer: 'Respuesta publicada.' } as any);
const TRAVEL = [faq('lang', '¿En qué idiomas se hace el tour?'), faq('incl', '¿Qué incluye el paquete?'), faq('meet', '¿Dónde es el punto de encuentro?')];
const FOOD = [faq('hours', '¿Cuál es el horario del restaurante?'), faq('book', '¿Cómo hago una reserva?'), faq('avg', '¿Cuál es el precio promedio por persona?')];
const CLINIC = [faq('hours', '¿Cuál es el horario de atención?'), faq('pay', '¿Cuáles son los métodos de pago?')];

describe('F4300-53 · tour languages and opening hours asked in other words', () => {
    it.each([
        ['what languages is the tour in?', 'lang'],
        ['en quelles langues se fait le tour ?', 'lang'],
        ['em que idiomas é o tour?', 'lang'],
        ['What languages are the tours conducted in?', 'lang'],
    ])('agency: %s → %s', (message, expected) => {
        expect(pickTopicFallbackFaq(TRAVEL, message)?.id ?? null).toBe(expected);
    });

    it.each([
        ['Qual é o horário de funcionamento de vocês?', 'hours'],
        ['What are your opening hours?', 'hours'],
        ["Quels sont vos horaires d'ouverture ?", 'hours'],
    ])('restaurant: %s → %s', (message, expected) => {
        expect(pickTopicFallbackFaq(FOOD, message)?.id ?? null).toBe(expected);
    });

    it.each([
        ['What are your operating hours?', 'hours'],
        ['¿cuál es su horario de funcionamiento?', 'hours'],
    ])('clinic: %s → %s', (message, expected) => {
        expect(pickTopicFallbackFaq(CLINIC, message)?.id ?? null).toBe(expected);
    });
});
