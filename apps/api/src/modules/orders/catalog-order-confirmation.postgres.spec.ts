import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from './orders.service';
import { catalogHash } from './catalog-order-contract';
import { OperationConfirmationService } from '../email-templates/operation-confirmation.service';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';

/**
 * ═══ THE ORDER CONFIRMATION SWITCH, END TO END, THROUGH REAL POSTGRES ═══
 *
 * `tools.orders.emailConfirmations` was declared by the contract, drawn as a
 * switch by the agent editor — which even names `order_confirmation` as the
 * template it governs — and read by NOTHING. The template was seeded into every
 * tenant and rendered zero times. So the reproduction of the defect is the
 * first assertion here: before the fix, no scenario in this file sent anything,
 * whatever the switch said.
 *
 * ── TWO AGENTS, TWO CONNECTIONS, OPPOSITE ANSWERS ───────────────────────────
 *
 * One tenant, two WhatsApp connections, and the two agents hold opposite
 * answers. Every send/no-send pair below differs ONLY in which connection the
 * order was placed on, so a reader that resolves the wrong agent — the old
 * `agent_personas WHERE is_active = true LIMIT 1`, an unordered pick — inverts
 * an outcome instead of quietly agreeing.
 *
 * ── WHAT IS REAL ────────────────────────────────────────────────────────────
 *
 * The database, the production catalogue DDL, the real `OrdersService` with its
 * real command port, the real agent rows and their saved configuration. Only
 * the mail transport is a double: sending is the one external effect a test may
 * not have, so the assertion is on the render-and-send call, which is where the
 * decision turns into a message.
 */
const databaseUrl = process.env.CATALOG_ORDERS_TEST_DATABASE_URL
    ?? process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl ? describe : describe.skip)('the order confirmation follows orders.emailConfirmations', () => {
    const schema = `tenant_orderconfirm_${randomUUID().replace(/-/g, '')}`;
    const tenantId = randomUUID();
    const productId = randomUUID();

    /** The two connections, the agent bound to each, and a contact per thread. */
    const ACCOUNT_ON = '15550001111';
    const ACCOUNT_OFF = '15559990000';
    const AGENT_ON = randomUUID();
    const AGENT_OFF = randomUUID();
    const CONTACT_ON = randomUUID();
    const CONTACT_OFF = randomUUID();
    const THREAD_ON = randomUUID();
    const THREAD_OFF = randomUUID();

    let client: PrismaClient;
    let prisma: any;
    let orders: OrdersService;
    let renderAndSend: jest.Mock;
    jest.setTimeout(180_000);

    const query = (sql: string, params: any[] = []): Promise<any[]> =>
        prisma.executeInTenantSchema(schema, sql, params);

    const items = [{ productId, quantity: 2, productName: 'Forged', unitPrice: 1 }];

    const saveAgent = async (id: string, account: string, emailConfirmations: boolean) => {
        await query(`INSERT INTO agent_personas(id,name,config_json,version,channels,
                channel_bindings,schedule_mode,is_active,is_default)
            VALUES($1::uuid,$2,$3::jsonb,1,ARRAY['whatsapp'],ARRAY[$4],'24_7',true,false)
            ON CONFLICT (id) DO UPDATE SET config_json = EXCLUDED.config_json`,
            [id, `Agent ${account}`, JSON.stringify({
                persona: { name: `Agent ${account}` },
                tools: {
                    catalog: { enabled: true },
                    orders: { enabled: true, emailConfirmations },
                },
            }), `whatsapp:${account}`]);
    };

    /** An agent-placed order: `pending`, terms frozen, inside a real thread. */
    const placeByAgent = async (contactId: string, conversationId: string) => {
        const commands = orders.catalogCommands();
        const data = { contactId, conversationId, items, idempotencyKey: randomUUID() };
        const terms = await commands.quote(schema, data);
        return commands.create(schema, data, {
            source: 'agent', expectedTermsHash: catalogHash(terms),
        });
    };

    beforeAll(async () => {
        const url = new URL(databaseUrl!);
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
            || !url.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        client = new PrismaClient({ datasourceUrl: databaseUrl });
        await ensureSyntheticGlobalTables(sql => client.$executeRawUnsafe(sql));
        await client.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public');
        await client.$executeRawUnsafe(
            'INSERT INTO public.tenants(id,schema_name,is_active,language) VALUES($1::uuid,$2,true,$3)',
            tenantId, schema, 'es-CO');

        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        prisma.$queryRaw = client.$queryRaw.bind(client);
        prisma.$queryRawUnsafe = client.$queryRawUnsafe.bind(client);
        prisma.getTenantSchemaName = async (id: string) => {
            if (id !== tenantId) throw new Error('test_scope_violation');
            return schema;
        };
        // The ownership predicate runs against the REAL global table, so "no
        // active tenant owns this schema" is answered by the database and not
        // by the fixture.
        prisma.tenant = {
            findFirst: async (args: any) => {
                const rows = await client.$queryRawUnsafe(
                    `SELECT id, language FROM public.tenants
                      WHERE schema_name = $1 AND is_active = $2 LIMIT 1`,
                    args?.where?.schemaName, args?.where?.isActive ?? true) as any[];
                return rows[0] ?? null;
            },
        };

        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        await query('CREATE FUNCTION uuid_generate_v4() RETURNS UUID LANGUAGE SQL AS $$ SELECT pg_catalog.gen_random_uuid() $$');
        for (const sql of [
            'CREATE TABLE contacts(id UUID PRIMARY KEY,external_id TEXT NOT NULL,channel_type TEXT NOT NULL,name TEXT,phone TEXT,email TEXT)',
            // The columns the origin-connection read needs: an order's thread is
            // what names the agent that took it.
            `CREATE TABLE conversations(id UUID PRIMARY KEY,contact_id UUID REFERENCES contacts(id),
                channel_type TEXT,channel_account_id TEXT,status TEXT DEFAULT 'active')`,
            `CREATE TABLE agent_personas(id UUID PRIMARY KEY,name TEXT,config_json JSONB NOT NULL,
                version INT NOT NULL,channels TEXT[] DEFAULT '{}',channel_bindings TEXT[] DEFAULT '{}',
                schedule_mode TEXT,is_active BOOLEAN DEFAULT true,is_default BOOLEAN DEFAULT false,
                updated_at TIMESTAMPTZ DEFAULT NOW())`,
            `CREATE TABLE persona_config(id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
                config_json JSONB,is_active BOOLEAN DEFAULT true,version INT DEFAULT 1)`,
            'CREATE TABLE contact_identities(contact_id UUID,customer_profile_id UUID)',
            'CREATE TABLE leads(id UUID PRIMARY KEY,contact_id UUID)',
            `CREATE TABLE opportunities(id UUID PRIMARY KEY,lead_id UUID,conversation_id UUID,
                won_at TIMESTAMPTZ,lost_at TIMESTAMPTZ,created_at TIMESTAMPTZ DEFAULT NOW())`,
            'CREATE TABLE customer_memory_erasure(contact_id UUID PRIMARY KEY,erased_at TIMESTAMPTZ NOT NULL DEFAULT NOW())',
        ]) await query(sql);

        // The production catalogue DDL, so a column this suite relies on cannot
        // be one the harness invented.
        const ddl = readFileSync(resolve(__dirname, '../../../prisma/tenant-schema.sql'), 'utf8');
        for (const table of ['products', 'stock_movements', 'orders', 'order_items']) {
            const start = ddl.indexOf(`CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."${table}" (`);
            if (start < 0) throw new Error('production_catalog_ddl_missing');
            await query(ddl.slice(start, ddl.indexOf('\n);', start) + 3)
                .replaceAll('{{SCHEMA_NAME}}', schema)
                .replaceAll('uuid_generate_v4()', 'pg_catalog.gen_random_uuid()'));
        }
        await query('ALTER TABLE products ADD COLUMN requires_prescription BOOLEAN NOT NULL DEFAULT false');
        const block = ddl.split('-- BEGIN CATALOG ORDER INTEGRITY')[1]
            ?.split('-- END CATALOG ORDER INTEGRITY')[0];
        if (!block) throw new Error('catalog_integrity_ddl_missing');
        for (const sql of block.replace(/^\s*--.*$/gm, '').split(';').filter(value => value.trim())) {
            await query(sql.replaceAll('{{SCHEMA_NAME}}', schema));
        }

        renderAndSend = jest.fn().mockResolvedValue(true);
        const redis = {
            get: async (key: string) => key === `tenant:${tenantId}:schema` ? schema : 'ready',
            set: async () => undefined,
        };
        // The REAL confirmation decision — ownership, recipient, switch,
        // language — over the real database. Only the transport is a double.
        orders = new OrdersService(prisma, redis as any,
            new OperationConfirmationService(prisma, { renderAndSend } as any));
    });

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_orderconfirm_[a-f0-9]{32}$/.test(schema)) {
                throw new Error('invalid_cleanup_scope');
            }
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe(
                'DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2', tenantId, schema);
        } finally { await client.$disconnect(); }
    });

    beforeEach(async () => {
        renderAndSend.mockClear();
        await client.$executeRawUnsafe(
            'UPDATE public.tenants SET is_active=true WHERE id=$1::uuid', tenantId);
        await query(`TRUNCATE order_items,orders,stock_movements,products,conversations,
            contacts,agent_personas,opportunities,leads,contact_identities,
            customer_memory_erasure CASCADE`);
        await query(`INSERT INTO contacts(id,external_id,channel_type,name,email)
            VALUES($1::uuid,'on','whatsapp','Ana','ana@example.com'),
                  ($2::uuid,'off','whatsapp','Beto','beto@example.com')`,
            [CONTACT_ON, CONTACT_OFF]);
        await query(`INSERT INTO conversations(id,contact_id,channel_type,channel_account_id)
            VALUES($1::uuid,$2::uuid,'whatsapp',$3),($4::uuid,$5::uuid,'whatsapp',$6)`,
            [THREAD_ON, CONTACT_ON, ACCOUNT_ON, THREAD_OFF, CONTACT_OFF, ACCOUNT_OFF]);
        await query(`INSERT INTO products(id,name,price,currency,stock,is_available)
            VALUES($1::uuid,'Real product',12.35,'COP',100,true)`, [productId]);
        await saveAgent(AGENT_ON, ACCOUNT_ON, true);
        await saveAgent(AGENT_OFF, ACCOUNT_OFF, false);
    });

    describe('a pending order is never announced as confirmed', () => {
        it('sends nothing when the agent places the order, even on the agent that confirms', async () => {
            // The seeded template says "Pedido Confirmado". An agent-placed
            // order is `pending` precisely because the business has not
            // accepted it, and announcing it would be the product asserting a
            // commercial outcome that has not happened.
            const order = await placeByAgent(CONTACT_ON, THREAD_ON);

            expect(order.status).toBe('pending');
            expect(renderAndSend).not.toHaveBeenCalled();
        });
    });

    describe('the confirmation follows the agent that took the order', () => {
        it('sends when the business confirms an order taken on the agent that confirms', async () => {
            const order = await placeByAgent(CONTACT_ON, THREAD_ON);

            await orders.updateOrderStatus(tenantId, order.id, 'confirmed', 'tenant_admin');

            expect(renderAndSend).toHaveBeenCalledTimes(1);
            const [target, slug, to, variables, lang] = renderAndSend.mock.calls[0];
            expect({ target, slug, to, lang }).toEqual({
                target: schema, slug: 'order_confirmation', to: 'ana@example.com', lang: 'es',
            });
            // The order it is about, and the money the writer froze — not a
            // total recomputed from a float.
            expect(variables.order_id).toBe(order.id);
            expect(variables.order_total).toContain('24,70');
            expect(variables.order_items_html).toContain('Real product');
        });

        it('stays silent for an order taken on the agent whose switch is off', async () => {
            const order = await placeByAgent(CONTACT_OFF, THREAD_OFF);

            await orders.updateOrderStatus(tenantId, order.id, 'confirmed', 'tenant_admin');

            expect(renderAndSend).not.toHaveBeenCalled();
            // The order really did reach `confirmed`: the silence is the
            // switch, not a failed transition.
            expect(await query('SELECT status FROM orders WHERE id=$1::uuid', [order.id]))
                .toEqual([{ status: 'confirmed' }]);
        });

        it('re-reads the switch, so flipping it changes the next order', async () => {
            const first = await placeByAgent(CONTACT_ON, THREAD_ON);
            await orders.updateOrderStatus(tenantId, first.id, 'confirmed', 'tenant_admin');
            expect(renderAndSend).toHaveBeenCalledTimes(1);

            await saveAgent(AGENT_ON, ACCOUNT_ON, false);
            renderAndSend.mockClear();

            const second = await placeByAgent(CONTACT_ON, THREAD_ON);
            await orders.updateOrderStatus(tenantId, second.id, 'confirmed', 'tenant_admin');
            expect(renderAndSend).not.toHaveBeenCalled();
        });
    });

    describe('at most once, whatever the caller repeats', () => {
        it('does not send a second receipt when the same transition is requested again', async () => {
            const order = await placeByAgent(CONTACT_ON, THREAD_ON);
            await orders.updateOrderStatus(tenantId, order.id, 'confirmed', 'tenant_admin');
            await orders.updateOrderStatus(tenantId, order.id, 'confirmed', 'tenant_admin');

            expect(renderAndSend).toHaveBeenCalledTimes(1);
        });

        it('does not send again when the order is later marked paid', async () => {
            // `paid` is a settlement on an order that was already confirmed and
            // already receipted. From October a repeat is also a charge.
            const order = await placeByAgent(CONTACT_ON, THREAD_ON);
            await orders.updateOrderStatus(tenantId, order.id, 'confirmed', 'tenant_admin');
            await orders.updateOrderStatus(tenantId, order.id, 'paid', 'tenant_admin');

            expect(renderAndSend).toHaveBeenCalledTimes(1);
        });

        it('does not send a second receipt for an idempotent replay of a confirmed order', async () => {
            const data = {
                contactId: CONTACT_ON, conversationId: THREAD_ON, items,
                idempotencyKey: randomUUID(), status: 'confirmed',
            };
            const first = await orders.createOrder(tenantId, data as any);
            const second = await orders.createOrder(tenantId, data as any);

            expect(second.id).toBe(first.id);
            expect(second.idempotentReplay).toBe(true);
            expect(renderAndSend).toHaveBeenCalledTimes(1);
        });
    });

    describe('the absences that are not the owner switching it off', () => {
        it('sends for an order raised from the dashboard with no thread', async () => {
            // No thread, no serving agent to ask, and an absent configuration
            // has never meant "off".
            await orders.createOrder(tenantId,
                { contactId: CONTACT_OFF, items, status: 'confirmed' } as any);

            expect(renderAndSend).toHaveBeenCalledTimes(1);
            expect(renderAndSend.mock.calls[0][2]).toBe('beto@example.com');
        });

        it('sends nothing when the customer has no address', async () => {
            await query('UPDATE contacts SET email=NULL WHERE id=$1::uuid', [CONTACT_ON]);
            const order = await placeByAgent(CONTACT_ON, THREAD_ON);

            await orders.updateOrderStatus(tenantId, order.id, 'confirmed', 'tenant_admin');

            expect(renderAndSend).not.toHaveBeenCalled();
        });

        it('sends nothing for a schema no active tenant owns', async () => {
            // The predicate an isolated evaluation hits: its writer runs inside
            // a CLONE of the tenant schema, which has no row in
            // `public.tenants`. Exercised here by removing the ownership rather
            // than by cloning a schema, because it is the same clause — and it
            // is keyed on ownership so that a production caller can never lose
            // a customer's receipt merely by looking like a test.
            const order = await placeByAgent(CONTACT_ON, THREAD_ON);
            await client.$executeRawUnsafe(
                'UPDATE public.tenants SET is_active=false WHERE id=$1::uuid', tenantId);

            await orders.updateOrderStatus(tenantId, order.id, 'confirmed', 'tenant_admin');

            expect(renderAndSend).not.toHaveBeenCalled();
        });

        it('does not let a dead mail transport undo the order', async () => {
            renderAndSend.mockRejectedValueOnce(new Error('smtp_unreachable'));
            const order = await placeByAgent(CONTACT_ON, THREAD_ON);

            await expect(orders.updateOrderStatus(tenantId, order.id, 'confirmed', 'tenant_admin'))
                .resolves.toBeUndefined();
            expect(await query('SELECT status FROM orders WHERE id=$1::uuid', [order.id]))
                .toEqual([{ status: 'confirmed' }]);
        });
    });
});
