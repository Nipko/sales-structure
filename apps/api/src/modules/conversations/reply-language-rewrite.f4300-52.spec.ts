import { closerToTurnLanguage, languageMismatch, rewriteRejection, withoutSentencesIn } from './reply-language';

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

    // Production QA 29-oct: these closing questions share too many words with Portuguese to score as Spanish; «¿» is Spanish only.
    it.each([
        ['pt', 'O Audífono QA Aurora tem um preço atual de 119.900 COP e há 2 unidades disponíveis em stock. ¿Le gustaría que le ayude a hacer un pedido?',
            'O Audífono QA Aurora tem um preço atual de 119.900 COP e há 2 unidades disponíveis em stock.'],
        ['fr', 'La durée du Spark QA Tour 20261018T2140Z est de 4 heures. ¿Desea saber algo más sobre este tour?',
            'La durée du Spark QA Tour 20261018T2140Z est de 4 heures.'],
    ])('a closing question opened with «¿» in a %s reply is Spanish: flagged, and dropped from the rewrite', (code, text, kept) => {
        expect(languageMismatch(text, code)).toBe('es');
        expect(withoutSentencesIn(text, 'es', code)).toBe(kept);
    });

    // Production QA 29/30-oct (real estate, French, three times): a sentence opened in Spanish and finished in French.
    it.each([
        'La propiedad tiene 2 chambres, 1 salle de bain et une superficie de 80 mètres carrés. Si vous souhaitez, je peux vous aider à organiser une visite ou vous fournir plus de détails.',
        "La propiedad a la que se refiere tiene 2 chambres et 1 salle de bain. Si vous souhaitez plus d'informations ou organiser une visite, n'hésitez pas à me le faire savoir.",
    ])('«%s» is a French reply with a Spanish sentence', text => {
        expect(languageMismatch(text, 'fr')).toBe('es');
    });

    it('«¿» never flags a Spanish reply, and a two-word «¡Hola!» is not a sentence', () => {
        expect(languageMismatch('El precio es de 119.900 COP. ¿Le gustaría hacer un pedido?', 'es')).toBeNull();
        expect(languageMismatch('Le prix est de 119 900 COP, merci beaucoup pour votre question. ¡Hola amigo!', 'fr')).toBeNull();
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

/** F4300-16 (production QA 29-oct): a Spanish courtesy close to «D'accord, merci.» / «Obrigado» was never seen as Spanish. */
describe('F4300-16 · a Spanish courtesy close is Spanish', () => {
    it.each([
        'Con mucho gusto. Si necesita algo más, no dude en contactarme. ¡Que tenga un buen día!',
        '¡De nada! Si necesita algo más, aquí estoy para ayudarle. 😊',
    ])('«%s» to a French or Portuguese turn', reply => {
        expect(languageMismatch(reply, 'fr')).toBe('es');
        expect(languageMismatch(reply, 'pt')).toBe('es');
        expect(languageMismatch(reply, 'es')).toBeNull();
    });

    it('the same close in Portuguese or French is not Spanish', () => {
        expect(languageMismatch('Com muito gosto. Se precisar de algo mais, estou aqui para ajudar. Tenha um bom dia!', 'pt')).toBeNull();
        expect(languageMismatch('Avec plaisir. Si vous avez besoin d’autre chose, n’hésitez pas. Bonne journée !', 'fr')).toBeNull();
    });
});
