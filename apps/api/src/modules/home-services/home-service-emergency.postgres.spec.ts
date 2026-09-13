import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';
import { HomeServicesService } from './home-services.service';
import { OperationalNoticeService } from '../operational-notices/operational-notice.service';

const databaseUrl = process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl ? describe : describe.skip)('home-service emergency delivery authority', () => {
    jest.setTimeout(120_000);
    const tenantId = randomUUID();
    const schema = `tenant_hsemergency_${randomUUID().replace(/-/g, '')}`;
    const adminId = randomUUID();
    const supervisorId = randomUUID();
    const inactiveId = randomUUID();
    let client: PrismaClient;
    let prisma: any;

    beforeAll(async () => {
        const parsed = new URL(databaseUrl!);
        if (!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)
            || !parsed.pathname.endsWith('_eval_isolation')) throw new Error('disposable_loopback_database_required');
        client = new PrismaClient({ datasourceUrl: databaseUrl });
        await ensureSyntheticGlobalTables(sql => client.$executeRawUnsafe(sql));
        await client.$executeRawUnsafe('INSERT INTO public.tenants(id,schema_name,is_active) VALUES($1::uuid,$2,true)',tenantId,schema);
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        await client.$executeRawUnsafe(`CREATE TABLE "${schema}".service_requests(
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),contact_id UUID,opportunity_id UUID,conversation_id UUID,
            service_id UUID,service_type TEXT NOT NULL,urgency TEXT NOT NULL,customer_name TEXT,customer_phone TEXT,
            address TEXT,address_notes TEXT,city TEXT,issue_description TEXT,preferred_date DATE,
            preferred_time_window TEXT,estimated_duration_minutes INTEGER,estimated_cost NUMERIC,currency TEXT,
            scheduled_at TIMESTAMP,status TEXT NOT NULL,completed_at TIMESTAMP,created_at TIMESTAMPTZ DEFAULT NOW())`);
        for (const [id,email,role,active] of [
            [adminId,'admin@example.com','tenant_admin',true],
            [supervisorId,'supervisor@example.com','tenant_supervisor',true],
            [inactiveId,'inactive@example.com','tenant_admin',false],
        ] as const) await client.$executeRawUnsafe(
            'INSERT INTO public.users(id,tenant_id,email,role,is_active) VALUES($1::uuid,$2::uuid,$3,$4,$5)',
            id,tenantId,email,role,active);
        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        prisma.$queryRawUnsafe = client.$queryRawUnsafe.bind(client);
        prisma.$executeRawUnsafe = client.$executeRawUnsafe.bind(client);
    });

    afterAll(async () => {
        if (!client) return;
        try {
            if (!/^tenant_hsemergency_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe('DELETE FROM public.users WHERE id=ANY($1::uuid[])',[adminId,supervisorId,inactiveId]);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid',tenantId);
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally { await client.$disconnect(); }
    });

    beforeEach(async () => {
        await client.$executeRawUnsafe(`TRUNCATE "${schema}".service_requests CASCADE`);
        const table = await client.$queryRawUnsafe<any[]>("SELECT to_regclass($1)::text AS name",`${schema}.operational_notice_outbox`);
        if (table[0]?.name) await client.$executeRawUnsafe(`TRUNCATE "${schema}".operational_notice_outbox CASCADE`);
    });

    it('stores exactly one intent for each active admin or supervisor', async () => {
        const service = new HomeServicesService(prisma,{ emit: jest.fn() } as any);
        const request = await service.createRequest(schema,{serviceType:'gas',urgency:'emergencia',
            customerName:'Ana',customerPhone:'+573001112233',address:'Calle 1',city:'Bogotá',issueDescription:'Fuga'});
        const notices = await prisma.executeInTenantSchema(schema,
            'SELECT * FROM operational_notice_outbox ORDER BY recipient_user_id');
        expect(notices).toHaveLength(2);
        expect(new Set(notices.map((row:any)=>row.recipient_user_id))).toEqual(new Set([adminId,supervisorId]));
        expect(notices).toEqual(expect.arrayContaining([
            expect.objectContaining({kind:'home_service.emergency',entity_id:request.id,state:'pending'}),
        ]));
        prisma.tenant = { findUnique: async () => ({ language: 'es-CO' }) };
        const adminNotice = notices.find((row:any)=>row.recipient_user_id===adminId);
        const hydrated = await (OperationalNoticeService.prototype as any).hydrate.call(
            { prisma, widget: {} },
            (sql:string,params:any[]=[])=>prisma.executeInTenantSchema(schema,sql,params),
            schema,tenantId,adminNotice);
        expect(hydrated).toMatchObject({route:'email',email:'admin@example.com'});
        expect(hydrated.text).toContain('EMERGENCIA — nueva solicitud de servicio');
        expect(hydrated.text).toContain('Problema: Fuga');
    });

    it('rolls the request back when its emergency authority cannot be stored', async () => {
        const rejecting = Object.create(PrismaService.prototype);
        rejecting.$transaction = client.$transaction.bind(client);
        rejecting.$queryRawUnsafe = client.$queryRawUnsafe.bind(client);
        rejecting.$executeRawUnsafe = client.$executeRawUnsafe.bind(client);
        const original = rejecting.transactionInTenantSchema.bind(rejecting);
        rejecting.transactionInTenantSchema = (target:string,work:any,options?:any) => original(target,(query:any)=>work(async(sql:string,params:any[]=[])=>{
            if (sql.includes('INSERT INTO operational_notice_outbox')) throw new Error('forced_notice_storage_failure');
            return query(sql,params);
        }),options);
        const service = new HomeServicesService(rejecting,{ emit: jest.fn() } as any);
        await expect(service.createRequest(schema,{serviceType:'electricidad',urgency:'emergencia'}))
            .rejects.toThrow('forced_notice_storage_failure');
        await expect(prisma.executeInTenantSchema(schema,'SELECT id FROM service_requests')).resolves.toEqual([]);
    });
});
