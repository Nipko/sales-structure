import { buildDomainContractDraft, composeSubtypeEvalPack } from '@parallext/shared';
import { resolveCanonicalEvalFixtures, bindCanonicalEvalFixtures } from '../simulation/eval-canonical-fixtures';
import { hasPositiveTaskAssertion } from '../simulation/task-competence-matrix';
import { canEvalExecuteWriter, EVAL_SANDBOX_CONTACT_ID, EVAL_WRITER_SANDBOX_FAMILIES } from '../conversations/agent-test-tool-policy';
import { CANONICAL_EVAL_TOOLS } from '../simulation/isolated-eval-namespace';
import { repairOrderTerms, repairRequestHash, repairActionErrorResult } from './repair-order-terms';

describe('Workshop template execution evidence',()=>{
    it.each(['es','en','pt','fr'] as const)('provides complete own-object tasks and bound negative probes in %s',language=>{
        const pack=composeSubtypeEvalPack({industry:'automotriz',subtype:'taller',language});
        const contract=buildDomainContractDraft('automotriz','taller');
        for(const key of ['open_repair_order','approve_repair_estimate','cancel_repair_order']) {
            const intent=contract.intents.find(value=>value.key===key)!;
            const complete=pack.find(value=>value.key===`intent_${key}_canonical_complete_v1`)!;
            expect(complete?.language).toBe(language);
            expect(hasPositiveTaskAssertion(intent.toolPlan,complete)).toBe(true);
        }
        const fixtures=resolveCanonicalEvalFixtures({capturedAt:'2026-09-07T12:00:00Z',config:{hours:{timezone:'America/Bogota',schedule:{}}}} as any);
        const bound=bindCanonicalEvalFixtures(pack,fixtures);
        expect(JSON.stringify(bound)).not.toContain('{{fixture.');
        const untouched=pack.find(value=>value.key==='intent_approve_repair_estimate_canonical_no_v1')!;
        expect(untouched.expectedActions).toEqual(expect.arrayContaining([expect.objectContaining({where:expect.objectContaining({approval_status:'pending'})})]));
        const generic=pack.find(value=>value.key==='intent_open_repair_order_happy_path')!;
        expect(generic.expectedActions).toEqual(expect.arrayContaining([expect.objectContaining({type:'no_row',where:{external_id:null}})]));
        expect(bound.filter(value=>/^intent_(open_repair_order|track_repair_order|approve_repair_estimate|cancel_repair_order)_canonical_/.test(value.key))).toHaveLength(13);
    });
    it('enables exactly the three audited workshop writers only with an owned canonical namespace',()=>{
        expect(EVAL_WRITER_SANDBOX_FAMILIES.repair_orders).toMatchObject({status:'audited',canonicalOnly:true});
        for(const tool of ['create_repair_order','approve_repair','cancel_repair_order']) {
            expect(CANONICAL_EVAL_TOOLS.has(tool)).toBe(true);
            expect(canEvalExecuteWriter(tool,EVAL_SANDBOX_CONTACT_ID)).toBe(false);
        }
    });
    it('invalidates consent when any material quote fact changes and does not expose arbitrary errors',()=>{
        const row={id:'repair',version:2,vehicle_id:'vehicle',make:'Mazda',model:'3',license_plate:'EVAL123',status:'awaiting_approval',estimate_amount_cents:12000,currency:'COP',estimate_line_items:[{description:'Inspection',quantity:1,unitAmountCents:12000}]};
        const original=repairRequestHash(repairOrderTerms(row,'estimate_decision'));
        for(const patch of [{version:3},{license_plate:'OTHER'},{estimate_amount_cents:24000},{currency:'USD'},{estimate_line_items:[]},{promised_at:'2026-10-01T12:00:00Z'}]) {
            expect(repairRequestHash(repairOrderTerms({...row,...patch},'estimate_decision'))).not.toBe(original);
        }
        expect(repairActionErrorResult(new Error('SELECT secret_customer_data FROM schema'))).toBeNull();
    });
});
