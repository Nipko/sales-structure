import { guardDescriptionStatusClaim } from './description-authority';

/**
 * F4300-35 residue (production 25-oct, tours QA tenant): the draft «includes a virtual tour and a synthetic guide, but does not
 * include transport or accommodation» lost its claim clause («a synthetic guide») and was sent as
 *   pt «Inclui um percurso virtual e mas não inclui transporte nem alojamento.»
 *   fr «Incluant un parcours virtuel et mais excluant le transport et l'hébergement.»
 * The «and» that joined the removed clause stayed right before the «but» of the next one. The orphan connector goes; a
 * connector left at the end of what is kept, before the punctuation, goes too.
 */
const TOUR = { packages: [{ name: 'Tour QA Aurora', description: 'Tour sintético de QA. No es una oferta comercial.', price: 125 }] };

describe('no orphan connector after a removed clause', () => {
    it.each([
        ['pt', 'Inclui um percurso virtual e um guia sintético, mas não inclui transporte nem alojamento.',
            'Inclui um percurso virtual, mas não inclui transporte nem alojamento.'],
        ['fr', "Incluant un parcours virtuel et un guide synthétique, mais excluant le transport et l'hébergement.",
            "Incluant un parcours virtuel, mais excluant le transport et l'hébergement."],
        ['es', 'Incluye un recorrido virtual y una guía sintética, pero no incluye transporte ni alojamiento.',
            'Incluye un recorrido virtual, pero no incluye transporte ni alojamiento.'],
        ['en', 'The Tour QA Aurora includes a virtual tour and a synthetic guide, but does not include transport or accommodation.',
            'The Tour QA Aurora includes a virtual tour, but does not include transport or accommodation.'],
        // No comma before the contrast: the contrast joins what is left, not the «and» of the removed clause.
        ['en', 'The Tour QA Aurora includes a virtual tour and a synthetic guide but does not include transport.',
            'The Tour QA Aurora includes a virtual tour but does not include transport.'],
        ['es', 'Incluye un recorrido virtual y una guía sintética, sin embargo no incluye transporte.',
            'Incluye un recorrido virtual, sin embargo no incluye transporte.'],
        ['pt', 'Inclui um percurso virtual e um guia sintético, porém não inclui transporte.',
            'Inclui um percurso virtual, porém não inclui transporte.'],
    ])('%s «%s»', (lang, reply, expected) => {
        const out = guardDescriptionStatusClaim({ reply, sources: [TOUR], lang });
        expect(out).toMatchObject({ changed: true, action: 'removed' });
        expect(out.text).toBe(expected);
    });

    it.each([
        ['es', 'Incluye un recorrido virtual y, además, una guía sintética.', 'Incluye un recorrido virtual.'],
        ['en', 'It includes a virtual tour and, also, a synthetic guide.', 'It includes a virtual tour.'],
        ['pt', 'Inclui um percurso virtual e, também, um guia sintético.', 'Inclui um percurso virtual.'],
        ['fr', 'Il comprend un parcours virtuel et, aussi, un guide synthétique.', 'Il comprend un parcours virtuel.'],
    ])('%s: a trailing connector before the punctuation goes («%s»)', (lang, reply, expected) => {
        const out = guardDescriptionStatusClaim({ reply, sources: [TOUR], lang });
        expect(out.text).toBe(expected);
    });

    it.each([
        // pt «e mais» is «and more», not an orphan pair.
        ['pt', 'O Tour QA Aurora é um passeio sintético de teste. Inclui guia e mais duas refeições.', 'Inclui guia e mais duas refeições.'],
        // A sentence the check does not touch keeps its words.
        ['es', 'El Tour QA Aurora es un tour sintético de QA. Incluye guía y pero también comida.', 'Incluye guía y pero también comida.'],
    ])('%s: untouched text stays («%s»)', (lang, reply, expected) => {
        const out = guardDescriptionStatusClaim({ reply, sources: [TOUR], lang });
        expect(out.text).toBe(expected);
    });

    it('an uppercase final letter is a name, not a connector («vitamina E»)', () => {
        const dish = { items: [{ name: 'Spark QA Plato', description: 'Plato sintético de QA.', price: 13500 }] };
        const out = guardDescriptionStatusClaim({ reply: 'El Spark QA Plato es un plato sintético de QA, con arroz, pollo y vitamina E.', sources: [dish], lang: 'es' });
        expect(out.text).toMatch(/vitamina E\.$/);
    });
});
