import { sessionLlmRouter } from './agent-turn-adapters';
import { AgentTurnTrace } from './agent-turn-session';
import { LLMSourceAuthorityUnavailable } from '../ai/interfaces/llm-source-authority';
import { IntentInterpreterService } from './intent-interpreter.service';
import { ConversationsService } from './conversations.service';

describe('Evaluation source authority on auxiliary model calls',()=>{
    const fixture=()=>{
        const provider=jest.fn(async()=>({content:'Model output'}));
        const router={execute:jest.fn(async(request:any)=>request.withSourceAuthority?request.withSourceAuthority(provider):provider())};
        const session={trace:new AgentTurnTrace(),executionContext:{persistence:'disabled'},learningEvaluationSource:{releaseId:'candidate'},
            evaluationSourceAuthority:jest.fn(async(_invoke:()=>Promise<any>):Promise<any>=>{throw new LLMSourceAuthorityUnavailable();})};
        return{provider,router,session,adapter:sessionLlmRouter(router as any,session as any)};
    };
    it('keeps a source denial visible when the real intent interpreter falls back locally',async()=>{
        const f=fixture();
        await new IntentInterpreterService(f.adapter).interpret('Necesito resolver una situación particular','idle',[], '2026-09-07',[],'tenant');
        expect(f.session.evaluationSourceAuthority).toHaveBeenCalledTimes(1);
        expect(f.provider).not.toHaveBeenCalled();expect(f.session.trace.error).toBe('llm_source_authority_unavailable');
    });
    it('keeps the mandatory evaluation checks around requested main-turn checks and the model response',async()=>{
        const f=fixture(),order:string[]=[];
        f.session.evaluationSourceAuthority.mockImplementation(async invoke=>{
            order.push('evaluation-before');
            const response=await invoke();
            order.push('evaluation-after');
            return response;
        });
        const requested=jest.fn(async(invoke:any)=>{
            order.push('requested-before');
            const response=await invoke();
            order.push('requested-after');
            return response;
        });
        f.provider.mockImplementation(async()=>{order.push('model');return{content:'Model output'};});

        await expect(f.adapter.execute({task:'conversation',messages:[],withSourceAuthority:requested}))
            .resolves.toMatchObject({content:'Model output'});
        expect(order).toEqual(['evaluation-before','requested-before','model','requested-after','evaluation-after']);
        expect(f.session.evaluationSourceAuthority).toHaveBeenCalledTimes(1);
        expect(requested).toHaveBeenCalledTimes(1);expect(f.provider).toHaveBeenCalledTimes(1);
    });
    it('does not let a requested main-turn authority bypass an evaluation denial',async()=>{
        const f=fixture(),requested=jest.fn(async(invoke:any)=>invoke());
        await expect(f.adapter.execute({task:'conversation',messages:[],withSourceAuthority:requested}))
            .rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
        expect(f.session.evaluationSourceAuthority).toHaveBeenCalledTimes(1);
        expect(requested).not.toHaveBeenCalled();expect(f.provider).not.toHaveBeenCalled();
        expect(f.session.trace.error).toBe('llm_source_authority_unavailable');
    });
    it('does not invoke the model when requested source checks reject an otherwise allowed evaluation',async()=>{
        const f=fixture();
        f.session.evaluationSourceAuthority.mockImplementation(async invoke=>invoke());
        const requested=jest.fn(async()=>{throw new LLMSourceAuthorityUnavailable();});
        await expect(f.adapter.execute({task:'conversation',messages:[],withSourceAuthority:requested}))
            .rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
        expect(f.session.evaluationSourceAuthority).toHaveBeenCalledTimes(1);
        expect(requested).toHaveBeenCalledTimes(1);expect(f.provider).not.toHaveBeenCalled();
        expect(f.session.trace.error).toBe('llm_source_authority_unavailable');
    });
    it('runs the same authority once when it is shared by the session and request',async()=>{
        const f=fixture();
        f.session.evaluationSourceAuthority.mockImplementation(async invoke=>invoke());
        await expect(f.adapter.execute({task:'conversation',messages:[],withSourceAuthority:f.session.evaluationSourceAuthority}))
            .resolves.toMatchObject({content:'Model output'});
        expect(f.session.evaluationSourceAuthority).toHaveBeenCalledTimes(1);
        expect(f.provider).toHaveBeenCalledTimes(1);
    });
    it('keeps a source denial visible when the real search rewriter returns the original query',async()=>{
        const f=fixture();
        const session={...f.session,history:[{role:'user',content:'Busco ayuda con un servicio'}]};
        const query=await (ConversationsService.prototype as any).rewriteSearchQuery.call({llmRouter:f.router,logger:{debug:jest.fn()}},
            '¿Cuánto cuesta ese?','tenant_test','conversation','tenant','CO',session);
        expect(query).toBe('¿Cuánto cuesta ese?');expect(f.session.evaluationSourceAuthority).toHaveBeenCalledTimes(1);
        expect(f.provider).not.toHaveBeenCalled();expect(session.trace.error).toBe('llm_source_authority_unavailable');
    });
    it('rejects an evaluator session if its internal authority is missing',async()=>{
        const f=fixture();delete (f.session as any).evaluationSourceAuthority;
        await expect(f.adapter.execute({task:'conversation',messages:[]})).rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
        expect(f.router.execute).not.toHaveBeenCalled();
    });
});
