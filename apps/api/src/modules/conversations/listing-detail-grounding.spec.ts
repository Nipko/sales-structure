import { listingDetailIdForQuestion as pick, requiresListingDetailLookup as needs } from './listing-detail-grounding';
const id = '57542cc7-de10-4166-b731-704bc7fa403d';
const row = { id, name: 'Spark QA Inmueble', status: 'available' };
describe('current listing detail identity', () => {
    it.each(['¿Cuántos metros cuadrados tiene el Spark QA Inmueble?', '¿El inmueble tiene parqueaderos?',
        'Property parking?', 'Área do imóvel?', 'Surface du logement?', 'Enlace del apartamento', 'Financiamiento del inmueble', 'Deposito del apartamento', 'Cuota HOA de la propiedad', 'Año de construccion y estrato del inmueble', 'Financiamento do imovel', 'Financement du logement', 'Property year built'])('recognizes %s', q => expect(needs(q)).toBe(true));
    it.each(['¿Cuándo es mi cita?', 'Reserva una visita', '¿Cuánto dura el tour?'])('ignores %s', q => expect(needs(q)).toBe(false));
    it('matches only an exact current name or UUID', () => {
        expect(pick('Área del Spark QA Inmueble?', { listings: [row] })).toBe(id);
        expect(pick(`Área del inmueble ${id}?`, { listings: [row] })).toBe(id);
        expect(pick('Área del Spark?', { listings: [row] })).toBeNull();
        expect(pick('Área de xSpark QA Inmueble?', { listings: [row] })).toBeNull();
    });
    it.each([{ error: 'failed', listings: [row] }, { listings: [row, row] }, { listings: [{ ...row, status: 'sold' }] },
        { listings: [{ ...row, id: 'bad' }] }, { stale: true, listings: [row] }])('rejects malformed/ambiguous/unavailable sources', value => {
        expect(pick('Spark QA Inmueble', value)).toBeNull();
    });
    it('does not infer name uniqueness across the eight-result search boundary', () => {
        const listings = Array.from({ length: 8 }, (_, n) => ({ ...row, id: `57542cc7-de10-4166-b731-704bc7fa403${n}`, name: n ? `Other ${n}` : row.name }));
        expect(pick(row.name, { listings })).toBeNull();
        expect(pick(listings[0].id, { listings })).toBe(listings[0].id);
    });
});
