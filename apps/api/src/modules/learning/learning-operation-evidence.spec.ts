import { captureLearningLedger,learningResultHash,verifyLearningOperation,type LearningOperationScope } from './learning-operation-evidence';
const tenantId='11111111-1111-4111-8111-111111111111',contactId='00000000-0000-4000-8000-00000000eba1';
const objectId='22222222-2222-4222-8222-222222222222',ledgerId='33333333-3333-4333-8333-333333333333';
function setup(){
    const result={success:true,order:{id:objectId,status:'pending',paymentStatus:'pending',currency:'COP',totalAmount:20,totalAmountCents:'2000',version:1}};
    const scope:LearningOperationScope={tenantId,contactId,conversationId:'44444444-4444-4444-8444-444444444444',
        namespace:{schemaName:'tenant_eval_11111111_aaaaaaaaaaaaaaaaaaaaaaaa',sourceSchema:'tenant_source',tenantId,token:ledgerId,expiresAt:'2099-01-01',tables:[]},assertLease:jest.fn().mockResolvedValue(undefined)};
    const ledger={id:ledgerId,tool_name:'place_catalog_order',args_hash:'a'.repeat(64),response_payload:result};
    const object={id:objectId,contact_id:contactId,status:'pending',payment_status:'pending',currency:'COP',total_amount:'20.00',version:1};
    const state={ledgers:[ledger],objects:[{hash:'object-digest',data:object}]};
    const prisma={executeInTenantSchema:jest.fn(async(schema:string,sql:string)=>{
        if(schema!==scope.namespace!.schemaName)throw new Error('wrong_schema');
        if(sql.includes('to_regclass'))return [{relation:'exists'}];
        if(sql.includes('FROM tool_execution_ledger'))return state.ledgers;
        return state.objects;
    })};
    return {scope,result,state,prisma:prisma as any,call:{name:'place_catalog_order',result}};
}
describe('Learning operation evidence does not equate table deltas with success',()=>{
    it('accepts a valid idempotent replay with the same exact ledger and owned object',async()=>{
        const f=setup(),before=await captureLearningLedger(f.prisma,f.scope);
        const proof=await verifyLearningOperation(f.prisma,f.scope,{...f.call,result:{...f.result,idempotentReplay:true}},before);
        expect(proof).toMatchObject({status:'verified',effect:'replayed',objectId,ledgerId});
        expect(proof.resultHash).toBe(learningResultHash(f.result));
    });
    it('requires exact result and object evidence even if some unrelated row changed',async()=>{
        const f=setup();f.state.objects=[];
        expect(await verifyLearningOperation(f.prisma,f.scope,f.call,{available:true,entries:{}})).toMatchObject({status:'unverified',reason:'owned_object_missing'});
        f.state.ledgers=[];expect(await verifyLearningOperation(f.prisma,f.scope,f.call,{available:true,entries:{}})).toMatchObject({status:'unverified',reason:'ledger_result_missing'});
    });
    it('does not bind a different amount or failed ledger to a successful response',async()=>{
        const f=setup();f.state.objects[0].data.total_amount='30.00';
        expect(await verifyLearningOperation(f.prisma,f.scope,f.call,{available:true,entries:{}})).toMatchObject({status:'unverified',reason:'object_amount_mismatch'});
        f.state.ledgers[0].response_payload={...f.result,order:{...f.result.order,totalAmount:30}};
        expect(await verifyLearningOperation(f.prisma,f.scope,f.call,{available:true,entries:{}})).toMatchObject({status:'unverified',reason:'ledger_result_missing'});
    });
    it('reports unknown evidence for unreviewed writers and never rewards mere success text',async()=>{
        const f=setup();
        expect(await verifyLearningOperation(f.prisma,f.scope,{name:'send_product_image',result:{success:true}},{available:true,entries:{}})).toMatchObject({status:'unverified',reason:'verifier_unavailable'});
        expect(await verifyLearningOperation(f.prisma,f.scope,{name:'place_catalog_order',result:{success:true}},{available:true,entries:{}})).toMatchObject({status:'unverified',reason:'object_reference_missing'});
        expect(f.prisma.executeInTenantSchema).not.toHaveBeenCalled();
    });
    it('does not turn a refusal or a read into an operational claim',async()=>{
        const f=setup();for(const call of [{name:'place_catalog_order',result:{error:'confirmation_required'}},{name:'get_catalog_order',result:f.result}])
            expect(await verifyLearningOperation(f.prisma,f.scope,call,{available:true,entries:{}})).toEqual({status:'not_applicable'});
    });
    it('keeps missing writer results unknown and rejects inconsistent target references',async()=>{
        const f=setup(),before={available:true,entries:{}};
        expect(await verifyLearningOperation(f.prisma,f.scope,{name:'place_catalog_order'},before))
            .toMatchObject({status:'unverified',reason:'result_unavailable'});
        expect(await verifyLearningOperation(f.prisma,f.scope,{...f.call,result:{...f.result,activeObject:{kind:'order',id:ledgerId}}},before))
            .toMatchObject({status:'unverified',reason:'object_reference_mismatch'});
        expect(f.prisma.executeInTenantSchema).not.toHaveBeenCalled();
    });
    it('requires the cancellation state and refuses an altered historical request hash',async()=>{
        const f=setup(),before=await captureLearningLedger(f.prisma,f.scope);
        f.state.ledgers[0].args_hash='b'.repeat(64);
        expect(await verifyLearningOperation(f.prisma,f.scope,f.call,before)).toMatchObject({status:'unverified',reason:'ledger_changed'});
        f.state.ledgers[0].tool_name='cancel_catalog_order';
        expect(await verifyLearningOperation(f.prisma,f.scope,{...f.call,name:'cancel_catalog_order'},{available:true,entries:{}}))
            .toMatchObject({status:'unverified',reason:'object_state_mismatch'});
    });
    it('rejects a lost or mismatched namespace before reading any evidence',async()=>{
        const f=setup();await expect(captureLearningLedger(f.prisma,{...f.scope,tenantId:objectId})).rejects.toThrow('learning_evidence_namespace_required');
        expect(f.prisma.executeInTenantSchema).not.toHaveBeenCalled();
    });
});
