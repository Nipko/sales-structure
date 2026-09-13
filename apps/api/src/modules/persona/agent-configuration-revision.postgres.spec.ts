import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AgentConfigurationRevisionStore, operationalConfigurationBody, type RevisionQuery } from './agent-configuration-revision';

const url=process.env.AGENT_REVISION_TEST_DATABASE_URL;
const integration=url?describe:describe.skip;
integration('Separate editable and operational configurations on PostgreSQL',()=>{
    const schema=`tenant_configrevision_${randomUUID().replace(/-/g,'')}`;
    const tenantId=randomUUID(),agentId=randomUUID(),actor={id:randomUUID(),role:'tenant_admin'};
    let client:PrismaClient,prisma:PrismaService,store:AgentConfigurationRevisionStore;
    const query=(sql:string,params:any[]=[])=>prisma.executeInTenantSchema<any[]>(schema,sql,params);
    const tx=<T>(work:(query:RevisionQuery)=>Promise<T>)=>prisma.transactionInTenantSchema(schema,work);
    const operational=()=>query('SELECT * FROM agent_personas WHERE id=$1::uuid',[agentId]).then(rows=>rows[0]);
    const request=async(overrides:any={})=>({tenantId,agentId,actor,requestKey:randomUUID(),expectedOperationalVersion:7,
        expectedDraftRevision:null,body:operationalConfigurationBody(await operational()),...overrides});
    const save=(input:any)=>tx(q=>store.saveWithQuery(q,input));
    beforeAll(async()=>{
        const parsed=new URL(url!);
        if(!['127.0.0.1','localhost','[::1]'].includes(parsed.hostname)||!parsed.pathname.endsWith('_eval_isolation'))
            throw new Error('disposable_loopback_database_required');
        client=new PrismaClient({datasourceUrl:url});
        await client.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS public.tenants(id UUID PRIMARY KEY,schema_name TEXT)');
        await client.$executeRawUnsafe('INSERT INTO public.tenants(id,schema_name) VALUES($1::uuid,$2)',tenantId,schema);
        await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        prisma=Object.create(PrismaService.prototype);
        prisma.$transaction=client.$transaction.bind(client);
        prisma.$queryRawUnsafe=client.$queryRawUnsafe.bind(client);
        await query(`CREATE TABLE agent_personas(id UUID PRIMARY KEY,name TEXT,config_json JSONB,channels TEXT[],channel_bindings TEXT[],
            schedule_mode TEXT,is_active BOOLEAN,is_default BOOLEAN,version INTEGER,updated_at TIMESTAMPTZ DEFAULT NOW())`);
        const template=readFileSync(resolve(__dirname,'../../../prisma/tenant-schema.sql'),'utf8');
        const start=template.indexOf('-- BEGIN AGENT CONFIGURATION REVISIONS'),end=template.indexOf('-- END AGENT CONFIGURATION REVISIONS',start);
        if(start<0||end<0)throw new Error('configuration_revision_ddl_missing');
        for(const statement of template.slice(start,end).replaceAll('{{SCHEMA_NAME}}',schema).split(';').filter(row=>row.trim()))
            await client.$executeRawUnsafe(statement);
        store=new AgentConfigurationRevisionStore(prisma);
    });
    beforeEach(async()=>{
        await query('TRUNCATE agent_configuration_commands,agent_configuration_drafts,agent_configuration_revisions,agent_personas');
        await query(`INSERT INTO agent_personas(id,name,config_json,channels,channel_bindings,schedule_mode,is_active,is_default,version)
            VALUES($1::uuid,'Alex',$2::jsonb,ARRAY['web_widget'],ARRAY['web_widget:test'],'24_7',true,true,7)`,
            [agentId,JSON.stringify({persona:{name:'Alex',role:'support'},tools:{catalog:{enabled:true}},behavior:{rules:['Current rule']}})]);
    });
    afterAll(async()=>{
        if(client){try{
            if(!/^tenant_configrevision_[a-f0-9]{32}$/.test(schema))throw new Error('invalid_cleanup_scope');
            await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await client.$executeRawUnsafe('DELETE FROM public.tenants WHERE id=$1::uuid AND schema_name=$2',tenantId,schema);
        }finally{await client.$disconnect();}}
    });
    it('saves a different persona and routing without changing the serving row, version or pending approval scope',async()=>{
        const before=await operational(),input=await request();
        input.body.name='Draft Alex';input.body.configJson.persona.name='Draft Alex';
        input.body.channels=['telegram'];input.body.channelBindings=['telegram:proposed'];input.body.isActive=false;
        const saved=await save(input),draft=await tx(q=>store.readWithQuery(q,agentId));
        expect(saved.base_operational_version).toBe(7);expect(draft.id).toBe(saved.id);expect(draft.body.name).toBe('Draft Alex');
        expect(await operational()).toEqual(before);
    });
    it('replays concurrent identical requests as one revision and one command',async()=>{
        const input=await request();const results=await Promise.all(Array.from({length:6},()=>save(input)));
        expect(new Set(results.map(row=>row.id)).size).toBe(1);expect(results.filter(row=>!row.idempotentReplay)).toHaveLength(1);
        for(const table of ['agent_configuration_commands','agent_configuration_drafts','agent_configuration_revisions'])
            expect((await query(`SELECT count(*)::int AS n FROM ${table}`))[0].n).toBe(1);
    });
    it('refuses reusing a request key for a different body',async()=>{
        const input=await request();await save(input);input.body.configJson.behavior.rules=['Changed'];
        await expect(save(input)).rejects.toMatchObject({response:{error:'agent_configuration_request_conflict'}});
    });
    it('does not let two editors overwrite the same draft revision',async()=>{
        const first=await save(await request());
        const a=await request({expectedDraftRevision:first.id}),b=await request({expectedDraftRevision:first.id});
        a.body.configJson.behavior.rules=['Editor A'];b.body.configJson.behavior.rules=['Editor B'];
        const results=await Promise.allSettled([save(a),save(b)]);
        expect(results.filter(row=>row.status==='fulfilled')).toHaveLength(1);
        expect(results.find(row=>row.status==='rejected')).toMatchObject({reason:{response:{error:'agent_draft_revision_changed'}}});
        expect((await query('SELECT count(*)::int AS n FROM agent_configuration_revisions'))[0].n).toBe(2);
    });
    it('detects a changed operational version before creating the first draft',async()=>{
        const input=await request();await query('UPDATE agent_personas SET version=8');
        await expect(save(input)).rejects.toMatchObject({response:{error:'agent_operational_version_changed'}});
        expect((await query('SELECT count(*)::int AS n FROM agent_configuration_revisions'))[0].n).toBe(0);
    });
    it('detects a live edit even if its writer failed to bump the version',async()=>{
        const first=await save(await request()),input=await request({expectedDraftRevision:first.id});
        await query("UPDATE agent_personas SET channels=ARRAY['telegram']");
        await expect(save(input)).rejects.toMatchObject({response:{error:'agent_operational_configuration_changed'}});
        expect((await tx(q=>store.readWithQuery(q,agentId))).id).toBe(first.id);
    });
    it('rolls the revision and pointer back if the final command record fails',async()=>{
        const first=await save(await request()),input=await request({expectedDraftRevision:first.id});
        await expect(tx(q=>store.saveWithQuery(async(sql,params)=>{
            if(sql.includes('INSERT INTO agent_configuration_commands'))throw new Error('synthetic_command_store_failure');
            return q(sql,params);
        },input))).rejects.toThrow('synthetic_command_store_failure');
        expect((await tx(q=>store.readWithQuery(q,agentId))).id).toBe(first.id);
        expect((await query('SELECT count(*)::int AS n FROM agent_configuration_revisions'))[0].n).toBe(1);
    });
    it('rejects a tenant ID that does not own the transaction schema',async()=>{
        await expect(save(await request({tenantId:randomUUID()}))).rejects.toMatchObject({response:{error:'tenant_not_found'}});
    });
    it('checks role and canonical assignment kinds before any write',async()=>{
        await expect(save(await request({actor:{...actor,role:'tenant_agent'}}))).rejects.toMatchObject({response:{error:'agent_configuration_admin_required'}});
        const input=await request();input.body.channels=['email'];
        await expect(save(input)).rejects.toMatchObject({response:{error:'agent_configuration_body_invalid'}});
        expect((await query('SELECT count(*)::int AS n FROM agent_configuration_revisions'))[0].n).toBe(0);
    });
    it('rejects a changed stored body instead of presenting it as a reviewed revision',async()=>{
        const first=await save(await request());
        await query(`UPDATE agent_configuration_revisions SET body=jsonb_set(body,'{name}','"tampered"'::jsonb) WHERE id=$1::uuid`,[first.id]);
        await expect(tx(q=>store.readWithQuery(q,agentId))).rejects.toMatchObject({response:{error:'agent_configuration_revision_invalid'}});
    });
    it('only selects the current draft on its unchanged operational baseline for evaluation',async()=>{
        const first=await save(await request());
        expect((await tx(q=>store.readCurrentRevisionWithQuery(q,agentId,first.id))).id).toBe(first.id);
        const second=await save(await request({expectedDraftRevision:first.id}));
        await expect(tx(q=>store.readCurrentRevisionWithQuery(q,agentId,first.id))).rejects.toMatchObject({response:{error:'agent_draft_revision_changed'}});
        expect((await tx(q=>store.readCurrentRevisionWithQuery(q,agentId,second.id))).id).toBe(second.id);
        await query('UPDATE agent_personas SET version=8');
        await expect(tx(q=>store.readCurrentRevisionWithQuery(q,agentId,second.id))).rejects.toMatchObject({response:{error:'agent_operational_configuration_changed'}});
    });
});
