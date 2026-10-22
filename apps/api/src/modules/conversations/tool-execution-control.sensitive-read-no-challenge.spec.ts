import { ToolExecutionControlService } from './tool-execution-control.service';
const tenantId='11111111-1111-4111-8111-111111111111',contactId='22222222-2222-4222-8222-222222222222',conversationId='33333333-3333-4333-8333-333333333333';
function harness(verified=false){
 const prisma={tenant:{findUnique:jest.fn()},$queryRawUnsafe:jest.fn(),$executeRawUnsafe:jest.fn()};
 const identity={isVerified:jest.fn().mockResolvedValue(verified),startVerification:jest.fn()};
 const guard=new ToolExecutionControlService(prisma as any,{get:()=> 'synthetic-unit-signing-secret-at-least-32-bytes'} as any,identity as any,{} as any);
 const call=(toolName:string,extra:Record<string,unknown>={})=>guard.preflight({schemaName:'tenant_synthetic',tenantId,contactId,conversationId,channelType:'telegram',toolName,args:toolName==='get_check_in_instructions'?{propertyId:'44444444-4444-4444-8444-444444444444'}:{},identityChallenge:'none',...extra} as any);
 const noSideEffects=()=>{expect(identity.startVerification).not.toHaveBeenCalled();expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();};return {call,identity,noSideEffects};
}
describe('A2QA03 health read gate without sending a code',()=>{
 it.each(['get_treatment_plan','list_upcoming_sessions'])('unverified %s remains denied and does not invent an empty clinical record',async tool=>{
  const h=harness();const d:any=await h.call(tool);expect(d.allowed).toBe(false);expect(d.result).toMatchObject({error:'identity_verification_required',needsVerification:true,challengeSent:false});expect(d.result).not.toHaveProperty('hasPlan');expect(d.result).not.toHaveProperty('upcomingSessions');h.noSideEffects();expect(h.identity.isVerified).toHaveBeenCalledWith(conversationId,contactId);
 });
 it('verified treatment-plan identity passes only the A2 guard, not the domain read',async()=>{
  const h=harness(true);const d:any=await h.call('get_treatment_plan');expect(d.allowed).toBe(true);expect(d.policy).toMatchObject({effect:'read',assurance:'A2',assuranceEnforcement:'step_up'});expect(d).not.toHaveProperty('plan');h.noSideEffects();
 });
});
describe('A2QA09 physical-access gate without sending a code',()=>{
 it('unverified access read denies without an address or access code',async()=>{
  const h=harness();const d:any=await h.call('get_check_in_instructions');expect(d.allowed).toBe(false);expect(d.result).toMatchObject({error:'identity_verification_required',challengeSent:false});expect(d.result).not.toHaveProperty('address');expect(d.result).not.toHaveProperty('checkInInstructions');h.noSideEffects();
 });
 it('verified identity passes only the guard and does not certify an eligible stay',async()=>{
  const h=harness(true);const d:any=await h.call('get_check_in_instructions');expect(d.allowed).toBe(true);expect(d.policy).toMatchObject({effect:'read',assurance:'A2',ownership:'resource_owner'});expect(d).not.toHaveProperty('address');expect(d).not.toHaveProperty('checkInInstructions');h.noSideEffects();
 });
 it('missing conversation remains denied even with a verified identity stub',async()=>{
  const h=harness(true);const d:any=await h.call('get_check_in_instructions',{conversationId:undefined});expect(d.allowed).toBe(false);expect(d.result.error).toBe('identity_context_required');expect(h.identity.isVerified).not.toHaveBeenCalled();h.noSideEffects();
 });
});
