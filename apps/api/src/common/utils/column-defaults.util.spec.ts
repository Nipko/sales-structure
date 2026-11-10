import { COLUMN_DEFAULTS, CONFIRMED_FIELDS_KEY as SPEC_KEY } from '@parallext/business-spec';
import {
    CATALOG_COLUMN_DEFAULTS, CONFIRMED_FIELDS_KEY, confirmedFieldsStamp, metadataWithConfirmedFieldsSql, unconfirmedDefaultColumns,
} from './column-defaults.util';

describe('opción B (dueño, 2026-11-06): defaults de columna sin confirmar', () => {
    it('es la misma tabla que la preparación (business-spec L4 por campo)', () => {
        expect(CATALOG_COLUMN_DEFAULTS).toEqual(COLUMN_DEFAULTS);
        expect(CONFIRMED_FIELDS_KEY).toBe(SPEC_KEY);
    });

    it('un valor igual al default y sin confirmar no es dato; confirmado o distinto, sí', () => {
        expect([...unconfirmedDefaultColumns('tour_packages', { min_party_size: 1, max_capacity: 10 })]).toEqual(['min_party_size', 'max_capacity']);
        expect([...unconfirmedDefaultColumns('tour_packages', { min_party_size: 2, max_capacity: '10', metadata: JSON.stringify({ confirmed_fields: { max_capacity: 'x' } }) })]).toEqual([]);
        expect([...unconfirmedDefaultColumns('properties', { cleaning_fee: '0.00' })]).toEqual(['cleaning_fee']);
        expect([...unconfirmedDefaultColumns('properties', { cleaning_fee: null })]).toEqual([]);
        expect([...unconfirmedDefaultColumns('services', { price: 0 })]).toEqual([]);
    });

    it('E2ah: inmueble con parqueaderos 0, sin financiación y sin amenidades por default no niega nada', () => {
        const row = { parking_spots: 0, financing_available: false, amenities: [], metadata: {} };
        expect([...unconfirmedDefaultColumns('real_estate_listings', row)].sort()).toEqual(['amenities', 'financing_available', 'parking_spots']);
        expect([...unconfirmedDefaultColumns('real_estate_listings', { parking_spots: 2, financing_available: true, amenities: '["gym"]' })]).toEqual([]);
        expect([...unconfirmedDefaultColumns('real_estate_listings', { ...row, metadata: { confirmed_fields: { parking_spots: 'x', financing_available: 'x' } } })]).toEqual(['amenities']);
        // Una lectura que no trae la columna no la marca (search_listings no proyecta financing_available).
        expect([...unconfirmedDefaultColumns('real_estate_listings', { parking_spots: 0 })]).toEqual(['parking_spots']);
        const at = new Date('2026-11-10T10:00:00.000Z');
        expect(confirmedFieldsStamp('real_estate_listings', { parkingSpots: 0, financingAvailable: false, amenities: [] },
            { parkingSpots: 'parking_spots', financingAvailable: 'financing_available', amenities: 'amenities' }, at))
            .toEqual({ parking_spots: at.toISOString(), financing_available: at.toISOString(), amenities: at.toISOString() });
    });

    it('guardar el formulario con el campo lo confirma aunque traiga el mismo valor', () => {
        const at = new Date('2026-11-06T10:00:00.000Z');
        const fields = { maxCapacity: 'max_capacity', minPartySize: 'min_party_size', name: 'name' };
        expect(confirmedFieldsStamp('tour_packages', { maxCapacity: 10, name: 'X' }, fields, at)).toEqual({ max_capacity: at.toISOString() });
        expect(confirmedFieldsStamp('tour_packages', { name: 'X', minPartySize: '' }, fields, at)).toEqual({});
        expect(confirmedFieldsStamp('properties', { cleaningFee: 0 }, { cleaningFee: 'cleaning_fee' }, at)).toEqual({ cleaning_fee: at.toISOString() });
    });

    it('el UPDATE conserva las confirmaciones anteriores y suma las nuevas', () => {
        expect(metadataWithConfirmedFieldsSql(null, '$3')).toBe(
            "COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('confirmed_fields', COALESCE(metadata->'confirmed_fields', '{}'::jsonb) || $3::jsonb)");
        expect(metadataWithConfirmedFieldsSql('$2', null)).toContain("$2::jsonb || CASE WHEN metadata ? 'confirmed_fields'");
    });
});
