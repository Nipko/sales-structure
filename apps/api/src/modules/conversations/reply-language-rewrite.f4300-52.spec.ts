import { closerToTurnLanguage, rewriteRejection, withoutSentencesIn } from './reply-language';

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

/**
 * F4300-16 (production QA 29-oct, POST292-FONE-PT on image fa13d55e): the turn was detected as Portuguese, both rewrites of the
 * Spanish warranty reply kept every figure and name but held one Spanish sentence, and the reply wholly in Spanish went out.
 */
describe('F4300-16 · a rewrite closer to the turn language than the reply', () => {
    const SPANISH = 'El audífono QA Aurora tiene garantía de 72 días calendario desde la entrega. Es una garantía específica para este producto de prueba. ¿Le gustaría saber algo más sobre este audífono?';
    const ONE_LEFT = 'O audífono QA Aurora tem garantia de 72 dias corridos a partir da entrega. Es una garantía específica para este producto de prueba. Gostaria de saber mais alguma coisa?';

    it('has fewer sentences in the source language and one in the turn language', () => {
        expect(closerToTurnLanguage(ONE_LEFT, SPANISH, 'es', 'pt', ['Audífono QA Aurora'])).toBe(true);
    });

    it('a rewrite as Spanish as the reply, or with nothing in the turn language, is not closer', () => {
        expect(closerToTurnLanguage(SPANISH, SPANISH, 'es', 'pt', ['Audífono QA Aurora'])).toBe(false);
        expect(closerToTurnLanguage('Es una garantía específica para este producto de prueba.', SPANISH, 'es', 'pt')).toBe(false);
    });
});
