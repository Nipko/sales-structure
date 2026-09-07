import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isolatedEvalNamespaceForPrisma } from '../simulation/isolated-eval-namespace';
import { EVAL_SANDBOX_CONTACT_ID } from '../conversations/agent-test-tool-policy';
import { LearningEvaluationService } from './learning-evaluation.service';
const databaseUrl=process.env.LEARNING_EVIDENCE_TEST_DATABASE_URL;
(databaseUrl?describe:describe.skip)('Learning evidence reads its owned PostgreSQL namespace',()=>{
    const tenantId=randomUUID(),source=`tenant_learning_evidence_${randomUUID().replace(/-/g,'')}`,contactId=EVAL_SANDBOX_CONTACT_ID;
    let client:PrismaClient,prisma:PrismaService,namespaces:ReturnType<typeof isolatedEvalNamespaceForPrisma>,lease:any,service:LearningEvaluationService,session:any;
    const sql=(schema:string,text:string,params:any[]=[])=>prisma.executeInTenantSchema<any[]>(schema,text,params);
    beforeAll(async()=>{
        const url=new URL(databaseUrl!);if(!['127.0.0.1','localhost'].includes(url.hostname)||!url.pathname.endsWith('_eval_isolation'))throw new Error('disposable_loopback_database_required');
        client=new PrismaClient({datasourceUrl:databaseUrl});
        const tables:any[]=await client.$queryRawUnsafe("SELECT to_regclass('public.tenants')::text AS name");
        if(!tables[0].name)await client.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS public.tenants(id UUID PRIMARY KEY,schema_name TEXT)');
        await client.$executeRawUnsafe('INSERT INTO public.tenants(id,schema_name) VALUES($1::uuid,$2)',tenantId,source);
        prisma=Object.create(PrismaService.prototype);prisma.$transaction=client.$transaction.bind(client);
        prisma.getTenantSchemaName=jest.fn(async()=>{throw new Error('source_resolution_forbidden');});
        await client.$executeRawUnsafe(`CREATE SCHEMA "${source}"`);
        await sql(source,'CREATE TABLE contacts(id UUID PRIMARY KEY)');
        await sql(source,'CREATE TABLE orders(id UUID PRIMARY KEY,contact_id UUID REFERENCES contacts(id),status TEXT,total_amount NUMERIC(15,2))');
        await sql(source,'INSERT INTO contacts(id) VALUES($1::uuid)',[contactId]);
        await sql(source,"INSERT INTO orders VALUES($1::uuid,$2::uuid,'source-unchanged',42.12)",[randomUUID(),contactId]);
        namespaces=isolatedEvalNamespaceForPrisma(prisma);
    });
    beforeEach(async()=>{
        lease=await namespaces.provision(tenantId,source,['contacts','orders']);
        await sql(lease.schemaName,'INSERT INTO contacts(id) VALUES($1::uuid)',[contactId]);
        session={sandboxContactId:contactId,sandboxConversationId:randomUUID(),sandboxNamespace:lease,reset:async()=>{},assertLease:()=>namespaces.assertOwned(lease),recordInbound:async()=>randomUUID()};
        const runtime={test:jest.fn(async()=>{
            await sql(lease.schemaName,"INSERT INTO orders VALUES($1::uuid,$2::uuid,'pending',12.35)",[randomUUID(),contactId]);
            return {reply:'He registrado el pedido pendiente.',debug:{agentRevision:{configHash:'frozen'},toolCalls:[{name:'place_catalog_order',result:{success:true}}],ragHits:[],model:'synthetic'}};
        })};
        service=new LearningEvaluationService({} as any,runtime as any,{} as any,{} as any,{} as any,prisma);
    });
    afterEach(async()=>{if(lease)await namespaces.dispose(lease);});
    afterAll(async()=>{
        if(!client)return;
        try{
            if(!/^tenant_learning_evidence_[a-f0-9]{32}$/.test(source))throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${source}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2',tenantId,source);
            // Other synthetic suites may share the registry. Remove only our row.
        }finally{await client.$disconnect();}
    });
    it('checks before/after in the namespace and preserves identical source rows',async()=>{
        const before=await sql(source,'SELECT id,status,total_amount FROM orders');
        const replay=await (service as any).replay(tenantId,randomUUID(),{channel:'web_widget',messages:[{role:'customer',text:'Confirma mi pedido'}]},
            {configHash:'frozen'},null,session,session.assertLease);
        expect(replay.completed).toBe(true);
        // This test's synthetic payload has no ledger/object reference; the
        // changed diagnostic count alone must never certify that action.
        expect(replay.failures).toEqual(['operation_evidence_unverified:place_catalog_order:object_reference_missing']);
        expect(replay.turns[0].database.before.orders.count).toBe(0);expect(replay.turns[0].database.after.orders.count).toBe(1);
        expect(replay.turns[0].database.after.orders.hash).not.toBe(replay.turns[0].database.before.orders.hash);
        expect(await sql(source,'SELECT id,status,total_amount FROM orders')).toEqual(before);
        expect(prisma.getTenantSchemaName).not.toHaveBeenCalled();
    });
    it('fails closed for missing/foreign namespaces or a lost owner token without reading the source',async()=>{
        for(const patch of [{sandboxNamespace:undefined},{sandboxNamespace:{...lease,tenantId:randomUUID()}},{sandboxContactId:randomUUID()}]){
            await expect((service as any).databaseEvidence(tenantId,{...session,...patch})).rejects.toThrow('learning_evidence_namespace_required');
        }
        const forged={...lease,token:randomUUID()};
        await expect((service as any).databaseEvidence(tenantId,{...session,sandboxNamespace:forged,assertLease:()=>namespaces.assertOwned(forged)})).rejects.toThrow('eval_namespace_lease_lost');
        expect(prisma.getTenantSchemaName).not.toHaveBeenCalled();
    });
});
