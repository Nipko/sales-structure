import { randomUUID } from 'crypto';
import { OperationalNoticeService } from '../operational-notices/operational-notice.service';

const CONFIRMING_ACCOUNT='15550001111';
const SILENT_ACCOUNT='15559990000';
const CONFIRMS=(family:string)=>({[family]:{enabled:true,emailConfirmations:true}});
const STAYS_SILENT=(family:string)=>({[family]:{enabled:true,emailConfirmations:false}});

/** Exercise the delivery-time policy, not a test copy of it. */
function harness(kind:'tour.booking_confirmed'|'property.booking_confirmed',options:{
    bookedOn:string|null;toolsByAccount:Record<string,any>;language?:string;
}) {
    const conversationId=options.bookedOn?randomUUID():null;
    const entityId=randomUUID();
    const asked:Array<{sql:string;params:any[]}>= [];
    const facts=kind==='tour.booking_confirmed'?{
        id:entityId,contact_id:null,conversation_id:conversationId,status:'reserved',guest_email:'ana@example.com',
        guest_name:'Ana',name:'Tour del café',departure_date_text:'2026-10-01',departure_time:'09:00',
        party_size:2,adults:2,children:0,total_price:'200',currency:'COP',departure_location:'Plaza',
        language:options.language||'es',
    }:{
        id:entityId,contact_id:null,conversation_id:conversationId,status:'confirmed',guest_email:'ana@example.com',
        guest_name:'Ana',name:'Casa Mar',check_in_text:'2026-10-01',check_out_text:'2026-10-03',nights:2,
        total_price:'220',currency:'COP',check_in_instructions:'Llave en recepción',language:options.language||'es',
    };
    const query=jest.fn(async(sql:string,params:any[]=[])=>{
        asked.push({sql,params});
        if(sql.includes(kind.startsWith('tour.')?'FROM tour_bookings':'FROM property_bookings'))return [facts];
        if(sql.includes("to_regclass('customer_memory_erasure')"))return [{name:null}];
        if(sql.includes('channel_type, channel_account_id FROM conversations'))return conversationId&&params[0]===conversationId
            ?[{channel_type:'whatsapp',channel_account_id:options.bookedOn}]:[];
        if(sql.includes('WITH ranked AS')){
            const account=String(params[0]||'').split(':')[1];
            const tools=options.toolsByAccount[account];
            return [{matches:tools?[{id:randomUUID(),name:'Agent',config_json:{persona:{name:'Agent'},tools},version:1,
                channels:['whatsapp'],channel_bindings:[params[0]],schedule_mode:'24_7',is_active:true,is_default:false}]:null,
                has_agents:true,legacy_config:null}];
        }
        throw new Error(`Unexpected SQL: ${sql}`);
    });
    const runtime:any={prisma:{tenant:{findUnique:jest.fn().mockResolvedValue({language:'es-CO'})}},widget:{}};
    const hydrate=()=> (OperationalNoticeService.prototype as any).hydrate.call(runtime,query,'tenant_policy',randomUUID(),{
        id:randomUUID(),kind,entity_id:entityId,contact_id:null,conversation_id:conversationId,
    });
    const resolvedBinding=()=>asked.find(entry=>entry.sql.includes('WITH ranked AS'))?.params[0];
    return {hydrate,resolvedBinding};
}

describe.each([
    ['tour.booking_confirmed','tours','tour_booking_confirmation'],
    ['property.booking_confirmed','properties','property_booking_confirmation'],
] as const)('%s delivery policy',(kind,family,slug)=>{
    it('follows the agent on the booking connection and suppresses when its switch is off',async()=>{
        const h=harness(kind,{bookedOn:SILENT_ACCOUNT,toolsByAccount:{
            [CONFIRMING_ACCOUNT]:CONFIRMS(family),[SILENT_ACCOUNT]:STAYS_SILENT(family),
        }});
        await expect(h.hydrate()).rejects.toMatchObject({code:'notice_confirmation_switched_off'});
        expect(h.resolvedBinding()).toBe(`whatsapp:${SILENT_ACCOUNT}`);
    });

    it('prepares the configured template when the serving agent confirms',async()=>{
        const h=harness(kind,{bookedOn:CONFIRMING_ACCOUNT,toolsByAccount:{
            [CONFIRMING_ACCOUNT]:CONFIRMS(family),[SILENT_ACCOUNT]:STAYS_SILENT(family),
        },language:'pt-BR'});
        const result=await h.hydrate();
        expect(result).toMatchObject({route:'email',email:'ana@example.com',emailTemplate:{slug,language:'pt-BR'}});
        expect(h.resolvedBinding()).toBe(`whatsapp:${CONFIRMING_ACCOUNT}`);
    });

    it('confirms a dashboard booking with no serving thread',async()=>{
        const h=harness(kind,{bookedOn:null,toolsByAccount:{[SILENT_ACCOUNT]:STAYS_SILENT(family)}});
        await expect(h.hydrate()).resolves.toMatchObject({emailTemplate:{slug}});
        expect(h.resolvedBinding()).toBeUndefined();
    });

    it('does not let another family silence this operation',async()=>{
        const other=family==='tours'?'properties':'tours';
        const h=harness(kind,{bookedOn:CONFIRMING_ACCOUNT,toolsByAccount:{
            [CONFIRMING_ACCOUNT]:{...STAYS_SILENT(other),[family]:{enabled:true}},
        }});
        await expect(h.hydrate()).resolves.toMatchObject({emailTemplate:{slug}});
    });
});
