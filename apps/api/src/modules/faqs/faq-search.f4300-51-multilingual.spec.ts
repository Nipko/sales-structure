import type { FAQ } from '@parallext/shared';
import { pickTopicFallbackFaq, topicTermsOf, withEquivalents } from './faq-search';

/**
 * F4300-51 (production QA 28-oct, store tenant): the FAQ «¿Cuál es el plazo de garantía QA del audífono de prueba?» was found in
 * Spanish only; «how long is the warranty on the QA test headphone?», «combien de temps dure la garantie de l’audífono QA de test ?»
 * and «quanto tempo dura a garantia do audífono QA de teste?» got «no tengo información».
 */
const faq = (id: string, question: string, answer: string) => ({ id, question, answer, category: null, tags: [], orderIndex: 0, isPublished: true } as unknown as FAQ);
const STORE = [
    faq('hours', '¿Cuál es el horario de atención?', 'Cuéntame qué día te sirve y te confirmo nuestro horario de atención.'),
    faq('pay', '¿Cuáles son los métodos de pago?', 'Te confirmamos los medios de pago disponibles según lo que necesites.'),
    faq('where', '¿Dónde están ubicados?', 'Con gusto te compartimos nuestra dirección y cómo llegar.'),
    faq('returns', '¿Tienen política de devolución?', 'Cuéntanos tu caso y te confirmamos qué condiciones de cambio o devolución aplican.'),
    faq('warranty', '¿Cuál es el plazo de garantía QA del audífono de prueba?', 'Para este piloto ficticio, el audífono QA tiene garantía de 72 días calendario desde la entrega.'),
];

describe('F4300-51 · a FAQ written in one language answers the same question in the other three', () => {
    it.each([
        '¿cuánto dura la garantía del audífono QA de prueba?',
        'how long is the warranty on the QA test headphone?',
        'combien de temps dure la garantie de l’audífono QA de test ?',
        'quanto tempo dura a garantia do audífono QA de teste?',
    ])('«%s» → the warranty FAQ', message => {
        expect(pickTopicFallbackFaq(STORE, message)?.id).toBe('warranty');
    });

    it.each([
        ['what payment methods do you accept?', 'pay'], ['quais são os métodos de pagamento?', 'pay'],
        ['do you have a returns policy?', 'returns'], ['quels sont vos horaires ?', 'hours'],
    ])('«%s» → %s', (message, id) => {
        expect(pickTopicFallbackFaq(STORE, message)?.id).toBe(id);
    });

    it.each(['how long does shipping take to Medellín?', 'is the Aurora tour in English?', 'what colour is the headphone?'])('nothing to answer «%s»', message => {
        expect(pickTopicFallbackFaq(STORE, message)).toBeNull();
    });

    it('the candidate search looks for every spelling of the topic', () => {
        expect(withEquivalents(topicTermsOf('how long is the warranty?'))).toEqual(expect.arrayContaining(['warranty', 'garantia', 'garantie']));
    });
});
