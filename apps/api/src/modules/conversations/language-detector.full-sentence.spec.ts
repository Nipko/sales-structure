import { LanguageDetectorService } from './language-detector.service';

/**
 * Inmobiliaria QA, 2026-10-09 (RI08 → RI09): the chat was English, the customer wrote «Me interesa ver un apartamento
 * en Chapinero, ¿cómo funcionan las visitas?» and the agent answered «Visits to apartments are scheduled with a real
 * estate advisor…». The sentence carried a single marker (the ¿), and a lone marker never switches a stored language.
 *
 * A whole sentence in another language IS the customer's language now; a lone borrowed word, a brand or a courtesy word
 * still is not. ¿ ¡ ñ are unmistakably Spanish and count double; Spanish function words count as evidence.
 */
describe('a full sentence in another language switches a sticky language', () => {
    const detector = new LanguageDetectorService();

    it('the RI09 message after an English chat is Spanish and the switch is persisted', () => {
        const text = 'Me interesa ver un apartamento en Chapinero, ¿cómo funcionan las visitas?';
        expect(detector.detect(text, 'es', 'en')).toBe('es');
        expect(detector.detectDetailed(text, 'es', 'en')).toEqual({ language: 'es', persist: true });
    });

    it.each([
        ['Busco un apartamento en Usaquén de tres habitaciones, ¿hay opciones?', 'en', 'es'],
        ['¡Hola! Me gustaría conocer las opciones que tienen para los viajeros de la familia', 'en', 'es'],
        ['Mañana estaré en la oficina con mis hijos y quiero ver el inmueble', 'en', 'es'],
        ['The apartment is near the park and I would like to see it on Saturday', 'es', 'en'],
        ['Je cherche un appartement dans le quartier avec une terrasse pour ma famille', 'es', 'fr'],
        ['Preciso de um apartamento com garagem para a minha família e os meus filhos', 'es', 'pt'],
    ])('"%s" (stored %s) is %s', (text, stored, expected) => {
        expect(detector.detect(text, stored, stored)).toBe(expected);
    });

    it('¿ ¡ ñ count as strong evidence once the message has a few words', () => {
        // Two strong pieces: the character (weighing two) and nothing else is enough in a message of three words.
        expect(detector.detect('¿cuándo abren hoy?', 'en', 'en')).toBe('es');
        expect(detector.detect('mañana por la tarde', 'en', 'en')).toBe('es');
    });

    describe('does not flap on short or ambiguous messages (the existing guard rails hold)', () => {
        it.each([
            ['What are your opening hours?', 'en'],
            ['me mandas el link please', 'es'],
            ['quiero ver el menu please', 'en'],
            ['gracias', 'en'],
            ['thanks', 'es'],
            ['hola', 'en'],
            ['ok', 'es'],
            ['what?', 'es'],
            ['el Want Pack', 'es'],
            ['cual', 'en'],
            ['¿ok?', 'en'],
            // five words, but only ONE piece of Spanish: a brand and a loan word in an English chat
            ['I want the Plan Aurora el sabado', 'en'],
            // an English sentence that borrows a Spanish place name keeps English
            ['Send me the details for Las Vegas please', 'en'],
            // five words with no sign of English but only one or two pieces of Spanish: a name and a loan word, not a new language
            ['Plan Aurora el sabado por favor', 'en'],
            ['Hotel Aurora con las vistas al mar', 'en'],
            ['Cabana Aurora del lago norte', 'en'],
        ])('"%s" keeps %s', (text, stored) => {
            expect(detector.detect(text, stored, stored)).toBe(stored);
        });

        it('a sentence that still shows a sign of the stored language does not switch', () => {
            // «apartment» ... «the» are English function words; the Spanish part is only a name and a loan word.
            expect(detector.detect('Is the apartamento in Chapinero still available for rent', 'en', 'en')).toBe('en');
        });

        it('with no stored language the sentence is judged on its own, as before', () => {
            expect(detector.detect('Me interesa ver un apartamento en Chapinero, ¿cómo funcionan las visitas?', 'es')).toBe('es');
            expect(detector.detect('xyz', 'pt')).toBe('pt');
        });
    });
});
