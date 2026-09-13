import { buildDomainContractDraft, composeSubtypeEvalPack, EVAL_LANGUAGES, listCanonicalSubtypeExperienceProfileIds } from '@parallext/shared';
import { bindCanonicalEvalFixtures, resolveCanonicalEvalFixtures } from '../simulation/eval-canonical-fixtures';
import type { AgentEvaluationSnapshot } from '../conversations/agent-evaluation-snapshot';
import { buildTaskCompetenceMatrix, hasPositiveTaskAssertion } from '../simulation/task-competence-matrix';
import { CANONICAL_EVAL_TOOLS } from '../simulation/isolated-eval-namespace';
import { canEvalExecuteWriter, EVAL_SANDBOX_CONTACT_ID } from '../conversations/agent-test-tool-policy';
import { retainTaskDependencies } from '../conversations/tool-task-dependencies';

const fixtures=resolveCanonicalEvalFixtures({capturedAt:'2026-09-07T15:00:00Z',config:{hours:{timezone:'America/Bogota',schedule:{}}}} as AgentEvaluationSnapshot);

describe('canonical test-drive evaluation pack',()=>{
    it('covers only declared test-drive missions in every supported language',()=>{
        let profiles=0;
        for(const profileId of listCanonicalSubtypeExperienceProfileIds()){
            const [industry,subtype]=profileId.split('/');
            const intent=buildDomainContractDraft(industry,subtype).intents.find(item=>item.key==='schedule_test_drive');
            if(intent)profiles++;
            for(const language of EVAL_LANGUAGES){
                const cases=composeSubtypeEvalPack({industry,subtype,language}).filter(item=>item.key.startsWith('intent_schedule_test_drive_canonical_'));
                expect(cases).toHaveLength(intent?9:0);
                for(const scenario of cases){
                    expect(scenario.profileId).toBe(profileId);expect(scenario.language).toBe(language);
                    expect(scenario.messages.length).toBeLessThanOrEqual(8);
                    expect(JSON.stringify(bindCanonicalEvalFixtures(scenario,fixtures))).not.toContain('{{fixture.');
                }
                if(intent){
                    const complete=cases.find(item=>item.key.endsWith('_complete_v1'))!;
                    expect(hasPositiveTaskAssertion(intent.toolPlan,complete)).toBe(true);
                    for(const key of ['no','question'])expect(hasPositiveTaskAssertion(intent.toolPlan,cases.find(item=>item.key.endsWith(`_${key}_v1`))!)).toBe(false);
                }
            }
        }
        expect(profiles).toBeGreaterThan(0);
    });
    it('binds exact vehicle, accepted terms, staff and corrected time instead of any appointment',()=>{
        const matrix=buildTaskCompetenceMatrix();
        const profile=matrix.profiles.find(item=>item.tasks.some(task=>task.key==='schedule_test_drive'))!;
        const [industry,subtype]=profile.profileId.split('/');
        const pack=composeSubtypeEvalPack({industry,subtype,language:'en'}).map(item=>bindCanonicalEvalFixtures(item,fixtures));
        const correction=pack.find(item=>item.key==='intent_schedule_test_drive_canonical_correction_v1')!;
        expect(correction.expectedActions).toContainEqual(expect.objectContaining({kind:'db_effect',type:'row_exists',family:'appointments',table:'appointments',where:expect.objectContaining({
            vehicle_id:'00000000-0000-4000-8000-00000000b00b',vehicle_terms_id:'00000000-0000-4000-8000-00000000b00b',
            service_terms_id:'00000000-0000-4000-8000-00000000b001',assigned_to:'00000000-0000-4000-8000-00000000b010',start_at:'2026-09-09T09:30:00',status:'confirmed',
        })}));
        const cancel=pack.find(item=>item.key==='intent_schedule_test_drive_canonical_cancel_v1')!;
        expect(cancel.expectedActions).toContainEqual(expect.objectContaining({type:'row_count',count:1}));
        expect(cancel.expectedActions).toContainEqual({kind:'tool_call',type:'called',tool:'cancel_appointment'});
        expect(cancel.criteria).toContain('synthetic');
        expect(pack.find(item=>item.key==='intent_schedule_test_drive_canonical_pending_payment_v1')!.expectedActions)
            .toContainEqual(expect.objectContaining({type:'row_exists',where:expect.objectContaining({status:'pending_payment',payment_status:'pending',amount_due:2.5})}));
        const task=profile.tasks.find(item=>item.key==='schedule_test_drive')!;
        expect(task.gaps).not.toContain('positive_task_case_missing');expect(task.gaps).not.toContain('effect_verifier_missing');
        expect(task.gaps).toContain('profile_execution_evidence_missing');expect(profile.certification.certified).toBe(false);
    });
    it('requires a namespace and retains only authorized prerequisites when selecting the alias',()=>{
        expect(CANONICAL_EVAL_TOOLS.has('schedule_test_drive')).toBe(true);
        expect(canEvalExecuteWriter('schedule_test_drive',EVAL_SANDBOX_CONTACT_ID)).toBe(false);
        const names=['schedule_test_drive','search_vehicles','get_vehicle_details','list_services','check_availability'];
        const tools=names.map(name=>({name})) as any;
        expect(retainTaskDependencies([tools[0]],tools).map(tool=>tool.name)).toEqual(names);
        expect(retainTaskDependencies([tools[0]],tools.slice(0,2)).map(tool=>tool.name)).toEqual(names.slice(0,2));
    });
});
