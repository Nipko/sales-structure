import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isolatedEvalNamespaceForPrisma } from '../simulation/isolated-eval-namespace';
import { EVAL_SANDBOX_CONTACT_ID } from '../conversations/agent-test-tool-policy';
import { captureLearningLedger,verifyLearningOperation,type LearningOperationScope } from './learning-operation-evidence';
const url=process.env.LEARNING_EVIDENCE_TEST_DATABASE_URL;
(url?describe:describe.skip)('Learning command proof with PostgreSQL and Prisma',()=>{
    const tenantId=randomUUID(),source=`tenant_learning_proof_${randomUUID().replace(/-/g,'')}`,contactId=EVAL_SANDBOX_CONTACT_ID,otherContact=randomUUID(),conversationId=randomUUID();
    const orderId=randomUUID(),ledgerId=randomUUID();
    let client:PrismaClient,prisma:PrismaService,namespaces:ReturnType<typeof isolatedEvalNamespaceForPrisma>,scope:LearningOperationScope;
    const sql=(schema:string,text:string,params:any[]=[])=>prisma.executeInTenantSchema<any[]>(schema,text,params);
    const result={success:true,order:{id:orderId,status:'pending',paymentStatus:'pending',currency:'COP',totalAmount:12.35,totalAmountCents:'1235',version:1}};
    const call={name:'place_catalog_order',result};
    beforeAll(async()=>{
        const parsed=new URL(url!);if(!['127.0.0.1','localhost'].includes(parsed.hostname)||!parsed.pathname.endsWith('_eval_isolation'))throw new Error('disposable_loopback_database_required');
        client=new PrismaClient({datasourceUrl:url});
        const tables:any[]=await client.$queryRawUnsafe("SELECT to_regclass('public.tenants')::text AS name");
        if(!tables[0].name)await client.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS public.tenants(id UUID PRIMARY KEY,schema_name TEXT)');
        await client.$executeRawUnsafe('INSERT INTO public.tenants(id,schema_name) VALUES($1::uuid,$2)',tenantId,source);
        prisma=Object.create(PrismaService.prototype);prisma.$transaction=client.$transaction.bind(client);
        await client.$executeRawUnsafe(`CREATE SCHEMA "${source}"`);
        // Synthetic rows exercise verifier ownership and JSONB serialization;
        // domain command/consent integration is covered by catalog-orders.postgres.
        await sql(source,'CREATE TABLE contacts(id UUID PRIMARY KEY)');
        await sql(source,'CREATE TABLE orders(id UUID PRIMARY KEY,contact_id UUID REFERENCES contacts(id),status TEXT,payment_status TEXT,currency TEXT,total_amount NUMERIC(15,2),version INT)');
        await sql(source,'CREATE TABLE tool_execution_ledger(id UUID PRIMARY KEY,tool_name TEXT,args_hash CHAR(64),response_payload JSONB,contact_id UUID REFERENCES contacts(id),conversation_id UUID,status TEXT)');
        await sql(source,'INSERT INTO contacts VALUES($1::uuid)',[contactId]);
        await sql(source,"INSERT INTO orders VALUES($1::uuid,$2::uuid,'untouched','pending','COP',42.12,1)",[orderId,contactId]);
        namespaces=isolatedEvalNamespaceForPrisma(prisma);
    });
    beforeEach(async()=>{
        const lease=await namespaces.provision(tenantId,source,['contacts','orders','tool_execution_ledger']);
        scope={tenantId,contactId,conversationId,namespace:lease,assertLease:()=>namespaces.assertOwned(lease)};
        await sql(lease.schemaName,'INSERT INTO contacts VALUES($1::uuid),($2::uuid)',[contactId,otherContact]);
    });
    afterEach(async()=>{
        expect(await sql(source,'SELECT status,total_amount::text FROM orders')).toEqual([{status:'untouched',total_amount:'42.12'}]);
        await namespaces.dispose(scope.namespace!);
    });
    afterAll(async()=>{
        if(!client)return;
        try{
            if(!/^tenant_learning_proof_[a-f0-9]{32}$/.test(source))throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${source}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2',tenantId,source);
            // Other synthetic suites may share the registry. Remove only our row.
        }finally{await client.$disconnect();}
    });
    const commit=async(owner=contactId,status='succeeded')=>{
        await prisma.transactionInTenantSchema(scope.namespace!.schemaName,async query=>{
            await query("INSERT INTO orders VALUES($1::uuid,$2::uuid,'pending','pending','COP',12.35,1)",[orderId,owner]);
            await query('INSERT INTO tool_execution_ledger VALUES($1::uuid,$2,$3,$4::jsonb,$5::uuid,$6::uuid,$7)',[ledgerId,call.name,'a'.repeat(64),JSON.stringify(result),contactId,conversationId,status]);
        });
    };
    it('verifies one exact commit and its unchanged idempotent replay',async()=>{
        const before=await captureLearningLedger(prisma,scope);await commit();
        const first=await verifyLearningOperation(prisma,scope,call,before);
        expect(first).toMatchObject({status:'verified',effect:'committed',objectId:orderId,ledgerId});
        const replayBefore=await captureLearningLedger(prisma,scope);
        const repeated=await verifyLearningOperation(prisma,scope,{...call,result:{...result,idempotentReplay:true}},replayBefore);
        expect(repeated).toMatchObject({status:'verified',effect:'replayed',objectHash:first.objectHash,resultHash:first.resultHash});
        expect(await sql(scope.namespace!.schemaName,'SELECT COUNT(*)::int AS count FROM orders')).toEqual([{count:1}]);
    });
    it('does not attribute an unrelated row change or a foreign object to this command',async()=>{
        const before=await captureLearningLedger(prisma,scope);await commit(otherContact);
        await sql(scope.namespace!.schemaName,"INSERT INTO orders VALUES($1::uuid,$2::uuid,'changed','pending','COP',1,1)",[randomUUID(),contactId]);
        expect(await verifyLearningOperation(prisma,scope,call,before)).toMatchObject({status:'unverified',reason:'owned_object_missing'});
    });
    it('does not infer success from a failed ledger or a response with a different amount',async()=>{
        const before=await captureLearningLedger(prisma,scope);await commit(contactId,'failed');
        expect(await verifyLearningOperation(prisma,scope,call,before)).toMatchObject({status:'unverified',reason:'ledger_result_missing'});
        await sql(scope.namespace!.schemaName,"UPDATE tool_execution_ledger SET status='succeeded'");
        await sql(scope.namespace!.schemaName,'UPDATE orders SET total_amount=20');
        expect(await verifyLearningOperation(prisma,scope,call,before)).toMatchObject({status:'unverified',reason:'object_amount_mismatch'});
    });
});
