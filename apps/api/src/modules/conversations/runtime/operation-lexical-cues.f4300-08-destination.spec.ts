import { lexicalRequiredReadsOperation, tourQuestionOperation } from './operation-lexical-cues';

/**
 * F4300-08 (production QA 26-oct, travel tenant, image 6f1d3bf6): «¿a qué destino va el Tour QA Aurora?» and its pt/en/fr twins ran
 * only search_faqs and were answered «no tengo información confirmada sobre el destino específico» — the package says «Destino QA
 * Aurora». Where a tour goes, and where it leaves from, are in the package: the turn reads it.
 */
const TOURS = ['search_packages'];

describe('F4300-08 · where a tour goes is read from the package', () => {
    it.each([
        '¿a qué destino va el Tour QA Aurora?', 'para qual destino vai o Tour QA Aurora?', 'where does the Tour QA Aurora go?',
        'quelle est la destination du Tour QA Aurora ?', '¿desde dónde sale el Tour QA Aurora?', 'de onde sai o Tour QA Aurora?',
        'd’où part le Tour QA Aurora ?', 'where does the Tour QA Aurora depart from?', '¿cuál es el punto de encuentro del tour?',
    ])('«%s»', text => {
        expect(tourQuestionOperation(text)).toBe('package_info');
        expect(lexicalRequiredReadsOperation(text, 'tours', TOURS)).toBe('package_info');
    });

    it('a destination with no tour named is not a package question («¿cuál es su destino favorito?»)', () => {
        expect(tourQuestionOperation('¿cuál es su destino favorito?')).toBeNull();
    });
});
