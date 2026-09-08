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
            evaluationSourceAuthority:jest.fn(async()=>{throw new LLMSourceAuthorityUnavailable();})};
        return{provider,router,session,adapter:sessionLlmRouter(router as any,session as any)};
    };
    it('keeps a source denial visible when the real intent interpreter falls back locally',async()=>{
        const f=fixture();
        await new IntentInterpreterService(f.adapter).interpret('Necesito resolver una situación particular','idle',[], '2026-09-07',[],'tenant');
        expect(f.session.evaluationSourceAuthority).toHaveBeenCalledTimes(1);
        expect(f.provider).not.toHaveBeenCalled();expect(f.session.trace.error).toBe('llm_source_authority_unavailable');
    });
    it('uses one combined main-turn authority instead of nesting a second tenant transaction',async()=>{
        const f=fixture(),combined=jest.fn(async(invoke:any)=>invoke());
        await f.adapter.execute({task:'conversation',messages:[],withSourceAuthority:combined});
        expect(combined).toHaveBeenCalledTimes(1);expect(f.provider).toHaveBeenCalledTimes(1);
        expect(f.session.evaluationSourceAuthority).not.toHaveBeenCalled();
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
