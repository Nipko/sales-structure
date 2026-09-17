import { Logger } from '@nestjs/common';
import { VerticalsService } from './verticals.service';
import { VerticalMigrationService } from './vertical-migration.service';
import { getVerticalDefinition } from './vertical-definitions';

/**
 * D10 (sep-2026): every service a recipe writes is an EXAMPLE until the owner
 * confirms it. The mark is written at the source, as a SQL literal, so the
 * positional parameters other specs pin (`$9::text[]` translations, args 3/5/8)
 * do not move.
 */
describe('recipe seeds carry the example mark', () => {
    it('the day-0 bootstrap and the reseed write price_status = example', async () => {
        const service = Object.create(VerticalsService.prototype);
        service.logger = new Logger('seed-price-status.spec');
        const query = jest.fn(async (_sql: string, _params?: unknown[]) => [] as any[]);
        const definition = getVerticalDefinition('moda_belleza');
        await (service as any).seedServices('tenant_seed', definition, 'es', query);
        const inserts = query.mock.calls.filter(([sql]: any[]) => String(sql).includes('INSERT INTO services'));
        expect(inserts).toHaveLength(definition.services.length);
        for (const [sql, params] of inserts as any[]) {
            expect(sql).toMatch(/duration_type, price_status\)/);
            expect(sql).toMatch(/\$8, 'example'/);
            expect(sql).toContain('name = ANY($9::text[])');
            expect(Array.isArray(params[8])).toBe(true);
            expect(params).toHaveLength(9);
        }
    });

    it('a vertical change seeds its additive services as examples too', async () => {
        const service = Object.create(VerticalMigrationService.prototype);
        const query = jest.fn(async (sql: string, _params?: unknown[]) => (String(sql).includes('INSERT INTO services') ? [{ id: 'row' }] : []));
        const targetSeeds = { pipelineStages: [], faqs: [], services: [{ name: 'Corte', description: 'Corte', durationMinutes: 45, price: 40000, currency: 'COP', category: 'corte', sortOrder: 0, durationType: 'fixed' }] };
        const diff = { pipelineStages: { add: [] }, faqs: { add: [] }, services: { add: [{ name: 'Corte' }] } };
        await (service as any).insertAdditiveSeeds(query, 'tenant', 'pipeline', targetSeeds, diff);
        const inserts = query.mock.calls.filter(([sql]: any[]) => String(sql).includes('INSERT INTO services'));
        expect(inserts).toHaveLength(1);
        expect(inserts[0][0]).toMatch(/duration_type, price_status\)/);
        expect(inserts[0][0]).toMatch(/\$8, 'example'\)/);
        expect(inserts[0][1]).toHaveLength(8);
    });
});
