import { OutboundQueueProcessor } from './outbound-queue.processor';
describe('operational notice transport boundary',()=>{
    const reference={tenantId:'11111111-1111-4111-8111-111111111111',noticeId:'22222222-2222-4222-8222-222222222222'};
    it('uses fresh canonical hydration and channel credentials through the common gateway',async()=>{
        const outbound:any={tenantId:reference.tenantId,channelType:'telegram',channelAccountId:'current',to:'current-contact',content:{type:'text',text:'canonical'}};
        const gateway={sendMessage:jest.fn().mockResolvedValue('provider-message')},tokens={getChannelToken:jest.fn().mockResolvedValue({accessToken:'fresh'})};
        const deliver=jest.fn(async(ref,transport)=>{expect(ref).toEqual(reference);return (await transport.prepare(outbound))();});
        const processor=new OutboundQueueProcessor(gateway as any,{isOverLimit:async()=>false,recordUsage:async()=>{}} as any,tokens as any,{} as any,{} as any,{} as any,undefined,{deliver});
        expect(await processor.process({data:{operationalNotice:reference}} as any)).toBe('provider-message');
        expect(tokens.getChannelToken).toHaveBeenCalledWith(reference.tenantId,'telegram','current');
        expect(gateway.sendMessage).toHaveBeenCalledWith(outbound,'fresh');
    });
    it('does not resolve a recipient or send when the durable delivery port is missing',async()=>{
        const gateway={sendMessage:jest.fn()},tokens={getChannelToken:jest.fn()};
        const processor=new OutboundQueueProcessor(gateway as any,{} as any,tokens as any,{} as any,{} as any,{} as any);
        await expect(processor.process({data:{operationalNotice:reference}} as any)).rejects.toThrow();
        expect(tokens.getChannelToken).not.toHaveBeenCalled();expect(gateway.sendMessage).not.toHaveBeenCalled();
    });
});
