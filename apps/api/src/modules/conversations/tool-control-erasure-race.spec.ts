import { ToolExecutionControlService } from './tool-execution-control.service';
import { ComplianceService } from '../compliance/compliance.service';
import { getToolPolicy } from './tool-policy-registry';

const schema='tenant_privacy',tenant='11111111-1111-4111-8111-111111111111',contact='22222222-2222-4222-8222-222222222222';
const ledgerId='33333333-3333-4333-8333-333333333333',ticket='44444444-4444-4444-8444-444444444444';
const decision={allowed:true as const,policy:getToolPolicy('create_appointment')!,ledgerId,executionLeaseToken:'lease'};
function deferred(){let resolve!:()=>void;return {promise:new Promise<void>(r=>resolve=r),resolve:()=>resolve()};}

/** Models shared/exclusive advisory locking and committed tombstone visibility. */
function build(){
    let readers=0,writer=false;
    const wake:Array<()=>void>=[];
    const lock=async(shared:boolean)=>{
        while(writer||(!shared&&readers>0))await new Promise<void>(resolve=>wake.push(resolve));
        if(shared)readers++;else writer=true;
        return ()=>{if(shared)readers--;else writer=false;wake.splice(0).forEach(resolve=>resolve());};
    };
    const state={erased:false,response:{private:'old'} as any,request:{private:'request'} as any,updates:0,delay:false,outbox:{private:'old'},ticketResult:{private:'old'}};
    const started=deferred(),finish=deferred();
    const query=jest.fn(async(sql:string,params:any[]=[])=>{
        if(sql.includes('current_schema() AS schema')&&sql.includes('AS replies'))return [{schema,replies:null,sources:null}];
        if(sql==='SELECT id FROM public.tenants WHERE id=$1::uuid AND schema_name=$2 FOR SHARE')return [{id:tenant}];
        if(sql.startsWith('SELECT * FROM tool_execution_ledger'))return [{id:ledgerId,contact_id:contact,status:'executing'}];
        if(sql.includes('SELECT contact_id FROM customer_memory_erasure'))return state.erased?[{contact_id:contact}]:[];
        if(sql.includes('SELECT t.id AS ticket_id'))return [{ticket_id:ticket,contact_id:contact,ticket_status:'approved',ledger_status:'succeeded',response_payload:{private:'cached'}}];
        if(sql.includes('SELECT o.payload,ticket.contact_id'))return [{contact_id:contact,payload:{private:'leased before erasure'}}];
        if(sql.includes('WITH due AS'))return state.erased?[]:[{id:'event',event_type:'tool.approval.resumed',payload:state.outbox}];
        if(sql.includes('INSERT INTO customer_memory_erasure'))state.erased=true;
        if(sql.includes("to_regclass('tool_execution_ledger')"))return [{ledger:true,tickets:true,outbox:true}];
        if(sql.includes("UPDATE tool_execution_ledger SET request_payload='{}'")){state.response={error:'contact_erased'};state.request={};return [];}
        if(sql.includes('UPDATE tool_approval_tickets SET status=')){state.ticketResult={} as any;return [];}
        if(sql.includes("UPDATE tool_approval_outbox SET payload='{}'")){state.outbox={} as any;return [];}
        if(sql.includes('SET status = $2, response_payload')){
            started.resolve();if(state.delay)await finish.promise;
            state.response=JSON.parse(params[2]);state.updates++;return [{id:ledgerId}];
        }
        return [];
    });
    const prisma={getTenantSchemaName:jest.fn().mockResolvedValue(schema),auditLog:{create:jest.fn()},
        executeInTenantSchema:jest.fn((_schema:string,sql:string,params:any[])=>query(sql,params)),
        transactionInTenantSchema:jest.fn(async(_schema:string,callback:any)=>{
            const releases:Array<()=>void>=[];
            let heldPrivacy: 'shared' | 'exclusive' | undefined;
            try{return await callback(async(sql:string,params:any[]=[])=>{
                if(sql.includes('FROM pg_locks')&&sql.includes("mode='ExclusiveLock'"))
                    return heldPrivacy==='exclusive'&&params[0]===`agent-privacy:${schema}`?[{'?column?':1}]:[];
                if(sql.includes('pg_advisory_xact_lock')&&params[0]===`agent-privacy:${schema}`){
                    const mode=sql.includes('_shared')?'shared':'exclusive';
                    // PostgreSQL reacquires an already-held transaction lock without self-waiting.
                    if(heldPrivacy==='exclusive'||heldPrivacy===mode)return [];
                    if(heldPrivacy)throw new Error('fixture_lock_upgrade_not_supported');
                    releases.push(await lock(mode==='shared'));heldPrivacy=mode;return [];
                }
                return query(sql,params);
            });}finally{releases.forEach(release=>release());}
        })};
    const controls=new ToolExecutionControlService(prisma as any,{} as any,{} as any,{} as any);
    jest.spyOn(controls as any,'ensureControlTables').mockResolvedValue(undefined);
    const compliance=new ComplianceService(prisma as any);
    return {state,query,prisma,controls,compliance,started,finish};
}

describe('Tool derivative erasure is atomic with late callbacks',()=>{
    it('waits for an in-flight finalizer, erases its output, then blocks late payloads',async()=>{
        const {state,controls,compliance,started,finish}=build();state.delay=true;
        const finalizing=controls.complete(schema,decision,{private:'provider result'});await started.promise;
        const erasing=compliance.eraseContactData(schema,tenant,contact,'admin');
        await new Promise<void>(resolve=>setImmediate(resolve));expect(state.erased).toBe(false);
        finish.resolve();await finalizing;expect((await erasing).completed).toBe(true);
        expect(state.request).toEqual({});expect(state.response).toEqual({error:'contact_erased'});
        expect(state.outbox).toEqual({});expect(state.ticketResult).toEqual({});
        await expect(controls.complete(schema,decision,{private:'delayed secret'})).rejects.toThrow('contact_erased');
        await controls.fail(schema,decision,'sensitive provider error');
        expect(state.response).toEqual({error:'contact_erased'});expect(state.updates).toBe(1);
    });
    it('blocks resume and cached notifications without returning private payloads',async()=>{
        const {state,controls}=build();state.erased=true;
        expect(await controls.claimApprovalResume({tenantId:tenant,ticketId:ticket})).toEqual({state:'completed',result:{error:'contact_erased'}});
        expect(await controls.finishApprovalResume({tenantId:tenant,schemaName:schema,ticketId:ticket,leaseToken:'lease',toolName:'create_appointment',
            contactId:contact,conversationId:ledgerId,args:{}},{private:'late result'})).toEqual({state:'completed',result:{error:'contact_erased'}});
        const publish=jest.fn();
        expect(await controls.publishApprovalOutboxEvent(schema,{id:'event',eventType:'tool.approval.resumed',leaseToken:'lease',payload:{private:'old'}},publish)).toBe(false);
        expect(publish).not.toHaveBeenCalled();expect(await controls.claimApprovalOutboxEvents(schema)).toEqual([]);
    });
});
