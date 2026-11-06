import { PropertiesService } from '../vacation-rental/properties.service';
import { ToursService } from './tours.service';

/**
 * Opción B (dueño, 2026-11-06): guardar el formulario con el mínimo o el máximo de viajeros de un paquete, o con la tarifa
 * de limpieza de un alojamiento, confirma ese valor aunque sea el mismo default de columna (`metadata.confirmed_fields`).
 */
describe('opción B: el formulario guardado confirma los defaults de columna', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const tours = (execute: jest.Mock) => new ToursService({ executeInTenantSchema: execute } as any, { enforcePlanLimit: jest.fn() } as any, {} as any);
    const properties = (execute: jest.Mock) => new PropertiesService({ executeInTenantSchema: execute } as any, { enforcePlanLimit: jest.fn() } as any, {} as any);

    it('crear un paquete sin mínimo ni máximo no confirma nada; con el máximo, lo confirma', async () => {
        const execute = jest.fn().mockResolvedValueOnce([{ cnt: 0 }]).mockResolvedValueOnce([{ id }]);
        await tours(execute).createPackage('t', 'tenant_x', { name: 'Tour', currency: 'COP' });
        const metadata = JSON.parse(execute.mock.calls[1][2].at(-1));
        expect(metadata).toEqual({});

        const execute2 = jest.fn().mockResolvedValueOnce([{ cnt: 0 }]).mockResolvedValueOnce([{ id }]);
        await tours(execute2).createPackage('t', 'tenant_x', { name: 'Tour', currency: 'COP', maxCapacity: 10, metadata: { a: 1 } });
        const stamped = JSON.parse(execute2.mock.calls[1][2].at(-1));
        expect(stamped).toEqual({ a: 1, confirmed_fields: { max_capacity: expect.any(String) } });
    });

    it('editar el máximo con el mismo 10 lo confirma y conserva las confirmaciones anteriores', async () => {
        const execute = jest.fn().mockResolvedValue([{ id }]);
        await tours(execute).updatePackage('tenant_x', id, { maxCapacity: 10 });
        const [, sql, params] = execute.mock.calls[0];
        expect(sql).toContain(`"metadata" = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('confirmed_fields', COALESCE(metadata->'confirmed_fields', '{}'::jsonb) || $2::jsonb)`);
        expect(JSON.parse(params[1])).toEqual({ max_capacity: expect.any(String) });
        expect(params[2]).toBe(id);
        expect(sql).toContain('WHERE id = $3::uuid');
    });

    it('reemplazar metadata sin tocar los viajeros no borra lo confirmado', async () => {
        const execute = jest.fn().mockResolvedValue([{ id }]);
        await tours(execute).updatePackage('tenant_x', id, { metadata: { b: 2 } });
        const [, sql, params] = execute.mock.calls[0];
        expect(sql).toContain(`"metadata" = $1::jsonb || CASE WHEN metadata ? 'confirmed_fields'`);
        expect(JSON.parse(params[0])).toEqual({ b: 2 });
    });

    it('guardar la tarifa de limpieza 0 la confirma (crear y editar)', async () => {
        const execute = jest.fn().mockResolvedValueOnce([{ cnt: 0 }]).mockResolvedValueOnce([{ id }]);
        await properties(execute).create('t', 'tenant_x', { name: 'Suite', cleaningFee: 0 });
        expect(JSON.parse(execute.mock.calls[1][2].at(-1))).toEqual({ confirmed_fields: { cleaning_fee: expect.any(String) } });

        const execute2 = jest.fn().mockResolvedValue([{ id }]);
        await properties(execute2).update('tenant_x', id, { cleaningFee: 0 });
        const [, sql, params] = execute2.mock.calls[0];
        expect(sql).toContain(`"cleaning_fee" = $1`);
        expect(sql).toContain(`"metadata" = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('confirmed_fields'`);
        expect(JSON.parse(params[1])).toEqual({ cleaning_fee: expect.any(String) });

        const execute3 = jest.fn().mockResolvedValueOnce([{ cnt: 0 }]).mockResolvedValueOnce([{ id }]);
        await properties(execute3).create('t', 'tenant_x', { name: 'Suite' });
        expect(JSON.parse(execute3.mock.calls[1][2].at(-1))).toEqual({});
    });
});
