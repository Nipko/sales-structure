import { randomUUID } from 'crypto';
import { ConflictException } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';
import { CustomerMemoryService } from '../conversations/customer-memory.service';
import { ComplianceService } from '../compliance/compliance.service';
import { IdentityService } from '../identity/identity.service';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// This suite runs production SQL and pgvector. Only the external embedding/LLM
// boundary and Redis accounting are synthetic. It never reads global tenants.
const databaseUrl=process.env.KNOWLEDGE_MEMORY_TEST_DATABASE_URL;
const integration=databaseUrl?describe:describe.skip;
const vector=()=>[1,...Array(1535).fill(0)];
function deferred<T=void>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{promise,resolve};}

integration('Knowledge and memory publication with real PostgreSQL + pgvector',()=>{
    const schema=`tenant_memorykb_${randomUUID().replace(/-/g,'')}`;
    const tenantId=randomUUID(),documentId=randomUUID(),contactId=randomUUID(),siblingId=randomUUID(),profileId=randomUUID(),conversationId=randomUUID(),siblingConversationId=randomUUID(),removedProfileId=randomUUID(),suggestionId=randomUUID();
    let pool:any,prisma:any,knowledge:KnowledgeService,memory:CustomerMemoryService,compliance:ComplianceService,identity:IdentityService,embedding:jest.SpyInstance,router:any;
    let beforeSql:((sql:string)=>Promise<void>)|undefined;
    const correction={key:'contact.preference.channel',text:'Prefiere correo, no llamadas',kind:'preference',evidence:'Ahora prefiero correo, no llamadas',validUntil:null};
    const stopContact={...correction,text:'No quiere contacto comercial',evidence:'No quiero contacto comercial'};
    async function transaction<T>(work:(query:<R=any[]>(sql:string,params?:any[])=>Promise<R>)=>Promise<T>){
        const client=await pool.connect();
        try{await client.query('BEGIN');await client.query(`SET LOCAL search_path TO "${schema}", public`);
            const result=await work(async(sql,params=[]) => {await beforeSql?.(sql);return (await client.query(sql,params)).rows;});await client.query('COMMIT');return result;
        }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    }
    const execute=(sql:string,params:any[]=[]):Promise<any[]>=>transaction(query=>query(sql,params));
    const docState=async()=>({doc:(await execute('SELECT content_text,version,status,audience,error_message FROM knowledge_documents WHERE id=$1::uuid',[documentId]))[0],
        chunks:await execute('SELECT chunk_text FROM knowledge_embeddings ORDER BY chunk_index'),history:await execute('SELECT version,content_text FROM knowledge_document_versions ORDER BY version')});
    const extract=(contact=contactId,conversation=conversationId)=>memory.extractFromConversation(tenantId,schema,conversation,contact);
    const currentMemory=(contact=contactId,query?:string)=>memory.getMemory(schema,contact,query,tenantId);
    beforeAll(async()=>{
        const url=new URL(databaseUrl!);
        if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!url.pathname.endsWith('_eval_isolation'))throw new Error('disposable_loopback_database_required');
        const {Pool}=require('pg');pool=new Pool({connectionString:databaseUrl,max:8});
        if(!/^tenant_memorykb_[a-f0-9]{32}$/.test(schema))throw new Error('invalid_test_schema');
        await pool.query(`CREATE SCHEMA "${schema}"`);
        const existing=(await pool.query("SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='vector'")).rows;
        if(existing.length&&existing[0].nspname!=='public')throw new Error('vector_extension_must_not_depend_on_another_test_schema');
        if(!existing.length)await pool.query(`CREATE EXTENSION vector WITH SCHEMA "${schema}"`);
        for(const sql of [
            `CREATE TABLE knowledge_documents(id UUID PRIMARY KEY,title TEXT,file_type TEXT,content_text TEXT,version INT,updated_at TIMESTAMPTZ,created_at TIMESTAMPTZ DEFAULT NOW(),status TEXT,
                chunk_count INT DEFAULT 1,is_regulated BOOLEAN DEFAULT false,jurisdiction TEXT,authority TEXT,valid_from DATE,valid_to DATE,audience TEXT DEFAULT 'customer',agent_ids UUID[] DEFAULT '{}',is_public BOOLEAN DEFAULT false,
                source_type TEXT DEFAULT 'upload',error_message TEXT,crawl_hash TEXT,last_crawled_at TIMESTAMPTZ,category TEXT,auto_recrawl BOOLEAN,slug TEXT,excerpt TEXT,language TEXT)`,
            `CREATE TABLE knowledge_embeddings(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),document_id UUID REFERENCES knowledge_documents(id) ON DELETE CASCADE,chunk_index INT,chunk_text TEXT,embedding vector(1536),metadata JSONB,search_tsv TSVECTOR,created_at TIMESTAMPTZ DEFAULT NOW())`,
            `CREATE TABLE knowledge_document_versions(document_id UUID,version INT,title TEXT,content_text TEXT,chunk_count INT,changed_by TEXT,change_summary TEXT,UNIQUE(document_id,version))`,
            `CREATE TABLE messages(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),conversation_id UUID,direction TEXT,content_text TEXT,created_at TIMESTAMPTZ DEFAULT NOW())`,
            `CREATE TABLE conversations(id UUID PRIMARY KEY,contact_id UUID)`,
            `CREATE TABLE contact_identities(contact_id UUID,customer_profile_id UUID,is_primary BOOLEAN DEFAULT false)`,
            `CREATE TABLE customer_profiles(id UUID PRIMARY KEY,phone TEXT,email TEXT,updated_at TIMESTAMPTZ DEFAULT NOW())`,
            `CREATE TABLE merge_suggestions(id UUID PRIMARY KEY,customer_profile_id_a UUID,customer_profile_id_b UUID,status TEXT,reviewed_by UUID,reviewed_at TIMESTAMPTZ)`,
            `CREATE TABLE agent_personas(id UUID PRIMARY KEY)`,
        ])await execute(sql);
        prisma={getTenantSchemaName:async(id:string)=>{if(id!==tenantId)throw new Error('tenant_scope_violation');return schema;},
            executeInTenantSchema:async(name:string,sql:string,params:any[]=[])=>{if(name!==schema)throw new Error('test_scope_violation');return execute(sql,params);},
            transactionInTenantSchema:async(name:string,work:any)=>{if(name!==schema)throw new Error('test_scope_violation');return transaction(work);}};
        const cache=new Map<string,string>();
        const redis={get:async(key:string)=>cache.get(key)??null,set:async(key:string,value:string)=>{cache.set(key,value);},incrBy:async()=>0,expire:async()=>{},del:async()=>{},tenantKey:(id:string,key:string)=>`${id}:${key}`};
        knowledge=new KnowledgeService(prisma,redis as any,{} as any,{getPlanLimit:async()=>Infinity} as any,{} as any,{} as any);
        embedding=jest.spyOn(knowledge,'generateEmbedding');router={execute:jest.fn()};
        memory=new CustomerMemoryService(prisma,router,knowledge);compliance=new ComplianceService(prisma);
        identity=new IdentityService(prisma,redis as any,{} as any);
        await (memory as any).ensureTable(schema);
    });
    beforeEach(async()=>{
        beforeSql=undefined;
        await execute('TRUNCATE knowledge_documents,knowledge_embeddings,knowledge_document_versions,messages,conversations,contact_identities,customer_profiles,merge_suggestions,agent_personas,customer_memory_facts,customer_memories,customer_memory_erasure CASCADE');
        await execute(`INSERT INTO knowledge_documents(id,title,file_type,content_text,version,updated_at,status) VALUES($1::uuid,'Conditions','text/plain','Old policy',1,'2026-09-01 10:00:00.123456+00','ready')`,[documentId]);
        await execute('INSERT INTO knowledge_embeddings(document_id,chunk_index,chunk_text,embedding) VALUES($1::uuid,0,$2,$3::vector)',[documentId,'Old policy',JSON.stringify(vector())]);
        await execute('INSERT INTO conversations(id,contact_id) VALUES($1::uuid,$2::uuid),($3::uuid,$4::uuid)',[conversationId,contactId,siblingConversationId,siblingId]);
        await execute('INSERT INTO contact_identities(contact_id,customer_profile_id) VALUES($1::uuid,$3::uuid),($2::uuid,$3::uuid)',[contactId,siblingId,profileId]);
        await execute('INSERT INTO customer_profiles(id) VALUES($1::uuid),($2::uuid)',[profileId,removedProfileId]);
        await execute(`INSERT INTO merge_suggestions(id,customer_profile_id_a,customer_profile_id_b,status) VALUES($1::uuid,$2::uuid,$3::uuid,'pending')`,[suggestionId,profileId,removedProfileId]);
        await execute(`INSERT INTO messages(conversation_id,direction,content_text) VALUES($1::uuid,'inbound',$2),($3::uuid,'inbound',$4)`,[conversationId,correction.evidence,siblingConversationId,stopContact.evidence]);
        await execute(`INSERT INTO customer_memory_facts(owner_kind,owner_id,fact_key,fact_text,fact_kind,evidence_text,source_contact_id,source_conversation_id)
            VALUES('profile',$1::uuid,$2,'Prefiere teléfono','preference','Prefiero teléfono',$3::uuid,$4::uuid)`,[profileId,correction.key,contactId,conversationId]);
        await execute(`INSERT INTO customer_memories(contact_id,facts,summary) VALUES($1::uuid,'["Prefiere teléfono"]','Resumen obsoleto')`,[contactId]);
        embedding.mockReset().mockResolvedValue(vector());router.execute.mockReset().mockResolvedValue({content:JSON.stringify({facts:[correction]})});
    });
    afterAll(async()=>{
        if(pool){if(!/^tenant_memorykb_[a-f0-9]{32}$/.test(schema))throw new Error('invalid_test_cleanup_scope');
            try{await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);}finally{await pool.end();}}
    });

    it('keeps live content, version and embeddings after a provider failure, then recovers on retry',async()=>{
        embedding.mockRejectedValueOnce(new Error('synthetic embedding failure'));
        await expect(knowledge.updateDocument(tenantId,documentId,{content:'New policy'})).rejects.toThrow('synthetic embedding failure');
        expect(await docState()).toMatchObject({doc:{content_text:'Old policy',version:1,status:'ready',error_message:'synthetic embedding failure'},chunks:[{chunk_text:'Old policy'}],history:[]});
        const updated=await knowledge.updateDocument(tenantId,documentId,{content:'New policy'});expect(updated.version).toBe(2);
        expect(await docState()).toMatchObject({doc:{content_text:'New policy',version:2,error_message:null},chunks:[{chunk_text:'New policy'}],history:[{version:1,content_text:'Old policy'}]});
    });
    it('rolls back a partially inserted replacement when PostgreSQL rejects vector dimensions',async()=>{
        embedding.mockResolvedValueOnce(vector()).mockResolvedValueOnce([1,0]);
        await expect(knowledge.updateDocument(tenantId,documentId,{content:'Primera parte. '.repeat(180)+'\n\n'+'Segunda parte. '.repeat(180)})).rejects.toThrow(/dimensions/i);
        expect(await docState()).toMatchObject({doc:{content_text:'Old policy',version:1,status:'ready'},chunks:[{chunk_text:'Old policy'}],history:[]});
    });
    it('rejects a slow indexing writer after a newer content version is published',async()=>{
        const entered=deferred(),release=deferred();
        embedding.mockImplementation(async(text:string)=>{if(text==='Slow policy'){entered.resolve();await release.promise;}return vector();});
        const slow=knowledge.updateDocument(tenantId,documentId,{content:'Slow policy'}).then(value=>({value,error:null}),error=>({error}));
        await entered.promise;await knowledge.updateDocument(tenantId,documentId,{content:'Fast policy'});release.resolve();
        expect((await slow).error).toBeInstanceOf(ConflictException);
        expect(await docState()).toMatchObject({doc:{content_text:'Fast policy',version:2},chunks:[{chunk_text:'Fast policy'}],history:[{version:1,content_text:'Old policy'}]});
    });
    it('does not overwrite a concurrent audience change within the same JavaScript millisecond',async()=>{
        const entered=deferred(),release=deferred();embedding.mockImplementation(async()=>{entered.resolve();await release.promise;return vector();});
        const slow=knowledge.updateDocument(tenantId,documentId,{content:'Slow policy'}).then(value=>({value,error:null}),error=>({error}));
        await entered.promise;
        await execute(`UPDATE knowledge_documents SET audience='internal',updated_at='2026-09-01 10:00:00.123457+00' WHERE id=$1::uuid`,[documentId]);release.resolve();
        expect((await slow).error).toBeInstanceOf(ConflictException);
        expect(await docState()).toMatchObject({doc:{content_text:'Old policy',version:1,audience:'internal'},chunks:[{chunk_text:'Old policy'}],history:[]});
    });
    it('publishes a typed correction and retrieves only current facts using real vector ranking',async()=>{
        await extract();expect((await currentMemory(contactId,'contact preference'))?.facts).toEqual([correction.text]);
        expect(await execute('SELECT status,fact_text FROM customer_memory_facts ORDER BY created_at')).toEqual([{status:'superseded',fact_text:'Prefiere teléfono'},{status:'active',fact_text:correction.text}]);
        router.execute.mockResolvedValue({content:JSON.stringify({facts:[]})});await extract();
        await execute(`UPDATE customer_memories SET facts='["Prefiere teléfono"]',summary='Resumen obsoleto'`);
        expect(await currentMemory()).toBeNull();
    });
    it('does not rank a legacy contact value above a current profile correction with the same key',async()=>{
        await execute('UPDATE customer_memory_facts SET fact_text=$1,embedding=NULL',[stopContact.text]);
        await execute(`INSERT INTO customer_memory_facts(owner_kind,owner_id,fact_key,fact_text,fact_kind,embedding)
            VALUES('contact',$1::uuid,$2,'Prefiere teléfono','preference',$3::vector)`,[contactId,correction.key,JSON.stringify(vector())]);
        expect((await currentMemory(contactId,'contact preference'))?.facts).toEqual([stopContact.text]);
        expect((await currentMemory())?.facts).toEqual([stopContact.text]);
    });
    it('does not replace current memory with assistant-only claims or retrieve expired facts',async()=>{
        await execute(`INSERT INTO messages(conversation_id,direction,content_text) VALUES($1::uuid,'outbound','El cliente debe pagar 1000')`,[conversationId]);
        router.execute.mockResolvedValue({content:JSON.stringify({facts:[{...correction,text:'Debe pagar 1000',evidence:'El cliente debe pagar 1000'}]})});
        await extract();expect((await currentMemory())?.facts).toEqual(['Prefiere teléfono']);
        await execute("UPDATE customer_memory_facts SET valid_until=NOW()-INTERVAL '1 day'");
        expect(await currentMemory()).toBeNull();expect(await currentMemory(contactId,'contact preference')).toBeNull();
    });
    it('rolls back a failed memory insert and can publish the correction on a later retry',async()=>{
        await execute(`ALTER TABLE customer_memory_facts ADD CONSTRAINT reject_synthetic_correction CHECK(fact_text <> 'Prefiere correo, no llamadas')`);
        await extract();expect((await currentMemory())?.facts).toEqual(['Prefiere teléfono']);
        expect(await execute('SELECT status FROM customer_memory_facts')).toEqual([{status:'active'}]);
        await execute('ALTER TABLE customer_memory_facts DROP CONSTRAINT reject_synthetic_correction');await extract();
        expect((await currentMemory())?.facts).toEqual([correction.text]);
    });
    it('a delayed channel extraction cannot overwrite a newer correction for the unified profile',async()=>{
        const entered=deferred(),release=deferred();
        router.execute.mockImplementationOnce(async()=>{entered.resolve();await release.promise;return{content:JSON.stringify({facts:[correction]})};}).mockResolvedValue({content:JSON.stringify({facts:[stopContact]})});
        const pending=extract();await entered.promise;await extract(siblingId,siblingConversationId);release.resolve();await pending;
        expect((await currentMemory())?.facts).toEqual([stopContact.text]);
    });
    it('erasure of the unified profile removes old/current facts and blocks a delayed extractor',async()=>{
        const entered=deferred(),release=deferred();
        router.execute.mockImplementation(async()=>{entered.resolve();await release.promise;return{content:JSON.stringify({facts:[correction]})};});
        const pending=extract();await entered.promise;await (compliance as any).eraseCustomerMemory(schema,contactId);release.resolve();await pending;
        expect(await execute('SELECT id FROM customer_memory_facts')).toEqual([]);expect(await execute('SELECT contact_id FROM customer_memories')).toEqual([]);
        expect((await execute('SELECT contact_id FROM customer_memory_erasure')).map(row=>row.contact_id).sort()).toEqual([contactId,siblingId].sort());
        expect(await currentMemory()).toBeNull();expect(await currentMemory(siblingId)).toBeNull();
    });
    it('rolls back tombstones and deletions together if erasure fails, then retries successfully',async()=>{
        await execute(`CREATE FUNCTION refuse_synthetic_memory_erasure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic erasure failure'; END$$`);
        await execute('CREATE TRIGGER refuse_synthetic_memory_erasure BEFORE DELETE ON customer_memory_facts FOR EACH ROW EXECUTE FUNCTION refuse_synthetic_memory_erasure()');
        try{
            await expect((compliance as any).eraseCustomerMemory(schema,contactId)).rejects.toThrow('synthetic erasure failure');
            expect(await execute('SELECT contact_id FROM customer_memory_erasure')).toEqual([]);
            expect((await currentMemory())?.facts).toEqual(['Prefiere teléfono']);
        }finally{await execute('DROP TRIGGER refuse_synthetic_memory_erasure ON customer_memory_facts');await execute('DROP FUNCTION refuse_synthetic_memory_erasure()');}
        await (compliance as any).eraseCustomerMemory(schema,contactId);
        expect(await execute('SELECT id FROM customer_memory_facts')).toEqual([]);expect(await execute('SELECT contact_id FROM customer_memories')).toEqual([]);
    });
    it('does not publish a stale contact-owned snapshot after identity resolution and a profile correction',async()=>{
        await execute('DELETE FROM contact_identities WHERE contact_id=$1::uuid',[contactId]);
        await execute(`UPDATE customer_memory_facts SET owner_kind='contact',owner_id=$1::uuid`,[contactId]);
        const entered=deferred(),release=deferred();
        router.execute.mockImplementationOnce(async()=>{entered.resolve();await release.promise;return{content:JSON.stringify({facts:[correction]})};}).mockResolvedValue({content:JSON.stringify({facts:[stopContact]})});
        const pending=extract();await entered.promise;
        await execute('INSERT INTO contact_identities(contact_id,customer_profile_id) VALUES($1::uuid,$2::uuid)',[contactId,profileId]);
        await extract(siblingId,siblingConversationId);release.resolve();await pending;
        expect((await currentMemory())?.facts).toEqual([stopContact.text]);
    });
    it('holds off a first identity insert until memory publication has committed',async()=>{
        await execute('DELETE FROM contact_identities WHERE contact_id=$1::uuid',[contactId]);
        await execute(`UPDATE customer_memory_facts SET owner_kind='contact',owner_id=$1::uuid`,[contactId]);
        const entered=deferred(),release=deferred();let pause=true;
        beforeSql=async(sql)=>{if(pause&&sql.includes('INSERT INTO customer_memory_facts')){pause=false;entered.resolve();await release.promise;}};
        const publishing=extract();await entered.promise;
        const linking=execute('INSERT INTO contact_identities(contact_id,customer_profile_id) VALUES($1::uuid,$2::uuid)',[contactId,profileId]);
        try{
            let waiting=false;
            for(let attempt=0;attempt<100&&!waiting;attempt++){
                waiting=Boolean((await execute(`SELECT 1 FROM pg_locks WHERE relation='contact_identities'::regclass AND mode='RowExclusiveLock' AND NOT granted`)).length);
                if(!waiting)await new Promise(resolve=>setTimeout(resolve,5));
            }
            expect(waiting).toBe(true);
        }finally{release.resolve();await Promise.all([publishing,linking]);beforeSql=undefined;}
        router.execute.mockResolvedValue({content:JSON.stringify({facts:[stopContact]})});await extract(siblingId,siblingConversationId);
        expect((await currentMemory())?.facts).toEqual([stopContact.text]);
    });
    it('keeps legacy profile facts reachable after a real identity merge and erases their lineage',async()=>{
        await execute('UPDATE contact_identities SET customer_profile_id=$1::uuid WHERE contact_id=$2::uuid',[removedProfileId,siblingId]);
        await execute(`INSERT INTO customer_memory_facts(owner_kind,owner_id,fact_key,fact_text,fact_kind,source_contact_id)
            VALUES('profile',$1::uuid,'contact.city','Vive en Medellín','profile',NULL)`,[removedProfileId]);
        await identity.approveMerge(tenantId,suggestionId,contactId);
        expect((await currentMemory())?.facts).toContain('Vive en Medellín');
        expect(await execute('SELECT id FROM customer_memory_facts WHERE owner_id=$1::uuid',[removedProfileId])).toEqual([]);
        await (compliance as any).eraseCustomerMemory(schema,contactId);
        expect(await execute('SELECT id FROM customer_memory_facts')).toEqual([]);
    });
    it('does not select a conflicting profile attribute during merge and requires a later customer clarification',async()=>{
        await execute('UPDATE contact_identities SET customer_profile_id=$1::uuid WHERE contact_id=$2::uuid',[removedProfileId,siblingId]);
        await execute(`INSERT INTO customer_memory_facts(owner_kind,owner_id,fact_key,fact_text,fact_kind)
            VALUES('profile',$1::uuid,$2,'Prefiere mensajes','preference')`,[removedProfileId,correction.key]);
        await identity.approveMerge(tenantId,suggestionId,contactId);
        const merged=await currentMemory();expect(merged?.facts).toEqual([]);
        expect((merged as any)?.conflicts).toEqual([{key:correction.key,observations:expect.arrayContaining(['Prefiere teléfono','Prefiere mensajes'])}]);
        router.execute.mockResolvedValue({content:'{"facts":[]}'});await extract();expect((await currentMemory())?.conflicts).toHaveLength(1);
        router.execute.mockResolvedValue({content:JSON.stringify({facts:[correction]})});
        await extract();expect((await currentMemory())?.facts).toEqual([]);
        await execute(`INSERT INTO messages(conversation_id,direction,content_text) VALUES($1::uuid,'inbound',$2)`,[conversationId,correction.evidence]);
        await extract();expect((await currentMemory())?.facts).toEqual([correction.text]);expect((await currentMemory() as any)?.conflicts??[]).toEqual([]);
    });
    it('rolls back identity movement and memory lineage when a later merge statement fails',async()=>{
        await execute('UPDATE contact_identities SET customer_profile_id=$1::uuid WHERE contact_id=$2::uuid',[removedProfileId,siblingId]);
        await execute(`INSERT INTO customer_memory_facts(owner_kind,owner_id,fact_key,fact_text) VALUES('profile',$1::uuid,'contact.city','Medellín')`,[removedProfileId]);
        await execute(`CREATE FUNCTION refuse_synthetic_profile_delete() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic profile delete failure'; END$$`);
        await execute('CREATE TRIGGER refuse_synthetic_profile_delete BEFORE DELETE ON customer_profiles FOR EACH ROW EXECUTE FUNCTION refuse_synthetic_profile_delete()');
        try{
            await expect(identity.approveMerge(tenantId,suggestionId,contactId)).rejects.toThrow('synthetic profile delete failure');
            expect((await execute('SELECT customer_profile_id FROM contact_identities WHERE contact_id=$1::uuid',[siblingId]))[0].customer_profile_id).toBe(removedProfileId);
            expect((await execute("SELECT owner_id FROM customer_memory_facts WHERE fact_key='contact.city'"))[0].owner_id).toBe(removedProfileId);
            expect((await execute('SELECT status FROM merge_suggestions'))[0].status).toBe('pending');
        }finally{await execute('DROP TRIGGER refuse_synthetic_profile_delete ON customer_profiles');await execute('DROP FUNCTION refuse_synthetic_profile_delete()');}
    });
    it('retracts a disputed memory only with a new explicit customer quote, not omission',async()=>{
        await execute("UPDATE customer_memory_facts SET status='conflicted',last_seen_at=NOW()");
        router.execute.mockResolvedValue({content:JSON.stringify({facts:[],retractions:[{key:correction.key,evidence:correction.evidence}]})});
        await extract();expect((await currentMemory())?.conflicts).toHaveLength(1);
        const evidence='Olvida mis preferencias de contacto';
        await execute(`INSERT INTO messages(conversation_id,direction,content_text) VALUES($1::uuid,'inbound',$2)`,[conversationId,evidence]);
        router.execute.mockResolvedValue({content:JSON.stringify({facts:[],retractions:[{key:correction.key,evidence}]})});
        await extract();expect(await currentMemory()).toBeNull();
        expect((await execute('SELECT status FROM customer_memory_facts'))[0].status).toBe('superseded');
    });
    it('allows only one concurrent approval of an identity merge',async()=>{
        const results=await Promise.allSettled([identity.approveMerge(tenantId,suggestionId,contactId),identity.approveMerge(tenantId,suggestionId,contactId)]);
        expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);expect(results.filter(result=>result.status==='rejected')).toHaveLength(1);
        expect(await execute('SELECT id FROM customer_profiles WHERE id=$1::uuid',[removedProfileId])).toEqual([]);
    });
    it('runs publication and merge through the real Prisma raw-query serializer and tenant wrapper',async()=>{
        const client=new PrismaClient({datasourceUrl:databaseUrl});
        const adapter=Object.create(PrismaService.prototype);
        adapter.$transaction=client.$transaction.bind(client);
        adapter.getTenantSchemaName=async(id:string)=>{if(id!==tenantId)throw new Error('tenant_scope_violation');return schema;};
        const previous=(knowledge as any).prisma;
        try{
            (knowledge as any).prisma=adapter;
            expect((await knowledge.updateDocument(tenantId,documentId,{content:'Prisma publication'})).version).toBe(2);
            const actualMemory=new CustomerMemoryService(adapter,router,knowledge);
            await actualMemory.extractFromConversation(tenantId,schema,conversationId,contactId);
            expect((await actualMemory.getMemory(schema,contactId))?.facts).toEqual([correction.text]);
            const actualIdentity=new IdentityService(adapter,{get:async()=>schema} as any,{} as any);
            await actualIdentity.approveMerge(tenantId,suggestionId,contactId);
            expect((await execute('SELECT status FROM merge_suggestions'))[0].status).toBe('approved');
            await (new ComplianceService(adapter) as any).eraseCustomerMemory(schema,contactId);
            expect(await execute('SELECT id FROM customer_memory_facts')).toEqual([]);
        }finally{(knowledge as any).prisma=previous;await client.$disconnect();}
    });
});
