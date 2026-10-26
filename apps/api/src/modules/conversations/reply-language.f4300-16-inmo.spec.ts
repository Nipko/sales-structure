import { languageMismatch } from './reply-language';

/**
 * F4300-16 residual (production QA 26-oct): «qual o endereço do Spark QA Inmueble?» got a reply in Spanish only,
 * «O Spark QA Inmueble está ubicado en Calle Sintetica QA 123, en la ciudad Spark QA Ciudad. ¿Le gustaría saber algo
 * más?», and the guard let it out: of its words only «gustaría» counted as Spanish.
 */
const NAMES = ['Spark QA Inmueble 20261018T113247Z', 'Spark QA Inmueble'];

describe('F4300-16 · a Spanish address reply to a Portuguese turn', () => {
    it('is seen as Spanish', () => {
        const reply = 'O Spark QA Inmueble está ubicado en Calle Sintetica QA 123, en la ciudad Spark QA Ciudad. ¿Le gustaría saber algo más?';
        expect(languageMismatch(reply, 'pt', NAMES)).toBe('es');
    });

    it('the Portuguese reply with the same Spanish address is left alone', () => {
        const reply = 'O Spark QA Inmueble está localizado na Calle Sintetica QA 123, na cidade Spark QA Ciudad. Posso ajudar com mais alguma coisa?';
        expect(languageMismatch(reply, 'pt', NAMES)).toBeNull();
    });
});
