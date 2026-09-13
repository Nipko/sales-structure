import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OperationConfirmationService } from '../operation-confirmation.service';
import { ensureSyntheticGlobalTables } from '../../../common/__fixtures__/synthetic-global-tables';

/**
 * ═══ ONE TENANT, TWO CONNECTIONS, TWO AGENTS THAT DISAGREE ═══
 *
 * Nine writers now send a customer receipt under
 * `tools.<family>.emailConfirmations`, and every one of them has to be proved
 * the same way: the switch that decides is the one the owner set on the agent
 * that SERVED the operation, not whichever active agent an unordered `LIMIT 1`
 * returned. Nine hand-built harnesses is nine chances for one of them to use a
 * single agent and pass against the very defect it exists to catch.
 *
 * So the shape lives here: a real disposable schema, real `agent_personas`
 * rows with real `channel_bindings`, and two connections whose agents hold
 * OPPOSITE answers. Each suite adds only its own domain tables and its own
 * question about WHEN the receipt is owed.
 *
 * Only the SMTP transport is a double — sending mail is the one external effect
 * a test may not have — so `renderAndSend` is where the decision becomes
 * observable. Everything in front of it is production's own code over the real
 * database.
 */

export interface ConfirmationHarness {
    readonly tenantId: string;
    readonly schema: string;
    readonly client: PrismaClient;
    /** A `PrismaService` whose per-schema execution is production's own. */
    readonly prisma: any;
    /** The transport double. Assert on this: it is where a decision becomes mail. */
    readonly renderAndSend: jest.Mock;
    /** The real decision service, over the real database. */
    readonly confirmations: OperationConfirmationService;
    query(sql: string, params?: any[]): Promise<any[]>;
    /** Save (or overwrite) one agent bound to one WhatsApp connection. */
    saveAgent(id: string, account: string, tools: Record<string, any>): Promise<void>;
    /** A contact, and a thread on `account` when one is named. */
    customer(account?: string | null, email?: string | null): Promise<{
        contactId: string; conversationId: string | null;
    }>;
    /** Truncate the base and domain tables, and forget every recorded send. */
    reset(): Promise<void>;
    setTenantActive(active: boolean): Promise<void>;
    setTenantLanguage(language: string): Promise<void>;
    teardown(): Promise<void>;
}

/** The connections every suite shares, so the assertions read the same. */
export const CONFIRMS_ACCOUNT = '15550001111';
export const SILENT_ACCOUNT = '15559990000';

const BASE_TABLES = ['agent_personas', 'conversations', 'contacts'];

export async function startConfirmationHarness(
    prefix: string,
    options: { ddl: readonly string[]; tables: readonly string[] },
): Promise<ConfirmationHarness> {
    const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;
    if (!databaseUrl) throw new Error('disposable_database_required');
    const url = new URL(databaseUrl);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
        || !url.pathname.endsWith('_eval_isolation')) {
        throw new Error('disposable_loopback_database_required');
    }
    if (!/^[a-z_]{4,20}$/.test(prefix)) throw new Error('invalid_harness_prefix');

    const tenantId = randomUUID();
    const schema = `tenant_${prefix}_${randomUUID().replace(/-/g, '')}`;
    const client = new PrismaClient({ datasourceUrl: databaseUrl });
    await ensureSyntheticGlobalTables(text => client.$executeRawUnsafe(text));
    await client.$executeRawUnsafe(
        'INSERT INTO public.tenants(id,schema_name,is_active,language) VALUES($1::uuid,$2,true,$3)',
        tenantId, schema, 'es-CO');
    await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    // Several vertical DDLs default a primary key with it.
    await client.$executeRawUnsafe(
        `CREATE FUNCTION "${schema}".uuid_generate_v4() RETURNS UUID LANGUAGE SQL`
        + ' AS $$ SELECT pg_catalog.gen_random_uuid() $$');

    const prisma: any = Object.create(PrismaService.prototype);
    prisma.$transaction = client.$transaction.bind(client);
    prisma.$queryRaw = client.$queryRaw.bind(client);
    prisma.$queryRawUnsafe = client.$queryRawUnsafe.bind(client);
    prisma.getTenantSchemaName = async () => schema;
    // The ownership predicate runs against the REAL global table, so "no active
    // tenant owns this schema" is answered by the database. `name` is supplied
    // here because the shared synthetic `public.tenants` has no such column and
    // widening it belongs to whoever owns that fixture.
    prisma.tenant = {
        findFirst: async (args: any) => {
            const rows = await client.$queryRawUnsafe(
                `SELECT id, language FROM public.tenants
                  WHERE schema_name = $1 AND is_active = $2 LIMIT 1`,
                args?.where?.schemaName, args?.where?.isActive ?? true) as any[];
            return rows[0] ? { ...rows[0], name: 'Negocio de prueba' } : null;
        },
        findUnique: async () => ({ id: tenantId, schemaName: schema, language: 'es-CO' }),
    };
    prisma.user = { findMany: async () => [] };

    const query = (sql: string, params: any[] = []): Promise<any[]> =>
        prisma.executeInTenantSchema(schema, sql, params);

    await query(`CREATE TABLE contacts(id UUID PRIMARY KEY, external_id TEXT, name TEXT,
        phone TEXT, email TEXT, channel_type TEXT)`);
    await query(`CREATE TABLE conversations(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contact_id UUID REFERENCES contacts(id), channel_type TEXT, channel_account_id TEXT,
        status TEXT DEFAULT 'active', metadata JSONB DEFAULT '{}')`);
    // The real shape `readServingPersona` ranks over. A thinner copy would let
    // the resolution pass here and fail in production.
    await query(`CREATE TABLE agent_personas(id UUID PRIMARY KEY, name TEXT,
        config_json JSONB NOT NULL, version INTEGER NOT NULL, channels TEXT[] DEFAULT '{}',
        channel_bindings TEXT[] DEFAULT '{}', schedule_mode TEXT,
        is_active BOOLEAN DEFAULT true, is_default BOOLEAN DEFAULT false,
        updated_at TIMESTAMPTZ DEFAULT NOW())`);
    await query(`CREATE TABLE persona_config(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        config_json JSONB, is_active BOOLEAN DEFAULT true, version INTEGER DEFAULT 1)`);
    for (const statement of options.ddl) await query(statement);

    const renderAndSend = jest.fn().mockResolvedValue(true);
    const confirmations = new OperationConfirmationService(prisma, { renderAndSend } as any);
    const truncate = [...options.tables, ...BASE_TABLES]
        .map(table => `"${schema}".${table}`).join(', ');

    return {
        tenantId, schema, client, prisma, renderAndSend, confirmations, query,

        async saveAgent(id, account, tools) {
            await query(`INSERT INTO agent_personas(id,name,config_json,version,channels,
                    channel_bindings,schedule_mode,is_active,is_default)
                VALUES($1::uuid,$2,$3::jsonb,1,ARRAY['whatsapp'],ARRAY[$4],'24_7',true,false)
                ON CONFLICT (id) DO UPDATE SET config_json = EXCLUDED.config_json`,
                [id, `Agent ${account}`,
                    JSON.stringify({ persona: { name: `Agent ${account}` }, tools }),
                    `whatsapp:${account}`]);
        },

        async customer(account = CONFIRMS_ACCOUNT, email = 'ana@example.com') {
            const contactId = randomUUID();
            const conversationId = randomUUID();
            // No phone: the channel notices are a separate lane with their own
            // connection resolution, and these suites are about the email.
            await query(`INSERT INTO contacts(id,external_id,name,phone,email,channel_type)
                VALUES($1::uuid,$2,'Ana',NULL,$3,'whatsapp')`,
                [contactId, contactId.slice(0, 8), email]);
            if (!account) return { contactId, conversationId: null };
            await query(`INSERT INTO conversations(id,contact_id,channel_type,channel_account_id,status)
                VALUES($1::uuid,$2::uuid,'whatsapp',$3,'active')`,
                [conversationId, contactId, account]);
            return { contactId, conversationId };
        },

        async reset() {
            renderAndSend.mockReset();
            renderAndSend.mockResolvedValue(true);
            await client.$executeRawUnsafe(
                'UPDATE public.tenants SET is_active=true, language=$2 WHERE id=$1::uuid',
                tenantId, 'es-CO');
            await client.$executeRawUnsafe(`TRUNCATE ${truncate} CASCADE`);
        },

        async setTenantActive(active) {
            await client.$executeRawUnsafe(
                'UPDATE public.tenants SET is_active=$2 WHERE id=$1::uuid', tenantId, active);
        },

        async setTenantLanguage(language) {
            await client.$executeRawUnsafe(
                'UPDATE public.tenants SET language=$2 WHERE id=$1::uuid', tenantId, language);
        },

        async teardown() {
            try {
                if (!new RegExp(`^tenant_${prefix}_[a-f0-9]{32}$`).test(schema)) {
                    throw new Error('invalid_cleanup_scope');
                }
                await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
                await client.$executeRawUnsafe(
                    'DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2',
                    tenantId, schema);
            } finally { await client.$disconnect(); }
        },
    };
}

/**
 * The production DDL for one tenant table, lifted out of `tenant-schema.sql`.
 *
 * A hand-written copy is how a suite agrees with itself and disagrees with
 * production by one column or one type. Callers pass the extra additive
 * statements their table has acquired since.
 */
export function productionTableDdl(table: string): string {
    const ddl: string = readFileSync(
        resolve(__dirname, '../../../../prisma/tenant-schema.sql'), 'utf8');
    const start = ddl.indexOf(`CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."${table}" (`);
    if (start < 0) throw new Error(`production_ddl_missing:${table}`);
    const end = ddl.indexOf('\n);', start);
    if (end < 0) throw new Error(`production_ddl_unterminated:${table}`);
    return ddl.slice(start, end + 3)
        // The harness creates its tables INSIDE the schema's search path, and
        // the cross-table references in production's DDL are not what these
        // suites measure.
        .replace(/"\{\{SCHEMA_NAME\}\}"\./g, '')
        .replace(/\s+REFERENCES\s+"[^"]+"\("[^"]+"\)(\s+ON DELETE \w+( \w+)?)?/g, '')
        .replace(/\s+CONSTRAINT\s+"[^"]+"/g, '')
        .replace(/uuid_generate_v4\(\)/g, 'pg_catalog.gen_random_uuid()');
}
