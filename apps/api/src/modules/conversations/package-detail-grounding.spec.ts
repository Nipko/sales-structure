import { packageDetailIdForQuestion as resolve, requiresPackageDetailLookup as requires } from './package-detail-grounding';
const id = '76775f40-2fdd-48e2-9db5-c6afa93573dc';
const other = '847fdf5f-49ff-4b8f-8c3d-f13baaf651b5';
const name = 'Spark QA Tour 20261018T2140Z';
const row = { id, name };
const ask = `Del ${name}, ¿qué equipaje debo llevar y qué incluye?`;

describe('current named package detail lookup', () => {
    it.each([ask, `¿En qué idioma se realiza el ${name}?`, 'How long does this tour last?', 'Qual a duração do pacote?', 'Quelle est la durée du forfait?', 'Quelles langues pour le tour?', 'What should I bring for the tour?', '¿Qué condiciones de cancelación tiene el tour? No quiero cancelar.'])('recognizes a detail question: %s', text => expect(requires(text)).toBe(true));
    it.each(['Hola', 'Quiero una devolución del producto', '¿Cuánto dura la cita?', 'Consulta el idioma del agente', '¿Cuánto cuesta el tour?'])('keeps other requests on their existing route: %s', text => expect(requires(text)).toBe(false));
    it('uses the exact current package, with no price requirement', () => expect(resolve(ask, { packages: [row] })).toBe(id));
    it('accepts a supplied UUID only when it exists in the current catalogue', () => {
        expect(resolve(`Detalles del tour ${id}`, { packages: [row] })).toBe(id);
        expect(resolve(`${ask} ${other}`, { packages: [row] })).toBeNull();
    });
    it.each([{ error: 'denied', packages: [row] }, { status: 'failed', packages: [row] }, { stale: true, packages: [row] }, { truncated: true, packages: [row] }, { packages: [row, { ...row, id: other }] }, { packages: [row, row] }, { packages: [{ ...row, is_active: false }] }, { packages: [{ ...row, id: 'not-a-uuid' }] }, { packages: [] }])('rejects unavailable, ambiguous or malformed results', result => expect(resolve(ask, result)).toBeNull());
    it('does not treat a full search page as proof of a unique name', () => {
        const packages = Array.from({ length: 20 }, (_, index) => ({ id: `76775f40-2fdd-48e2-9db5-${String(index).padStart(12, '0')}`, name: index ? `Other ${index}` : name }));
        expect(resolve(ask, { packages })).toBeNull();
        expect(resolve(`Details of tour ${packages[0].id}`, { packages })).toBe(packages[0].id);
    });
    it('does not pick the first of multiple named packages', () => {
        expect(resolve(`${ask} y Tour alternativo`, { packages: [row, { id: other, name: 'Tour alternativo' }] })).toBeNull();
        expect(resolve(`Del ${name}EXTRA, qué incluye`, { packages: [row] })).toBeNull();
        expect(resolve(`Del X${name}, qué incluye`, { packages: [row] })).toBeNull();
    });
});
