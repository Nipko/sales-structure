import { pickTopicFallbackFaq } from './faq-search';
import { LanguageDetectorService } from '../conversations/language-detector.service';

/**
 * F4300-53 (production QA 29-oct, image c6facac4): real FAQs of the dental clinic and the restaurant asked in other words were not
 * found — the agent invented an on-call number for «urgence dentaire», said sedation is not offered, or asked how many people an
 * order was for. F4300-16: «como funciona a garantia do fone?» was answered in Spanish.
 */
const faq = (id: string, question: string, answer: string) => ({ id, question, answer } as any);
const URGENCY = faq('urgency', '¿Atienden urgencias dentales?', 'Si tienes dolor intenso, un golpe o sangrado abundante, te conecto YA con la clínica.');
const FEAR = faq('fear', '¿Cómo manejan el dolor o miedo al dentista?', 'Es una preocupación muy común. Las opciones de manejo del dolor y de la ansiedad las evalúa la profesional.');
const CLEANING = faq('clean', '¿Cuánto cuesta una limpieza dental?', 'El costo varía según el tipo de limpieza.');
const AVERAGE = faq('average', '¿Cuál es el precio promedio por persona?', 'Depende de lo que pidas. Escribe "menú" y te muestro la carta.');
const HOURS = faq('hours', '¿Cuál es el horario de atención?', 'Cuéntame qué día te sirve y te confirmo el horario.');
const ROWS = [URGENCY, FEAR, CLEANING, AVERAGE, HOURS];

describe('F4300-53 · dental urgency, fear of the dentist, average price per person', () => {
    it.each([
        ['que faire en cas d’urgence dentaire ?', 'urgency'],
        ['what should I do in a dental emergency?', 'urgency'],
        ['o que fazer em caso de emergência dentária?', 'urgency'],
        ['j’ai peur du dentiste, comment gérez-vous cela ?', 'fear'],
        ['I am scared of the dentist, how do you handle it?', 'fear'],
        ['tenho medo de dentista, como vocês lidam com isso?', 'fear'],
        ['what is the average price per person?', 'average'],
        ['how much is a dental cleaning?', 'clean'],
        ['what is the price of the Aurora headphones?', null],
    ])('%s → %s', (message, expected) => {
        expect(pickTopicFallbackFaq(ROWS, message)?.id ?? null).toBe(expected);
    });

    it('«como funciona a garantia do fone?» is Portuguese', () => {
        expect(new LanguageDetectorService().detect('como funciona a garantia do fone?', 'es', 'es')).toBe('pt');
    });
});
