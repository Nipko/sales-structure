import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { AgentDispatchOutboxStore } from '../../modules/channels/agent-dispatch-outbox.store';
import { ProactiveDispatchService } from '../../modules/channels/proactive-dispatch.service';
import { DISPATCH_OUTBOX_DDL } from '../../modules/channels/agent-dispatch-outbox';
import { ensureSyntheticGlobalTables } from './synthetic-global-tables';
import { isDisposableDatabaseUrl } from './disposable-database';

/**
 * Shared scaffold of the N3 "durable lane" suites (automation, recall,
 * broadcast, reminders): real PostgreSQL, the real dispatch outbox and the real
 * `ProactiveDispatchService`. Only the transport (a recorder) and Redis are
 * doubles. Table shapes follow the existing `*-durable-lane.postgres.spec.ts`
 * suites, which are the shapes the lane's own authority hashes are computed on.
 */
export const N3_LANE_URL = process.env.PARALLLY_ISOLATION_TEST_URL;

export async function openLane(prefix: string, ddl: string[]) {
    const url = new URL(N3_LANE_URL!);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || !isDisposableDatabaseUrl(url)) {
        throw new Error('disposable_loopback_database_required');
    }
    const tenantId = randomUUID();
    const schema = `tenant_${prefix}_${randomUUID().replace(/-/g, '')}`;
    const client = new PrismaClient({ datasourceUrl: N3_LANE_URL });
    await ensureSyntheticGlobalTables(text => client.$executeRawUnsafe(text));
    await client.$executeRawUnsafe(
        'INSERT INTO public.tenants(id,schema_name,is_active,language) VALUES($1::uuid,$2,true,$3)', tenantId, schema, 'es-CO');
    await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);

    const prisma: any = Object.create(PrismaService.prototype);
    const nativeTransaction = client.$transaction.bind(client) as any;
    // The disposable server runs in America/Bogota, CI in UTC: pin UTC per transaction.
    prisma.$transaction = (callback: any, ...rest: any[]) => nativeTransaction(
        typeof callback === 'function'
            ? async (tx: any) => { await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'UTC'"); return callback(tx); }
            : callback, ...rest);
    prisma.$queryRaw = client.$queryRaw.bind(client);
    prisma.$queryRawUnsafe = client.$queryRawUnsafe.bind(client);
    prisma.$executeRawUnsafe = client.$executeRawUnsafe.bind(client);
    prisma.getTenantSchemaName = async () => schema;
    prisma.tenant = {
        findUnique: async () => ({ id: tenantId, schemaName: schema, isInternal: true, subscriptionStatus: 'active', language: 'es-CO' }),
        findFirst: async () => ({ id: tenantId, schemaName: schema }),
    };
    const sql = (text: string, params: any[] = []): Promise<any[]> => prisma.executeInTenantSchema(schema, text, params);
    for (const statement of ddl) await sql(statement);
    for (const statement of DISPATCH_OUTBOX_DDL) await sql(statement);

    const published: string[] = [];
    const store = new AgentDispatchOutboxStore(prisma,
        { getClient: () => ({ zadd: async () => 1, zremrangebyscore: async () => 0 }) } as any);
    (store as any).schemaFor = async () => schema;
    const proactive = new ProactiveDispatchService(prisma, store,
        { enqueueDispatch: async (_t: string, id: string) => { published.push(id); } } as any);

    const outboxRows = () => sql(`SELECT id,item_kind,state,origin_kind,channel_account_id,contact_id,payload,error_code
        FROM agent_dispatch_outbox ORDER BY created_at`);
    const close = async () => {
        try {
            if (!new RegExp(`^tenant_${prefix}_[a-f0-9]{32}$`).test(schema)) throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid', tenantId);
        } finally { await client.$disconnect(); }
    };
    return { tenantId, schema, client, prisma, sql, store, proactive, published, outboxRows, close };
}

/** Skinny tenant tables, with the column types the lane's revisions depend on. */
export const LANE_CHAT_DDL = [
    `CREATE TABLE contacts(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT, phone TEXT,
        channel_type TEXT, email TEXT, external_id TEXT, last_appointment_at TIMESTAMP, next_recall_at TIMESTAMP,
        last_contact_at TIMESTAMP DEFAULT NOW())`,
    `CREATE TABLE conversations(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contact_id UUID REFERENCES contacts(id), channel_type TEXT, channel_account_id TEXT,
        status TEXT DEFAULT 'active', metadata JSONB DEFAULT '{}', updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE messages(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID REFERENCES conversations(id), direction TEXT, content_type TEXT,
        content_text TEXT, media_url TEXT, status TEXT, external_id TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW())`,
    'CREATE UNIQUE INDEX uidx_messages_external_id ON messages(external_id) WHERE external_id IS NOT NULL',
    // Shape of the canonical table minus the FK to leads: what `isBlocked` reads.
    `CREATE TABLE opt_out_records(id UUID PRIMARY KEY DEFAULT gen_random_uuid(), lead_id UUID, phone VARCHAR(50),
        channel VARCHAR(50) NOT NULL DEFAULT 'whatsapp', trigger_msg TEXT, detected_from VARCHAR(20) DEFAULT 'keyword',
        status VARCHAR(20) DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW())`,
];

/** A confirmed opt-out, in the form the compliance service writes it. */
export const optOut = (sql: (t: string, p?: any[]) => Promise<any[]>, phone: string, status = 'confirmed') =>
    sql("INSERT INTO opt_out_records(phone,channel,status,detected_from) VALUES($1,'whatsapp',$2,'keyword')", [phone, status]);
