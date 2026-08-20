import { BadRequestException } from '@nestjs/common';
import { PropertiesService } from './properties.service';
import { ToursService } from '../tours/tours.service';

/**
 * El registro global de estadías y el de salidas de tour.
 *
 * Los dos endpoints devuelven las filas que dos pantallas nuevas consumen
 * directamente. Un alias que no coincide con la columna real no rompe nada
 * visible desde el backend: la pantalla se dibuja entera y muestra "Sin
 * huésped" en cada fila, con los datos correctos abajo. Por eso las columnas
 * que la pantalla lee se afirman acá y no solo del lado del cliente.
 */
describe('operational booking registers', () => {
    const schemaName = 'tenant_registro';

    function buildProperties(executeInTenantSchema: jest.Mock) {
        const prisma = { executeInTenantSchema, transactionInTenantSchema: jest.fn(), tenant: { findUnique: jest.fn() } };
        return new PropertiesService(prisma as any, { enforcePlanLimit: jest.fn() } as any, { renderAndSend: jest.fn() } as any);
    }

    function buildTours(executeInTenantSchema: jest.Mock) {
        const prisma = { executeInTenantSchema, transactionInTenantSchema: jest.fn(), tenant: { findUnique: jest.fn() } };
        return new ToursService(prisma as any, { enforcePlanLimit: jest.fn() } as any, { renderAndSend: jest.fn() } as any);
    }

    /** Camino feliz: sin filtros lee todo, cuenta el total y pagina. */
    it('lists every stay with its property, its contact fallback and who created it', async () => {
        const execute = jest.fn()
            .mockResolvedValueOnce([{ total: 3 }])
            .mockResolvedValueOnce([{ id: 'a', guest_name: 'Ana', property_name: 'Casa Mar', origin: 'agent' }]);
        const service = buildProperties(execute);

        const result = await service.listAllBookings(schemaName);

        expect(result).toMatchObject({ total: 3, limit: 50, offset: 0 });
        expect(result.bookings).toHaveLength(1);
        const [, sql, params] = execute.mock.calls[1];
        expect(params).toEqual([]);
        expect(sql).not.toContain('WHERE');
        // Las columnas que la pantalla lee, afirmadas contra la consulta.
        for (const alias of ['property_name', 'property_city', 'AS origin', 'contact_name']) {
            expect(sql).toContain(alias);
        }
        // Sin el LEFT JOIN, una estadía cuyo huésped no se escribió a mano
        // —la que reserva el agente en una conversación— queda sin nombre.
        expect(sql).toContain('LEFT JOIN contacts c ON c.id = b.contact_id');
    });

    it('reads a failed count as zero rows rather than crashing the register', async () => {
        const execute = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]);
        const result = await buildProperties(execute).listAllBookings(schemaName);
        expect(result.total).toBe(0);
    });

    /** Nada de lo que llega del cliente se interpola: todo va como parámetro. */
    it('parameterizes every filter and keeps the placeholders in order', async () => {
        const execute = jest.fn().mockResolvedValue([{ total: 0 }]);
        const service = buildProperties(execute);

        await service.listAllBookings(schemaName, {
            status: 'confirmed',
            propertyId: '22222222-2222-4222-8222-222222222222',
            from: '2026-08-01',
            to: '2026-08-31',
            search: "O'Hara",
        });

        const [, sql, params] = execute.mock.calls[1];
        expect(sql).toContain('b.status = $1');
        expect(sql).toContain('b.property_id = $2::uuid');
        expect(sql).toContain('b.check_out > $3::date');
        expect(sql).toContain('b.check_in < $4::date');
        expect(sql).toContain('b.guest_name ILIKE $5');
        expect(params).toEqual([
            'confirmed',
            '22222222-2222-4222-8222-222222222222',
            '2026-08-01',
            '2026-08-31',
            "%O'Hara%",
        ]);
        // El rango es semiabierto, igual que en disponibilidad: una estadía que
        // termina el día que empieza la ventana no la solapa.
        expect(sql).not.toContain('check_out >= $3');
    });

    it('rejects a status or a property id that is not what it claims to be', async () => {
        const service = buildProperties(jest.fn().mockResolvedValue([{ total: 0 }]));
        await expect(service.listAllBookings(schemaName, { status: "x'; DROP TABLE property_bookings; --" }))
            .rejects.toBeInstanceOf(BadRequestException);
        await expect(service.listAllBookings(schemaName, { propertyId: 'not-a-uuid' }))
            .rejects.toBeInstanceOf(BadRequestException);
        await expect(service.listAllBookings(schemaName, { from: '31-08-2026' }))
            .rejects.toBeInstanceOf(BadRequestException);
    });

    it('clamps the page size so one tenant cannot ask for the whole table', async () => {
        const execute = jest.fn().mockResolvedValue([{ total: 0 }]);
        const service = buildProperties(execute);

        const wide = await service.listAllBookings(schemaName, { limit: 100000, offset: -5 });
        expect(wide).toMatchObject({ limit: 200, offset: 0 });

        const narrow = await service.listAllBookings(schemaName, { limit: 0 });
        expect(narrow.limit).toBe(50);
    });

    /** El mismo contrato de columnas para el manifiesto de salidas. */
    it('lists tour bookings with the traveller columns the manifest shows', async () => {
        const execute = jest.fn().mockResolvedValue([]);
        await buildTours(execute).listBookings(schemaName);

        const [, sql, params] = execute.mock.calls[0];
        expect(params).toEqual([]);
        expect(sql).toContain('package_name');
        expect(sql).toContain('c.name AS contact_name');
        expect(sql).toContain('AS origin');
        expect(sql).toContain('LEFT JOIN contacts c ON c.id = b.contact_id');
        // `guest_*` es como se llaman las columnas en la tabla. Escribirlas
        // `customer_*` dejaba el manifiesto entero sin nombres.
        expect(sql).toContain('b.*');
        expect(sql).not.toContain('customer_name');
    });

    it('filters tour bookings by package as a uuid parameter', async () => {
        const execute = jest.fn().mockResolvedValue([]);
        const packageId = '33333333-3333-4333-8333-333333333333';
        await buildTours(execute).listBookings(schemaName, packageId);

        const [, sql, params] = execute.mock.calls[0];
        expect(sql).toContain('WHERE b.package_id = $1::uuid');
        expect(params).toEqual([packageId]);
    });
});
