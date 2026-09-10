import { buildDomainContractDraft, composeSubtypeEvalPack, EVAL_LANGUAGES, listCanonicalSubtypeExperienceProfileIds } from '@parallext/shared';
import { bindCanonicalEvalFixtures, resolveCanonicalEvalFixtures } from '../simulation/eval-canonical-fixtures';
import type { AgentEvaluationSnapshot } from '../conversations/agent-evaluation-snapshot';
import { buildTaskCompetenceMatrix, hasPositiveTaskAssertion } from '../simulation/task-competence-matrix';
import { CANONICAL_EVAL_TOOLS } from '../simulation/isolated-eval-namespace';
import { canEvalExecuteWriter, EVAL_SANDBOX_CONTACT_ID } from '../conversations/agent-test-tool-policy';
import { retainTaskDependencies } from '../conversations/tool-task-dependencies';
const fixture=resolveCanonicalEvalFixtures({capturedAt:'2026-09-07T15:00:00Z',config:{hours:{timezone:'America/Bogota',schedule:{}}}} as AgentEvaluationSnapshot);
describe('pet registration and correction competence pack',()=>{
    it('declares complete and adverse cases only for applicable profiles, in every supported language',()=>{
        let profiles=0;
        for(const profileId of listCanonicalSubtypeExperienceProfileIds()){
            const [industry,subtype]=profileId.split('/');
            const task=buildDomainContractDraft(industry,subtype).intents.find(item=>item.key==='register_pet');
            if(task)profiles++;
            for(const language of EVAL_LANGUAGES){
                const cases=composeSubtypeEvalPack({industry,subtype,language}).filter(item=>item.key.startsWith('intent_register_pet_canonical_'));
                expect(cases).toHaveLength(task?6:0);
                for(const scenario of cases){
                    expect(scenario.profileId).toBe(profileId);expect(scenario.language).toBe(language);
                    expect(JSON.stringify(bindCanonicalEvalFixtures(scenario,fixture))).not.toContain('{{fixture.');
                    expect(scenario.messages.length).toBeLessThanOrEqual(8);
                }
                if(task)for(const key of ['complete','repeat','update','missing_species','question','foreign_pet']){
                    expect(hasPositiveTaskAssertion(task.toolPlan,cases.find(item=>item.key.endsWith(`_${key}_v1`))!)).toBe(['complete','repeat','update'].includes(key));
                }
            }
        }
        expect(profiles).toBeGreaterThan(0);
    });
    it('keeps preview read-only and does not confuse declared effects with profile certification',()=>{
        const matrix=buildTaskCompetenceMatrix();
        for(const profile of matrix.profiles)for(const task of profile.tasks.filter(item=>item.key==='register_pet')){
            expect(task.gaps).not.toContain('positive_task_case_missing');expect(task.gaps).not.toContain('effect_verifier_missing');
            expect(task.gaps).toContain('profile_execution_evidence_missing');expect(profile.certification.certified).toBe(false);
        }
        for(const name of ['register_pet','update_pet']){
            expect(CANONICAL_EVAL_TOOLS.has(name)).toBe(true);
            expect(canEvalExecuteWriter(name,EVAL_SANDBOX_CONTACT_ID)).toBe(false);
            const tools=[{name},{name:'list_pets_for_contact'}] as any;
            expect(retainTaskDependencies([tools[0]],tools).map(tool=>tool.name)).toEqual([name,'list_pets_for_contact']);
        }
    });
});
