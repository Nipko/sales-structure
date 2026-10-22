import { TraceService } from './trace.service';

describe('FAQ provenance within the persisted turn budget',()=>{
 it('retains a FAQ result after step twenty while keeping the hundred-step persistence bound',async()=>{
  const id='11111111-1111-4111-8111-111111111111';
  const steps=Array.from({length:105},(_,index)=>index===25
   ?{type:'tool_result',label:'search_faqs',metadata:{faqResultIds:[id],faqResultIdsComplete:true}}
   :{type:'decision',label:`synthetic-step-${index}`,metadata:{index}});
  const write=jest.fn().mockResolvedValue([]);
  const service=Object.assign(Object.create(TraceService.prototype),{prisma:{getTenantSchemaName:jest.fn().mockResolvedValue('tenant_synthetic'),executeInTenantSchema:write},ensureTables:jest.fn().mockResolvedValue(undefined),logger:{warn:jest.fn()}})as TraceService;
  await service.recordTurn({tenantId:'synthetic',conversationId:'synthetic-conversation',totalDurationMs:1,stepCount:steps.length,steps});
  expect(write).toHaveBeenCalledTimes(1);const params=write.mock.calls[0][2],stored=JSON.parse(params[4]);
  expect(params[3]).toBe(100);expect(stored).toHaveLength(100);expect(stored[25].metadata).toEqual({faqResultIds:[id],faqResultIdsComplete:true});
  expect(steps).toHaveLength(105);
 });
});
