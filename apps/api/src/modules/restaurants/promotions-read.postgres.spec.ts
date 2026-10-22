import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { RestaurantsService } from './restaurants.service';
import { isDisposableDatabaseUrl } from '../../common/__fixtures__/disposable-database';

const connection = process.env.PROMOTION_SQL_TEST_URL;
(connection ? describe : describe.skip)('promotion eligibility in disposable PostgreSQL', () => {
    const schema = `tenant_promoread_${randomUUID().replace(/-/g, '')}`, other = `${schema}_other`;
    let client: PrismaClient;
    const shape = '(id uuid PRIMARY KEY,title text,is_active boolean,valid_from timestamp,valid_to timestamp,created_at timestamp DEFAULT NOW())';
    const reader = (db: any) => {
        const service = Object.create(RestaurantsService.prototype) as RestaurantsService;
        (service as any).prisma = { executeInTenantSchema: async (target: string, sql: string) => {
            if (![schema, other].includes(target) || !sql.startsWith('SELECT * FROM menu_promotions ')) throw Error('synthetic scope rejected');
            await db.$executeRawUnsafe(`SET LOCAL search_path TO "${target}"`);
            return db.$queryRawUnsafe(sql);
        } };
        return service;
    };
    beforeAll(async () => {
        const url = new URL(connection!);
        const base = url.pathname.slice(1);
        if (!['parallly_promo_a_eval_isolation', 'parallly_promo_b_eval_isolation'].includes(base)
            || !isDisposableDatabaseUrl(url, base)) throw Error('owned_disposable_database_required');
        client = new PrismaClient({ datasourceUrl: connection! });
        for (const s of [schema, other]) {
            await client.$executeRawUnsafe(`CREATE SCHEMA "${s}"`);
            await client.$executeRawUnsafe(`CREATE TABLE "${s}".menu_promotions ${shape}`);
        }
    });
    afterAll(async () => {
        if (!client) return;
        for (const s of [schema, other]) {
            if (!/^tenant_promoread_[a-f0-9]{32}(_other)?$/.test(s)) throw Error('unsafe_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA "${s}" CASCADE`);
        }
        await client.$disconnect();
    });
    jest.setTimeout(45000);
    async function scenario(active: boolean, bounds: string, included: boolean, crossTenant = false) {
        const id = randomUUID();
        await client.$transaction(async tx => {
            for (const s of crossTenant ? [schema, other] : [schema]) {
                await tx.$executeRawUnsafe(`INSERT INTO "${s}".menu_promotions(id,title,is_active,valid_from,valid_to) VALUES($1::uuid,$2,$3,${bounds})`, id, s === schema ? 'Synthetic own' : 'Synthetic other', active);
            }
        });
        await client.$transaction(async tx => {
            await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
            const before = await tx.$queryRawUnsafe<any[]>(`SELECT count(*)::int AS n FROM "${schema}".menu_promotions`);
            const rows = await reader(tx).listPromotions(schema, true);
            expect(rows.filter((p: any) => p.id === id).map((p: any) => p.title)).toEqual(included ? ['Synthetic own'] : []);
            if (crossTenant) expect((await reader(tx).listPromotions(other, true)).filter((p: any) => p.id === id).map((p: any) => p.title)).toEqual(['Synthetic other']);
            const after = await tx.$queryRawUnsafe<any[]>(`SELECT count(*)::int AS n FROM "${schema}".menu_promotions`);
            expect(after).toEqual(before);
        });
    }
    it('PROMOSQL_A_OPEN includes active promotion with NULL bounds', async () => scenario(true, 'NULL,NULL', true));
    it('PROMOSQL_A_INACTIVE excludes inactive promotion', async () => scenario(false, 'NULL,NULL', false));
    it('PROMOSQL_A_FUTURE excludes a future start', async () => scenario(true, "NOW()+INTERVAL '1 day',NULL", false));
    it('PROMOSQL_B_EXPIRED excludes a past end', async () => scenario(true, "NULL,NOW()-INTERVAL '1 day'", false));
    it('PROMOSQL_B_BOUNDARY includes both exact boundaries on the transaction clock', async () => {
        await client.$transaction(async tx => {
            const id = randomUUID();
            await tx.$executeRawUnsafe(`INSERT INTO "${schema}".menu_promotions VALUES($1::uuid,$2,true,NOW(),NOW(),NOW())`, id, 'Synthetic boundary');
            const rows = await reader(tx).listPromotions(schema, true);
            expect(rows.filter((p: any) => p.id === id).map((p: any) => p.title)).toEqual(['Synthetic boundary']);
        });
    });
    it('PROMOSQL_B_ISOLATION reads only the selected synthetic tenant with duplicate UUID', async () => scenario(true, 'NULL,NULL', true, true));
});
