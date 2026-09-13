import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';
import { WebhookSubscriptionService } from './webhook-subscription.service';
import { erasePublicWebhookDeliveries } from './webhook-delivery-erasure';

const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl ? describe : describe.skip)('public webhook delivery outbox', () => {
    const tenantId = randomUUID();
    const subscriptionId = randomUUID();
    const deliveryId = randomUUID();
    const schema = `tenant_hook_${tenantId.replace(/-/g, '')}`;
    let client: PrismaClient;
    let service: WebhookSubscriptionService;
    jest.setTimeout(120_000);

    beforeAll(async () => {
        const url = new URL(databaseUrl!);
        if (!['127.0.0.1', 'localhost'].includes(url.hostname)
            || !url.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        client = new PrismaClient({ datasourceUrl: databaseUrl });
        await ensureSyntheticGlobalTables(sql => client.$executeRawUnsafe(sql));
        const prisma = {
            $queryRawUnsafe: async (sql: string, ...params: any[]) =>
                client.$queryRawUnsafe(sql, ...params),
        };
        service = new WebhookSubscriptionService(
            prisma as any,
            { get: jest.fn().mockResolvedValue(null), set: jest.fn() } as any,
            { axiosRef: { post: jest.fn() } } as any,
            {} as any,
        );
        await (service as any).ensureTable();
        await client.$executeRawUnsafe(
            'INSERT INTO public.tenants(id,schema_name,is_active) VALUES($1::uuid,$2,true)',
            tenantId, schema,
        );
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        await client.$executeRawUnsafe(
            `CREATE TABLE "${schema}".conversations(id UUID PRIMARY KEY, contact_id UUID NOT NULL)`,
        );
        await client.$executeRawUnsafe(
            `INSERT INTO public.webhook_subscriptions(id,tenant_id,target_url,event,secret,is_active)
             VALUES($1::uuid,$2::uuid,'https://hooks.example.test/receive','lead.created','secret',true)`,
            subscriptionId, tenantId,
        );
    });

    afterAll(async () => {
        if (!client) return;
        await client.$executeRawUnsafe(
            'DELETE FROM public.webhook_subscriptions WHERE tenant_id = $1::uuid', tenantId,
        );
        await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id = $1::uuid', tenantId);
        await client.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
        await client.$disconnect();
    });

    it('commits one row per domain event and settles the provider receipt atomically', async () => {
        await client.$executeRawUnsafe(
            `INSERT INTO public.webhook_delivery_outbox
                (id,subscription_id,tenant_id,event,event_key,payload)
             VALUES($1::uuid,$2::uuid,$3::uuid,'lead.created','lead.created:lead-1','{}'::jsonb)`,
            deliveryId, subscriptionId, tenantId,
        );
        jest.spyOn(service as any, 'deliver').mockResolvedValue({ outcome: 'accepted', statusCode: 204 });

        await (service as any).deliverOutboxRow(deliveryId);

        const [delivery] = await client.$queryRawUnsafe<any[]>(
            `SELECT state,attempts,status_code,lease_token FROM public.webhook_delivery_outbox
              WHERE id=$1::uuid`, deliveryId,
        );
        const [subscription] = await client.$queryRawUnsafe<any[]>(
            'SELECT last_triggered_at FROM public.webhook_subscriptions WHERE id=$1::uuid',
            subscriptionId,
        );
        expect(delivery).toMatchObject({ state: 'accepted', attempts: 1, status_code: 204, lease_token: null });
        expect(subscription.last_triggered_at).toBeInstanceOf(Date);

        await (service as any).deliverOutboxRow(deliveryId);
        expect((service as any).deliver).toHaveBeenCalledTimes(1);
    });

    it('rejects an in-flight row without a complete fenced lease', async () => {
        await expect(client.$executeRawUnsafe(
            `INSERT INTO public.webhook_delivery_outbox
                (subscription_id,tenant_id,event,event_key,payload,state)
             VALUES($1::uuid,$2::uuid,'lead.created','broken','{}'::jsonb,'in_flight')`,
            subscriptionId, tenantId,
        )).rejects.toMatchObject({ code: 'P2010' });
    });

    it('redacts terminal receipts and refuses unsent work during contact erasure', async () => {
        const contactId = randomUUID();
        const conversationId = randomUUID();
        await client.$executeRawUnsafe(
            `INSERT INTO "${schema}".conversations(id,contact_id) VALUES($1::uuid,$2::uuid)`,
            conversationId, contactId,
        );
        const pendingId = randomUUID();
        const acceptedId = randomUUID();
        await client.$executeRawUnsafe(
            `INSERT INTO public.webhook_delivery_outbox
                (id,subscription_id,tenant_id,event,event_key,payload,state)
             VALUES
                ($1::uuid,$3::uuid,$4::uuid,'message.received','erase:pending',$5::jsonb,'pending'),
                ($2::uuid,$3::uuid,$4::uuid,'conversation.closed','erase:accepted',$6::jsonb,'accepted')`,
            pendingId, acceptedId, subscriptionId, tenantId,
            JSON.stringify({ contactId, text: 'private words' }),
            JSON.stringify({ conversationId, name: 'Private Name' }),
        );

        const count = await client.$transaction(async tx => {
            await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}", public`);
            return erasePublicWebhookDeliveries(
                (sql, params = []) => tx.$queryRawUnsafe(sql, ...params), tenantId, [contactId],
            );
        });
        const rows = await client.$queryRawUnsafe<any[]>(
            `SELECT id,state,payload,error FROM public.webhook_delivery_outbox
              WHERE id=ANY($1::uuid[]) ORDER BY id`, [pendingId, acceptedId],
        );
        expect(count).toBe(2);
        expect(rows.find(row => row.id === pendingId)).toMatchObject({
            state: 'rejected', payload: {}, error: 'contact_erased',
        });
        expect(rows.find(row => row.id === acceptedId)).toMatchObject({
            state: 'accepted', payload: {},
        });
    });
});
