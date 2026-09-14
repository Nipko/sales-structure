import { BillingAdminController } from './billing-admin.controller';
describe('superadmin catalogue edits',()=>{
    const updatedAt=new Date('2026-09-14T12:00:00Z');
    const existing={slug:'starter',name:'Starter',updatedAt,priceUsdCents:6900,features:{maxContacts:100},priceLocalOverrides:{},maxAgents:1,maxAiMessages:5000};
    function harness() {
        const tx:any={$queryRawUnsafe:jest.fn(),billingPlan:{findUnique:jest.fn().mockResolvedValue(existing),update:jest.fn(async({data}:any)=>({...existing,...data}))},auditLog:{create:jest.fn()}};
        const prisma:any={$transaction:jest.fn((fn:any)=>fn(tx))};
        const throttle:any={invalidatePlanCacheForSlug:jest.fn().mockResolvedValue(4)};
        const controller=new BillingAdminController({} as any,prisma,throttle,{} as any,{} as any,{} as any,{} as any);
        return {tx,throttle,controller};
    }
    it('rejects stale edit buffers before mutation',async()=>{
        const h=harness();await expect(h.controller.updatePlan('starter',{expectedUpdatedAt:'2026-09-13T12:00:00Z',maxAiMessages:0},{})).rejects.toMatchObject({status:409});
        expect(h.tx.billingPlan.update).not.toHaveBeenCalled();expect(h.throttle.invalidatePlanCacheForSlug).not.toHaveBeenCalled();
    });
    it('merges partial features and commits audit with the plan',async()=>{
        const h=harness();await h.controller.updatePlan('starter',{expectedUpdatedAt:updatedAt.toISOString(),features:{maxContacts:200}},{user:{id:'user'}});
        expect(h.tx.billingPlan.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({features:{maxContacts:200}})}));
        expect(h.tx.auditLog.create).toHaveBeenCalled();
    });
    it('does not report a successful database commit as a failed edit when cache is unavailable',async()=>{
        const h=harness();h.throttle.invalidatePlanCacheForSlug.mockRejectedValue(new Error('offline'));
        const result=await h.controller.updatePlan('starter',{expectedUpdatedAt:updatedAt.toISOString(),maxAiMessages:1000},{user:{id:'user'}});
        expect(result).toMatchObject({success:true,cacheInvalidationPending:true});
    });
});
