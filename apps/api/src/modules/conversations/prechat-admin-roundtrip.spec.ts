// PREPARED ONLY, NOT REGISTERED OR EXECUTED.
// Intended target: apps/api/src/modules/conversations/prechat-admin-roundtrip.spec.ts
// Real admin controller + real PreChatService, strict semantic in-memory SQL.
// Constructor dependencies not used by these methods are inert test doubles.
import { ConversationsController } from './conversations.controller';
import { PreChatService } from './pre-chat.service';

jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }));
jest.mock('./conversations.service', () => ({ ConversationsService: class {} }));
jest.mock('./active-operations-context.service', () => ({ ActiveOperationsContextService: class {} }));
jest.mock('../persona/persona.service', () => ({ PersonaService: class {} }));

const TENANT='11111111-1111-4111-8111-111111111111';
const SCHEMA='qa_prechat_semantic_local_only';
const CONFIG={is_active:true,greeting_message:'QA local: antes de conversar',fields:[
    {key:'email',label:'QA Correo',type:'email' as const,required:true,options:[],map_to:'contact.email'},
    {key:'trip',label:'QA Viaje',type:'select' as const,required:false,options:['Norte','Sur'],map_to:'metadata.trip'},
]};
type Row={id:string;tenant_id:string;name:string;fields_json:string;greeting_message:string|null;is_active:boolean;created_at:number;updated_at:number};
function fixture(){
    const rows:Row[]=[];
    const sqlCalls:{schema:string;sql:string;params:unknown[]}[]=[];
    const prisma={tenant:{findUnique:jest.fn(async (query:any)=>{
        expect(query).toEqual({where:{id:TENANT},select:{schemaName:true}});
        return {schemaName:SCHEMA};
    })},executeInTenantSchema:jest.fn(async (schema:string,sql:string,params:unknown[])=>{
        expect(schema).toBe(SCHEMA);
        const normalized=sql.replace(/\s+/g,' ').trim();
        sqlCalls.push({schema,sql:normalized,params});
        // Recognize only the actual read projection and this table. The
        // optional inactive/latest read is an allowed admin contract, while
        // WHERE is_active=true remains mandatory for the runtime consumer.
        const projection='SELECT id, name, fields_json, greeting_message, is_active, created_at, updated_at FROM pre_chat_forms';
        const read=new RegExp('^'+projection+'( WHERE is_active = true)?( ORDER BY (created_at|updated_at) DESC(?:, id DESC)?)? LIMIT 1$');
        const match=normalized.match(read);
        if(match){
            expect(params).toEqual([]);
            const candidates=rows.filter(row=>!match[1]||row.is_active);
            if(match[2])candidates.sort((a,b)=>b.created_at-a.created_at || b.id.localeCompare(a.id));
            return candidates.slice(0,1).map(row=>({...row}));
        }
        const write="WITH deactivated AS ( UPDATE pre_chat_forms SET is_active = false, updated_at = NOW() WHERE is_active = true RETURNING 1 ) INSERT INTO pre_chat_forms (tenant_id, name, fields_json, greeting_message, is_active) VALUES ($1, 'default', $2::jsonb, $3, $4) RETURNING id, name, fields_json, greeting_message, is_active";
        if(normalized===write){
            expect(params).toHaveLength(4);expect(params[0]).toBe(TENANT);
            expect(typeof params[1]).toBe('string');expect(typeof params[3]).toBe('boolean');
            const fields=JSON.parse(params[1] as string);expect(Array.isArray(fields)).toBe(true);
            rows.forEach(row=>{if(row.is_active)row.is_active=false;});
            const row:Row={id:'synthetic-form-'+(rows.length+1),tenant_id:TENANT,name:'default',fields_json:JSON.stringify(fields),greeting_message:params[2] as string|null,is_active:params[3] as boolean,created_at:rows.length+1,updated_at:rows.length+1};
            rows.push(row);return [{...row}];
        }
        throw new Error('Unexpected SQL in isolated prechat adapter: '+normalized);
    })};
    const service=new PreChatService(prisma as never);
    const controller=new ConversationsController(undefined as never,service,undefined as never,prisma as never,undefined as never);
    return {controller,service,rows,sqlCalls};
}

describe('admin prechat disable/reopen versus active runtime consumer',()=>{
    it('control: active save and admin reopen preserve complete field contracts',async()=>{
        const f=fixture();const saved=await f.controller.savePrechatForm(TENANT,CONFIG);
        expect(saved).toMatchObject({success:true,data:CONFIG});
        expect(await f.controller.getPrechatForm(TENANT)).toMatchObject({success:true,data:CONFIG});
        expect(f.rows).toHaveLength(1);
    });
    it('product: disabling preserves the editable admin configuration on reopen',async()=>{
        const f=fixture();await f.controller.savePrechatForm(TENANT,CONFIG);
        await f.controller.savePrechatForm(TENANT,{...CONFIG,is_active:false});
        // The active consumer is SUPPOSED to hide disabled forms. That correct
        // behavior is a control, never the defect assertion.
        expect(await f.service.getActiveForm(TENANT)).toBeNull();
        expect(f.rows.at(-1)).toMatchObject({is_active:false,fields_json:JSON.stringify(CONFIG.fields)});
        const reopened=await f.controller.getPrechatForm(TENANT);
        expect(reopened).toMatchObject({success:true,data:{...CONFIG,is_active:false}});
    });
    it('control: an inactive form stays absent from the active runtime consumer',async()=>{
        const f=fixture();await f.controller.savePrechatForm(TENANT,{...CONFIG,is_active:false});
        expect(await f.service.getActiveForm(TENANT)).toBeNull();
        expect(f.rows).toHaveLength(1);expect(f.rows[0].is_active).toBe(false);
    });
    it('control: no saved form is a successful empty admin result without any write',async()=>{
        const f=fixture();expect(await f.controller.getPrechatForm(TENANT)).toEqual({success:true,data:null});
        expect(f.rows).toEqual([]);expect(f.sqlCalls).toHaveLength(1);
        expect(f.sqlCalls[0].sql.startsWith('SELECT ')).toBe(true);
    });
});
