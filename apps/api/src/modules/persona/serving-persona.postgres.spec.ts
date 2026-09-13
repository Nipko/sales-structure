import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { readServingPersona } from './serving-persona';
const url=process.env.AGENT_RELEASE_TEST_DATABASE_URL;
(url?describe:describe.skip)('Authoritative serving persona routing on PostgreSQL',()=>{
    const schema=`tenant_serving_${randomUUID().replace(/-/g,'')}`;
    let client:PrismaClient,prisma:PrismaService;
    const query=(sql:string,params:any[]=[])=>prisma.executeInTenantSchema<any[]>(schema,sql,params);
    const read=(channel='telegram',account?:string)=>readServingPersona(<T>(sql:string,params:any[]=[])=>prisma.executeInTenantSchema<T>(schema,sql,params),channel,account);
    const agent=async(data:any={})=>{const id=data.id||randomUUID();await query(`INSERT INTO agent_personas(id,config_json,version,is_active,is_default,channels,channel_bindings)
        VALUES($1::uuid,$2::jsonb,$3,$4,$5,$6::text[],$7::text[])`,[id,JSON.stringify({persona:{name:data.name||'Agent'}}),data.version??1,data.active??true,data.default??false,data.channels||[],data.bindings||[]]);return id;};
    beforeAll(async()=>{
        const parsed=new URL(url!);if(!['127.0.0.1','localhost'].includes(parsed.hostname)||!parsed.pathname.endsWith('_eval_isolation'))throw new Error('disposable_loopback_database_required');
        client=new PrismaClient({datasourceUrl:url});await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
        prisma=Object.create(PrismaService.prototype);prisma.$transaction=client.$transaction.bind(client);
        await query('CREATE TABLE agent_personas(id UUID PRIMARY KEY,name TEXT DEFAULT \'Agent\',config_json JSONB,version INTEGER,is_active BOOLEAN,is_default BOOLEAN,channels TEXT[],channel_bindings TEXT[],schedule_mode TEXT DEFAULT \'24_7\')');
        await query('CREATE TABLE persona_config(config_json JSONB,version INTEGER,is_active BOOLEAN)');
    });
    beforeEach(async()=>{await query('TRUNCATE agent_personas,persona_config');});
    afterAll(async()=>{if(client)try{if(!/^tenant_serving_[a-f0-9]{32}$/.test(schema))throw new Error('invalid_cleanup_scope');await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);}finally{await client.$disconnect();}});
    it('prefers exact connection, then channel type, then default with the matching version and body',async()=>{
        const fallback=await agent({name:'Default',default:true}),byType=await agent({name:'Type',channels:['telegram'],version:2});
        const exact=await agent({name:'Exact',bindings:['telegram:one'],version:3});
        expect(await read('telegram','one')).toMatchObject({agentId:exact,version:3,config:{persona:{name:'Exact'}}});
        expect((await read('telegram','two')).agentId).toBe(byType);expect((await read('web_widget','widget')).agentId).toBe(fallback);
    });
    it('observes a published replacement immediately and does not fall back after deactivation',async()=>{
        const id=await agent({default:true,name:'Before'});expect((await read()).version).toBe(1);
        await query(`UPDATE agent_personas SET config_json='{"persona":{"name":"After"}}',version=2 WHERE id=$1::uuid`,[id]);
        expect(await read()).toMatchObject({agentId:id,version:2,config:{persona:{name:'After'}}});
        await query(`INSERT INTO persona_config VALUES('{"persona":{"name":"Old legacy"}}',9,true)`);
        await query('UPDATE agent_personas SET is_active=false WHERE id=$1::uuid',[id]);
        expect(await read()).toEqual({config:null,agentId:null,version:null});
    });
    it('preserves an explicit legacy configuration only when no durable agents exist',async()=>{
        expect((await read()).config).toBeNull();await query(`INSERT INTO persona_config VALUES('{"persona":{"name":"Legacy"}}',1,true)`);
        expect(await read()).toMatchObject({agentId:null,version:null,config:{persona:{name:'Legacy'}}});
        await agent({active:false});expect((await read()).config).toBeNull();
    });
    it.each([{bindings:['telegram:one']},{channels:['telegram']},{default:true}])('refuses ambiguous assignment at the winning priority: %j',async configuration=>{
        await agent(configuration);await agent(configuration);
        await expect(read('telegram','one')).rejects.toMatchObject({response:{error:'agent_connection_assignment_conflict'}});
    });
    it('ignores lower-priority ambiguity when a unique exact connection owns the turn',async()=>{
        await agent({default:true});await agent({default:true});const id=await agent({bindings:['telegram:one']});
        expect((await read('telegram','one')).agentId).toBe(id);
    });
});
