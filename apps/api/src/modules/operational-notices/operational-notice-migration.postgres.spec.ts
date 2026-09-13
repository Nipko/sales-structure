import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';

const databaseUrl=process.env.PARALLLY_ISOLATION_TEST_URL;

(databaseUrl?describe:describe.skip)('operational-notice kind migrations',()=>{
    jest.setTimeout(120_000);
    const tenantId=randomUUID(),schema=`tenant_onmigration_${randomUUID().replace(/-/g,'')}`;
    let client:PrismaClient;
    const migration=readFileSync(join(__dirname,'../../../prisma/migrations/20260913110000_add_home_service_emergency_notices/migration.sql'),'utf8');
    const bookingMigration=readFileSync(join(__dirname,'../../../prisma/migrations/20260913120000_add_booking_confirmation_notices/migration.sql'),'utf8');
    const orderMigration=readFileSync(join(__dirname,'../../../prisma/migrations/20260913130000_add_catalog_order_confirmation_notices/migration.sql'),'utf8');
    const slaMigration=readFileSync(join(__dirname,'../../../prisma/migrations/20260913140000_add_handoff_sla_notices/migration.sql'),'utf8');
    const appointmentSlackMigration=readFileSync(join(__dirname,'../../../prisma/migrations/20260913150000_add_appointment_slack_notices/migration.sql'),'utf8');
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
            entity_id UUID NOT NULL,contact_id UUID,conversation_id UUID,state TEXT NOT NULL DEFAULT 'pending',
            next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
        await client.$executeRawUnsafe(`CREATE TABLE "${schema}".property_bookings(id UUID PRIMARY KEY)`);
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
        await client.$executeRawUnsafe(bookingMigration);
        await client.$executeRawUnsafe(bookingMigration);
        await client.$executeRawUnsafe(orderMigration);
        await client.$executeRawUnsafe(orderMigration);
        await client.$executeRawUnsafe(slaMigration);
        await client.$executeRawUnsafe(slaMigration);
        await client.$executeRawUnsafe(appointmentSlackMigration);
        await client.$executeRawUnsafe(appointmentSlackMigration);
        const recipient=randomUUID();
        await client.$executeRawUnsafe(`INSERT INTO "${schema}".operational_notice_outbox(
            event_key,kind,entity_id,recipient_user_id) VALUES($1,'home_service.emergency',$2::uuid,$3::uuid)`,
            `emergency:${recipient}`,randomUUID(),recipient);
        const rows=await client.$queryRawUnsafe<any[]>(`SELECT kind,recipient_user_id
            FROM "${schema}".operational_notice_outbox`);
        expect(rows).toEqual([{kind:'home_service.emergency',recipient_user_id:recipient}]);
        await client.$executeRawUnsafe(`INSERT INTO "${schema}".operational_notice_outbox(
            event_key,kind,entity_id) VALUES($1,'tour.booking_confirmed',$2::uuid),
            ($3,'property.booking_confirmed',$4::uuid),
            ($5,'order.confirmed',$6::uuid)`,
            `tour:${recipient}`,randomUUID(),`property:${recipient}`,randomUUID(),`order:${recipient}`,randomUUID());
        await client.$executeRawUnsafe(`INSERT INTO "${schema}".operational_notice_outbox(
            event_key,kind,entity_id,recipient_user_id) VALUES($1,'handoff.sla_escalated',$2::uuid,$3::uuid)`,
            `sla:${recipient}`,randomUUID(),recipient);
        await client.$executeRawUnsafe(`INSERT INTO "${schema}".operational_notice_outbox(
            event_key,kind,entity_id) VALUES($1,'appointment.operator_slack',$2::uuid)`,
            `appointment-slack:${recipient}`,randomUUID());
        const columns=await client.$queryRawUnsafe<any[]>(`SELECT column_name FROM information_schema.columns
            WHERE table_schema=$1 AND table_name='property_bookings' AND column_name='language'`,schema);
        expect(columns).toHaveLength(1);
    });
});
