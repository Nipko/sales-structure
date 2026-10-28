import { pickTopicFallbackFaq } from './faq-search';

/**
 * F4300-53 (production QA 28-oct, image 7e28ab93): the store's warranty FAQ «¿Cuál es el plazo de garantía QA del audífono de
 * prueba?» (72 days) was not found for «¿cuánto dura la garantía del Audífono QA Aurora?» in es/en/pt/fr — «prueba» counted as a
 * topic the message never says, and «Aurora» is not in the FAQ, so the FAQ was read as about something else.
 */
const faq = (id: string, question: string, answer: string) => ({ id, question, answer } as any);
const WARRANTY = faq('w', '¿Cuál es el plazo de garantía QA del audífono de prueba?',
    'Para este piloto ficticio, el audífono QA tiene garantía de 72 días calendario desde la entrega.');
const SHIPPING = faq('s', '¿Hacen envíos a todo el país?', 'Sí, enviamos a todo el país en 3 a 5 días hábiles.');

describe('F4300-53 · a generic marker in the FAQ question is not another topic', () => {
    it.each([
        '¿cuánto dura la garantía del Audífono QA Aurora?',
        'how long is the warranty on the Audífono QA Aurora?',
        'quanto tempo dura a garantia do Audífono QA Aurora?',
        'quelle est la durée de garantie de l’Audífono QA Aurora ?',
    ])('finds the warranty FAQ: %s', (message) => {
        expect(pickTopicFallbackFaq([WARRANTY, SHIPPING], message)?.id).toBe('w');
    });

    it('a different named topic still does not substitute («Faro Azul» for «Faro Rojo»)', () => {
        const azul = faq('a', '¿Cuánto dura el tour Faro Azul?', 'El tour Faro Azul dura 3 horas.');
        expect(pickTopicFallbackFaq([azul], '¿cuánto dura el tour Faro Rojo?')).toBeNull();
    });
});
