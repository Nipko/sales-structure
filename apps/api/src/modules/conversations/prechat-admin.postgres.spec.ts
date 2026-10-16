// PREPARED ONLY. Intended target: conversations/prechat-admin.postgres.spec.ts
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { PrismaClient } from '@prisma/client';
import { PreChatService } from './pre-chat.service';
import { ConversationsController } from './conversations.controller';
jest.mock('../prisma/prisma.service',()=>({PrismaService:class{}}));
jest.mock('./conversations.service',()=>({ConversationsService:class{}}));
jest.mock('./active-operations-context.service',()=>({ActiveOperationsContextService:class{}}));
jest.mock('../persona/persona.service',()=>({PersonaService:class{}}));

const url=process.env.KNOWLEDGE_FILE_TEST_DATABASE_URL;
const integration=url?describe:describe.skip;
integration('admin prechat saved/active semantics on owned real Prisma PostgreSQL',()=>{
    const tenants=[randomUUID(),randomUUID()];const schemas=tenants.map(id=>'tenant_prechat_'+id.replace(/-/g,''));
    const created:string[]=[];let db:Pool;let client:PrismaClient;let service:PreChatService;let controller:ConversationsController;
    const statements:{schema:string;sql:string}[]=[];
    const input=(name:string,active:boolean)=>({is_active:active,greeting_message:'QA '+name,fields:[{key:'email',label:'QA '+name,type:'email' as const,required:true,options:[],map_to:'contact.email'}]});
    const snapshot=async(schema:string)=>(await db.query(`SELECT md5(COALESCE(jsonb_agg(to_jsonb(f) ORDER BY id)::text,'[]')) AS hash FROM "${schema}".pre_chat_forms f`)).rows;
    beforeAll(async()=>{
        const parsed=new URL(url!);if(!['127.0.0.1','localhost'].includes(parsed.hostname)||!parsed.pathname.endsWith('_eval_isolation'))throw new Error('disposable_loopback_database_required');
        db=new Pool({connectionString:url,max:3});client=new PrismaClient({datasources:{db:{url:url!}}});await client.$connect();
        for(const schema of schemas){
            if(!/^tenant_prechat_[a-f0-9]{32}$/.test(schema))throw new Error('owned_schema_name_required');
            await db.query(`CREATE SCHEMA "${schema}"`);created.push(schema);
            // Canonical existing types, no public tenant DDL, extension install,
            // PrismaService.onModuleInit or generated-client regeneration.
            await db.query(`CREATE TABLE "${schema}".pre_chat_forms (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id VARCHAR(255) NOT NULL,
                name VARCHAR(255) DEFAULT 'default', fields_json JSONB NOT NULL DEFAULT '[]'::jsonb,
                greeting_message TEXT, is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
            )`);
        }
        const adapter={tenant:{findUnique:async(query:any)=>{
            expect(query.select).toEqual({schemaName:true});const index=tenants.indexOf(query.where.id);
            if(index<0)throw new Error('owned_tenant_scope_required');return {schemaName:schemas[index]};
        }},executeInTenantSchema:async(schema:string,sql:string,params:unknown[]=[])=>{
            if(!created.includes(schema))throw new Error('owned_schema_scope_required');
            if(!/^\s*(SELECT\b|WITH deactivated\b)/i.test(sql)||!/\bpre_chat_forms\b/.test(sql))throw new Error('unexpected_service_sql');
            statements.push({schema,sql});return client.$transaction(async tx=>{
                await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}", pg_catalog`);
                return tx.$queryRawUnsafe(sql,...params);
            });
        }};
        service=new PreChatService(adapter as never);
        controller=new ConversationsController(undefined as never,service,undefined as never,adapter as never,undefined as never);
    });
    beforeEach(async()=>{for(const schema of created)await db.query(`TRUNCATE "${schema}".pre_chat_forms`);statements.length=0;});
    afterAll(async()=>{
        if(!db)return;
        try{for(const schema of created){if(!schemas.includes(schema)||!/^tenant_prechat_[a-f0-9]{32}$/.test(schema))throw new Error('refusing_foreign_schema_cleanup');await db.query(`DROP SCHEMA "${schema}" CASCADE`);}}
        finally{await client?.$disconnect();await db.end();}
    });
    it('admin reopens the latest inactive saved fields while the active consumer omits them',async()=>{
        await controller.savePrechatForm(tenants[0],input('older',true));
        // Own synthetic row only: fixed older timestamp makes the latest-save
        // oracle independent of clock precision and transaction NOW ties.
        await db.query(`UPDATE "${schemas[0]}".pre_chat_forms SET created_at='2020-01-01 00:00:00'`);
        const current=input('current',false);await controller.savePrechatForm(tenants[0],current);
        const before=await snapshot(schemas[0]);
        expect(await service.getActiveForm(tenants[0])).toBeNull();
        expect(await controller.getPrechatForm(tenants[0])).toMatchObject({success:true,data:current});
        expect(await snapshot(schemas[0])).toEqual(before);
    });
    it('separates the two owned tenants with identical field keys without changing either read snapshot',async()=>{
        const a=input('tenantA',true),b=input('tenantB',false);
        await controller.savePrechatForm(tenants[0],a);await controller.savePrechatForm(tenants[1],b);
        const before=await Promise.all(schemas.map(snapshot));
        expect(await controller.getPrechatForm(tenants[0])).toMatchObject({success:true,data:a});
        expect(await controller.getPrechatForm(tenants[1])).toMatchObject({success:true,data:b});
        expect(await service.getActiveForm(tenants[0])).toMatchObject(a);expect(await service.getActiveForm(tenants[1])).toBeNull();
        const n=statements.length;await expect(controller.getPrechatForm(randomUUID())).rejects.toThrow('owned_tenant_scope_required');expect(statements).toHaveLength(n);
        expect(await Promise.all(schemas.map(snapshot))).toEqual(before);
    });
    it('uses a deterministic ID tie-break for equal timestamps without pretending it establishes chronological order',async()=>{
        const ids=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'];
        for(let i=0;i<ids.length;i++)await db.query(`INSERT INTO "${schemas[0]}".pre_chat_forms(id,tenant_id,fields_json,greeting_message,is_active,created_at,updated_at) VALUES($1,$2,$3::jsonb,$4,false,'2020-01-01 00:00:00','2020-01-01 00:00:00')`,[ids[i],tenants[0],JSON.stringify(input('tie'+i,false).fields),'QA tie'+i]);
        const before=await snapshot(schemas[0]);expect((await controller.getPrechatForm(tenants[0])).data?.id).toBe(ids[1]);expect(await service.getActiveForm(tenants[0])).toBeNull();expect(await snapshot(schemas[0])).toEqual(before);
    });
});
