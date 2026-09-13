import { AIToolExecutorService } from './ai-tool-executor.service';
import { authorityFor } from './__fixtures__/tool-authority.fixture';
import { AGENT_TEST_EXECUTION_CONTEXT, DRAFT_EXECUTION_CONTEXT } from '../../common/types/execution-context';
import { agentTestBlockedToolResult } from './agent-test-tool-policy';
import type { ServedAgentAuthority } from '../persona/served-agent-authority';

const tenantId='11111111-1111-4111-8111-111111111111',contactId='22222222-2222-4222-8222-222222222222';
const agentId='33333333-3333-4333-8333-333333333333',conversationId='44444444-4444-4444-8444-444444444444';
const schemaName='tenant_payment_executor';
const scope:ServedAgentAuthority={kind:'agent',tenantId,schemaName,agentId,version:7,operationalHash:'a'.repeat(64)};
const payable={paymentIntentId:'canonical-intent',canonicalReference:`order:${contactId}`,amountCents:10000,currency:'COP',description:'Canonical payable',paymentStatus:'pending'};
function fixture(){
    const payments={preparePaymentLink:jest.fn().mockResolvedValue({ok:true,payable}),
        createPaymentLink:jest.fn().mockResolvedValue({linkCreated:true,paymentStatus:'pending'}),
        confirmationRequiredResult:jest.fn((_payable,result)=>result)};
    const controls={preflight:jest.fn(async(_request:any)=>({allowed:true,ledgerId:'ledger',policy:{externalEffect:'provider'}})),
        complete:jest.fn(),fail:jest.fn().mockResolvedValue(undefined),
        proposeDraftAction:jest.fn().mockResolvedValue({allowed:false,result:{error:'confirmation_required',persisted:false}})};
    const executor=Object.create(AIToolExecutorService.prototype) as AIToolExecutorService;
    Object.assign(executor,{paymentOperations:payments,toolExecutionControl:controls,
        logger:{log:jest.fn(),warn:jest.fn(),error:jest.fn()},assertWritePreconditions:jest.fn().mockResolvedValue(null)});
    const run=(opts:Record<string,unknown>={},args:Record<string,unknown>={})=>executor.execute(schemaName,tenantId,contactId,'create_payment_link',
        {payableReference:payable.canonicalReference,...args},conversationId,{authority:authorityFor('create_payment_link'),...opts});
    return {payments,controls,run};
}
describe('payment executor uses private served revision metadata',()=>{
    it.each([undefined,{...scope,tenantId:contactId},{...scope,operationalHash:'invalid'}])('rejects absent or mismatched private scope even when the model supplies a valid one',async operationalScope=>{
        const {run,payments,controls}=fixture();
        expect(await run({operationalScope},{operationalScope:scope,operationalAuthority:scope})).toMatchObject({error:'agent_operational_authority_required',persisted:false});
        expect(payments.preparePaymentLink).not.toHaveBeenCalled();expect(payments.createPaymentLink).not.toHaveBeenCalled();
        expect(controls.preflight).not.toHaveBeenCalled();
    });
    it('passes the exact selected scope separately and replaces model payment terms before consent',async()=>{
        const {run,payments,controls}=fixture();
        expect(await run({operationalScope:scope},{operationalScope:{...scope,version:99},amountCents:1})).toMatchObject({linkCreated:true});
        expect(payments.createPaymentLink).toHaveBeenCalledWith(schemaName,tenantId,contactId,'ledger',payable,scope);
        expect(controls.preflight.mock.calls[0][0]).toMatchObject({operationalScope:scope,args:{amountCents:10000}});
        expect(controls.preflight.mock.calls[0][0].args.operationalScope).toBeUndefined();
    });
    it.each([AGENT_TEST_EXECUTION_CONTEXT,{mode:'evaluation',persistence:'disabled'}])('keeps preview/evaluation writes blocked before preparation or provider admission',async executionContext=>{
        const {run,payments,controls}=fixture();
        expect(await run({executionContext,evalMode:true})).toEqual(agentTestBlockedToolResult('create_payment_link'));
        expect(payments.preparePaymentLink).not.toHaveBeenCalled();expect(payments.createPaymentLink).not.toHaveBeenCalled();
        expect(controls.preflight).not.toHaveBeenCalled();
    });
    it('keeps draft payment proposals reviewable without admitting the provider effect',async()=>{
        const {run,payments,controls}=fixture();
        expect(await run({executionContext:DRAFT_EXECUTION_CONTEXT,draftScope:{agentId,agentVersion:7},operationalScope:scope})).toMatchObject({error:'confirmation_required',persisted:false});
        expect(controls.proposeDraftAction).toHaveBeenCalledWith(expect.objectContaining({draftMode:true,operationalScope:scope,
            args:expect.objectContaining({amountCents:10000})}));
        expect(payments.createPaymentLink).not.toHaveBeenCalled();expect(controls.preflight).not.toHaveBeenCalled();
    });
    it('preserves a central confirmation denial before money intent creation',async()=>{
        const {run,payments,controls}=fixture();
        controls.preflight.mockResolvedValueOnce({allowed:false,result:{error:'confirmation_required'}} as any);
        expect(await run({operationalScope:scope})).toMatchObject({error:'confirmation_required'});
        expect(payments.createPaymentLink).not.toHaveBeenCalled();
    });
});
