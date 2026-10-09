import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AIToolExecutorService } from '../ai-tool-executor.service';
import { ToolExecutionControlService } from '../tool-execution-control.service';
import { AppointmentsService } from '../../appointments/appointments.service';
import { OrdersService } from '../../orders/orders.service';
import { ListingsService } from '../../listings/listings.service';
import { operationalConfigurationHash } from '../../persona/agent-configuration-revision';
import type { ServedAgentAuthority } from '../../persona/served-agent-authority';
import { ensureSyntheticGlobalTables } from '../../../common/__fixtures__/synthetic-global-tables';
import { isDisposableDatabaseUrl } from '../../../common/__fixtures__/disposable-database';
import { authorityFor } from './tool-authority.fixture';
import * as commitmentProposal from '../commitment-proposal';

/**
 * Live-path harness for the N3 functional suites.
 *
 * Everything between the tool call and the row is production code: the executor,
 * the central `ToolExecutionControlService` (ledger, signed confirmation,
 * ownership, approval tickets), the domain writers and the canonical tenant DDL
 * loaded by `PrismaService.ensureCanonicalTables`. The only doubles are the
 * edges a test may not touch: Redis (an in-memory mutex), mail/SMS/channel
 * transports and the calendar provider.
 */
export const N3_DATABASE_URL = process.env.PARALLLY_ISOLATION_TEST_URL;

/** In-memory Redis with real mutual exclusion on `acquireLockToken`. */
export function memoryRedis(options: { alwaysGrant?: boolean } = {}) {
    const locks = new Map<string, string>();
    return {
        acquireLockToken: async (key: string) => {
            if (!options.alwaysGrant && locks.has(key)) return null;
            const token = randomUUID();
            locks.set(key, token);
            return token;
        },
        releaseLockToken: async (key: string, token: string) => {
            if (locks.get(key) !== token) return false;
            locks.delete(key);
            return true;
        },
        get: async () => null, set: async () => undefined, del: async () => undefined,
        getJson: async () => null, setJson: async () => undefined,
    };
}

/** Base tables in FK order: loading `appointments` before `opportunities` silently drops it. */
export const CRM_BASE_TABLES = ['contacts', 'conversations', 'messages', 'customer_memory_erasure', 'customer_profiles',
    'contact_identities', 'companies', 'campaigns', 'courses', 'leads', 'opportunities', 'pipelines', 'pipeline_stages',
    'agent_personas', 'persona_config'];

export interface LiveOptions {
    prefix: string;
    /** Canonical tables, in dependency order. Control tables are lazy. */
    tables: string[];
    redis?: ReturnType<typeof memoryRedis>;
    /** Injected into executor constructor slots by name. */
    executorDeps?: Record<string, any>;
    /** ChatIdentityService (real or double). Default: always verified. */
    chatIdentity?: any;
    /**
     * Known product defects the suite steps around so a DIFFERENT contract can be
     * observed. Each one is pinned by its own red `*.defect.postgres.spec.ts`;
     * a suite that does not opt in sees the product exactly as shipped.
     *
     *  - commitmentDdl     `resolveCommitment` runs `CREATE TABLE IF NOT EXISTS
     *                      commitment_proposals` inside the preflight transaction,
     *                      which the schema-lock rule forbids: the "yes" of every
     *                      commitment-family write ends in `tool_failed`.
     *  - contactsIsActive  the canonical `contacts` has no `is_active`, which
     *                      `ChatIdentityService` selects: no code is ever sent.
     */
    workarounds?: { commitmentDdl?: boolean; contactsIsActive?: boolean };
    /** `public.tenants` language/country defaults. */
    language?: string;
    /**
     * The tenant's business type, as the tenant row carries it (`industry`, `settings.verticalConfig`). It is what the central
     * guard reads to decide whether a contact needs a code to see or act on their own appointments. Absent: no vertical on the
     * row, which the policy reads as a sensitive business (fail closed).
     */
    vertical?: { industry: string; subType?: string };
}

const SLOTS = ['prisma', 'redis', 'eventEmitter', 'calendarIntegration', 'faqsService', 'policiesService',
    'knowledgeService', 'propertiesService', 'toursService', 'treatmentService', 'listingsService', 'petsService',
    'restaurantsService', 'gymsService', 'educationService', 'insuranceService', 'chatIdentity',
    'homeServicesService', 'ecommerceService', 'verticalIntegrations', 'mcpClient', 'toolExecutionControl',
    'paymentOperations', 'photographyService', 'ordersService', 'vehicleInventory', 'resourceRentals',
    'leadsRepository', 'opportunitiesRepository', 'tasksService', 'repairOrders', 'appointmentsService'];

export async function openLive(options: LiveOptions) {
    const url = new URL(N3_DATABASE_URL!);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !isDisposableDatabaseUrl(url)) {
        throw new Error('disposable_loopback_database_required');
    }
    const schema = `tenant_${options.prefix}_${randomUUID().replace(/-/g, '')}`;
    const tenantId = randomUUID();
    const client = new PrismaClient({ datasourceUrl: N3_DATABASE_URL });
    await ensureSyntheticGlobalTables(text => client.$executeRawUnsafe(text));
    await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await client.$executeRawUnsafe(
        'INSERT INTO public.tenants(id,schema_name,is_active,language,name) VALUES($1::uuid,$2,true,$3,$4)',
        tenantId, schema, options.language ?? 'es-CO', `N3 ${options.prefix}`);

    const prisma: any = Object.create(PrismaService.prototype);
    /** Errors that crossed a transaction, with their raw stack: why a tool answered `tool_failed`. */
    const stacks: string[] = [];
    const nativeTransaction = client.$transaction.bind(client) as any;
    // The disposable server runs in America/Bogota; CI runs in UTC. Prisma binds a JS Date as
    // timestamptz, so `$1::timestamp` on a naive column reads the session zone. Pin UTC per
    // transaction so the harness answers like CI instead of like the host it happens to run on.
    prisma.$transaction = async (callback: any, ...rest: any[]) => {
        const pinned = typeof callback === 'function'
            ? async (tx: any) => { await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'UTC'"); return callback(tx); }
            : callback;
        try { return await nativeTransaction(pinned, ...rest); } catch (error: any) {
            stacks.push(String(error?.stack || error).split(String.fromCharCode(10)).slice(0, 9).join(' <- '));
            throw error;
        }
    };
    prisma.$queryRaw = client.$queryRaw.bind(client);
    prisma.$queryRawUnsafe = client.$queryRawUnsafe.bind(client);
    prisma.$executeRawUnsafe = client.$executeRawUnsafe.bind(client);
    prisma.getTenantSchemaName = async (id: string) => {
        if (id !== tenantId) throw new Error('test_scope_violation');
        return schema;
    };
    prisma.tenant = {
        findUnique: async () => ({ id: tenantId, schemaName: schema, language: 'es-CO', isInternal: false,
            subscriptionStatus: 'active',
            ...(options.vertical ? { industry: options.vertical.industry } : {}),
            settings: options.vertical ? { verticalConfig: { industry: options.vertical.industry, subType: options.vertical.subType } } : {} }),
        findFirst: async () => ({ id: tenantId, schemaName: schema }),
    };
    // The canonical-table loader only runs statements that name a table. Trigger
    // functions and `DO` blocks that add columns (payment_policy, ...) are not
    // table-scoped statements, so they are applied here: functions first (the
    // triggers need them), the requested tables, then the column-adding blocks.
    const template = (await prisma.loadTenantSchemaTemplate()).replace(/\{\{SCHEMA_NAME\}\}/g, schema);
    const statements = prisma.splitSqlStatements(template) as string[];
    const tolerated = ['42P01', '42703', '42704', '42883', '42P07', '42710', '42P16'];
    const apply = async (statement: string) => {
        try { await client.$executeRawUnsafe(statement); } catch (error: any) {
            if (!tolerated.includes(error?.meta?.code)) throw error;
        }
    };
    for (const statement of statements) if (/^CREATE OR REPLACE FUNCTION/i.test(statement)) await apply(statement);
    await prisma.ensureCanonicalTables(schema, options.tables);
    const present: Array<{ t: string }> = await client.$queryRawUnsafe(
        `SELECT table_name AS t FROM information_schema.tables WHERE table_schema=$1`, schema);
    const missing = options.tables.filter(table => !present.some(row => row.t === table));
    if (missing.length) throw new Error(`canonical_tables_missing:${missing.join(',')} (check FK order)`);
    for (const statement of statements) {
        if (/^DO\s+\$/i.test(statement) && options.tables.some(table => statement.includes(`"${table}"`) || statement.includes(`'${table}'`))) await apply(statement);
    }

    const q = <T = any[]>(sql: string, params: any[] = []) => prisma.executeInTenantSchema(schema, sql, params) as Promise<T>;
    const restorers: Array<() => void> = [];
    if (options.workarounds?.contactsIsActive) {
        await q('ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true');
    }
    if (options.workarounds?.commitmentDdl) {
        const spy = jest.spyOn(commitmentProposal, 'ensureCommitmentProposals').mockResolvedValue(undefined);
        restorers.push(() => spy.mockRestore());
    }
    const redis = options.redis ?? memoryRedis();
    const events = { emit: jest.fn() };
    const calendarOutbox = { enqueueWithQuery: jest.fn(async () => undefined) };
    const regional = {
        timezoneForSchema: async () => 'America/Bogota', timezoneFor: async () => 'America/Bogota',
        resolve: async () => ({ timezone: 'America/Bogota', operatingCountry: { value: 'CO' } }),
    };
    const control = new ToolExecutionControlService(prisma,
        { get: () => 'n3-live-signing-secret-at-least-32-bytes' } as any,
        (options.chatIdentity ?? { isVerified: async () => true, startVerification: async () => ({ status: 'already_verified' }) }) as any,
        redis as any, regional as any);
    const appointments = new AppointmentsService(prisma, events as any, calendarOutbox as any, regional as any);
    const orders = new OrdersService(prisma, redis as any);

    const deps: Record<string, any> = {
        prisma, redis, eventEmitter: events, toolExecutionControl: control, paymentOperations: {},
        chatIdentity: options.chatIdentity ?? { isVerified: async () => true },
        appointmentsService: appointments, ordersService: orders,
        calendarIntegration: { getFreeBusyForDate: async () => [] },
        listingsService: new ListingsService(prisma),
        ...options.executorDeps,
    };
    const executor: any = new (AIToolExecutorService as any)(...SLOTS.map(name => deps[name] ?? {}));
    /** Everything the product logged, so a failing assertion can show why a tool said `tool_failed`. */
    const logs: string[] = [];
    for (const target of [executor.logger, (control as any).logger]) {
        for (const level of ['log', 'warn', 'error', 'debug']) {
            jest.spyOn(target, level).mockImplementation((...args: any[]) => { logs.push(`${level}: ${args.map(String).join(' ')}`); });
        }
    }

    let tick = 0;
    const clockBase = Date.now() - 3_600_000;
    const inbound = async (conversationId: string, text: string) => {
        tick += 1;
        return (await q<any[]>(
            `INSERT INTO messages(conversation_id,direction,content_text,created_at)
             VALUES($1::uuid,'inbound',$2,$3::timestamptz) RETURNING id`,
            [conversationId, text, new Date(clockBase + tick * 1000).toISOString()]))[0].id as string;
    };

    const agentId = randomUUID();
    const seedAgent = async () => {
        await q(`INSERT INTO agent_personas(id,name,config_json,version,is_active,is_default,channels,channel_bindings)
            VALUES($1::uuid,'N3 agent','{}',3,true,true,'{}','{}')`, [agentId]);
        await q(`INSERT INTO persona_config(config_yaml,config_json,is_active)
            VALUES('{}','{"hours":{"timezone":"America/Bogota"}}',true)`);
        const [row] = await q<any[]>('SELECT * FROM agent_personas WHERE id=$1::uuid', [agentId]);
        return { kind: 'agent', tenantId, schemaName: schema, agentId, version: 3,
            operationalHash: operationalConfigurationHash(row) } as ServedAgentAuthority;
    };

    const call = async (contactId: string, conversationId: string, tool: string, args: any,
        scope: ServedAgentAuthority | undefined, extra: any = {}) => {
        const result = await executor.execute(schema, tenantId, contactId, tool, args, conversationId, {
            authority: authorityFor(tool), operationalScope: scope, channelType: 'whatsapp', ...extra,
        });
        if (result?.error === 'tool_failed' || result?.error === 'reconciliation_required') {
            // eslint-disable-next-line no-console
            console.warn(`[n3 ${tool} -> ${result.error}] ${logs.slice(-1)[0] ?? ''} :: ${(stacks.slice(-1)[0] ?? '').slice(0, 700)}`);
        }
        return result as any;
    };

    const close = async () => {
        restorers.forEach(restore => restore());
        try {
            if (!new RegExp(`^tenant_${options.prefix}_[a-f0-9]{32}$`).test(schema)) throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.chat_identity_challenges WHERE tenant_id=$1::uuid', tenantId);
            await client.$executeRawUnsafe('DELETE FROM public.users WHERE tenant_id=$1::uuid', tenantId);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2', tenantId, schema);
        } finally { await client.$disconnect(); }
    };

    /** An active staff member of THIS tenant (`public.users`). */
    const seedStaff = async (first: string, role = 'tenant_agent') => {
        const id = randomUUID();
        await client.$executeRawUnsafe(
            `INSERT INTO public.users(id,tenant_id,email,is_active,role,first_name,last_name)
             VALUES($1::uuid,$2::uuid,$3,true,$4,$5,'N3')`, id, tenantId, `${first.toLowerCase()}-${id}@example.invalid`, role, first);
        return id;
    };

    return { schema, tenantId, client, prisma, q, executor, control, appointments, orders, redis, events,
        calendarOutbox, inbound, seedAgent, seedStaff, call, close, agentId, logs, stacks };
}

/** A contact with a conversation, as the live path needs them. */
export async function seedCustomer(q: (sql: string, params?: any[]) => Promise<any>, name: string,
    extra: { email?: string; phone?: string } = {}) {
    const contactId = randomUUID(), conversationId = randomUUID();
    await q(`INSERT INTO contacts(id,external_id,channel_type,name,email,phone)
        VALUES($1::uuid,$2,'whatsapp',$3,$4,$5)`,
    [contactId, `ext-${contactId}`, name, extra.email ?? null, extra.phone ?? null]);
    await q(`INSERT INTO conversations(id,contact_id,channel_type,channel_account_id,status)
        VALUES($1::uuid,$2::uuid,'whatsapp','n3-account','active')`, [conversationId, contactId]);
    return { contactId, conversationId };
}
