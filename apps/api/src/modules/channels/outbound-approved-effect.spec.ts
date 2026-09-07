import { OutboundQueueService } from './outbound-queue.service';
import { OutboundQueueProcessor } from './outbound-queue.processor';
import { ApprovalEffectSuppressed } from './approved-effect-delivery.port';
import { resolveTenantSubscriptionAccess } from '../../common/utils/subscription-entitlement.util';
jest.mock('../../common/utils/subscription-entitlement.util',()=>({resolveTenantSubscriptionAccess:jest.fn()}));
const reference={tenantId:'11111111-1111-4111-8111-111111111111',ticketId:'22222222-2222-4222-8222-222222222222',effectId:'33333333-3333-4333-8333-333333333333'};
describe('approved delivery queue boundary',()=>{
    it('keeps only IDs in Redis and never retries enqueue without its deterministic identity',async()=>{
        const queue={getJob:jest.fn(async()=>null),add:jest.fn(async()=>{throw new Error('queue unavailable');})};
        const service=new OutboundQueueService(queue as any,{getPriority:async()=>1} as any,{} as any);
        await expect(service.enqueueApprovedEffect({...reference,caption:'private',to:'private'} as any)).rejects.toThrow('queue unavailable');
        expect(queue.add).toHaveBeenCalledTimes(1);
        expect((queue.add.mock.calls as any)[0][1]).toEqual({approvalEffect:reference});
        expect((queue.add.mock.calls as any)[0][2]).toHaveProperty('jobId',`approval-effect-${reference.ticketId}-${reference.effectId}`);
    });
    it('retries an existing failed job under the same key instead of adding another job',async()=>{
        const job={getState:async()=> 'failed',retry:jest.fn()};const queue={getJob:async()=>job,add:jest.fn()};
        await new OutboundQueueService(queue as any,{} as any,{} as any).enqueueApprovedEffect(reference);
        expect(job.retry).toHaveBeenCalledTimes(1);expect(queue.add).not.toHaveBeenCalled();
    });
    it('resolves fresh entitlement and credentials through the hydration port, never from a queue payload',async()=>{
        (resolveTenantSubscriptionAccess as jest.Mock).mockResolvedValue({allowed:true});
        const outbound:any={tenantId:reference.tenantId,to:'private',channelType:'whatsapp',channelAccountId:'bound',content:{type:'image',mediaUrl:'https://example.test'}};
        const gateway={sendMessage:jest.fn(async()=> 'ack')},token={getChannelToken:jest.fn(async()=>({accessToken:'fresh'}))};
        const deliver=jest.fn(async(ref,transport)=>{expect(ref).toEqual(reference);return (await transport.prepare(outbound))();});
        const processor=new OutboundQueueProcessor(gateway as any,{isOverLimit:async()=>false,recordUsage:async()=>{}} as any,token as any,{} as any,{} as any,{} as any,{deliver});
        expect(await processor.process({data:{approvalEffect:reference}} as any)).toBe('ack');
        expect(token.getChannelToken).toHaveBeenCalledWith(reference.tenantId,'whatsapp','bound');
        expect(gateway.sendMessage).toHaveBeenCalledWith(outbound,'fresh');
        (resolveTenantSubscriptionAccess as jest.Mock).mockResolvedValue({allowed:false,restrictionLevel:'suspended'});
        await expect(processor.process({data:{approvalEffect:reference}} as any)).rejects.toBeInstanceOf(ApprovalEffectSuppressed);
        expect(gateway.sendMessage).toHaveBeenCalledTimes(1);
    });
});
