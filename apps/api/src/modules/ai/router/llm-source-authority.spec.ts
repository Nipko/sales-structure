import { LLMRouterService } from './llm-router.service';
import { LLMSourceAuthorityUnavailable } from '../interfaces/llm-source-authority';
import type { LLMResponse } from '../interfaces/illm-provider.interface';

const answer:LLMResponse={content:'private discarded answer',finishReason:'stop',usage:{promptTokens:12,completionTokens:4,totalTokens:16}};
function fixture(){
    const providers=['openai','deepseek'].map(providerName=>({providerName,generate:jest.fn(async(_request:any)=>answer)}));
    const events={emit:jest.fn()},redis={get:jest.fn(async()=>null),set:jest.fn(),acquireLock:jest.fn(async()=>true)};
    const router=new LLMRouterService(providers as any,redis as any,{isConfigured:async()=>true} as any,events as any);
    const models=providers.map((p,index)=>({id:index?'deepseek-chat':'gpt-4o-mini',provider:p.providerName,tier:'tier_2_standard',
        costPer1kTokens:.01,costInPer1k:.01,costOutPer1k:.01,maxContextTokens:128000,supportsTools:true}));
    jest.spyOn(router as any,'buildCandidates').mockResolvedValue(models);
    const stats=jest.spyOn(router as any,'trackStats').mockResolvedValue(undefined);
    const breaker=jest.spyOn(router as any,'markProviderFailure').mockResolvedValue(undefined);
    return{router,providers,events,stats,breaker};
}
describe('LLM source authority applies to every provider attempt',()=>{
    it.each(['task','direct'])('stops %s dispatch before a revoked source reaches any provider',async mode=>{
        const {router,providers,stats,breaker,events}=fixture();
        const withSourceAuthority=jest.fn(async()=>{throw new LLMSourceAuthorityUnavailable();});
        await expect(router.execute({messages:[],...(mode==='task'?{task:'conversation' as const}:{model:'gpt-4o-mini'}),withSourceAuthority}))
            .rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
        expect(providers.every(p=>p.generate.mock.calls.length===0)).toBe(true);
        expect(stats).not.toHaveBeenCalled();expect(breaker).not.toHaveBeenCalled();expect(events.emit).not.toHaveBeenCalled();
    });
    it.each(['task','direct'])('accounts for a discarded %s response without traces, provider failure or failover',async mode=>{
        const {router,providers,stats,breaker,events}=fixture();
        const withSourceAuthority=async(invoke:()=>Promise<LLMResponse>)=>{const response=await invoke();throw new LLMSourceAuthorityUnavailable(response.usage);};
        await expect(router.execute({messages:[],...(mode==='task'?{task:'conversation' as const}:{model:'gpt-4o-mini'}),withSourceAuthority}))
            .rejects.toMatchObject({usage:answer.usage});
        expect(providers[0].generate).toHaveBeenCalledTimes(1);expect(providers[1].generate).not.toHaveBeenCalled();
        expect(providers[0].generate.mock.calls[0][0]).not.toHaveProperty('withSourceAuthority');
        expect(stats).toHaveBeenCalledTimes(1);expect(stats.mock.calls[0][3]).toEqual(answer.usage);expect(stats.mock.calls[0][4]).toBe(false);
        expect(breaker).not.toHaveBeenCalled();expect(events.emit).not.toHaveBeenCalled();
    });
    it('checks the authority again before failover after an ordinary provider error',async()=>{
        const {router,providers,breaker}=fixture();
        providers[0].generate.mockRejectedValueOnce(new Error('provider outage'));
        let attempt=0;
        const withSourceAuthority=jest.fn(async(invoke:()=>Promise<LLMResponse>)=>{
            if(++attempt===2)throw new LLMSourceAuthorityUnavailable();
            return invoke();
        });
        await expect(router.execute({task:'conversation',messages:[],withSourceAuthority})).rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
        expect(withSourceAuthority).toHaveBeenCalledTimes(2);expect(providers[1].generate).not.toHaveBeenCalled();
        expect(breaker).toHaveBeenCalledTimes(1);
    });
    it('preserves normal fallback when both attempts have valid source authority',async()=>{
        const {router,providers}=fixture();providers[0].generate.mockRejectedValueOnce(new Error('provider outage'));
        const withSourceAuthority=jest.fn(async(invoke:()=>Promise<LLMResponse>)=>invoke());
        expect((await router.execute({task:'conversation',messages:[],withSourceAuthority})).content).toBe(answer.content);
        expect(withSourceAuthority).toHaveBeenCalledTimes(2);expect(providers[1].generate).toHaveBeenCalledTimes(1);
    });
});
