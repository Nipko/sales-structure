import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { ConflictException } from '@nestjs/common';
import { KnowledgeConflictService } from './knowledge-conflict.service';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';

// Only a disposable, explicitly selected loopback database. All data is synthetic.
const databaseUrl = process.env.KNOWLEDGE_CONFLICT_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration('Knowledge conflict review on real PostgreSQL', () => {
    const schema = `tenant_conflict_${randomUUID().replace(/-/g, '')}`;
    const tenantId=randomUUID(),actorId=randomUUID(),a=randomUUID(),b=randomUUID(),agentId=randomUUID();
    const scope={audience:'customer' as const,agentId:null,jurisdiction:'CO'};
    let pool:any,service:KnowledgeConflictService,llm:any;
    const quoteA='Las consultas están disponibles todos los lunes a las nueve.';
    const quoteB='Las consultas están disponibles todos los lunes a las diez.';
    async function transaction<T>(work:(query:<R=any[]>(sql:string,params?:any[])=>Promise<R>)=>Promise<T>) {
        const client=await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(`SET LOCAL search_path TO "${schema}", public`);
            const result=await work(async(sql,params=[]) => (await client.query(sql,params)).rows);
            await client.query('COMMIT');return result;
        } catch(error) {await client.query('ROLLBACK');throw error;}
        finally{client.release();}
    }
    const execute=(sql:string,params:any[]=[]):Promise<any[]>=>transaction(query=>query(sql,params));
    const review=(item:any)=>({revision:item.revision,decision:'prefer_a' as const,reason:'Verificado con responsable del negocio.',sourceAHash:item.sourceA.hash,sourceBHash:item.sourceB.hash,scope});
    async function scan() {await service.scan(tenantId);return (await service.overview(tenantId)).cases[0];}
    beforeAll(async()=>{
        const url=new URL(databaseUrl!);
        if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!url.pathname.endsWith('_eval_isolation'))throw new Error('disposable_loopback_database_required');
        pool=new Pool({connectionString:databaseUrl,max:6});
        if(!/^tenant_conflict_[a-f0-9]{32}$/.test(schema))throw new Error('invalid_test_schema');
        await pool.query(`CREATE SCHEMA "${schema}"`);
        for(const sql of [
            `CREATE TABLE knowledge_documents(id UUID PRIMARY KEY,title TEXT,content_text TEXT,status TEXT,version INT,audience TEXT,agent_ids UUID[] DEFAULT '{}',authority TEXT,jurisdiction TEXT,is_regulated BOOLEAN DEFAULT false,valid_from DATE,valid_to DATE,updated_at TIMESTAMPTZ DEFAULT NOW())`,
            `CREATE TABLE faqs(id UUID PRIMARY KEY,question TEXT,answer TEXT,is_published BOOLEAN DEFAULT true,updated_at TIMESTAMPTZ DEFAULT NOW())`,
            `CREATE TABLE policies(id UUID PRIMARY KEY,title TEXT,content TEXT,type TEXT,is_active BOOLEAN DEFAULT true,version INT DEFAULT 1,effective_from TIMESTAMPTZ,effective_to TIMESTAMPTZ,updated_at TIMESTAMPTZ DEFAULT NOW())`,
            `CREATE TABLE companies(id UUID PRIMARY KEY,name TEXT,about TEXT,is_primary BOOLEAN DEFAULT false,updated_at TIMESTAMPTZ DEFAULT NOW())`,
            `CREATE TABLE agent_personas(id UUID PRIMARY KEY)`,
        ])await execute(sql);
        const prisma={getTenantSchemaName:async(id:string)=>{if(id!==tenantId)throw new Error('tenant_scope_violation');return schema;},
            executeInTenantSchema:async(name:string,sql:string,params:any[]=[])=>{if(name!==schema)throw new Error('test_scope_violation');return execute(sql,params);},
            transactionInTenantSchema:async(name:string,work:any)=>{if(name!==schema)throw new Error('test_scope_violation');return transaction(work);}};
        llm={execute:jest.fn()};service=new KnowledgeConflictService(prisma as any,llm);
        await service.ensureTables(schema);
    });
    beforeEach(async()=>{
        await execute('TRUNCATE knowledge_documents,faqs,policies,companies,agent_personas,knowledge_conflict_cases,knowledge_conflict_decisions,knowledge_conflict_scans CASCADE');
        await execute(`INSERT INTO knowledge_documents(id,title,content_text,status,version,audience) VALUES($1::uuid,'Consultas los lunes',$3,'ready',1,'customer'),($2::uuid,'Consultas los lunes',$4,'ready',1,'customer')`,[a,b,quoteA,quoteB]);
        await execute('INSERT INTO agent_personas(id) VALUES($1::uuid)',[agentId]);
        llm.execute.mockReset().mockImplementation(async(input:any)=>{
            const source=JSON.parse(input.messages[0].content);
            return {content:JSON.stringify({contradicts:true,quoteA:source.A.text.includes(quoteA)?quoteA:quoteB,
                quoteB:source.B.text.includes(quoteA)?quoteA:quoteB,detail:'Posibles horarios incompatibles.',suggestion:'Verificar horario.'})};
        });
    });
    afterAll(async()=>{
        if(pool){
            if(!/^tenant_conflict_[a-f0-9]{32}$/.test(schema))throw new Error('invalid_test_cleanup_scope');
            try{await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);}finally{await pool.end();}
        }
    });
    it('accepts exactly one concurrent review for a source revision and preserves actor/reason',async()=>{
        const item=await scan(),input=review(item);
        const attempts=await Promise.allSettled([service.review(tenantId,item.id,actorId,input),service.review(tenantId,item.id,actorId,input)]);
        expect(attempts.filter(result=>result.status==='fulfilled')).toHaveLength(1);
        const rejected=attempts.find(result=>result.status==='rejected') as PromiseRejectedResult;
        expect(rejected.reason).toBeInstanceOf(ConflictException);
        expect(await execute('SELECT revision,actor_id,reason,scope FROM knowledge_conflict_decisions')).toEqual([{revision:1,actor_id:actorId,reason:input.reason,scope}]);
        expect((await service.overview(tenantId)).cases[0]).toMatchObject({revision:2,status:'reviewed'});
    });
    it('source metadata changes invalidate preferences without changing source text',async()=>{
        const item=await scan();await service.review(tenantId,item.id,actorId,review(item));
        expect((await service.annotations(schema,[a],scope,AGENT_TEST_EXECUTION_CONTEXT)).annotations[a][0].state).toBe('reviewed_preference');
        await execute(`UPDATE knowledge_documents SET audience='internal' WHERE id=$1::uuid`,[a]);
        expect((await service.overview(tenantId)).cases[0].status).toBe('stale');
        expect((await service.annotations(schema,[a],scope,AGENT_TEST_EXECUTION_CONTEXT)).annotations).toEqual({});
        await expect(service.review(tenantId,item.id,actorId,{...review(item),revision:2})).rejects.toBeInstanceOf(ConflictException);
    });
    it('source deletion cascades the evidence and decisions without retained source excerpts',async()=>{
        const item=await scan();await service.review(tenantId,item.id,actorId,review(item));
        await execute('DELETE FROM knowledge_documents WHERE id=$1::uuid',[a]);
        expect(await execute('SELECT * FROM knowledge_conflict_cases')).toEqual([]);
        expect(await execute('SELECT * FROM knowledge_conflict_decisions')).toEqual([]);
        expect(JSON.stringify(await execute('SELECT report FROM knowledge_conflict_scans'))).not.toContain(quoteA);
    });
    it('rejects preference for a document over a canonical policy and cascades FAQ/policy/business lineage',async()=>{
        await execute('DELETE FROM knowledge_documents WHERE id=$1::uuid',[b]);
        const ids={faq:randomUUID(),policy:randomUUID(),business:randomUUID()};
        for(const kind of ['faq','policy','business'] as const){
            if(kind==='faq')await execute(`INSERT INTO faqs(id,question,answer) VALUES($1::uuid,'Consultas los lunes',$2)`,[ids[kind],quoteB]);
            if(kind==='policy')await execute(`INSERT INTO policies(id,title,content,type) VALUES($1::uuid,'Consultas los lunes',$2,'terms')`,[ids[kind],quoteB]);
            if(kind==='business')await execute(`INSERT INTO companies(id,name,about,is_primary) VALUES($1::uuid,'Consultas los lunes',$2,true)`,[ids[kind],quoteB]);
            const item=await scan();expect(item.sourceB.kind).toBe(kind);
            if(kind==='policy')await expect(service.review(tenantId,item.id,actorId,review(item))).rejects.toMatchObject({response:{error:'structured_source_authority_required'}});
            await service.review(tenantId,item.id,actorId,{...review(item),decision:'defer'});
            await execute(`DELETE FROM ${{faq:'faqs',policy:'policies',business:'companies'}[kind]} WHERE id=$1::uuid`,[ids[kind]]);
            expect(await execute('SELECT id FROM knowledge_conflict_cases')).toEqual([]);
            expect(await execute('SELECT id FROM knowledge_conflict_decisions')).toEqual([]);
        }
    });
    it('records a concurrent source edit during judgment as unknown without creating a case',async()=>{
        const implementation=llm.execute.getMockImplementation();
        llm.execute.mockImplementation(async(input:any)=>{const result=await implementation(input);await execute('UPDATE knowledge_documents SET version=version+1 WHERE id=$1::uuid',[a]);return result;});
        expect(await service.scan(tenantId)).toMatchObject({checkedPairs:0,unknownPairs:1,newIssues:0,errors:['source_changed_during_scan']});
        expect(await execute('SELECT id FROM knowledge_conflict_cases')).toEqual([]);
    });
    it('invalidates business identity evidence when another company becomes the primary source',async()=>{
        await execute('DELETE FROM knowledge_documents WHERE id=$1::uuid',[b]);
        const original=randomUUID();
        await execute(`INSERT INTO companies(id,name,about) VALUES($1::uuid,'Consultas los lunes',$2)`,[original,quoteB]);
        const item=await scan();expect(item.sourceB.id).toBe(original);
        await execute(`INSERT INTO companies(id,name,about,is_primary) VALUES($1::uuid,'Nueva identidad',$2,true)`,[randomUUID(),quoteB]);
        expect((await service.overview(tenantId)).cases[0].status).toBe('stale');
        expect((await service.annotations(schema,[a],scope,AGENT_TEST_EXECUTION_CONTEXT)).annotations).toEqual({});
    });
});
