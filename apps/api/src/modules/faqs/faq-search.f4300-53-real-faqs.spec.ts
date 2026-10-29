import { pickTopicFallbackFaq, withEquivalents, topicTermsOf } from './faq-search';

/**
 * F4300-53 (production QA 29-oct, image ad8dde51): real published FAQs of the QA tenants (read from their DB) asked in other words or
 * another language were not found — and the dental clinic, finding no FAQ, said it does not offer cleanings.
 */
const faq = (id: string, question: string, answer: string) => ({ id, question, answer } as any);
const CLEANING = faq('clean', '¿Cuánto cuesta una limpieza dental?', 'El costo varía según el tipo de limpieza (rutinaria o profunda). Te lo confirmamos en la valoración previa.');
const KIDS = faq('kids', '¿Hay descuento para niños?', 'Las tarifas para niños dependen del paquete y de la edad.');
const FIRST = faq('first', '¿Qué documentos necesito para la primera visita?', 'Trae tu documento de identidad y, si tienes seguro médico, el carné.');
const OTHER = faq('hours', '¿Cuál es el horario de atención?', 'Cuéntame qué día te sirve y te confirmo el horario.');
const ROWS = [CLEANING, KIDS, FIRST, OTHER];

describe('F4300-53 · real FAQs asked in other words', () => {
    it.each([
        ['how much is a dental cleaning?', 'clean'],
        ['combien coûte un détartrage ?', 'clean'],
        ['quanto custa uma limpeza dental?', 'clean'],
        ['do kids pay less?', 'kids'],
        ['¿los niños pagan menos?', 'kids'],
        ['crianças pagam menos?', 'kids'],
        ['les enfants paient-ils moins cher ?', 'kids'],
        ['what should I bring to my first visit?', 'first'],
        ['¿qué tengo que llevar a mi primera cita?', null],
    ])('%s → %s', (message, expected) => {
        expect(pickTopicFallbackFaq(ROWS, message)?.id ?? null).toBe(expected);
    });

    it('the candidate search spells the topic in the four languages', () => {
        expect(withEquivalents(topicTermsOf('how much is a dental cleaning?'))).toEqual(expect.arrayContaining(['limpieza']));
    });
});
