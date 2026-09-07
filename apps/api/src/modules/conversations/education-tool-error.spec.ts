import { AIToolExecutorService } from './ai-tool-executor.service';

describe('education tools do not expose internal errors', () => {
    it.each(['enrollStudentTool','cancelEnrollment'])('%s hides SQL, tenant schema and customer data',async(method)=>{
        const service: any=Object.create(AIToolExecutorService.prototype);
        service.educationService={enrollStudent:jest.fn().mockRejectedValue(new Error('constraint tenant_secret.email duplicate person@example.test password=private')),
            cancelEnrollment:jest.fn().mockRejectedValue(new Error('constraint tenant_secret.email duplicate person@example.test password=private'))};
        const result=await service[method]('tenant_private','contact',{});
        expect(result).toEqual({error:'enrollment_operation_failed',persisted:false});
    });
});
