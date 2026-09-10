import { EvaluationKnowledgeService } from './evaluation-knowledge.service';
import { evaluationKnowledgeFixture } from '../conversations/__fixtures__/evaluation-knowledge.fixture';
import { LLMSourceAuthorityUnavailable } from '../ai/interfaces/llm-source-authority';
import { reapKnowledgeReplicas } from './evaluation-knowledge-lifecycle';

jest.mock('../../common/utils/agent-source-fence', () => ({ withAgentSourceFence: (_p: any, _s: string, work: any) => work() }));
jest.mock('./evaluation-knowledge-lifecycle', () => ({ reapKnowledgeReplicas: jest.fn() }));
const tenantId='11111111-1111-4111-8111-111111111111', agentId='22222222-2222-4222-8222-222222222222';
function fixture() {
    const revisions={assertCurrent:jest.fn().mockResolvedValue(undefined)};
    const service=new EvaluationKnowledgeService({} as any,revisions as any);
    const snapshot:any={tenantId,agentId,manifest:{},structuredKnowledgeInputs:{sourceSchema:'tenant_test'},
        knowledgeInputs:evaluationKnowledgeFixture(tenantId,agentId)};
    const executable=jest.spyOn(service,'assertExecutable').mockResolvedValue(undefined);
    return {service,revisions,snapshot,executable};
}
describe('Evaluation knowledge service authority and cleanup orchestration',()=>{
    afterEach(()=>jest.clearAllMocks());
    it('preserves billed usage if nested source rejection and the outer postcheck both fail',async()=>{
        const f=fixture(),usage={promptTokens:31,completionTokens:7,totalTokens:38};
        const invoke=jest.fn(async()=>{f.executable.mockRejectedValue(new Error('lease revoked'));throw new LLMSourceAuthorityUnavailable(usage);});
        await expect(f.service.dataSourceAuthority(f.snapshot)(invoke)).rejects.toMatchObject({usage,message:'llm_source_authority_unavailable'});
        expect(invoke).toHaveBeenCalledTimes(1);
    });
    it('preserves an ordinary provider error only after validating sources again',async()=>{
        const f=fixture(),error=new Error('provider unavailable');
        await expect(f.service.dataSourceAuthority(f.snapshot)(async()=>{throw error;})).rejects.toBe(error);
        expect(f.executable).toHaveBeenCalledTimes(2);expect(f.revisions.assertCurrent).toHaveBeenCalledTimes(2);
    });
    it('discards response content after revocation while retaining its billed usage',async()=>{
        const f=fixture(),response={content:'private answer',usage:{promptTokens:23,completionTokens:5,totalTokens:28}};
        let thrown:any;
        try{await f.service.dataSourceAuthority(f.snapshot)(async()=>{f.executable.mockRejectedValue(new Error('revoked'));return response;},r=>r.usage);}
        catch(error){thrown=error;}
        expect(thrown).toBeInstanceOf(LLMSourceAuthorityUnavailable);expect(thrown.usage).toEqual(response.usage);
        expect(JSON.stringify(thrown)).not.toContain('private answer');
    });
    it('advances cleanup past reported failures and retains its cursor on a transport failure',async()=>{
        const f=fixture(),reap=reapKnowledgeReplicas as jest.Mock;
        reap.mockResolvedValue({nextCursor:null,failures:[]}).mockResolvedValueOnce({nextCursor:tenantId,failures:[{tenantId,code:'ambiguous_owner'}]})
            .mockRejectedValueOnce(new Error('database unavailable')).mockResolvedValueOnce({nextCursor:null,failures:[]});
        await f.service.reapExpired();await f.service.reapExpired();await f.service.reapExpired();await f.service.reapExpired();
        expect(reap.mock.calls.map(call=>call[1])).toEqual([
            {limit:100,afterTenantId:undefined},{limit:100,afterTenantId:tenantId},
            {limit:100,afterTenantId:tenantId},{limit:100,afterTenantId:undefined}]);
    });
});
