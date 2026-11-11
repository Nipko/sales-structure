import { BadRequestException } from '@nestjs/common';
import { ServicesService, serviceDetailsInput } from './services.service';
import { serviceDetailsForAgent } from './service-details';
import { AIToolExecutorService } from '../conversations/ai-tool-executor.service';

const SCHEMA = 'tenant_service_details';
const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const SERVICE_ID = '22222222-2222-4222-8222-222222222222';
const BASE_ROW = {
    id: SERVICE_ID, name: 'Limpieza dental', description: null, duration_minutes: 45, duration_type: 'fixed',
    price: 90000, price_status: 'confirmed', currency: 'COP', payment_policy: 'none', is_active: true,
    location_type: 'in_person', includes: [], excludes: [], preparation: null, preparation_required: null,
};

/** Writes land as DB columns, so the result must survive create/update -> SELECT -> mapRow. */
function fixture(initial: Record<string, unknown> | null = BASE_ROW) {
    let row: Record<string, any> | null = initial ? { ...initial } : null;
    const execute = jest.fn(async (_schema: string, sql: string, params: any[] = []) => {
        if (sql.startsWith('INSERT INTO services')) {
            const columns = sql.match(/INSERT INTO services \(([^)]+)\)/)![1].split(',').map(column => column.trim());
            row = { ...BASE_ROW };
            columns.slice(0, params.length).forEach((column, index) => { row![column] = params[index]; });
            return [];
        }
        if (sql.startsWith('UPDATE services')) {
            for (const match of sql.matchAll(/([a-z_]+) = \$(\d+)/g)) {
                if (match[1] !== 'id') row![match[1]] = params[Number(match[2]) - 1];
            }
            return [{ id: row!.id }];
        }
        if (sql.startsWith('SELECT * FROM services')) return row ? [{ ...row }] : [];
        throw new Error(`Unexpected query: ${sql}`);
    });
    const service = new ServicesService({ executeInTenantSchema: execute } as any, { del: jest.fn().mockResolvedValue(undefined) } as any);
    return { service, execute, row: () => row };
}

describe('ficha del servicio: descripción, incluye / no incluye y preparación', () => {
    it('creates a service with its details and returns them from the stored row', async () => {
        const { service, row } = fixture(null);
        const created = await service.create(SCHEMA, {
            name: 'Limpieza dental', durationMinutes: 45, price: 90000,
            description: '  Limpieza profunda con ultrasonido.  ',
            includes: [' Profilaxis ', 'Flúor', '', 'Flúor'], excludes: ['Blanqueamiento'],
            preparation: 'Cepíllate antes de venir.',
        }, TENANT_ID);
        expect(created).toMatchObject({
            description: 'Limpieza profunda con ultrasonido.',
            includes: ['Profilaxis', 'Flúor'], excludes: ['Blanqueamiento'],
            preparation: 'Cepíllate antes de venir.', preparationRequired: true,
        });
        // JSONB columns receive JSON text, never a JS array the driver would turn into a Postgres array.
        expect(row()!.includes).toBe('["Profilaxis","Flúor"]');
    });

    it('a service created without details stores empty lists and an undeclared preparation', async () => {
        const { service } = fixture(null);
        const created = await service.create(SCHEMA, { name: 'Consulta', durationMinutes: 30, free: true }, TENANT_ID);
        expect(created).toMatchObject({ description: null, includes: [], excludes: [], preparation: null, preparationRequired: null });
    });

    it('updates only the details it receives; «no requiere» clears written instructions', async () => {
        const { service } = fixture({ ...BASE_ROW, includes: '["Profilaxis"]', preparation: 'Ayuno', preparation_required: true });
        const kept = await service.update(SCHEMA, SERVICE_ID, { excludes: ['Radiografías'] }, TENANT_ID);
        expect(kept).toMatchObject({ includes: ['Profilaxis'], excludes: ['Radiografías'], preparation: 'Ayuno', preparationRequired: true });
        const none = await service.update(SCHEMA, SERVICE_ID, { preparationRequired: false }, TENANT_ID);
        expect(none).toMatchObject({ preparation: null, preparationRequired: false });
        const cleared = await service.update(SCHEMA, SERVICE_ID, { preparation: '', preparationRequired: null, includes: [] }, TENANT_ID);
        expect(cleared).toMatchObject({ preparation: null, preparationRequired: null, includes: [] });
    });

    it('rejects invalid shapes and lengths', () => {
        expect(() => serviceDetailsInput({ includes: 'Profilaxis' })).toThrow(BadRequestException);
        expect(() => serviceDetailsInput({ excludes: [1] })).toThrow(BadRequestException);
        expect(() => serviceDetailsInput({ includes: Array.from({ length: 31 }, (_, i) => `ítem ${i}`) })).toThrow(BadRequestException);
        expect(() => serviceDetailsInput({ includes: ['x'.repeat(201)] })).toThrow(BadRequestException);
        expect(() => serviceDetailsInput({ description: 'x'.repeat(2001) })).toThrow(BadRequestException);
        expect(() => serviceDetailsInput({ preparation: 'x'.repeat(2001) })).toThrow(BadRequestException);
        expect(() => serviceDetailsInput({ preparationRequired: 'no' })).toThrow(BadRequestException);
        expect(() => serviceDetailsInput({ preparationRequired: false, preparation: 'Ayuno' })).toThrow(BadRequestException);
        expect(serviceDetailsInput({})).toEqual({});
    });
});

describe('list_services lleva la ficha que escribió el dueño', () => {
    it('sends includes, excludes and preparation; empty lists are left out («no consta» is not «no incluye»)', () => {
        expect(serviceDetailsForAgent({ includes: ['Profilaxis'], excludes: '["Blanqueamiento"]', preparation: ' Ayuno ', preparation_required: true }))
            .toEqual({ includes: ['Profilaxis'], excludes: ['Blanqueamiento'], preparation: 'Ayuno' });
        expect(serviceDetailsForAgent({ includes: [], excludes: [], preparation: null, preparation_required: null })).toEqual({});
        expect(serviceDetailsForAgent({ preparation: null, preparation_required: false })).toEqual({ preparationRequired: false });
    });

    it('the agent read projects the new columns', async () => {
        const query = jest.fn().mockResolvedValue([{ ...BASE_ROW, includes: ['Profilaxis'], excludes: ['Blanqueamiento'], preparation: 'Ayuno de 8 horas', preparation_required: true }]);
        const executor: any = Object.assign(Object.create(AIToolExecutorService.prototype), { prisma: { $queryRawUnsafe: query }, logger: { warn: jest.fn() } });
        const result = await executor.listServices('tenant_synthetic');
        expect(query.mock.calls[0][0]).toMatch(/includes, excludes, preparation, preparation_required/);
        expect(result.services[0]).toMatchObject({ includes: ['Profilaxis'], excludes: ['Blanqueamiento'], preparation: 'Ayuno de 8 horas' });
    });
});
