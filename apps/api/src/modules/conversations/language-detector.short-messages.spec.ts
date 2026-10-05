import { LanguageDetectorService } from './language-detector.service';

/**
 * QA Telegram campaign 2026-10-05 (I09-I11, V07, V08, C06, C07, C10): clear
 * English/Portuguese/French questions were answered in Spanish. The detector
 * needs two marker words, so a normal sentence scores 0-1, falls back to the
 * tenant/previous language, and the prompt rule "Reply in <turn><language>"
 * then makes the model answer in Spanish.
 */
describe('LanguageDetectorService on ordinary single-sentence messages', () => {
    const detector = new LanguageDetectorService();

    it.each([
        ["I'm looking for an apartment to buy in Chapinero, budget up to 500 million COP.", 'en'],
        ['Procuro um apartamento para comprar em Chapinero, orçamento de até 500 milhões.', 'pt'],
        ["Je cherche un appartement à acheter à Chapinero, budget jusqu'à 500 millions.", 'fr'],
        ['Qual é o horário de funcionamento?', 'pt'],
        ["Quels sont vos horaires d'ouverture ?", 'fr'],
        ['Quais pacotes de viagem vocês têm para 2 pessoas em dezembro?', 'pt'],
        ['Quels forfaits de voyage avez-vous pour 2 personnes en décembre ?', 'fr'],
    ])('detects %s as %s instead of falling back to es', (text, expected) => {
        expect(detector.detect(text, 'es')).toBe(expected);
    });
});

describe('LanguageDetectorService keeps Spanish and ambiguous input safe', () => {
    const detector = new LanguageDetectorService();

    it.each([
        'Hola, quiero agendar un corte',
        'Cuanto cuesta el corte?',
        'Necesito una cita para mañana',
        '¿Tienen disponibilidad el sábado?',
    ])('short Spanish stays Spanish even when the fallback is another language: %s', text => {
        expect(detector.detect(text, 'en')).toBe('es');
    });

    it.each([
        ['ok', 'pt'],
        ['👍', 'en'],
        ['Chapinero 500 millones', 'fr'],
        ['Quiero un hair cut for tomorrow', 'pt'], // es 1 vs en 1: ambiguous
    ])('ambiguous or empty input falls back to the supplied language: %s', (text, fallback) => {
        expect(detector.detect(text, fallback)).toBe(fallback);
    });

    it('"tres" (Spanish for three) is not read as French "très"', () => {
        expect(detector.detect('Somos tres personas y queremos viajar en diciembre', 'pt')).toBe('pt');
    });

    it('a lone distinctive diacritic is enough, a shared one is not', () => {
        expect(detector.detect('milhões', 'es')).toBe('pt');
        expect(detector.detect('où ça', 'es')).toBe('fr');
        expect(detector.detect('café ç', 'en')).toBe('en');
    });

    it('a reliable detection wins over the previous-language fallback', () => {
        expect(detector.detect('Quels sont vos horaires ?', 'pt')).toBe('fr');
        expect(detector.detect('Quais são os pacotes?', 'es')).toBe('pt');
    });
});
