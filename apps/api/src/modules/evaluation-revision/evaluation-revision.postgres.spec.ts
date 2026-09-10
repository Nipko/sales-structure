import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { EvaluationRevisionService } from './evaluation-revision.service';
import { isDisposableDatabaseUrl } from '../../common/__fixtures__/disposable-database';

const connection=process.env.PARALLLY_ISOLATION_TEST_URL;
(connection ? describe : describe.skip)('evaluation dependency revision in disposable PostgreSQL',()=>{
    const tenantId=randomUUID(), schema=`tenant_revision_${randomUUID().replace(/-/g,'')}`;
    let pool:any,service:EvaluationRevisionService,afterRead:(()=>Promise<void>)|undefined;
    const query=async(sql:string,params:any[]=[]) => (await pool.query(sql,params)).rows;
    beforeAll(async()=>{
        const url=new URL(connection!);
        if(!['127.0.0.1','localhost'].includes(url.hostname)||!isDisposableDatabaseUrl(url))throw new Error('disposable_eval_database_required');
        pool=new Pool({connectionString:connection});
        await query('CREATE TABLE IF NOT EXISTS public.tenants(id uuid PRIMARY KEY,schema_name text NOT NULL)');
        await query('INSERT INTO public.tenants(id,schema_name) VALUES($1::uuid,$2)',[tenantId,schema]);
        await query(`CREATE SCHEMA "${schema}"`);
        for(const table of ['agent_personas','companies','knowledge_documents','knowledge_embeddings','knowledge_document_versions','faqs','policies','products']){
            await query(`CREATE TABLE "${schema}"."${table}"(id uuid PRIMARY KEY,payload jsonb NOT NULL)`);
            await query(`INSERT INTO "${schema}"."${table}" VALUES($1::uuid,$2::jsonb)`,[randomUUID(),JSON.stringify({version:1,text:'original',price:777,secret:'private-provider-token'})]);
        }
        await query(`CREATE TABLE "${schema}".learning_releases(id uuid PRIMARY KEY,snapshot jsonb,evaluation jsonb,evaluation_status text,updated_at timestamptz,evaluation_namespaces jsonb)`);
        await query(`INSERT INTO "${schema}".learning_releases VALUES($1::uuid,'{"examples":["approved"]}','{}','pending',NOW(),NULL)`,[randomUUID()]);
        await query(`CREATE TABLE "${schema}".eval_runs(id uuid PRIMARY KEY,output jsonb)`);
        const prisma={$transaction:async(work:any,options:any)=>{
            expect(options.isolationLevel).toBe('RepeatableRead');
            const client=await pool.connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
            try{
                const result=await work({$queryRawUnsafe:async(sql:string,...params:any[])=>{
                    const rows=(await client.query(sql,params)).rows;
                    if(afterRead&&sql.includes(`FROM "${schema}"."knowledge_documents" t`)){
                        const hook=afterRead;afterRead=undefined;await hook();
                    }
                    return rows;
                }});
                await client.query('COMMIT');return result;
            }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
        }};
        service=new EvaluationRevisionService(prisma as any,{evaluationRoutingSignature:async()=> 'router-fixed'} as any);
    },30000);
    afterAll(async()=>{
        if(!pool)return;
        if(!/^tenant_revision_[a-f0-9]{32}$/.test(schema))throw new Error('invalid_cleanup_scope');
        await query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await query('DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2',[tenantId,schema]);
        await pool.end();
    });
    it('sees one MVCC revision when documents and embeddings change between fingerprint reads',async()=>{
        const before=await service.capture(tenantId);
        afterRead=async()=>{
            const client=await pool.connect();await client.query('BEGIN');
            try{
                for(const table of ['knowledge_documents','knowledge_embeddings'])await client.query(`UPDATE "${schema}"."${table}" SET payload='{"version":2,"text":"changed"}'`);
                await client.query('COMMIT');
            }finally{client.release();}
        };
        const during=await service.capture(tenantId);
        expect(during.revision).toBe(before.revision);
        await expect(service.assertCurrent(before)).rejects.toThrow('evaluation_dependencies_changed');
        const output=JSON.stringify(during);
        expect(output).not.toContain('private-provider-token');expect(output).not.toContain('"price":777');
    });
    it('detects a chunk/version/FAQ/policy edit, not only a configuration edit',async()=>{
        for(const table of ['knowledge_embeddings','knowledge_document_versions','faqs','policies']){
            const before=await service.capture(tenantId);
            await query(`UPDATE "${schema}"."${table}" SET payload=$1::jsonb`,[JSON.stringify({changed:randomUUID()})]);
            await expect(service.assertCurrent(before)).rejects.toThrow(`tenant.${table}`);
        }
    });
    it('detects new catalogs and schema changes on empty business tables',async()=>{
        const before=await service.capture(tenantId);
        await query(`CREATE TABLE "${schema}".new_business_catalog(id uuid PRIMARY KEY)`);
        await expect(service.assertCurrent(before)).rejects.toThrow('evaluation_dependencies_changed');
        const empty=await service.capture(tenantId);
        await query(`ALTER TABLE "${schema}".new_business_catalog ADD COLUMN eligibility boolean DEFAULT false`);
        await expect(service.assertCurrent(empty)).rejects.toThrow('database.structure');
    });
    it('detects committed edits even when a business row is restored to its previous values',async()=>{
        const before=await service.capture(tenantId);
        await query(`UPDATE "${schema}".products SET payload=payload`);
        await expect(service.assertCurrent(before)).rejects.toThrow('tenant.products');
    });
    it('does not invalidate itself when evaluation bookkeeping changes, but release contents do invalidate it',async()=>{
        const before=await service.capture(tenantId);
        await query(`UPDATE "${schema}".learning_releases SET evaluation='{"scores":[90]}',evaluation_status='passed',updated_at=NOW(),evaluation_namespaces='[{"schemaName":"owned-temporary-copy"}]'::jsonb`);
        await query(`INSERT INTO "${schema}".eval_runs VALUES($1::uuid,'{"passed":true}')`,[randomUUID()]);
        await expect(service.assertCurrent(before)).resolves.toBeUndefined();
        await query(`UPDATE "${schema}".learning_releases SET snapshot='{"examples":["different"]}'`);
        await expect(service.assertCurrent(before)).rejects.toThrow('tenant.learning_releases');
    });
});
