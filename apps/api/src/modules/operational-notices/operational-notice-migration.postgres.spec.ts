import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';

const databaseUrl=process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl?describe:describe.skip)('home-service emergency operational-notice migration',()=>{
    jest.setTimeout(120_000);
    const tenantId=randomUUID(),schema=`tenant_onmigration_${randomUUID().replace(/-/g,'')}`;
    let client:PrismaClient;
    const migration=readFileSync(join(__dirname,'../../../prisma/migrations/20260913110000_add_home_service_emergency_notices/migration.sql'),'utf8');
    beforeAll(async()=>{
        const parsed=new URL(databaseUrl!);
        if(!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)||!parsed.pathname.endsWith('_eval_isolation'))throw new Error('disposable_loopback_database_required');
        client=new PrismaClient({datasourceUrl:databaseUrl});
        await ensureSyntheticGlobalTables(sql=>client.$executeRawUnsafe(sql));
        await client.$executeRawUnsafe('INSERT INTO public.tenants(id,schema_name,is_active) VALUES($1::uuid,$2,true)',tenantId,schema);
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        await client.$executeRawUnsafe(`CREATE TABLE "${schema}".operational_notice_outbox(
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),event_key TEXT NOT NULL UNIQUE,
            kind VARCHAR(60) NOT NULL CONSTRAINT operational_notice_outbox_kind_check
                CHECK(kind IN ('appointment.payment_confirmed','appointment.payment_review','gym.waitlist_promoted','education.waitlist_promoted','education.waitlist_review')),
            entity_id UUID NOT NULL,contact_id UUID,conversation_id UUID,state TEXT NOT NULL DEFAULT 'pending')`);
    });
    afterAll(async()=>{
        if(!client)return;
        try{
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid',tenantId);
            if(!/^tenant_onmigration_[a-f0-9]{32}$/.test(schema))throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        }finally{await client.$disconnect();}
    });
    it('widens an existing table idempotently and accepts the new kind',async()=>{
        await client.$executeRawUnsafe(migration);
        await client.$executeRawUnsafe(migration);
        const recipient=randomUUID();
        await client.$executeRawUnsafe(`INSERT INTO "${schema}".operational_notice_outbox(
            event_key,kind,entity_id,recipient_user_id) VALUES($1,'home_service.emergency',$2::uuid,$3::uuid)`,
            `emergency:${recipient}`,randomUUID(),recipient);
        const rows=await client.$queryRawUnsafe<any[]>(`SELECT kind,recipient_user_id
            FROM "${schema}".operational_notice_outbox`);
        expect(rows).toEqual([{kind:'home_service.emergency',recipient_user_id:recipient}]);
    });
});
