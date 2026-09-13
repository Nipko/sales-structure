import { TenantThrottleService } from './tenant-throttle.service';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';

describe('evaluation entitlements use the authoritative revision',()=>{
    it('bypasses a stale plan/features cache without writing to it',async()=>{
        const prisma={tenant:{findUnique:jest.fn().mockResolvedValue({plan:'pro',settings:{}})},
            billingPlan:{findUnique:jest.fn().mockResolvedValue({features:{customerPayments:false},maxAgents:2,maxAiMessages:100})}};
        const redis={get:jest.fn().mockResolvedValue('enterprise'),getJson:jest.fn().mockResolvedValue({customerPayments:true}),set:jest.fn(),setJson:jest.fn()};
        const service=new TenantThrottleService(prisma as any,redis as any);
        expect(await service.getPlanFeatures('tenant',AGENT_TEST_EXECUTION_CONTEXT)).toMatchObject({customerPayments:false,maxAgents:2});
        expect(prisma.billingPlan.findUnique).toHaveBeenCalledWith(expect.objectContaining({where:{slug:'pro'}}));
        expect(redis.get).not.toHaveBeenCalled();expect(redis.getJson).not.toHaveBeenCalled();
        expect(redis.set).not.toHaveBeenCalled();expect(redis.setJson).not.toHaveBeenCalled();
    });
    it('does not invent a default plan when the authoritative dependency is unreadable',async()=>{
        const service=new TenantThrottleService({tenant:{findUnique:jest.fn().mockRejectedValue(new Error('db unavailable'))}} as any,{} as any);
        await expect(service.getTenantPlan('tenant',AGENT_TEST_EXECUTION_CONTEXT)).rejects.toThrow('db unavailable');
    });
});
