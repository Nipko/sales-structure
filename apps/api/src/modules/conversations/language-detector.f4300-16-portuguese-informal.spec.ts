import { LanguageDetectorService } from './language-detector.service';

/**
 * F4300-16 (production QA 28-oct): «oi, somos um grupo de 12 amigos», «com 30.000 pesos, dá para dois pratos Spark?» and «a
 * coloração e tratamento demora qto mais ou menos?» were read as Spanish — or as the English stored from an earlier case — and
 * answered in that language; «l’audifono aurora a un fil ?» was read as Spanish. Portuguese and French spellings no other of the
 * four languages uses («oi», «dois», «qto», «pratos», «fio», «fil») decide the turn.
 */
const detector = new LanguageDetectorService();

describe('F4300-16 · informal Portuguese and short French are their own language', () => {
    it.each([
        ['oi, somos um grupo de 12 amigos', 'pt'], ['com 30.000 pesos, dá para dois pratos Spark?', 'pt'],
        ['a coloração e tratamento demora qto mais ou menos?', 'pt'], ['qto custa a manicure e pedicure?', 'pt'],
        ['o audifono aurora tem fio?', 'pt'], ['l’audifono aurora a un fil ?', 'fr'],
    ])('«%s» → %s, whatever the stored language', (text, lang) => {
        for (const previous of ['en', 'es', 'fr', 'pt', null]) {
            expect(detector.detect(text, 'es', previous)).toBe(lang);
        }
    });

    it.each(['Um, no sé', 'me mandas el link please', 'hola, ¿tienen cable HDMI?'])('«%s» stays Spanish after Spanish', text => {
        expect(detector.detect(text, 'es', 'es')).toBe('es');
    });
});
