import { isItemAttributeQuestion, needsItemDetailRead } from './operation-lexical-cues';

/**
 * F4300-08 (production QA 27-oct, store tenant, image 1a719d86): «¿el Audífono QA Aurora es de cable?» and «l’Audífono QA Aurora
 * est-il filaire ?» read only search_faqs and were answered «no tengo información» — the product's record says it is wireless.
 * Whether an item is wired or wireless is one of its attributes: the turn reads the product.
 */
describe('F4300-08 · wired or wireless is read from the product', () => {
    it.each([
        '¿el Audífono QA Aurora es de cable?', 'l’Audífono QA Aurora est-il filaire ?', 'is the Audífono QA Aurora wired?',
        'o Audífono QA Aurora é com fio?', '¿es inalámbrico?', 'é sem fio?', 'est-il sans fil ?', 'does it have bluetooth?',
    ])('«%s» reads the product', text => {
        expect(isItemAttributeQuestion(text)).toBe(true);
        expect(needsItemDetailRead(text)).toBe(true);
    });

    it.each(['¿cuál es la política de garantía de la tienda?', '¿cuánto cuesta en pesos?'])('still not an attribute: «%s»', text => {
        expect(isItemAttributeQuestion(text)).toBe(false);
    });
});

describe('F4300-08 · «does it have a cable?» is the same attribute (production QA 28-oct)', () => {
    it.each([
        'el audifono aurora tiene cable?', 'o audifono aurora tem fio?', 'does the aurora headphone have a cable?',
        'l’audifono aurora a un fil ?', '¿trae cable?', 'vem com fio?',
    ])('«%s» reads the product', text => {
        expect(isItemAttributeQuestion(text)).toBe(true);
        expect(needsItemDetailRead(text)).toBe(true);
    });

    it.each(['¿cuánto cuesta el envío?', 'a qué hora abren?'])('not an attribute: «%s»', text => {
        expect(isItemAttributeQuestion(text)).toBe(false);
    });
});
