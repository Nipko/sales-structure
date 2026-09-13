import { buildDomainContractDraft, composeSubtypeEvalPack } from '@parallext/shared';
import { resolveCanonicalEvalFixtures, bindCanonicalEvalFixtures } from '../simulation/eval-canonical-fixtures';
import { hasPositiveTaskAssertion } from '../simulation/task-competence-matrix';
import { canEvalExecuteWriter,EVAL_SANDBOX_CONTACT_ID,EVAL_WRITER_SANDBOX_FAMILIES } from '../conversations/agent-test-tool-policy';
import { CANONICAL_EVAL_TOOLS } from '../simulation/isolated-eval-namespace';

describe('Catalog template task evidence',()=>{
    it.each(['es','en','pt','fr'] as const)('provides bound positive and negative catalog tasks in %s',language=>{
        const contract=buildDomainContractDraft('salud','farmacia');
        const pack=composeSubtypeEvalPack({industry:'salud',subtype:'farmacia',language});
        for(const key of ['place_catalog_order','cancel_catalog_order']) {
            const intent=contract.intents.find(value=>value.key===key)!;
            const complete=pack.find(value=>value.key===`intent_${key}_canonical_complete_v1`)!;
            expect(complete?.language).toBe(language);expect(hasPositiveTaskAssertion(intent.toolPlan,complete)).toBe(true);
        }
        const fixtures=resolveCanonicalEvalFixtures({capturedAt:'2026-09-07T12:00:00Z',config:{hours:{timezone:'America/Bogota',schedule:{}}}} as any);
        const bound=bindCanonicalEvalFixtures(pack,fixtures);
        expect(JSON.stringify(bound)).not.toContain('{{fixture.');
        expect(bound.filter(value=>/^intent_(place_catalog_order|track_catalog_order|cancel_catalog_order)_canonical_/.test(value.key))).toHaveLength(13);
        for(const suffix of ['no','question','stock','prescription']) {
            const scenario=pack.find(value=>value.key===`intent_place_catalog_order_canonical_${suffix}_v1`)!;
            expect(scenario.expectedActions).toContainEqual(expect.objectContaining({type:'row_count',count:0,where:{notes:'[EVAL] new order'}}));
        }
        expect(pack.find(value=>value.key==='intent_cancel_catalog_order_canonical_paid_v1')!.expectedActions)
            .toContainEqual(expect.objectContaining({where:expect.objectContaining({status:'confirmed',payment_status:'paid'})}));
    });
    it('enables only canonical catalog writers with an owned namespace',()=>{
        expect(EVAL_WRITER_SANDBOX_FAMILIES.catalog_orders).toMatchObject({status:'audited',canonicalOnly:true,verifierAudited:true});
        for(const name of ['place_catalog_order','cancel_catalog_order']) {
            expect(CANONICAL_EVAL_TOOLS.has(name)).toBe(true);expect(canEvalExecuteWriter(name,EVAL_SANDBOX_CONTACT_ID)).toBe(false);
        }
    });
});
