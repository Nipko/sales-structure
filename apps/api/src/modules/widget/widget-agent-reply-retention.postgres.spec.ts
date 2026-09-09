import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LearningService } from '../learning/learning.service';
import { learningHash, learningSnapshotHash } from '../learning/learning-contracts';
import { retireLearningReleases } from '../learning/learning-evaluation-retention';
import { ComplianceService } from '../compliance/compliance.service';
import { redactWidgetAgentReplies, WIDGET_AGENT_REPLY_DDL } from './widget-agent-reply-retention';
import { ensureSyntheticGlobalTables } from '../../common/__fixtures__/synthetic-global-tables';

const databaseUrl = process.env.LEARNING_EVIDENCE_TEST_DATABASE_URL;
(databaseUrl ? describe : describe.skip)('Widget reply retention with real PostgreSQL/Prisma', () => {
    const tenantId = randomUUID(), agentId = randomUUID();
    const schema = `tenant_widget_ret_${randomUUID().replace(/-/g,'')}`;
    const foreign = `tenant_widget_ret_${randomUUID().replace(/-/g,'')}`;
    let client: PrismaClient, prisma: PrismaService, learning: LearningService;
    const sql = (text: string, params: any[] = [], target = schema) => prisma.executeInTenantSchema<any[]>(target,text,params);
    async function bootstrap(target: string) {
        await sql('CREATE TABLE contacts(id UUID PRIMARY KEY,name TEXT,phone TEXT,email TEXT)',[],target);
        await sql(`CREATE TABLE conversations(id UUID PRIMARY KEY,contact_id UUID REFERENCES contacts(id),metadata JSONB DEFAULT '{}',
            handoff_summary TEXT,handoff_summary_generated_at TIMESTAMPTZ)`,[],target);
        await sql(`CREATE TABLE messages(id UUID PRIMARY KEY,conversation_id UUID REFERENCES conversations(id),
            direction TEXT,content_type TEXT,content_text TEXT,media_url TEXT,media_mime_type TEXT,caption TEXT,
            metadata JSONB,status TEXT,external_id TEXT)`,[],target);
        for (const ddl of WIDGET_AGENT_REPLY_DDL) await sql(ddl,[],target);
    }
    beforeAll(async () => {
        const url = new URL(databaseUrl!);
        if (!['localhost','127.0.0.1'].includes(url.hostname) || !url.pathname.endsWith('_eval_isolation'))
            throw new Error('disposable_loopback_database_required');
        client = new PrismaClient({ datasourceUrl: databaseUrl });
        await ensureSyntheticGlobalTables(sql => client.$executeRawUnsafe(sql));
        await client.$executeRawUnsafe('INSERT INTO public.tenants(id,schema_name,is_active) VALUES($1::uuid,$2,true)',tenantId,schema);
        for (const name of [schema,foreign]) await client.$executeRawUnsafe(`CREATE SCHEMA "${name}"`);
        prisma = Object.create(PrismaService.prototype);
        prisma.$transaction = client.$transaction.bind(client);
        prisma.getTenantSchemaName = jest.fn(async () => schema);
        await bootstrap(schema); await bootstrap(foreign);
        await sql('CREATE TABLE contact_identities(contact_id UUID,customer_profile_id UUID)');
        await sql('CREATE TABLE customer_memory_erasure(contact_id UUID PRIMARY KEY,erased_at TIMESTAMPTZ DEFAULT NOW())');
        await sql('CREATE TABLE customer_memory_facts(id UUID PRIMARY KEY,owner_kind TEXT,owner_id UUID,source_contact_id UUID)');
        await sql('CREATE TABLE customer_memories(contact_id UUID PRIMARY KEY)');
        learning = new LearningService(prisma,{} as any,{} as any);
        await learning.ensureTables(schema);
    });
    beforeEach(async () => {
        await sql('TRUNCATE widget_agent_reply_sources,widget_agent_replies,messages,conversations,contacts,contact_identities,customer_memory_erasure,customer_memory_facts,customer_memories,learning_sources,learning_releases CASCADE');
        await sql('TRUNCATE widget_agent_reply_sources,widget_agent_replies,messages,conversations,contacts CASCADE',[],foreign);
    });
    afterAll(async () => {
        if (!client) return;
        try {
            for (const name of [schema,foreign]) {
                if (!/^tenant_widget_ret_[a-f\d]{32}$/.test(name)) throw new Error('invalid_cleanup_scope');
                await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${name}" CASCADE`);
            }
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2',tenantId,schema);
        } finally { await client.$disconnect(); }
    });
    async function fixture(target = schema) {
        const recipient = randomUUID(), conversation = randomUUID(), inbound = randomUUID(), message = randomUUID(), reply = randomUUID();
        const release = randomUUID(), example = randomUUID();
        const sources = ['train','holdout'].map(split => ({id:randomUUID(),contact:randomUUID(),split}));
        for (const contact of [recipient,...sources.map(source => source.contact)])
            await sql("INSERT INTO contacts VALUES($1::uuid,'Synthetic customer',NULL,NULL)",[contact],target);
        await sql("INSERT INTO conversations VALUES($1::uuid,$2::uuid,'{}')",[conversation,recipient],target);
        await sql(`INSERT INTO messages(id,conversation_id,direction,content_type,content_text,media_url,media_mime_type,caption,metadata,status,external_id)
            VALUES($1::uuid,$3::uuid,'inbound','text','Synthetic question',NULL,NULL,NULL,'{}','delivered','inbound'),
            ($2::uuid,$3::uuid,'outbound','image','Derived text','https://example.test/private.png','image/png','Derived caption',
                '{"nested":{"private":"copied evidence"}}','pending','opaque-outbound')`,[inbound,message,conversation],target);
        const snapshot = {examples:[{id:example,source_id:sources[0].id}],heldout:[{source_id:sources[1].id}]};
        const footprint = {version:1,tenantId,agentId,entries:[{releaseId:release,releaseHash:learningSnapshotHash(snapshot),exampleId:example,projectionHash:'a'.repeat(64)}]};
        if (target === schema) {
            for (const source of sources) await sql(`INSERT INTO learning_sources(id,agent_id,source_kind,source_key,group_key,source_contact_id,
                split,channel,language,transcript,content_hash,created_by) VALUES($1::uuid,$2::uuid,'file',$3,$4,$5::uuid,$6,
                    'web_widget','en','[]',$7,'fixture')`,
                [source.id,agentId,learningHash(source.id),learningHash(source.contact),source.contact,source.split,learningHash('synthetic')]);
            await sql(`INSERT INTO learning_examples(id,source_id,agent_id,intent,episode,content_hash,status)
                VALUES($1::uuid,$2::uuid,$3::uuid,'general','[]',$4,'approved')`,[example,sources[0].id,agentId,learningHash(example)]);
            await sql(`INSERT INTO learning_releases(id,agent_id,status,example_ids,snapshot,snapshot_hash,created_by)
                VALUES($1::uuid,$2::uuid,'published',$3::uuid[],$4::jsonb,$5,'fixture')`,[release,agentId,[example],JSON.stringify(snapshot),footprint.entries[0].releaseHash]);
        }
        await sql(`INSERT INTO widget_agent_replies(id,conversation_id,contact_id,inbound_message_id,channel_account_id,
            operational_scope,learning_footprint,message_id,status) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,'widget',
                $5::jsonb,$6::jsonb,$7::uuid,'stored')`,
            [reply,conversation,recipient,inbound,JSON.stringify({agentId,tenantId,version:2}),JSON.stringify([footprint]),message],target);
        for (const source of sources) await sql(`INSERT INTO widget_agent_reply_sources VALUES($1::uuid,$2::uuid,$3::uuid)`,[reply,source.id,source.contact],target);
        return {recipient,conversation,inbound,message,reply,release,sources,footprint};
    }
    const redact = (scope: Parameters<typeof redactWidgetAgentReplies>[2]) =>
        prisma.transactionInTenantSchema(schema,query => redactWidgetAgentReplies(query,schema,scope));
    async function assertRedacted(f: Awaited<ReturnType<typeof fixture>>) {
        const [row] = await sql('SELECT * FROM widget_agent_replies WHERE id=$1::uuid',[f.reply]);
        expect(row).toMatchObject({id:f.reply,inbound_message_id:f.inbound,message_id:f.message,status:'redacted',
            conversation_id:null,contact_id:null,channel_account_id:null,operational_scope:{},learning_footprint:null});
        const [message] = await sql('SELECT * FROM messages WHERE id=$1::uuid',[f.message]);
        expect(message).toMatchObject({content_type:'redacted',content_text:null,media_url:null,media_mime_type:null,caption:null,metadata:{},status:'redacted'});
        expect(await sql('SELECT 1 FROM widget_agent_reply_sources WHERE reply_id=$1::uuid',[f.reply])).toHaveLength(0);
    }

    it('keeps template and lazy bootstrap DDL equivalent and repeatable outside privacy transactions',async () => {
        const ddl = readFileSync(join(__dirname,'../../../prisma/tenant-schema.sql'),'utf8');
        const body = ddl.slice(ddl.indexOf('-- BEGIN WIDGET AGENT REPLY PROVENANCE'),ddl.indexOf('-- END WIDGET AGENT REPLY PROVENANCE'));
        const normalize = (text:string) => text.replace(/--[^\n]*/g,'').replace(/"\{\{SCHEMA_NAME\}\}"\./g,'').replace(/"/g,'').replace(/\s+/g,' ').replace(/\s*;\s*/g,';').trim();
        expect(normalize(body)).toBe(normalize(WIDGET_AGENT_REPLY_DDL.join(';')+';'));
        for (const statement of WIDGET_AGENT_REPLY_DDL) await sql(statement);
        const indexes = await sql("SELECT indexname FROM pg_indexes WHERE schemaname=$1 AND tablename='widget_agent_reply_sources'",[schema]);
        expect(indexes.map(row=>row.indexname)).toEqual(expect.arrayContaining(['idx_widget_agent_reply_sources_source','idx_widget_agent_reply_sources_contact']));
    });
    it('does no lazy DDL when an older tenant has no provenance tables',async () => {
        await sql('DROP TABLE widget_agent_reply_sources',[],foreign); await sql('DROP TABLE widget_agent_replies',[],foreign);
        const statements:string[]=[];
        try {
            expect(await prisma.transactionInTenantSchema(foreign,query => redactWidgetAgentReplies(
                async <R>(text:string,params?:any[])=>{statements.push(text);return query<R>(text,params);},foreign,{contactIds:[randomUUID()]}))).toBe(0);
            expect(statements.some(statement=>/CREATE|ALTER|INSERT|UPDATE|DELETE/i.test(statement))).toBe(false);
        } finally { for (const ddl of WIDGET_AGENT_REPLY_DDL) await sql(ddl,[],foreign); }
    });
    it('redacts only the exact recipient in its tenant and keeps the inbound receipt after message deletion',async () => {
        const f=await fixture(), unrelated=await fixture(), otherTenant=await fixture(foreign);
        // Identical recipient UUID in another schema cannot grant cross-tenant erasure.
        await sql('UPDATE widget_agent_replies SET contact_id=$1::uuid',[f.recipient],foreign);
        expect(await redact({contactIds:[f.recipient]})).toBe(1); await assertRedacted(f);
        expect((await sql('SELECT status FROM widget_agent_replies WHERE id=$1::uuid',[unrelated.reply]))[0].status).toBe('stored');
        expect((await sql('SELECT content_text FROM messages WHERE id=$1::uuid',[otherTenant.message],foreign))[0].content_text).toBe('Derived text');
        expect(await redact({contactIds:[f.recipient],releaseIds:[f.release]})).toBe(0);
        await sql('DELETE FROM messages WHERE conversation_id=$1::uuid',[f.conversation]);
        await sql('DELETE FROM conversations WHERE id=$1::uuid',[f.conversation]);
        await sql('DELETE FROM contacts WHERE id=$1::uuid',[f.recipient]);
        const inserted=await sql(`INSERT INTO widget_agent_replies(inbound_message_id,message_id,status)
            VALUES($1::uuid,$2::uuid,'redacted') ON CONFLICT(inbound_message_id) DO NOTHING RETURNING id`,[f.inbound,randomUUID()]);
        expect(inserted).toHaveLength(0);
        expect((await sql('SELECT status FROM widget_agent_replies WHERE inbound_message_id=$1::uuid',[f.inbound]))[0].status).toBe('redacted');
    });
    it.each([0,1])('erases a derived reply to another recipient through source contact index %s',async sourceIndex => {
        const f=await fixture();
        expect(await redact({contactIds:[f.sources[sourceIndex].contact]})).toBe(1);
        await assertRedacted(f);
        expect((await sql('SELECT content_text FROM messages WHERE id=$1::uuid',[f.inbound]))[0].content_text).toBe('Synthetic question');
    });
    it('matches retained release IDs across footprint groups from different agents',async () => {
        const f=await fixture(), history=await fixture();
        const historical={...history.footprint,agentId:randomUUID()};
        await sql('UPDATE widget_agent_replies SET learning_footprint=$2::jsonb WHERE id=$1::uuid',[f.reply,JSON.stringify([f.footprint,historical])]);
        expect(await redact({releaseIds:[history.release]})).toBe(2);
        await assertRedacted(f); await assertRedacted(history);
    });
    it('uses the source index after all footprint bodies have been removed and fails closed on a partial migration',async () => {
        const f=await fixture();
        await sql('UPDATE widget_agent_replies SET learning_footprint=NULL WHERE id=$1::uuid',[f.reply]);
        expect(await redact({sourceIds:[f.sources[1].id]})).toBe(1); await assertRedacted(f);
        const intact=await fixture();
        await sql('ALTER TABLE widget_agent_reply_sources RENAME TO widget_agent_reply_sources_pending');
        try {
            await expect(redact({contactIds:[intact.recipient]})).rejects.toThrow('widget_reply_source_index_unavailable');
            expect((await sql('SELECT content_text FROM messages WHERE id=$1::uuid',[intact.message]))[0].content_text).toBe('Derived text');
        } finally { await sql('ALTER TABLE widget_agent_reply_sources_pending RENAME TO widget_agent_reply_sources'); }
    });
    it('rollback revokes new use without deleting prior stored facts; actual source withdrawal redacts them',async () => {
        const f=await fixture();
        await learning.rollback(tenantId,agentId,f.release);
        expect((await sql('SELECT status FROM widget_agent_replies WHERE id=$1::uuid',[f.reply]))[0].status).toBe('stored');
        await learning.withdrawSource(tenantId,agentId,f.sources[1].id);
        await assertRedacted(f);
        expect((await sql('SELECT snapshot FROM learning_releases WHERE id=$1::uuid',[f.release]))[0].snapshot).toEqual({});
    });
    it('retained source references still redact when a release snapshot was already removed',async () => {
        const f=await fixture();
        await sql("UPDATE learning_releases SET snapshot='{}',status='retired' WHERE id=$1::uuid",[f.release]);
        await prisma.transactionInTenantSchema(schema,async query => {
            await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text',[`agent-privacy:${schema}`]);
            expect(await retireLearningReleases(query,{sourceIds:[f.sources[0].id]})).toBe(0);
        });
        await assertRedacted(f);
    });
    it('Compliance expands a linked source family and redacts another recipient under the same erasure fence',async () => {
        const f=await fixture(), linked=randomUUID(), profile=randomUUID();
        await sql("INSERT INTO contacts VALUES($1::uuid,'Synthetic linked contact',NULL,NULL)",[linked]);
        await sql('INSERT INTO contact_identities VALUES($1::uuid,$3::uuid),($2::uuid,$3::uuid)',[linked,f.sources[1].contact,profile]);
        const compliance=new ComplianceService(prisma);
        expect(await (compliance as any).eraseCustomerMemory(schema,linked,tenantId)).toBe(1);
        await assertRedacted(f);
        expect((await sql('SELECT contact_id FROM customer_memory_erasure ORDER BY contact_id')).map(row=>row.contact_id))
            .toEqual([linked,f.sources[1].contact].sort());
    });
    it('serializes redaction after an in-flight persisted read/emit on the shared privacy fence',async () => {
        const f=await fixture();
        let enter!:()=>void,finish!:()=>void;
        const ready=new Promise<void>(resolve=>{enter=resolve;});
        const release=new Promise<void>(resolve=>{finish=resolve;});
        const read=prisma.transactionInTenantSchema(schema,async query=>{
            await query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text',[`agent-privacy:${schema}`]);
            const [row]=await query<any[]>('SELECT content_text FROM messages WHERE id=$1::uuid',[f.message]);
            expect(row.content_text).toBe('Derived text'); enter(); await release;
        },{timeout:15000});
        await Promise.race([ready,read.then(()=>{throw new Error('read_ended_before_gate');})]);
        let done=false;
        const erasure=redact({contactIds:[f.sources[0].contact]}).then(value=>{done=true;return value;});
        try {
            const deadline=Date.now()+5000; let blocked=false;
            while(Date.now()<deadline&&!blocked){
                const [row]=await client.$queryRawUnsafe(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
                    WHERE datname=current_database() AND query LIKE '%pg_advisory_xact_lock(%'
                    AND cardinality(pg_blocking_pids(pid))>0) AS blocked`) as Array<{blocked:boolean}>;
                blocked=row.blocked; if(!blocked)await new Promise(resolve=>setTimeout(resolve,20));
            }
            expect(blocked).toBe(true); expect(done).toBe(false);
        } finally {finish();await read;await erasure;}
        await assertRedacted(f);
    });
});
