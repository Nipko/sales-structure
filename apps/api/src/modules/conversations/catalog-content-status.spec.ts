import { applyUnconfirmedMarks, catalogContentStatus, unconfirmedCatalogMarks, unconfirmedNotes } from './catalog-content-status';
import { authoritativeNumbers } from './runtime/evidence-verifier';

describe('opción B (dueño, 2026-11-06): lo que la lectura del catálogo dice de lo no confirmado', () => {
    const updated = '2026-10-21T10:00:00.000Z';

    it('un ítem sembrado o de ejemplo se reconoce por su procedencia vigente; el content_status solo no basta', () => {
        expect(catalogContentStatus({ content_status: 'seeded', origin: 'platform_seed', source_ref: { row_updated_at: updated }, updated_at: updated })).toBe('seeded');
        expect(catalogContentStatus({ content_status: 'example', origin: 'platform_seed', source_ref: JSON.stringify({ row_updated_at: updated }), updated_at: new Date(updated) })).toBe('example');
        // editado después por una pantalla que no conoce las columnas: vuelve a ser del negocio
        expect(catalogContentStatus({ content_status: 'seeded', origin: 'platform_seed', source_ref: { row_updated_at: updated }, updated_at: '2026-10-22T10:00:00.000Z' })).toBe('confirmed');
        expect(catalogContentStatus({ content_status: 'seeded', updated_at: updated })).toBe('confirmed');
        expect(catalogContentStatus({ content_status: 'confirmed', origin: 'owner_form', source_ref: { row_updated_at: updated }, updated_at: updated })).toBe('confirmed');
    });

    it('el ítem sembrado se puede nombrar, su precio no: priceStatus example y nota', () => {
        const row = { id: 'p1', content_status: 'seeded', origin: 'platform_seed', source_ref: { row_updated_at: updated }, updated_at: updated, cleaning_fee: 20000, metadata: {} };
        const record = applyUnconfirmedMarks({ id: 'p1', name: 'Suite', nightPrice: 150000, priceStatus: 'confirmed', cleaningFee: 20000 },
            unconfirmedCatalogMarks('properties', row, { cleaningFee: 'cleaning_fee' }));
        expect(record).toMatchObject({ contentStatus: 'seeded', priceStatus: 'example', cleaningFee: 20000 });
        expect(unconfirmedNotes([record])).toHaveProperty('seededItemNote');
        // ninguna cifra de un ítem sembrado respalda una frase
        expect([...authoritativeNumbers({ reads: [{ result: { properties: [record] } }] })]).toEqual([]);
    });

    it('la limpieza 0 sin confirmar llega null y nombrada; confirmada, llega 0', () => {
        const fields = { cleaningFee: 'cleaning_fee' };
        const unconfirmed = applyUnconfirmedMarks({ id: 'p1', cleaningFee: 0, priceStatus: 'confirmed' }, unconfirmedCatalogMarks('properties', { cleaning_fee: '0.00' }, fields));
        expect(unconfirmed).toEqual({ id: 'p1', cleaningFee: null, priceStatus: 'confirmed', unconfirmedFields: ['cleaningFee'] });
        expect(unconfirmedNotes([unconfirmed])).toHaveProperty('unconfirmedFieldsNote');
        const confirmed = applyUnconfirmedMarks({ id: 'p1', cleaningFee: 0 },
            unconfirmedCatalogMarks('properties', { cleaning_fee: 0, metadata: { confirmed_fields: { cleaning_fee: updated } } }, fields));
        expect(confirmed).toEqual({ id: 'p1', cleaningFee: 0 });
        expect(unconfirmedNotes([confirmed])).toEqual({});
    });
});
