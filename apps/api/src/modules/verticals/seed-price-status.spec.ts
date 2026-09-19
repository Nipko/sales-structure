import { Logger } from '@nestjs/common';
import { VerticalsService } from './verticals.service';
import { VerticalMigrationService } from './vertical-migration.service';
import { getVerticalDefinition } from './vertical-definitions';

/**
 * D10 (sep-2026): every service a recipe writes is an EXAMPLE until the owner
 * confirms it — or a QUOTE when the business prices it case by case.
 *
 * D17 (sep-2026) added the second half: the amount and the currency come from
 * the country of the business, so the mark can no longer be a SQL literal at a
 * fixed offset. These assertions therefore read the ARGUMENT the seed sends,
 * not the position it sends it in: a column reordering is not a defect, and a
 * row that reaches the customer with an unconfirmed number is.
 */
describe('recipe seeds carry the example mark', () => {
    function seedArgs(calls: any[]): Array<{ sql: string; params: any[] }> {
        return calls
            .filter(([sql]: any[]) => String(sql).includes('INSERT INTO services'))
            .map(([sql, params]: any[]) => ({ sql: String(sql), params }));
    }

    it('the day-0 bootstrap writes price_status = example', async () => {
        const service = Object.create(VerticalsService.prototype);
        service.logger = new Logger('seed-price-status.spec');
        const query = jest.fn(async (_sql: string, _params?: unknown[]) => [] as any[]);
        const definition = getVerticalDefinition('moda_belleza');
        await (service as any).seedServices('tenant_seed', definition, 'es', query, 'CO');
        const inserts = seedArgs(query.mock.calls as any[]);
        expect(inserts).toHaveLength(definition.services.length);
        for (const { sql, params } of inserts) {
            expect(sql).toMatch(/duration_type, price_status\)/);
            expect(sql).toContain('name = ANY($9::text[])');
            expect(Array.isArray(params[8])).toBe(true);
            // El estado viaja como argumento porque ahora tiene dos valores.
            expect(params[params.length - 1]).toBe('example');
        }
    });

    it('a service the business quotes is not a price waiting to be confirmed', async () => {
        // "Visita de plomería" no tiene monto que confirmar: decirle al cliente
        // "te confirmo el precio" promete un número que no existe.
        const service = Object.create(VerticalsService.prototype);
        service.logger = new Logger('seed-price-status.spec');
        const query = jest.fn(async (_sql: string, _params?: unknown[]) => [] as any[]);
        const definition = {
            ...getVerticalDefinition('servicios_hogar'),
            services: [{
                name: { es: 'Visita de plomería', en: 'Plumbing visit', pt: 'Visita', fr: 'Visite' },
                description: { es: 'x', en: 'x', pt: 'x', fr: 'x' },
                durationMinutes: 90, price: 0, currency: 'COP', category: 'plomeria',
                priceStatus: 'quote' as const,
            }],
        };
        await (service as any).seedServices('tenant_seed', definition, 'es', query, 'CO');
        const [insert] = seedArgs(query.mock.calls as any[]);
        expect(insert.params[insert.params.length - 1]).toBe('quote');
    });

    it('a vertical change seeds its additive services as examples too', async () => {
        const service = Object.create(VerticalMigrationService.prototype);
        const query = jest.fn(async (sql: string, _params?: unknown[]) => (String(sql).includes('INSERT INTO services') ? [{ id: 'row' }] : []));
        const targetSeeds = { pipelineStages: [], faqs: [], services: [{ name: 'Corte', description: 'Corte', durationMinutes: 45, price: '40000', currency: 'COP', category: 'corte', sortOrder: 0, durationType: 'fixed', priceStatus: 'example' }] };
        const diff = { pipelineStages: { add: [] }, faqs: { add: [] }, services: { add: [{ name: 'Corte' }] } };
        await (service as any).insertAdditiveSeeds(query, 'tenant', 'pipeline', targetSeeds, diff);
        const inserts = seedArgs(query.mock.calls as any[]);
        expect(inserts).toHaveLength(1);
        expect(inserts[0].sql).toMatch(/duration_type, price_status\)/);
        expect(inserts[0].params[inserts[0].params.length - 1]).toBe('example');
    });
});

/**
 * D17: la moneda y el monto salen del país del negocio, no de la semilla.
 */
describe('the seeded amount belongs to the country of the business', () => {
    async function seedFor(country: string | null) {
        const service = Object.create(VerticalsService.prototype);
        service.logger = new Logger('seed-price-status.spec');
        const query = jest.fn(async (_sql: string, _params?: unknown[]) => [] as any[]);
        const definition = {
            ...getVerticalDefinition('salud'),
            services: [{
                name: { es: 'Consulta general', en: 'General consultation', pt: 'Consulta', fr: 'Consultation' },
                description: { es: 'x', en: 'x', pt: 'x', fr: 'x' },
                durationMinutes: 30, price: 80_000, currency: 'COP', category: 'consulta',
            }],
        };
        await (service as any).seedServices('tenant_seed', definition, 'es', query, country);
        const [insert] = (query.mock.calls as any[])
            .filter(([sql]: any[]) => String(sql).includes('INSERT INTO services'));
        return { price: insert[1][3], currency: insert[1][4] };
    }

    it('un negocio mexicano nace con pesos mexicanos, no colombianos', async () => {
        const seeded = await seedFor('MX');
        expect(seeded.currency).toBe('MXN');
        expect(seeded.price).toBeGreaterThan(0);
        expect(seeded.price).toBeLessThan(80_000);
    });

    it('Colombia se queda con la referencia tal cual', async () => {
        expect(await seedFor('CO')).toEqual({ price: 80_000, currency: 'COP' });
    });

    it('fuera de los seis países la fila nace sin monto y con su moneda', async () => {
        // El dueño uruguayo escribe su número sobre una fila que ya sabe que
        // habla en pesos uruguayos. Un monto en la moneda equivocada lo obliga
        // a borrar antes de escribir, y mientras tanto es lo que ve su catálogo.
        expect(await seedFor('UY')).toEqual({ price: null, currency: 'UYU' });
    });

    it('sin país no inventa una moneda', async () => {
        // La columna tiene DEFAULT 'COP': pasar null explícito es lo único que
        // impide que el peso colombiano vuelva a entrar por la puerta de atrás.
        expect(await seedFor(null)).toEqual({ price: null, currency: null });
    });
});
