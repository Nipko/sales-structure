import { EventEmitter2 } from '@nestjs/event-emitter';
import { ToolApprovalWorkflowService } from './tool-approval-workflow.service';
import { operationalConfigurationHash } from '../persona/agent-configuration-revision';
import { authorityFor } from './__fixtures__/tool-authority.fixture';

const tenantId='11111111-1111-4111-8111-111111111111',agentId='22222222-2222-4222-8222-222222222222';
const contactId='33333333-3333-4333-8333-333333333333',conversationId='44444444-4444-4444-8444-444444444444';
const schemaName='tenant_served_approval';

describe('approved effects preserve their original served configuration',()=>{
    it.each(['current','missing','changed_version','changed_hash'])( '%s origin authority',async mode=>{
        const original={id:agentId,name:'Agent',version:7,is_active:true,config_json:{industry:'retail',tools:{appointments:{enabled:true}}}};
        const operationalScope={kind:'agent' as const,tenantId,schemaName,agentId,version:7,operationalHash:operationalConfigurationHash(original)};
        const current={...original,...(mode==='changed_version'?{version:8}:{}),
            ...(mode==='changed_hash'?{config_json:{...original.config_json,rules:['Changed']}}:{})};
        const claim={tenantId,schemaName,ticketId:contactId,leaseToken:conversationId,toolName:'cancel_appointment',contactId,conversationId,
            args:{appointmentId:contactId,operationalScope:{...operationalScope,version:99}},
            ...(mode==='missing'?{}:{operationalScope})};
        const controls={finishApprovalResume:jest.fn(async(_claim:any,result:any)=>result)};
        const executor={execute:jest.fn().mockResolvedValue({success:true})};
        const capabilities={resolve:jest.fn().mockResolvedValue({status:{status:'ok'},authority:authorityFor('cancel_appointment')})};
        const workflow=new ToolApprovalWorkflowService({
            executeInTenantSchema:async()=>[{channel_type:'web_widget',channel_account_id:'widget',agent_persona_id:agentId}],
            tenant:{findUnique:async()=>({industry:'retail',settings:{verticalConfig:{industry:'retail'}}})},
        } as any,controls as any,executor as any,new EventEmitter2(),{} as any,capabilities as any,
        {getAgent:async()=>current} as any);
        const result=await (workflow as any).executeClaim(claim);
        if(mode==='current'){
            expect(result).toMatchObject({success:true});
            expect(executor.execute).toHaveBeenCalledWith(schemaName,tenantId,contactId,'cancel_appointment',claim.args,conversationId,
                expect.objectContaining({operationalScope}));
        } else {
            expect(result).toMatchObject({error:'agent_operational_revision_changed',persisted:false});
            expect(capabilities.resolve).not.toHaveBeenCalled();expect(executor.execute).not.toHaveBeenCalled();
        }
    });
});
