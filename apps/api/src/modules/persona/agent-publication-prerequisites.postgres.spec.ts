import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertPublicationPrerequisites } from './agent-publication-prerequisites';

const url=process.env.AGENT_RELEASE_TEST_DATABASE_URL;
(url?describe:describe.skip)('publication prerequisites on a dedicated disposable PostgreSQL database',()=>{
    const database=`publication_${randomUUID().replaceAll('-','')}_eval_isolation`,schema='tenant_publication';
    const tenantId=randomUUID(),agentId=randomUUID();
    let admin:PrismaClient,client:PrismaClient,prisma:PrismaService;
    const query=(sql:string,params:any[]=[])=>prisma.executeInTenantSchema<any[]>(schema,sql,params);
    const input=()=>({tenantId,agentId,operational:{},body:{name:'Alex',configJson:{persona:{name:'Alex'},tools:{payments:{enabled:true}}} as any,
        channels:['web_widget'],channelBindings:['web_widget:owned'],isActive:true,isDefault:true,scheduleMode:'24_7'}});
    const check=(value=input())=>prisma.transactionInTenantSchema(schema,q=>assertPublicationPrerequisites(q,value,()=>{}));
    beforeAll(async()=>{
        const parsed=new URL(url!);if(!['127.0.0.1','localhost'].includes(parsed.hostname)||!parsed.pathname.endsWith('_eval_isolation'))throw new Error('disposable_loopback_database_required');
        admin=new PrismaClient({datasourceUrl:url});await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
        parsed.pathname=`/${database}`;client=new PrismaClient({datasourceUrl:parsed.toString()});
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        prisma=Object.create(PrismaService.prototype);prisma.$transaction=client.$transaction.bind(client);
        await query('CREATE TABLE public.tenants(id UUID PRIMARY KEY,schema_name TEXT,plan TEXT,industry TEXT,settings JSONB,is_active BOOLEAN,is_internal BOOLEAN)');
        await query('CREATE TABLE public.billing_subscriptions(tenant_id UUID PRIMARY KEY,status TEXT,trial_ends_at TIMESTAMPTZ,cancel_at_period_end BOOLEAN,current_period_end TIMESTAMPTZ,cancellation_reason TEXT,dunning_started_at TIMESTAMPTZ)');
        await query('CREATE TABLE public.billing_plans(slug TEXT PRIMARY KEY,max_agents INTEGER,max_ai_messages INTEGER,features JSONB)');
        await query('CREATE TABLE agent_personas(id UUID PRIMARY KEY,is_active BOOLEAN)');
        await query('CREATE TABLE services(id UUID PRIMARY KEY,is_active BOOLEAN)');
        await query('CREATE TABLE availability_slots(id UUID PRIMARY KEY,is_active BOOLEAN)');
    });
    beforeEach(async()=>{
        await query('TRUNCATE public.tenants,public.billing_subscriptions,public.billing_plans,agent_personas,services,availability_slots');
        await query(`INSERT INTO public.tenants VALUES($1::uuid,$2,'plan','education','{"verticalConfig":{"industry":"education","subType":"capacitacion"}}',true,false)`,[tenantId,schema]);
        await query(`INSERT INTO public.billing_subscriptions(tenant_id,status,cancel_at_period_end) VALUES($1::uuid,'active',false)`,[tenantId]);
        await query(`INSERT INTO public.billing_plans VALUES('plan',1,100,'{"customerPayments":true}')`);
        await query('INSERT INTO agent_personas VALUES($1::uuid,true)',[agentId]);
    });
    afterAll(async()=>{
        if(client)await client.$disconnect();
        if(admin)try{if(!/^publication_[a-f0-9]{32}_eval_isolation$/.test(database))throw new Error('cleanup_scope_invalid');
            await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}"`);
        }finally{await admin.$disconnect();}
    });
    it('uses integer quotas, JSON feature overrides and the owned schema through Prisma serialization',async()=>{
        await check();await query('INSERT INTO agent_personas VALUES($1::uuid,true)',[randomUUID()]);
        await expect(check()).rejects.toMatchObject({response:{error:'agent_limit_reached'}});
        await query(`UPDATE public.tenants SET settings=settings||'{"quotaOverrides":{"maxAgents":2}}'::jsonb WHERE id=$1::uuid`,[tenantId]);
        await check();await query('UPDATE public.tenants SET schema_name=$2 WHERE id=$1::uuid',[tenantId,'tenant_other']);
        await expect(check()).rejects.toMatchObject({response:{error:'agent_publication_tenant_unavailable'}});
    });
    it('reads subscription authority at database time and never inherits a plan as entitlement',async()=>{
        await query(`UPDATE public.billing_subscriptions SET status='pending_auth' WHERE tenant_id=$1::uuid`,[tenantId]);
        await expect(check()).rejects.toMatchObject({response:{error:'payment_method_required'}});
        await query(`UPDATE public.billing_subscriptions SET status='active',cancel_at_period_end=true,current_period_end=NOW()-INTERVAL '1 minute' WHERE tenant_id=$1::uuid`,[tenantId]);
        await expect(check()).rejects.toMatchObject({response:{error:'subscription_expired'}});
        await query('DELETE FROM public.billing_subscriptions');await expect(check()).rejects.toMatchObject({response:{error:'subscription_status_unavailable'}});
    });
    it('rejects removed appointment prerequisites and holds valid rows through the publication transaction',async()=>{
        const value=input();value.body.configJson.tools={appointments:{enabled:true}};
        await expect(check(value)).rejects.toMatchObject({response:{error:'appointments_prerequisites_missing'}});
        await query('INSERT INTO services VALUES($1::uuid,true)',[randomUUID()]);await query('INSERT INTO availability_slots VALUES($1::uuid,true)',[randomUUID()]);
        await prisma.transactionInTenantSchema(schema,async q=>{
            await assertPublicationPrerequisites(q,value,()=>{});
            await expect(prisma.transactionInTenantSchema(schema,async other=>{
                await other("SET LOCAL lock_timeout='100ms'");await other('DELETE FROM availability_slots');
            })).rejects.toMatchObject({code:'P2010',meta:{code:'55P03'}});
        });
        await query('DELETE FROM availability_slots');await expect(check(value)).rejects.toMatchObject({response:{error:'appointments_prerequisites_missing'}});
    });
    it('keeps a checked plan stable through commit, then sees the updated feature on the next request',async()=>{
        await prisma.transactionInTenantSchema(schema,async q=>{
            await assertPublicationPrerequisites(q,input(),()=>{});
            await expect(prisma.transactionInTenantSchema(schema,async other=>{
                await other("SET LOCAL lock_timeout='100ms'");await other(`UPDATE public.billing_plans SET features='{}' WHERE slug='plan'`);
            })).rejects.toMatchObject({code:'P2010',meta:{code:'55P03'}});
        });
        await query(`UPDATE public.billing_plans SET features='{}' WHERE slug='plan'`);
        await expect(check()).rejects.toMatchObject({response:{error:'configuration_capability_blocked'}});
    });
});
