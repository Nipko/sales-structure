import { ConversationsService } from './conversations.service';

describe('Inbound without a serving agent',()=>{
    it('keeps the customer request in the inbox and never invokes a model or sends a reply',async()=>{
        const service:any=Object.create(ConversationsService.prototype);
        const message:any={id:'provider-message',tenantId:'tenant',contactId:'external',channelType:'telegram',
            channelAccountId:'connection',content:{type:'text',text:'Necesito ayuda'},metadata:{}};
        const contact={id:'contact'},conversation={id:'conversation',status:'active',updated_at:new Date()};
        Object.assign(service,{
            logger:{log:jest.fn(),warn:jest.fn(),error:jest.fn(),debug:jest.fn()},
            redis:{acquireLockToken:jest.fn().mockResolvedValue('owned'),releaseLockToken:jest.fn().mockResolvedValue(true),renewLockToken:jest.fn().mockResolvedValue(true)},
            debounceBurst:jest.fn().mockResolvedValue(undefined),resolveConversation:jest.fn().mockResolvedValue({contact,conversation,lead:{id:'lead'}}),
            tenantSchema:jest.fn().mockResolvedValue('tenant_schema'),
            prisma:{executeInTenantSchema:jest.fn().mockResolvedValue([])},
            analyticsService:{trackEvent:jest.fn().mockResolvedValue(undefined)},
            nurturingService:{cancelFollowUp:jest.fn().mockResolvedValue(undefined)},
            dripSequenceService:{stopOnReply:jest.fn().mockResolvedValue(undefined)},
            pipelineService:{resolveTenantStage:jest.fn().mockResolvedValue({slug:'initial'})},
            personaService:{resolvePersonaForChannel:jest.fn().mockResolvedValue({config:null,agentId:null,version:null})},
            saveMessage:jest.fn().mockResolvedValue({id:'inbound',duplicate:false}),recordAgentSignal:jest.fn(),
            generateResponse:jest.fn(),sendAfterHoursMessage:jest.fn(),
        });
        await service.runTurn(message);
        expect(service.personaService.resolvePersonaForChannel).toHaveBeenCalledWith('tenant','telegram','connection');
        expect(service.saveMessage).toHaveBeenCalledTimes(1);
        expect(service.saveMessage).toHaveBeenCalledWith('tenant','conversation',message);
        expect(service.generateResponse).not.toHaveBeenCalled();
        expect(service.sendAfterHoursMessage).not.toHaveBeenCalled();
        expect(service.redis.releaseLockToken).toHaveBeenCalledWith('lock:conv:conversation','owned');
    });
});
