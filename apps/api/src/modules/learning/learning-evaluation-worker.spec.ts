import { LearningEvaluationProcessor } from './learning-evaluation.module';

describe('Learning queue failure belongs to its exact worker invocation',()=>{
    it('keeps a retryable failure running and marks only the last invocation as failed',async()=>{
        const error=new Error('provider unavailable'),evaluation={run:jest.fn().mockRejectedValue(error)},learning={failEvaluation:jest.fn()};
        const processor=new LearningEvaluationProcessor(evaluation as any,learning as any);
        const data={tenantId:'tenant',agentId:'agent',releaseId:'release',attemptId:'attempt'};
        await expect(processor.process({data,attemptsMade:0,opts:{attempts:2}} as any)).rejects.toBe(error);
        expect(learning.failEvaluation).not.toHaveBeenCalled();
        await expect(processor.process({data,attemptsMade:1,opts:{attempts:2}} as any)).rejects.toBe(error);
        const first=evaluation.run.mock.calls[0][1],last=evaluation.run.mock.calls[1][1];
        expect(first).not.toBe(last);
        expect(learning.failEvaluation).toHaveBeenCalledWith('tenant','agent','release','attempt',error.message,last);
        expect(Object.keys(data).sort()).toEqual(['agentId','attemptId','releaseId','tenantId']);
    });
    it('uses the old invocation token for a delayed error even when the same job object is reused',async()=>{
        let rejectOld!:(error:Error)=>void;
        const old=new Promise((_resolve,reject)=>{rejectOld=reject;});
        const evaluation={run:jest.fn().mockImplementationOnce(()=>old).mockResolvedValueOnce({passed:true})},learning={failEvaluation:jest.fn()};
        const processor=new LearningEvaluationProcessor(evaluation as any,learning as any);
        const job={data:{tenantId:'tenant',agentId:'agent',releaseId:'release',attemptId:'attempt'},attemptsMade:1,opts:{attempts:2}};
        const first=processor.process(job as any);const rejected=expect(first).rejects.toThrow('old process failed');
        expect(await processor.process(job as any)).toEqual({passed:true});
        rejectOld(new Error('old process failed'));await rejected;
        expect(learning.failEvaluation.mock.calls[0][5]).toBe(evaluation.run.mock.calls[0][1]);
        expect(learning.failEvaluation.mock.calls[0][5]).not.toBe(evaluation.run.mock.calls[1][1]);
    });
});
