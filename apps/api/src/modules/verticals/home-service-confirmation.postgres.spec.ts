import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ServiceRequestListener } from './service-request.listener';
import { OperationConfirmationService } from '../email-templates/operation-confirmation.service';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';

/**
 * ═══ THE HOME-SERVICE VISIT CONFIRMATION, THROUGH REAL POSTGRES ═══
 *
 * `tools.homeServices.emailConfirmations` was declared by the business-profile
 * contract, drawn as a switch by the agent editor — which names
 * `homeservice_booking_confirmation` as the template it governs — and read by
 * NOTHING. The template was seeded into every tenant and rendered zero times.
 * The only mail this vertical ever produced was an internal emergency alert to
 * the tenant's own staff, which the switch does not and must not govern.
 *
 * ── TWO AGENTS, TWO CONNECTIONS, OPPOSITE SWITCHES ──────────────────────────
 *
 * One tenant, two WhatsApp connections; the agent on one confirms visits and
 * the agent on the other does not. Every send/no-send pair below differs ONLY
 * in which connection the request arrived on, so a reader that resolves the
 * wrong agent — the old unordered `agent_personas WHERE is_active = true
 * LIMIT 1` — inverts an outcome rather than quietly agreeing.
 *
 * The database, the request rows and the agent configuration are real. Only the
 * mail transport is a double, because sending is the one external effect a test
 * may not have.
 */
const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl ? describe : describe.skip)('the home-service visit confirmation follows homeServices.emailConfirmations', () => {
    const tenantId = randomUUID();
    const schema = `tenant_hsconfirm_${randomUUID().replace(/-/g, '')}`;

    const ACCOUNT_ON = '15550001111';
    const ACCOUNT_OFF = '15559990000';
    const AGENT_ON = randomUUID();
    const AGENT_OFF = randomUUID();

    let client: PrismaClient;
    let prisma: any;
    let renderAndSend: jest.Mock;
    let staffEmail: jest.Mock;
    let listener: ServiceRequestListener;
    jest.setTimeout(180_000);

    const query = (sql: string, params: any[] = []): Promise<any[]> =>
        prisma.executeInTenantSchema(schema, sql, params);

    const saveAgent = async (id: string, account: string, emailConfirmations: boolean) => {
        await query(`INSERT INTO agent_personas(id,name,config_json,version,channels,
                channel_bindings,schedule_mode,is_active,is_default)
            VALUES($1::uuid,$2,$3::jsonb,1,ARRAY['whatsapp'],ARRAY[$4],'24_7',true,false)
            ON CONFLICT (id) DO UPDATE SET config_json = EXCLUDED.config_json`,
            [id, `Agent ${account}`, JSON.stringify({
                persona: { name: `Agent ${account}` },
                tools: { homeServices: { enabled: true, emailConfirmations } },
            }), `whatsapp:${account}`]);
    };

    /**
     * A request as `HomeServicesService.createRequest` writes it: `scheduled`
     * with a time when the tool carried a service and an hour, `pending`
     * otherwise.
     */
    const request = async (over: {
        account?: string | null;
        status?: string;
        scheduled?: boolean;
        email?: string | null;
        urgency?: string;
    } = {}) => {
        const contactId = randomUUID();
        const conversationId = randomUUID();
        const id = randomUUID();
        const email = over.email === undefined ? 'ana@example.com' : over.email;
        await query('INSERT INTO contacts(id,name,phone,email,channel_type) VALUES($1::uuid,$2,$3,$4,$5)',
            [contactId, 'Ana', '+573001112233', email, 'whatsapp']);
        if (over.account) {
            await query(`INSERT INTO conversations(id,contact_id,channel_type,channel_account_id,status)
                VALUES($1::uuid,$2::uuid,'whatsapp',$3,'active')`,
                [conversationId, contactId, over.account]);
        }
        const scheduled = over.scheduled !== false;
        await query(`INSERT INTO service_requests(id,contact_id,conversation_id,service_type,
                urgency,customer_name,customer_phone,address,city,status,
                assigned_technician_name,scheduled_at)
            VALUES($1::uuid,$2::uuid,$3::uuid,'plomeria',$4,'Ana','+573001112233',
                'Calle 1 #2-3','Bogotá',$5,'Tecnico Uno',
                CASE WHEN $6::boolean THEN TIMESTAMP '2026-10-01 15:00:00' ELSE NULL END)`,
            [id, contactId, over.account ? conversationId : null,
                over.urgency ?? 'normal', over.status ?? (scheduled ? 'scheduled' : 'pending'), scheduled]);
        return { id, contactId, conversationId: over.account ? conversationId : null };
    };

    const emit = (id: string, urgency = 'normal') =>
        listener.onServiceRequestCreated({
            requestId: id, tenantSchemaName: schema, urgency,
        });

    beforeAll(async () => {
        const url = new URL(databaseUrl!);
        if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
            || !url.pathname.endsWith('_eval_isolation')) {
            throw new Error('disposable_loopback_database_required');
        }
        client = new PrismaClient({ datasourceUrl: databaseUrl });
        await ensureSyntheticGlobalTables(text => client.$executeRawUnsafe(text));
        await client.$executeRawUnsafe(
            'INSERT INTO public.tenants(id,schema_name,is_active,language) VALUES($1::uuid,$2,true,$3)',
            tenantId, schema, 'es-CO');
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);

        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        prisma.$queryRaw = client.$queryRaw.bind(client);
        // The ownership predicate itself runs against the REAL global table, so
        // that "no active tenant owns this schema" is answered by the database
        // and not by the fixture. The display name is supplied here because the
        // shared synthetic `public.tenants` has no `name` column and widening it
        // belongs to whoever owns that fixture.
        prisma.tenant = {
            findFirst: async (args: any) => {
                const rows = await client.$queryRawUnsafe(
                    `SELECT id, language FROM public.tenants
                      WHERE schema_name = $1 AND is_active = $2 LIMIT 1`,
                    args?.where?.schemaName, args?.where?.isActive ?? true) as any[];
                return rows[0] ? { ...rows[0], name: 'Servicios ACME' } : null;
            },
        };
        prisma.user = { findMany: async () => [] };

        await query(`CREATE TABLE contacts(id UUID PRIMARY KEY, name TEXT, phone TEXT,
            email TEXT, channel_type TEXT)`);
        await query(`CREATE TABLE conversations(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            contact_id UUID REFERENCES contacts(id), channel_type TEXT, channel_account_id TEXT,
            status TEXT DEFAULT 'active', metadata JSONB DEFAULT '{}')`);
        // `TIMESTAMP`, like production: `scheduled_at` is a naive wall clock.
        await query(`CREATE TABLE service_requests(id UUID PRIMARY KEY, contact_id UUID,
            conversation_id UUID, service_id UUID, service_type VARCHAR(100) NOT NULL,
            urgency VARCHAR(20) DEFAULT 'normal', customer_name VARCHAR(255),
            customer_phone VARCHAR(50), address TEXT, address_notes TEXT, city VARCHAR(100),
            issue_description TEXT, assigned_technician_id UUID,
            assigned_technician_name VARCHAR(255), scheduled_at TIMESTAMP,
            completed_at TIMESTAMP, status VARCHAR(30) DEFAULT 'pending',
            metadata JSONB DEFAULT '{}', created_at TIMESTAMP DEFAULT NOW())`);
        await query(`CREATE TABLE agent_personas(id UUID PRIMARY KEY, name TEXT,
            config_json JSONB NOT NULL, version INTEGER NOT NULL, channels TEXT[] DEFAULT '{}',
            channel_bindings TEXT[] DEFAULT '{}', schedule_mode TEXT,
            is_active BOOLEAN DEFAULT true, is_default BOOLEAN DEFAULT false,
            updated_at TIMESTAMPTZ DEFAULT NOW())`);
        await query(`CREATE TABLE persona_config(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            config_json JSONB, is_active BOOLEAN DEFAULT true, version INTEGER DEFAULT 1)`);
    });

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_hsconfirm_[a-f0-9]{32}$/.test(schema)) {
                throw new Error('invalid_cleanup_scope');
            }
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid', tenantId);
        } finally { await client.$disconnect(); }
    });

    beforeEach(async () => {
        renderAndSend = jest.fn().mockResolvedValue(true);
        staffEmail = jest.fn().mockResolvedValue(undefined);
        listener = new ServiceRequestListener(
            prisma, { send: staffEmail } as any,
            new OperationConfirmationService(prisma, { renderAndSend } as any));
        await client.$executeRawUnsafe(
            'UPDATE public.tenants SET is_active=true WHERE id=$1::uuid', tenantId);
        await query(`TRUNCATE "${schema}".service_requests, "${schema}".conversations,
            "${schema}".contacts, "${schema}".agent_personas CASCADE`);
        await saveAgent(AGENT_ON, ACCOUNT_ON, true);
        await saveAgent(AGENT_OFF, ACCOUNT_OFF, false);
    });

    it('confirms a scheduled visit taken on the agent that confirms', async () => {
        const req = await request({ account: ACCOUNT_ON });

        await emit(req.id);

        expect(renderAndSend).toHaveBeenCalledTimes(1);
        const [target, slug, to, variables, lang] = renderAndSend.mock.calls[0];
        expect({ target, slug, to, lang }).toEqual({
            target: schema, slug: 'homeservice_booking_confirmation',
            to: 'ana@example.com', lang: 'es',
        });
        expect(variables).toMatchObject({
            service_name: 'plomeria',
            appointment_date: '2026-10-01',
            appointment_time: '15:00',
            location: 'Calle 1 #2-3, Bogotá',
            agent_name: 'Tecnico Uno',
        });
    });

    it('stays silent for a visit taken on the agent whose switch is off', async () => {
        const req = await request({ account: ACCOUNT_OFF });

        await emit(req.id);

        expect(renderAndSend).not.toHaveBeenCalled();
    });

    it('re-reads the switch, so flipping it changes the next visit', async () => {
        await emit((await request({ account: ACCOUNT_ON })).id);
        expect(renderAndSend).toHaveBeenCalledTimes(1);

        await saveAgent(AGENT_ON, ACCOUNT_ON, false);
        renderAndSend.mockClear();

        await emit((await request({ account: ACCOUNT_ON })).id);
        expect(renderAndSend).not.toHaveBeenCalled();
    });

    it('does not announce a visit for a request with no time', async () => {
        // `pending` on the agent that confirms: the refusal is the missing
        // appointment, not the switch. The template says "Visita Técnica
        // Programada" and would be asserting a visit nobody scheduled.
        const req = await request({ account: ACCOUNT_ON, scheduled: false });

        await emit(req.id);

        expect(renderAndSend).not.toHaveBeenCalled();
    });

    it('confirms a request raised with no thread at all', async () => {
        // No conversation, no serving agent to ask, and an absent
        // configuration has never meant "off" — while the only agent whose
        // switch could have been read says no.
        const req = await request({ account: null });

        await emit(req.id);

        expect(renderAndSend).toHaveBeenCalledTimes(1);
    });

    it('sends nothing when the customer left no address', async () => {
        const req = await request({ account: ACCOUNT_ON, email: null });

        await emit(req.id);

        expect(renderAndSend).not.toHaveBeenCalled();
    });

    it('sends nothing for a schema no active tenant owns', async () => {
        const req = await request({ account: ACCOUNT_ON });
        await client.$executeRawUnsafe(
            'UPDATE public.tenants SET is_active=false WHERE id=$1::uuid', tenantId);

        await emit(req.id);

        expect(renderAndSend).not.toHaveBeenCalled();
    });

    it('keeps the customer confirmation and the staff emergency alert independent', async () => {
        // The switch governs the CUSTOMER's confirmation. The internal alert
        // that wakes a human over a gas leak is not the owner's to silence
        // through it, and a failure in one lane must not take the other down.
        prisma.user = { findMany: async () => [{ email: 'owner@example.com' }] };
        try {
            renderAndSend.mockRejectedValue(new Error('smtp_unreachable'));
            const req = await request({ account: ACCOUNT_ON, urgency: 'emergencia' });

            await emit(req.id, 'emergencia');

            expect(staffEmail).toHaveBeenCalledTimes(1);
        } finally { prisma.user = { findMany: async () => [] }; }
    });

    it('still alerts staff for an emergency the owner silenced confirmations on', async () => {
        prisma.user = { findMany: async () => [{ email: 'owner@example.com' }] };
        try {
            const req = await request({ account: ACCOUNT_OFF, urgency: 'emergencia' });

            await emit(req.id, 'emergencia');

            expect(renderAndSend).not.toHaveBeenCalled();
            expect(staffEmail).toHaveBeenCalledTimes(1);
        } finally { prisma.user = { findMany: async () => [] }; }
    });
});
