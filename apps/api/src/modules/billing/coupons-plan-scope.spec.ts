import { CouponsService, isUuid } from './coupons.service';

/**
 * Regresión de un 500 en producción.
 *
 * `billing_plans.id` es una columna UUID NATIVA de Postgres. `normalizePlanSlugs`
 * aceptaba slug o UUID y armaba `OR: [{slug:{in:...}}, {id:{in:...}}]` con la
 * MISMA lista en las dos ramas. Como la UI manda slugs, al filtro de `id` le
 * llegaban 'pro'/'enterprise' y el driver de Prisma reventaba con
 * "Error creating UUID, invalid character" — 500 al generar un lote o crear un
 * cupón con planes seleccionados.
 *
 * Lo que se fija acá: a la rama `id` solo entran valores con forma de UUID.
 */
describe('CouponsService — alcance por planes (regresión UUID)', () => {
    const PLAN_UUID = '3f1a9c2e-5b4d-4e7a-9c88-1a2b3c4d5e6f';

    const build = (rows: Array<{ id: string; slug: string }>) => {
        const findMany = jest.fn().mockResolvedValue(rows);
        const findFirst = jest.fn().mockResolvedValue(rows[0] ?? null);
        const prisma: any = { billingPlan: { findMany, findFirst } };
        const service = new CouponsService(prisma, {} as any, {} as any, {} as any);
        return { service, findMany, findFirst };
    };

    it('no le pasa slugs al filtro de id (era el 500 en produccion)', async () => {
        const { service, findMany } = build([
            { id: PLAN_UUID, slug: 'pro' },
            { id: '11111111-2222-4333-8444-555555555555', slug: 'enterprise' },
        ]);

        const out = await (service as any).normalizePlanSlugs(['pro', 'enterprise']);

        expect(out).toEqual(['pro', 'enterprise']);
        const where = findMany.mock.calls[0][0].where;
        // Sin ningun UUID entre las claves, la rama `id` no debe existir.
        expect(JSON.stringify(where)).not.toContain('"id"');
        expect(where).toEqual({ slug: { in: ['pro', 'enterprise'] } });
    });

    it('sigue aceptando UUIDs y los normaliza a slug', async () => {
        const { service, findMany } = build([{ id: PLAN_UUID, slug: 'pro' }]);

        const out = await (service as any).normalizePlanSlugs([PLAN_UUID]);

        expect(out).toEqual(['pro']);
        // Con una clave UUID, la rama `id` aparece y lleva SOLO esa clave.
        expect(findMany.mock.calls[0][0].where).toEqual({
            OR: [{ slug: { in: [PLAN_UUID] } }, { id: { in: [PLAN_UUID] } }],
        });
    });

    it('mezcla slug + UUID mandando al filtro de id solo el UUID', async () => {
        const { service, findMany } = build([
            { id: PLAN_UUID, slug: 'pro' },
            { id: '11111111-2222-4333-8444-555555555555', slug: 'enterprise' },
        ]);

        await (service as any).normalizePlanSlugs(['enterprise', PLAN_UUID]);

        expect(findMany.mock.calls[0][0].where).toEqual({
            OR: [
                { slug: { in: ['enterprise', PLAN_UUID] } },
                { id: { in: [PLAN_UUID] } },
            ],
        });
    });

    it('isPlanEligible no consulta por id cuando la clave es un slug', async () => {
        const { service, findFirst } = build([{ id: PLAN_UUID, slug: 'pro' }]);

        await (service as any).isPlanEligible(['enterprise'], 'pro');

        expect(findFirst.mock.calls[0][0].where).toEqual({ slug: 'pro' });
    });

    it('isUuid distingue UUID real de slug', () => {
        expect(isUuid(PLAN_UUID)).toBe(true);
        expect(isUuid('pro')).toBe(false);
        expect(isUuid('emprendedor')).toBe(false);
        expect(isUuid('')).toBe(false);
    });
});
