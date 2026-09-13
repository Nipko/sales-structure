import { BookingEngineService, type BookingState } from './booking-engine.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';
import type { MissionExecutionScopeV1 } from '@parallext/shared';

describe('WhatsApp forms belong to one active booking mission revision',()=>{
    const authority=authorityFor('list_services','check_availability','create_appointment');
    const services=[{id:'service',name:'Consultation',durationMinutes:30,price:100,currency:'COP'}];
    function fixture(){
        const execute=jest.fn(async(_s:string,_t:string,_c:string,name:string)=>name==='check_availability'
            ?{available:true,slots:[{time:'10:00',endTime:'10:30'}]}:{success:true,appointment:{id:'appointment',status:'confirmed'}});
        const engine=new BookingEngineService({$queryRawUnsafe:jest.fn().mockResolvedValue([])} as any,
            {get:async()=>JSON.stringify(services),set:async()=>{}} as any,{execute} as any);
        const state:BookingState={step:'waiting_flow',missionId:'current',flowToken:'current-form',flowRevision:3,flowStartedAt:new Date().toISOString(),services};
        const scope:MissionExecutionScopeV1={version:1,kind:'booking',executionOwner:'booking',missionId:'current',revision:3,inboundMessageId:'inbound',
            expectedReply:{kind:'flow',missionId:'current',proposalId:'current-form',sourceMessageId:'previous'}};
        const run=(flowResponseToken:string,missionScope=scope)=>engine.process('schema','tenant','contact',{intent:'unknown'} as any,
            '__flow_response__',state,{},'2026-09-07','es',{authority,conversationId:'conversation',flowResponseToken,missionScope,
                flowData:{service_id:'service',date:'2026-09-14',time:'10:00',customer_name:'Ana Perez',customer_email:'ana@example.test'}});
        return {run,state,scope,execute};
    }
    it.each(['old-form','',undefined])('does not use or discard the current form when token is %s',async(token)=>{
        const h=fixture();const result=await h.run(token as string);
        expect(result.state).toMatchObject(h.state);expect(result.state.customerName).toBeUndefined();
        expect(h.execute).not.toHaveBeenCalled();
    });
    it('rejects a token from the right form when the mission revision changed',async()=>{
        const h=fixture();const result=await h.run('current-form',{...h.scope,revision:4});
        expect(result.state.step).toBe('waiting_flow');expect(h.execute).not.toHaveBeenCalled();
    });
    it('validates availability and sends the bound form token to the canonical command',async()=>{
        const h=fixture();const result=await h.run('current-form');
        expect(result.state.step).toBe('booked');
        expect(h.execute.mock.calls.map(call=>call[3])).toEqual(['check_availability','create_appointment']);
        expect((h.execute.mock.calls[1] as any[])[6].authorityEvidence).toMatchObject({source:'flow_response',flowToken:'current-form'});
    });
});
