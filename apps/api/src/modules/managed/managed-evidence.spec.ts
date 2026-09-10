import { ManagedService } from './managed.service';

describe('Managed outcome guarantees require operational evidence', () => {
    const tenantId='11111111-1111-4111-8111-111111111111';
    function harness(known: number, verified: number) {
        const prisma:any={
            getTenantSchemaName:async()=> 'tenant_managed',
            executeInTenantSchema:jest.fn(async (_schema:string,sql:string)=> sql.includes('COUNT(*)') ? [{closed:10,ai_resolved:10,ai_verified:verified,verified_known:known}] : []),
            tenant:{findUnique:async()=>({settings:{managed:{enabled:true,resolutionTargetPct:70}}}),
                findMany:async()=>[{id:tenantId,name:'Example',settings:{managed:{enabled:true}}}]},
        };
        return {service:new ManagedService(prisma),prisma};
    }
    it.each([0,9])('shows unknown, not zero or breach, when only %s of ten closed outcomes are verified',async (known)=>{
        const {service,prisma}=harness(known,known);
        const report=await service.getReport(tenantId);
        expect(report).toMatchObject({status:'unknown',deltaPct:null,resolution:{verifiedResolutionRate:null}});
        expect((await service.listManaged())[0]).toMatchObject({status:'unknown',deltaPct:null});
        const query=prisma.executeInTenantSchema.mock.calls.find((call:any[])=>call[1].includes('COUNT(*)'))[1];
        expect(query).toContain("resolution_verification_source = 'operational_evidence'");
    });
    it('uses a complete operational denominator when evidence is available',async ()=>{
        const {service}=harness(10,8);
        expect(await service.getReport(tenantId)).toMatchObject({status:'met',deltaPct:10,resolution:{verifiedResolutionRate:80}});
    });
});
