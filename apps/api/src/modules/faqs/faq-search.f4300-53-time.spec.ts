import { pickTopicFallbackFaq } from './faq-search';

/**
 * F4300-53 (production QA 29-oct, image 4714868a): after the price of the Audífono, «¿y cuánto tiempo tengo de garantía?» got «no tengo
 * información» — «tiempo» counted as a topic the warranty FAQ never says. «how long is the warranty?» found it.
 */
const faq = (id: string, question: string, answer: string) => ({ id, question, answer } as any);
const WARRANTY = faq('w', '¿Cuál es el plazo de garantía QA del audífono de prueba?',
    'Para este piloto ficticio, el audífono QA tiene garantía de 72 días calendario desde la entrega.');
const SHIPPING = faq('s', '¿Hacen envíos a todo el país?', 'Sí, enviamos a todo el país en 3 a 5 días hábiles.');

describe('F4300-53 · «cuánto tiempo» asks a duration', () => {
    it.each([
        '¿y cuánto tiempo tengo de garantía?',
        'e quanto tempo de garantia?',
        'et combien de temps dure la garantie ?',
        'and how long is the warranty?',
    ])('finds the warranty FAQ: %s', (message) => {
        expect(pickTopicFallbackFaq([WARRANTY, SHIPPING], message)?.id).toBe('w');
    });

    it('«tiempo» without a «cuánto» stays a topic word', () => {
        const weather = faq('t', '¿Qué tiempo hace en la playa?', 'Soleado casi todo el año.');
        expect(pickTopicFallbackFaq([WARRANTY], '¿qué tiempo hace en la playa?')).toBeNull();
        expect(pickTopicFallbackFaq([weather], '¿qué tiempo hace en la playa?')?.id).toBe('t');
    });
});
