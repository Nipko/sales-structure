import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { performance } from 'perf_hooks';
import { PrismaClient } from '@prisma/client';
import { EvaluationRevisionService } from '../src/modules/evaluation-revision/evaluation-revision.service';

/** Explicit, bounded synthetic workload; never an existing tenant or a production URL. */
async function main() {
    const connection=process.env.EVALUATION_REVISION_BENCHMARK_URL;
    if(!connection)throw new Error('benchmark_local_database_required');
    const url=new URL(connection);
    if(!['localhost','127.0.0.1'].includes(url.hostname)||url.port!=='55439'||!url.pathname.endsWith('_eval_isolation'))
        throw new Error('benchmark_disposable_database_required');
    const schema=`tenant_revisionbench_${randomUUID().replace(/-/g,'')}`,tenantId=randomUUID();
    const client=new PrismaClient({datasources:{db:{url:connection}}});
    const q=(sql:string,...params:unknown[])=>client.$queryRawUnsafe(sql,...params) as Promise<any[]>;
    const exec=(sql:string,...params:unknown[])=>client.$executeRawUnsafe(sql,...params);
    const service=new EvaluationRevisionService(client as any,{evaluationRoutingSignature:async()=> 'synthetic-static-routing'} as any);
    let namespaceCreated=false,tenantInserted=false,extensionCreated=false;
    try {
        await exec(`CREATE SCHEMA "${schema}"`);namespaceCreated=true;
        const vector=await q("SELECT n.nspname AS schema FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector'");
        let vectorSchema=vector[0]?.schema;
        if(!vectorSchema){await exec(`CREATE EXTENSION vector WITH SCHEMA "${schema}"`);extensionCreated=true;vectorSchema=schema;}
        if(!/^[a-z_][a-z0-9_]*$/.test(vectorSchema))throw new Error('benchmark_vector_namespace_invalid');
        await exec('CREATE TABLE IF NOT EXISTS public.tenants(id UUID PRIMARY KEY,schema_name TEXT NOT NULL)');
        await exec('INSERT INTO public.tenants(id,schema_name) VALUES($1::uuid,$2)',tenantId,schema);tenantInserted=true;
        await exec(`CREATE TABLE "${schema}".agent_personas(id UUID PRIMARY KEY,config_json JSONB,version INTEGER)`);
        await exec(`CREATE TABLE "${schema}".messages(id UUID PRIMARY KEY,content_text TEXT,created_at TIMESTAMPTZ)`);
        await exec(`CREATE TABLE "${schema}".knowledge_documents(id UUID PRIMARY KEY,content_text TEXT,version INTEGER)`);
        await exec(`CREATE TABLE "${schema}".knowledge_embeddings(id UUID PRIMARY KEY,content TEXT,embedding "${vectorSchema}".vector(1536))`);
        // Per-table discovery/query overhead is visible even when most modules are empty.
        for(let i=0;i<40;i++)await exec(`CREATE TABLE "${schema}".benchmark_empty_${i}(id UUID PRIMARY KEY,payload JSONB)`);
        await exec(`INSERT INTO "${schema}".agent_personas VALUES($1::uuid,'{"persona":{"name":"Synthetic benchmark"}}',1)`,randomUUID());
        const report:any={kind:'synthetic_local_signature_benchmark',timestamp:new Date().toISOString(),
            methodology:{tenantTables:44,messageTextCharacters:1024,documentTextCharacters:4096,embeddingDimensions:1536,
                repetitions:3,routing:'constant_test_double',database:'real_PostgreSQL_pgvector_Prisma',
                limitations:['shared_host_load','synthetic_data','no_model_provider','not_a_production_capacity_estimate']},samples:[]};
        for(const count of [100,1000,5000]) {
            const vectorCount=Math.min(count,1000),documents=Math.min(count,500);
            await exec(`TRUNCATE "${schema}".messages,"${schema}".knowledge_documents,"${schema}".knowledge_embeddings`);
            await exec(`INSERT INTO "${schema}".messages SELECT gen_random_uuid(),left(repeat(md5(n::text),32),1024),NOW() FROM generate_series(1,$1::int)n`,count);
            await exec(`INSERT INTO "${schema}".knowledge_documents SELECT gen_random_uuid(),repeat(md5(n::text),128),1 FROM generate_series(1,$1::int)n`,documents);
            const embedding=JSON.stringify(Array.from({length:1536},(_,index)=>Number(((index%71)/71).toFixed(6))));
            await exec(`INSERT INTO "${schema}".knowledge_embeddings SELECT gen_random_uuid(),'Synthetic chunk '||n,$2::"${vectorSchema}".vector FROM generate_series(1,$1::int)n`,vectorCount,embedding);
            const size=(await q(`SELECT SUM(pg_total_relation_size(c.oid))::text AS bytes FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind='r'`,schema))[0].bytes;
            const coldStart=performance.now();await service.capture(tenantId);const firstCaptureMs=performance.now()-coldStart;
            const captures:number[]=[],assertions:number[]=[];
            for(let repeat=0;repeat<3;repeat++) {
                const start=performance.now();const manifest=await service.capture(tenantId);captures.push(performance.now()-start);
                const check=performance.now();await service.assertCurrent(manifest);assertions.push(performance.now()-check);
            }
            report.samples.push({messages:count,documents,embeddings:vectorCount,relationBytes:Number(size),
                firstCaptureMs:Math.round(firstCaptureMs),captureMs:captures.map(value=>Math.round(value)),assertCurrentMs:assertions.map(value=>Math.round(value))});
        }
        process.stdout.write(JSON.stringify(report,null,2)+'\n');
    } finally {
        if(namespaceCreated){
            // Only names generated by this invocation; RESTRICT refuses external dependencies.
            const names=['knowledge_embeddings','knowledge_documents','messages','agent_personas',...Array.from({length:40},(_,i)=>`benchmark_empty_${i}`)];
            for(const name of names)await exec(`DROP TABLE IF EXISTS "${schema}"."${name}" RESTRICT`);
            if(extensionCreated)await exec('DROP EXTENSION vector RESTRICT');
            await exec(`DROP SCHEMA "${schema}" RESTRICT`);
        }
        if(tenantInserted)await exec('DELETE FROM public.tenants WHERE id=$1::uuid',tenantId);
        await client.$disconnect();
    }
}
main().catch(error=>{process.stderr.write(`Evaluation revision benchmark failed (${String(error?.code||'local_fixture_error')}).\n`);process.exitCode=1;});
