import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isDisposableDatabaseUrl } from '../../../common/__fixtures__/disposable-database';
import { AIToolExecutorService } from '../ai-tool-executor.service';
import { ToolExecutionControlService } from '../tool-execution-control.service';
import { PaymentOperationService, type CustomerPaymentStatus } from '../payment-operation.service';
import { ChatIdentityService } from '../chat-identity.service';
import { operationalConfigurationHash } from '../../persona/agent-configuration-revision';
import type { ServedAgentAuthority } from '../../persona/served-agent-authority';
import { authorityFor } from './tool-authority.fixture';

/**
 * N3 harness for the money and identity contracts: REAL PostgreSQL, REAL
 * ToolExecutionControlService / PaymentOperationService / ChatIdentityService /
 * AIToolExecutorService.execute. Only the outside world is simulated: the payment
 * provider, SMTP and SMS. Nothing here performs a network call.
 */
export const isolationUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

export interface SimPayable {
    contactId: string;
    amountCents: number;
    currency: string;
    description: string;
    paymentStatus: CustomerPaymentStatus;
}

/** Payment provider double: counts every effectful call and holds the "remote" truth. */
export function simulatedProvider() {
    const payables = new Map<string, SimPayable>();
    const statusOverride = new Map<string, any>();
    const calls = { createPaymentLink: [] as any[], applyDiscount: [] as any[], refundPayment: [] as any[], reconcile: [] as any[] };
    const state = { statusMode: 'normal' as 'normal' | 'throw', discountThrows: false };
    const provider: any = {
        id: 'sim-provider',
        supports: () => true,
        getRuntimeCapability: async () => ({ configured: true, ready: true, statusAvailable: true, activeProvider: 'sim-provider' }),
        resolveOwnership: async ({ contactId, kind, reference }: any) => {
            if (kind === 'discount') {
                return reference === `contact:${contactId}` ? { owned: true, canonicalReference: reference } : { owned: false };
            }
            const payable = payables.get(reference);
            if (!payable) return { owned: false };
            // An adversarial provider: it says "not yours" but still ships the other contact's money fields.
            return {
                owned: payable.contactId === contactId, canonicalReference: reference, canonicalAmountCents: payable.amountCents,
                canonicalCurrency: payable.currency, canonicalDescription: payable.description, paymentStatus: payable.paymentStatus,
            };
        },
        createPaymentLink: async (input: any) => {
            calls.createPaymentLink.push(input);
            return { providerOperationId: `sim-link-${calls.createPaymentLink.length}`, url: 'https://pay.example.test/checkout/abc', paymentStatus: 'pending' };
        },
        getPaymentStatus: async ({ contactId, payableReference }: any) => {
            if (state.statusMode === 'throw') throw new Error('provider_down');
            const payable = payables.get(payableReference);
            if (!payable || payable.contactId !== contactId) return null;
            const override = statusOverride.get(payableReference);
            return {
                canonicalReference: payableReference, amountCents: payable.amountCents, currency: payable.currency,
                description: payable.description, paymentStatus: payable.paymentStatus, provider: 'sim-provider', ...override,
            };
        },
        refundPayment: async (input: any) => { calls.refundPayment.push(input); return { providerOperationId: 'sim-refund-1' }; },
        applyDiscount: async (input: any) => {
            calls.applyDiscount.push(input);
            if (state.discountThrows) throw new Error('provider_timeout');
            return { providerOperationId: `sim-disc-${calls.applyDiscount.length}`, code: 'SIM-DISCOUNT' };
        },
        reconcile: async (input: any) => { calls.reconcile.push(input); return { status: 'confirmed' }; },
        findByIdempotencyKey: async () => null,
    };
    const reset = () => {
        for (const list of Object.values(calls)) list.length = 0;
        state.statusMode = 'normal'; state.discountThrows = false;
    };
    return { provider, payables, calls, state, statusOverride, reset };
}

export interface World {
    tenantId: string; schema: string; agentId: string;
    prisma: any; client: PrismaClient;
    q: (sql: string, params?: any[]) => Promise<any[]>;
    controls: ToolExecutionControlService; payments: PaymentOperationService; identity: ChatIdentityService;
    executor: AIToolExecutorService;
    sim: ReturnType<typeof simulatedProvider>;
    smtp: jest.Mock; sms: jest.Mock;
    plan: { customerPayments: boolean };
    scope: () => Promise<ServedAgentAuthority>;
    newContact: (extra?: { email?: string | null; phone?: string | null }) => Promise<string>;
    newConversation: (contactId: string) => Promise<string>;
    inbound: (conversationId: string, text: string) => Promise<string>;
    verify: (conversationId: string, contactId: string, tenantChannel?: string) => Promise<void>;
    run: (contactId: string, conversationId: string, tool: string, args: Record<string, unknown>, opts?: Record<string, unknown>) => Promise<any>;
    destroy: () => Promise<void>;
}

export async function buildWorld(tag: string): Promise<World> {
    const url = new URL(isolationUrl!);
    if (!isDisposableDatabaseUrl(url)) throw new Error('disposable_loopback_database_required');
    const tenantId = randomUUID(), agentId = randomUUID();
    const schema = `tenant_n3${tag}_${randomUUID().replace(/-/g, '')}`;
    const client = new PrismaClient({ datasourceUrl: isolationUrl });
    const prisma: any = Object.create(PrismaService.prototype);
    prisma.$transaction = client.$transaction.bind(client);
    prisma.$queryRawUnsafe = (sql: string, ...values: any[]) => client.$queryRawUnsafe(sql, ...values);
    prisma.$executeRawUnsafe = (sql: string, ...values: any[]) => client.$executeRawUnsafe(sql, ...values);
    prisma.getTenantSchemaName = async (id: string) => {
        if (id !== tenantId) throw new Error('fixture_tenant_mismatch');
        return schema;
    };
    const q = (sql: string, params: any[] = []) => prisma.executeInTenantSchema(schema, sql, params) as Promise<any[]>;

    await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await client.$executeRawUnsafe(
        `INSERT INTO public.tenants(id,schema_name,is_active,language,industry) VALUES($1::uuid,$2,true,'es','retail')`, tenantId, schema);
    for (const ddl of [
        `CREATE TABLE contacts(id UUID PRIMARY KEY,email TEXT,phone TEXT,phone_normalized TEXT,is_active BOOLEAN NOT NULL DEFAULT true,
            external_id TEXT,channel_type TEXT,name TEXT)`,
        `CREATE TABLE conversations(id UUID PRIMARY KEY,contact_id UUID,channel_type TEXT,channel_account_id TEXT,status TEXT DEFAULT 'active')`,
        'CREATE TABLE persona_config(config_json JSONB,version INTEGER,is_active BOOLEAN)',
        `CREATE TABLE messages(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),conversation_id UUID,direction TEXT,content_text TEXT,
            metadata JSONB,created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp())`,
        `CREATE TABLE agent_personas(id UUID PRIMARY KEY,name TEXT,config_json JSONB,channels TEXT[],channel_bindings TEXT[],
            schedule_mode TEXT,is_active BOOLEAN,is_default BOOLEAN,version INT,updated_at TIMESTAMPTZ)`,
        `CREATE TABLE properties(id UUID PRIMARY KEY,name TEXT,address TEXT,check_in_time TIME,check_out_time TIME,
            check_in_instructions TEXT,house_rules TEXT,night_price NUMERIC DEFAULT 100)`,
        `CREATE TABLE property_bookings(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),property_id UUID NOT NULL,contact_id UUID,
            check_in DATE NOT NULL,check_out DATE NOT NULL,status VARCHAR(50) DEFAULT 'pending',hold_expires_at TIMESTAMPTZ)`,
        `CREATE TABLE insurance_policies(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),policy_number VARCHAR(100) NOT NULL UNIQUE,contact_id UUID,
            policyholder_name VARCHAR(255) NOT NULL,monthly_premium DECIMAL(10,2) NOT NULL,currency VARCHAR(10) DEFAULT 'COP',
            starts_at DATE NOT NULL,ends_at DATE,status VARCHAR(20) DEFAULT 'active',next_payment_at DATE)`,
        `CREATE TABLE insurance_claims(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),policy_id UUID NOT NULL,claim_number VARCHAR(100),
            incident_type VARCHAR(100),incident_at DATE,description TEXT,claimed_amount DECIMAL(15,2),approved_amount DECIMAL(15,2),
            status VARCHAR(30) DEFAULT 'submitted',filed_via VARCHAR(20) DEFAULT 'whatsapp',created_at TIMESTAMP DEFAULT NOW())`,
    ]) await q(ddl);
    await q(`INSERT INTO agent_personas VALUES($1::uuid,'Agent','{}','{}','{}','always',true,false,1,NOW())`, [agentId]);

    const smtp = jest.fn().mockResolvedValue('smtp.n3.1');
    const sms = jest.fn().mockResolvedValue({ sent: true, sid: 'SM_N3_1' });
    const email = { prepareBoundedSend: jest.fn().mockImplementation(() => smtp) };
    const identity = new ChatIdentityService(prisma, email as any, { send: sms } as any,
        { phoneRegionFor: jest.fn().mockResolvedValue('CO') } as any);
    const controls = new ToolExecutionControlService(prisma, { get: () => 'n3-disposable-test-secret-32-bytes!' } as any, identity, {} as any);
    const sim = simulatedProvider();
    const plan = { customerPayments: true };
    const payments = new PaymentOperationService(prisma, sim.provider, { isFeatureEnabled: async () => plan.customerPayments } as any);

    const executor = Object.create(AIToolExecutorService.prototype) as AIToolExecutorService;
    Object.assign(executor, {
        prisma, toolExecutionControl: controls, paymentOperations: payments, chatIdentity: identity,
        logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
        propertiesService: { getById: async (s: string, id: string) => (await prisma.$queryRawUnsafe(`SELECT * FROM "${s}".properties WHERE id=$1::uuid`, id))[0] },
        insuranceService: {
            getPolicyByNumber: async (s: string, number: string) =>
                (await prisma.$queryRawUnsafe(`SELECT * FROM "${s}".insurance_policies WHERE policy_number=$1`, number))[0],
            // Real INSERT of the production service: exercised unchanged below.
            fileClaim: (s: string, data: any) => realInsuranceFileClaim(prisma, s, data),
        },
    });

    const scope = async (): Promise<ServedAgentAuthority> => {
        const [row] = await q('SELECT * FROM agent_personas WHERE id=$1::uuid', [agentId]);
        return { kind: 'agent', tenantId, schemaName: schema, agentId, version: Number(row.version), operationalHash: operationalConfigurationHash(row) };
    };

    const world: World = {
        tenantId, schema, agentId, prisma, client, q, controls, payments, identity, executor, sim, smtp, sms, plan, scope,
        newContact: async (extra = {}) => {
            const id = randomUUID();
            const email = extra.email === undefined ? `c${id.slice(0, 8)}@example.test` : extra.email;
            const phone = extra.phone === undefined ? null : extra.phone;
            await q('INSERT INTO contacts(id,email,phone,phone_normalized) VALUES($1::uuid,$2,$3,$3)', [id, email, phone]);
            return id;
        },
        newConversation: async (contactId: string) => {
            const id = randomUUID();
            await q(`INSERT INTO conversations(id,contact_id,channel_type) VALUES($1::uuid,$2::uuid,'whatsapp')`, [id, contactId]);
            return id;
        },
        inbound: async (conversationId: string, text: string) => {
            const [row] = await q(
                `INSERT INTO messages(conversation_id,direction,content_text) VALUES($1::uuid,'inbound',$2) RETURNING id::text AS id`, [conversationId, text]);
            return row.id;
        },
        verify: async (conversationId: string, contactId: string, tenantChannel = 'whatsapp') => {
            await identity.startVerification(tenantId, schema, contactId, conversationId, tenantChannel);
            const [row] = await client.$queryRawUnsafe(
                `SELECT code FROM public.chat_identity_challenges WHERE tenant_id=$1::uuid AND conversation_id=$2::uuid
                  AND consumed_at IS NULL AND superseded_at IS NULL ORDER BY created_at DESC LIMIT 1`, tenantId, conversationId) as any[];
            const verified = await identity.verifyCode(conversationId, row.code);
            if (!verified.ok) throw new Error('fixture_identity_verification_failed');
            smtp.mockClear(); sms.mockClear();
        },
        run: async (contactId, conversationId, tool, args, opts = {}) =>
            executor.execute(schema, tenantId, contactId, tool, args, conversationId,
                { authority: authorityFor(tool), channelType: 'whatsapp', ...opts } as any),
        destroy: async () => {
            try {
                if (!/^tenant_n3[a-z0-9]*_[a-f0-9]{32}$/.test(schema)) throw new Error('unsafe_cleanup');
                await client.$executeRawUnsafe('DELETE FROM public.chat_identity_challenges WHERE tenant_id=$1::uuid', tenantId);
                const tables = await client.$queryRawUnsafe(`SELECT tablename FROM pg_tables WHERE schemaname=$1`, schema) as any[];
                if (tables.length) await client.$executeRawUnsafe('DROP TABLE ' + tables.map(r => `"${schema}"."${r.tablename}"`).join(',') + ' CASCADE');
                await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" RESTRICT`);
                await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2', tenantId, schema);
            } finally { await client.$disconnect(); }
        },
    };
    return world;
}

/** Delegates to the PRODUCTION InsuranceService.fileClaim, bound to the fixture's prisma. */
async function realInsuranceFileClaim(prisma: any, schema: string, data: any) {
    const { InsuranceService } = await import('../../insurance/insurance.service');
    const service = Object.create(InsuranceService.prototype);
    service.prisma = prisma;
    return service.fileClaim(schema, data);
}

export const SAY_YES = 'Sí, confirmo';
