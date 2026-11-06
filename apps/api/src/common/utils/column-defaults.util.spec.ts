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
