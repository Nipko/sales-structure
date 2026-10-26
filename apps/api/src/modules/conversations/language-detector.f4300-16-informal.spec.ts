import { LanguageDetectorService } from './language-detector.service';

/**
 * F4300-16 residual (production QA 26-oct, image 994c54a7): Portuguese typed the way customers type, right after a Spanish
 * case, was answered in Spanish: «onde fika o spark qa inmueble» and «qto dura a consulta geral».
 */
describe('F4300-16 · informal Portuguese after a Spanish case', () => {
    const detector = new LanguageDetectorService();

    it.each([
        ['onde fika o spark qa inmueble', ['Spark QA Inmueble']],
        ['qto dura a consulta geral', ['Consulta general']],
    ])('«%s» is Portuguese', (text, names) => {
        expect(detector.detectDetailed(text, 'es', 'es', { names }).language).toBe('pt');
    });

    it.each([
        ['donde keda el spark qa inmueble', 'pt', 'es'],
        ['ok what', 'es', 'es'],
        ['how?', 'es', 'es'],
    ])('«%s» with «%s» stored stays «%s»', (text, stored, expected) => {
        expect(detector.detectDetailed(text, 'es', stored, { names: ['Spark QA Inmueble'] }).language).toBe(expected);
    });
});
