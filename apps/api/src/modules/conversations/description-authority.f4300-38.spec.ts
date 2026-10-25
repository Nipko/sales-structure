import { guardDescriptionStatusClaim } from './description-authority';

/**
 * F4300-38 (production 25-oct, tours QA tenant, image 45dd708a): asked what the Tour QA Aurora includes, 6 of 12 replies said
 * only what it does NOT include. The worker log shows the drafts the description guard removed whole:
 *   pt «O pacote Tour QA Aurora inclui um percurso virtual com guia sintética. Não inclui transporte nem alojamento.»
 *   fr «Le Tour QA Aurora comprend un parcours virtuel avec un guide synthétique. Il n'inclut pas le transport…»
 * The clause had no delimiter to split at, so «sintética» took «inclui um percurso virtual» with it. A clause that says what
 * the item includes, whose only claim is that adjective, keeps what it includes without the adjective.
 */
const TOUR = { packages: [{ name: 'Tour QA Aurora 20261014', price: 129000,
    description: 'Experiencia ficticia exclusiva para QA. No es una oferta comercial ni permite reservas reales. Incluye recorrido virtual y guía sintética; excluye transporte y alojamiento.' }] };
const guard = (reply: string, lang: string) => guardDescriptionStatusClaim({ reply, sources: [TOUR], lang });

describe('F4300-38 · what an item includes survives its claim adjective', () => {
    it.each([
        ['pt', 'O pacote Tour QA Aurora inclui um percurso virtual com guia sintética. Não inclui transporte nem alojamento.',
            'O pacote Tour QA Aurora inclui um percurso virtual com guia. Não inclui transporte nem alojamento.'],
        ['fr', "Le Tour QA Aurora comprend un parcours virtuel avec un guide synthétique. Il n'inclut pas le transport ni l'hébergement.",
            "Le Tour QA Aurora comprend un parcours virtuel avec un guide. Il n'inclut pas le transport ni l'hébergement."],
        ['es', 'El Tour QA Aurora incluye un recorrido virtual con guía sintética. No incluye transporte ni alojamiento.',
            'El Tour QA Aurora incluye un recorrido virtual con guía. No incluye transporte ni alojamiento.'],
        ['en', 'The Tour QA Aurora includes a virtual tour with a synthetic guide. It does not include transport or accommodation.',
            'The Tour QA Aurora includes a virtual tour with a guide. It does not include transport or accommodation.'],
    ])('%s: the inclusion is kept («%s»)', (lang, reply, expected) => {
        const out = guard(reply, lang);
        expect(out).toMatchObject({ changed: true, action: 'removed' });
        expect(out.text).toBe(expected);
    });

    it.each([
        ['es', 'El Tour QA Aurora es un tour sintético. Incluye un recorrido virtual.', 'Incluye un recorrido virtual.'],
        // «It» pointed at the removed sentence: it names the item (existing behaviour of the guard).
        ['en', 'The Tour QA Aurora is a synthetic tour for QA purposes. It includes a virtual tour.', 'Tour QA Aurora includes a virtual tour.'],
        ['pt', 'O Tour QA Aurora é um passeio fictício com guia. Inclui um percurso virtual.', 'Inclui um percurso virtual.'],
    ])('%s: a sentence saying the item itself is synthetic still goes («%s»)', (lang, reply, expected) => {
        expect(guard(reply, lang).text).toBe(expected);
    });

    it('a claim besides the adjective still takes the clause («not a commercial offer»)', () => {
        const out = guard('The Tour QA Aurora includes a synthetic guide and is not a commercial offer. It lasts 4 hours.', 'en');
        expect(out.text).not.toMatch(/commercial/);
        expect(out.text).toContain('It lasts 4 hours.');
    });
});
