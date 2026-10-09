import { ToursService } from './tours.service';
import { ACCENT_FOLD_FROM, ACCENT_FOLD_TO } from '../../common/utils/sql-accent-fold.util';

/**
 * Agencia QA Viajes, 2026-10-09: «Medellin» typed on a phone must find the package the owner titled «Medellín», and
 * the other way round. Same fold as the product catalogue (`translate`, no `unaccent` extension).
 */
describe('ToursService.searchPackages is accent-insensitive', () => {
    const schemaName = 'tenant_tours';

    async function run(params: Parameters<ToursService['searchPackages']>[1]) {
        const prisma = { executeInTenantSchema: jest.fn().mockResolvedValue([]) };
        const service = new ToursService(prisma as any, {} as any, {} as any);
        await service.searchPackages(schemaName, params);
        const [, sql, values] = prisma.executeInTenantSchema.mock.calls[0];
        return { sql: String(sql), values: values as unknown[] };
    }

    it('destination and name are compared folded on both sides with one bound parameter', async () => {
        const { sql, values } = await run({ destination: 'Medellín' });
        expect(sql).toContain(`translate(destination, '${ACCENT_FOLD_FROM}', '${ACCENT_FOLD_TO}')`);
        expect(sql).toContain(`translate(name, '${ACCENT_FOLD_FROM}', '${ACCENT_FOLD_TO}')`);
        expect(sql).toContain(`translate($1::text, '${ACCENT_FOLD_FROM}', '${ACCENT_FOLD_TO}')`);
        expect(sql).not.toMatch(/ILIKE/);
        expect(values).toEqual(['%Medellín%']);
    });

    it('keeps the other filters and their parameter numbers', async () => {
        const { sql, values } = await run({ destination: 'Cartagena', durationType: 'days', maxPrice: 900000 });
        expect(sql).toContain('duration_type = $2');
        expect(sql).toContain('price <= $3');
        expect(values).toEqual(['%Cartagena%', 'days', 900000]);
    });

    it('without a destination there is no text predicate at all', async () => {
        const { sql, values } = await run({});
        expect(sql).not.toContain('translate(');
        expect(values).toEqual([]);
    });
});
