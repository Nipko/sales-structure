import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { PushService } from './push.service';
import { isDisposableDatabaseUrl } from '../../common/__fixtures__/disposable-database';
import { DEFAULT_NOTIFICATION_PREFERENCES } from './notification-preferences';

const connection = process.env.PARALLLY_ISOLATION_TEST_URL;

(connection ? describe : describe.skip)('persisted push preferences on disposable PostgreSQL', () => {
    const tenantId = randomUUID();
    const userId = randomUUID();
    let pool: Pool;
    let service: PushService;

    beforeAll(async () => {
        const url = new URL(connection!);
        if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !isDisposableDatabaseUrl(url)) {
            throw new Error('disposable_database_required');
        }
        pool = new Pool({ connectionString: connection });
        await pool.query(`INSERT INTO public.tenants(id,schema_name,is_active)
            VALUES($1::uuid,$2,true)`, [tenantId, `tenant_${tenantId.replace(/-/g, '')}`]);
        await pool.query(`INSERT INTO public.users(id,email,first_name,last_name,role,tenant_id,is_active)
            VALUES($1::uuid,$2,'Synthetic','User','tenant_agent',$3::uuid,true)`, [userId, `${userId}@example.invalid`, tenantId]);
        await pool.query(`CREATE TABLE IF NOT EXISTS public.push_subscriptions(
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL, tenant_id UUID NOT NULL,
            endpoint TEXT NOT NULL UNIQUE, keys JSONB NOT NULL, provider VARCHAR(20), created_at TIMESTAMPTZ DEFAULT NOW())`);
        await pool.query(`INSERT INTO public.push_subscriptions(user_id,tenant_id,endpoint,keys,provider)
            VALUES($1::uuid,$2::uuid,$3,'{}'::jsonb,'expo')`, [userId, tenantId, `ExponentPushToken[${userId}]`]);
        const prisma = { $queryRawUnsafe: (sql: string, ...params: any[]) => pool.query(sql, params).then(result => result.rows) } as any;
        service = new PushService(prisma, { get: jest.fn() } as any);
    });

    afterAll(async () => {
        if (pool) {
            await pool.query('DELETE FROM public.push_subscriptions WHERE user_id=$1::uuid', [userId]).catch(() => undefined);
            await pool.query('DELETE FROM public.users WHERE id=$1::uuid', [userId]).catch(() => undefined);
            await pool.query('DELETE FROM public.tenants WHERE id=$1::uuid', [tenantId]).catch(() => undefined);
            await pool.end();
        }
    });

    it('persists preferences and filters subscriptions before dispatch', async () => {
        const stored = {
            ...DEFAULT_NOTIFICATION_PREFERENCES,
            categories: { ...DEFAULT_NOTIFICATION_PREFERENCES.categories, chat: false, orders: true },
        };
        await expect(service.updatePreferences(userId, tenantId, stored)).resolves.toEqual(stored);
        await expect(service.getPreferences(userId, tenantId)).resolves.toEqual(stored);

        const dispatch = jest.spyOn(service as any, 'dispatch').mockResolvedValue(1);
        await expect(service.sendToUser(userId, { title: 'Chat', body: 'Hidden' }, 'chat')).resolves.toBe(0);
        expect(dispatch).not.toHaveBeenCalled();
        await expect(service.sendToUser(userId, { title: 'Order', body: 'Visible' }, 'orders')).resolves.toBe(1);
        expect(dispatch).toHaveBeenCalledTimes(1);

        await pool.query(`UPDATE public.users SET notification_preferences='{}'::jsonb WHERE id=$1::uuid`, [userId]);
        await expect(service.sendToUser(userId, { title: 'Legacy order', body: 'Hidden by default' }, 'orders')).resolves.toBe(0);
        await expect(service.sendToUser(userId, { title: 'Legacy chat', body: 'Visible by default' }, 'chat')).resolves.toBe(1);
        expect(dispatch).toHaveBeenCalledTimes(2);
    });
});
