import { rewriteRejection, withoutSentencesIn } from './reply-language';

/**
 * F4300-52 (production QA 28-oct, store tenant): the warranty FAQ written in Spanish answered a Portuguese question in Spanish; the
 * language guard's rewrite to Portuguese left its closing question in Spanish, was rejected whole («still_source_language») and the
 * Spanish reply went out. A closing question still in the language being left is dropped when the rest keeps every figure and
 * name; a sentence of substance never is.
 */
const ORIGINAL = 'La garantía del audífono de prueba QA Aurora es de 72 días calendario desde la entrega. ¿Le puedo ayudar con algo más?';
const MIXED = 'A garantia do audífono de teste QA Aurora é de 72 dias corridos a partir da entrega. ¿Le puedo ayudar con algo más?';

describe('F4300-52 · a rewrite with one sentence left in the source language', () => {
    it('is rejected whole as it stands', () => {
        expect(rewriteRejection(ORIGINAL, MIXED, ['Audífono QA Aurora'], 'es', 'pt')?.reason).toBe('still_source_language');
    });

    it('without that sentence keeps the figure and is accepted', () => {
        const pruned = withoutSentencesIn(MIXED, 'es', 'pt');
        expect(pruned).toBe('A garantia do audífono de teste QA Aurora é de 72 dias corridos a partir da entrega.');
        expect(rewriteRejection(ORIGINAL, pruned!, ['Audífono QA Aurora'], 'es', 'pt')).toBeNull();
    });

    it('a closing question in the turn language: nothing to drop', () => {
        expect(withoutSentencesIn('A garantia é de 72 dias corridos a partir da entrega. Posso ajudar com mais alguma coisa?', 'es', 'pt')).toBeNull();
    });

    it('a sentence of substance left in the other language is never dropped', () => {
        const advice = 'Sinto muito que esteja passando por isso. Le recomiendo que busque atención urgente en la clínica o en un servicio de urgencias odontológicas.';
        expect(withoutSentencesIn(advice, 'es', 'pt')).toBeNull();
    });
});
