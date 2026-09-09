import { randomUUID } from 'crypto';
import { QualityService } from './quality.service';
import { ComplianceService } from '../compliance/compliance.service';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { isDisposableDatabaseUrl } from '../../common/__fixtures__/disposable-database';

const connection = process.env.PARALLLY_ISOLATION_TEST_URL;
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve=done; }); return { promise,resolve }; };
(connection ? describe : describe.skip)('production QA evidence on disposable PostgreSQL', () => {
    const schema=`tenant_quality_${randomUUID().replace(/-/g,'')}`, tenantId=randomUUID();
    const conversationId=randomUUID(), contactId=randomUUID(), agentId=randomUUID();
    let pool:any, prisma:any, service:QualityService, compliance:ComplianceService;
    let judge:any, events:any;
    const cache = new Map<string,string>();
    const sql = async (text:string, values:any[]=[]) => {
        const client=await pool.connect();
        try { await client.query(`SET search_path TO "${schema}",public`); return (await client.query(text,values)).rows; }
        finally { client.release(); }
    };
    const result={overall:9,resolution:9,tone:9,accuracy:8,empathy:8,flags:[],resolved:true,resolutionReason:'La respuesta parece resolver la pregunta.'};
    beforeAll(async () => {
        const url=new URL(connection!);
        if (!['127.0.0.1','localhost'].includes(url.hostname) || !isDisposableDatabaseUrl(url)) throw new Error('disposable_database_required');
        pool=new(require('pg').Pool)({ connectionString:connection });
        await pool.query(`CREATE SCHEMA "${schema}"`);
        for (const statement of [
            `CREATE TABLE conversations(id UUID PRIMARY KEY,contact_id UUID,status TEXT DEFAULT 'resolved',resolution_type TEXT DEFAULT 'ai_resolved',was_handed_off BOOLEAN DEFAULT false,
                agent_persona_id UUID,agent_config_version INTEGER,agent_attribution_conflicted BOOLEAN DEFAULT false,metadata JSONB DEFAULT '{}',created_at TIMESTAMPTZ DEFAULT NOW())`,
            `CREATE TABLE messages(id UUID PRIMARY KEY,conversation_id UUID REFERENCES conversations(id),direction TEXT,content_text TEXT,created_at TIMESTAMPTZ DEFAULT NOW())`,
            `CREATE TABLE agent_personas(id UUID PRIMARY KEY,version INTEGER,config_json JSONB)`,
            `CREATE TABLE contact_identities(contact_id UUID,customer_profile_id UUID)`,
            `CREATE TABLE customer_memory_facts(id UUID,owner_kind TEXT,owner_id UUID,source_contact_id UUID)`,
            `CREATE TABLE customer_memories(contact_id UUID)`,
            `CREATE TABLE quality_sampling_items(id UUID,conversation_id UUID,contact_id UUID,state TEXT,lease_token UUID,lease_expires_at TIMESTAMPTZ,last_error_code TEXT)`,
        ]) await sql(statement);
        prisma = {
            getTenantSchemaName:async () => schema,
            executeInTenantSchema:async (_schema:string,text:string,values:any[]=[]) => sql(text,values),
            transactionInTenantSchema:async (_schema:string,work:any) => {
                const client=await pool.connect(); await client.query('BEGIN');
                try { await client.query(`SET LOCAL search_path TO "${schema}",public`);
                    const out=await work(async(text:string,values:any[]=[]) => (await client.query(text,values)).rows);
                    await client.query('COMMIT');return out;
                } catch(error) { await client.query('ROLLBACK');throw error; } finally { client.release(); }
            },
        };
        const redis={get:async(key:string)=>cache.get(key),set:async(key:string,value:string)=>cache.set(key,value)};
        judge={execute:jest.fn()};events={emit:jest.fn()};
        service=new QualityService(prisma,redis as any,judge,{add:jest.fn()} as any,events);
        compliance=new ComplianceService(prisma);
        cache.set(`quality_cols:v2:${schema}`,'1');
        await service.ensureTables(schema);
    },30000);
    beforeEach(async () => {
        await sql('TRUNCATE conversation_quality_scores,messages,conversations,agent_personas,customer_memory_erasure,quality_sampling_items CASCADE');
        await sql(`INSERT INTO agent_personas VALUES($1::uuid,5,'{"mission":"Answer questions"}')`,[agentId]);
        await sql(`INSERT INTO conversations(id,contact_id,agent_persona_id,agent_config_version) VALUES($1::uuid,$2::uuid,$3::uuid,5)`,[conversationId,contactId,agentId]);
        await sql(`INSERT INTO messages VALUES($1::uuid,$2::uuid,'inbound','¿Tienen disponibilidad?',NOW()-INTERVAL '1 minute'),($3::uuid,$2::uuid,'outbound','Sí, mañana a las diez.',NOW())`,[randomUUID(),conversationId,randomUUID()]);
        judge.execute.mockReset().mockResolvedValue({content:JSON.stringify(result)});events.emit.mockClear();
    });
    afterAll(async () => {
        if (!pool) return;
        if (!/^tenant_quality_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_cleanup_scope');
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await pool.end();
    });
    it('migrates despite the v2 cache and records opinion, exact config and coverage without verifying a booking',async () => {
        expect(cache.get(`quality_cols:v3:${schema}`)).toBe('1');
        expect((await service.scoreConversation(tenantId,conversationId)).status).toBe('scored');
        const [row]=await sql('SELECT * FROM conversation_quality_scores');
        expect(row.resolution_verified).toBeNull();expect(row.operational_outcome).toBe('unknown');
        expect(row.conversational_resolved).toBe(true);expect(row.configuration_snapshot).toMatchObject({state:'captured',version:5});
        expect(row.coverage).toMatchObject({complete:true,selectedMessages:2});
        expect((await sql('SELECT resolution_verified FROM conversations'))[0].resolution_verified).toBeNull();
        const summary=await service.getQualitySummary(tenantId,'2020-01-01','2100-01-01');
        expect(summary).toMatchObject({scored:1,operationalUnknown:1,operationalKnown:0,verifiedResolutionRate:null});
    });
    it('keeps the last turn and marks truncated long conversations unknown',async () => {
        await sql(`INSERT INTO messages SELECT gen_random_uuid(),$1::uuid,'inbound','turn '||n,NOW()+n*INTERVAL '1 second' FROM generate_series(1,80) n`,[conversationId]);
        await service.scoreConversation(tenantId,conversationId);
        const transcript=judge.execute.mock.calls[0][0].messages[0].content;
        expect(transcript).toContain('turn 80');expect(transcript).not.toContain('¿Tienen disponibilidad?');
        const [row]=await sql('SELECT * FROM conversation_quality_scores');
        expect(row.coverage).toMatchObject({complete:false,totalMessages:82,selectedMessages:60,omittedMessages:22});
        expect(row.conversational_resolved).toBeNull();expect(row.resolution_verified).toBeNull();
    });
    it('never sends internal notes to the judge or counts them as customer-visible coverage',async () => {
        const [before]=await sql('SELECT qa_revision FROM conversations');
        await sql(`INSERT INTO messages VALUES(gen_random_uuid(),$1::uuid,'internal','private employee note',NOW())`,[conversationId]);
        expect((await sql('SELECT qa_revision FROM conversations'))[0].qa_revision).toBe(before.qa_revision);
        await service.scoreConversation(tenantId,conversationId);
        expect(judge.execute.mock.calls[0][0].messages[0].content).not.toContain('private employee note');
        expect((await sql('SELECT coverage FROM conversation_quality_scores'))[0].coverage).toMatchObject({complete:true,totalMessages:2,selectedMessages:2});
    });
    it('does not expose an old rubric hash even when its version is unchanged',async () => {
        await service.scoreConversation(tenantId,conversationId);
        await sql(`UPDATE conversation_quality_scores SET rubric_hash='old-rubric',flags='["outdated"]'`);
        expect((await service.getQualitySummary(tenantId,'2020-01-01','2100-01-01')).scored).toBe(0);
        expect(await service.getFlagged(tenantId,'2020-01-01','2100-01-01')).toHaveLength(0);
        await service.scoreConversation(tenantId,conversationId);
        expect((await service.getQualitySummary(tenantId,'2020-01-01','2100-01-01')).scored).toBe(1);
        expect(judge.execute).toHaveBeenCalledTimes(2);
    });
    it('serializes concurrent scores and durably deduplicates repeated resolve jobs',async () => {
        const entered=deferred(),release=deferred();
        judge.execute.mockImplementation(async()=>{entered.resolve();await release.promise;return {content:JSON.stringify(result)};});
        const first=service.scoreConversation(tenantId,conversationId);await entered.promise;
        const second=service.scoreConversation(tenantId,conversationId);release.resolve();
        const statuses=(await Promise.all([first,second])).map(row=>row.status).sort();
        expect(statuses).toEqual(['already_scored','scored']);
        await service.scoreConversation(tenantId,conversationId);
        expect(judge.execute).toHaveBeenCalledTimes(1);expect(events.emit).toHaveBeenCalledTimes(1);
        expect(await sql('SELECT id FROM conversation_quality_scores')).toHaveLength(1);
    });
    it.each(['message','state'])('rejects a concurrent %s edit before committing judge evidence',async (kind) => {
        const entered=deferred(),release=deferred();
        judge.execute.mockImplementation(async()=>{entered.resolve();await release.promise;return {content:JSON.stringify(result)};});
        const pending=service.scoreConversation(tenantId,conversationId);await entered.promise;
        if (kind==='message') await sql(`UPDATE messages SET content_text='Corrijo la respuesta' WHERE direction='outbound'`);
        else await sql(`UPDATE conversations SET status='open',resolution_type=NULL`);
        const failed=expect(pending).rejects.toThrow('quality_source_changed');release.resolve();await failed;
        expect(await sql('SELECT id FROM conversation_quality_scores')).toHaveLength(0);
        expect(events.emit).not.toHaveBeenCalled();
    });
    it('invalidates old evidence after later edits and retains canonical verification without revision loops',async () => {
        await service.scoreConversation(tenantId,conversationId);
        const [before]=await sql('SELECT qa_revision FROM conversations');
        await sql(`UPDATE conversations SET resolution_verified=true,resolution_verification_source='operational_evidence'`);
        expect((await sql('SELECT qa_revision FROM conversations'))[0].qa_revision).toBe(before.qa_revision);
        await sql(`INSERT INTO messages VALUES(gen_random_uuid(),$1::uuid,'inbound','Aún no está resuelto',NOW())`,[conversationId]);
        expect((await service.getQualitySummary(tenantId,'2020-01-01','2100-01-01')).scored).toBe(0);
        await service.scoreConversation(tenantId,conversationId);
        expect((await sql('SELECT resolution_verified FROM conversations'))[0].resolution_verified).toBe(true);
        expect(await sql('SELECT id FROM conversation_quality_scores')).toHaveLength(2);
    });
    it('erasure waits for QA then deletes derived evidence and cancels sampling; retries cannot resurrect it',async () => {
        await sql(`INSERT INTO quality_sampling_items(id,conversation_id,contact_id,state) VALUES(gen_random_uuid(),$1::uuid,$2::uuid,'queued')`,[conversationId,contactId]);
        const entered=deferred(),release=deferred();
        judge.execute.mockImplementation(async()=>{entered.resolve();await release.promise;return {content:JSON.stringify({...result,flags:['private derived detail']})};});
        const scoring=service.scoreConversation(tenantId,conversationId);await entered.promise;
        let erased=false;
        const erasing=(compliance as any).eraseCustomerMemory(schema, contactId, tenantId).then(()=>{erased=true;});
        await new Promise(done=>setTimeout(done,40));expect(erased).toBe(false);
        release.resolve();await scoring;await erasing;
        expect(await sql('SELECT id FROM conversation_quality_scores')).toHaveLength(0);
        expect((await sql('SELECT * FROM quality_sampling_items'))[0]).toMatchObject({state:'erased',contact_id:null,conversation_id:null});
        expect((await service.scoreConversation(tenantId,conversationId)).status).toBe('erased');
        expect(judge.execute).toHaveBeenCalledTimes(1);
    });
    it('does not send any transcript after erasure wins first',async () => {
        await (compliance as any).eraseCustomerMemory(schema, contactId, tenantId);
        expect((await service.scoreConversation(tenantId,conversationId)).status).toBe('erased');
        expect(judge.execute).not.toHaveBeenCalled();
    });
    it('marks missing historic configuration explicitly rather than attributing current config',async () => {
        await sql('UPDATE agent_personas SET version=6');
        await service.scoreConversation(tenantId,conversationId);
        const [row]=await sql('SELECT configuration_snapshot FROM conversation_quality_scores');
        expect(row.configuration_snapshot).toMatchObject({state:'unavailable',version:5,reason:'historical_configuration_unavailable'});
        expect(row.configuration_snapshot.config).toBeUndefined();
    });
    it('keeps unanswered conversations as explicit insufficient evidence without generating fake scores',async () => {
        await sql(`DELETE FROM messages WHERE direction='outbound'`);
        expect((await service.scoreConversation(tenantId,conversationId)).status).toBe('insufficient_messages');
        expect(judge.execute).not.toHaveBeenCalled();expect(await sql('SELECT id FROM conversation_quality_scores')).toHaveLength(0);
    });
    it.each(['runtime','template'])('bootstraps %s QA before legacy ALTERs and scores/erases with the real Prisma serializer',async (mode) => {
        const bootstrap=`${schema}_${mode}`;
        const client=new PrismaClient({datasourceUrl:connection});
        const adapter=Object.create(PrismaService.prototype);
        adapter.$transaction=client.$transaction.bind(client);
        adapter.getTenantSchemaName=async()=>bootstrap;
        const execute=(text:string,params:any[]=[])=>adapter.executeInTenantSchema(bootstrap,text,params);
        const runtime=new QualityService(adapter,{get:async()=>null,set:async()=>undefined} as any,judge,{add:jest.fn()} as any,events);
        try {
            await pool.query(`CREATE SCHEMA "${bootstrap}"`);
            // The original base schema has neither resolution_type nor
            // was_handed_off. Their historical ALTERs run much later.
            for (const statement of [
                `CREATE TABLE conversations(id UUID PRIMARY KEY,contact_id UUID,status TEXT DEFAULT 'active',metadata JSONB DEFAULT '{}',created_at TIMESTAMPTZ DEFAULT NOW())`,
                `CREATE TABLE messages(id UUID PRIMARY KEY,conversation_id UUID,direction TEXT,content_text TEXT,created_at TIMESTAMPTZ DEFAULT NOW())`,
                `CREATE TABLE contact_identities(contact_id UUID,customer_profile_id UUID)`,
                `CREATE TABLE customer_memory_facts(id UUID,owner_kind TEXT,owner_id UUID,source_contact_id UUID)`,
                `CREATE TABLE customer_memories(contact_id UUID)`,
            ]) await execute(statement);
            if (mode==='runtime') await runtime.ensureTables(bootstrap);
            else {
                const source=readFileSync(resolve(__dirname,'../../../prisma/tenant-schema.sql'),'utf8');
                const start=source.indexOf('CREATE TABLE IF NOT EXISTS "{{SCHEMA_NAME}}"."conversation_quality_scores"');
                const end=source.indexOf('-- ---- Durable proactive Agent Quality attention ----',start);
                const ddl=source.slice(start,end).replaceAll('{{SCHEMA_NAME}}',bootstrap);
                for (const statement of adapter.splitSqlStatements(ddl)) await execute(statement);
            }
            await execute(`INSERT INTO conversations(id,contact_id) VALUES($1::uuid,$2::uuid)`,[conversationId,contactId]);
            await execute(`UPDATE conversations SET resolution_type='ai_resolved' WHERE id=$1::uuid`,[conversationId]);
            await execute(`INSERT INTO messages VALUES(gen_random_uuid(),$1::uuid,'inbound','Pregunta',NOW()),(gen_random_uuid(),$1::uuid,'outbound','Respuesta',NOW())`,[conversationId]);
            expect((await runtime.scoreConversation(tenantId,conversationId)).status).toBe('scored');
            expect((await runtime.getQualitySummary(tenantId,'2020-01-01','2100-01-01')).scored).toBe(1);
            await (new ComplianceService(adapter) as any).eraseCustomerMemory(bootstrap, contactId, tenantId);
            expect(await execute('SELECT id FROM conversation_quality_scores')).toHaveLength(0);
            expect((await runtime.scoreConversation(tenantId,conversationId)).status).toBe('erased');
        } finally {
            await client.$disconnect();
            if(!/^tenant_quality_[a-f0-9]{32}_(runtime|template)$/.test(bootstrap))throw new Error('invalid_cleanup_scope');
            await pool.query(`DROP SCHEMA IF EXISTS "${bootstrap}" CASCADE`);
        }
    });
});
