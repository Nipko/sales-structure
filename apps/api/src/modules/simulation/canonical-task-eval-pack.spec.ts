import { buildDomainContractDraft, composeSubtypeEvalPack, EVAL_LANGUAGES, listCanonicalSubtypeExperienceProfileIds } from '@parallext/shared';
import { bindCanonicalEvalFixtures, resolveCanonicalEvalFixtures } from './eval-canonical-fixtures';
import type { AgentEvaluationSnapshot } from '../conversations/agent-evaluation-snapshot';
import { buildTaskCompetenceMatrix } from './task-competence-matrix';

const supported = new Set(['book_appointment', 'cancel_appointment', 'book_class', 'enrol_student']);
const separatelyVerified = new Set(['open_repair_order','track_repair_order','approve_repair_estimate','cancel_repair_order','place_catalog_order','track_catalog_order','cancel_catalog_order','schedule_test_drive','register_pet']);
const fixture = resolveCanonicalEvalFixtures({ capturedAt: '2026-09-07T15:00:00Z', config: { hours: { timezone: 'America/Bogota', schedule: {} } } } as AgentEvaluationSnapshot);

describe('complete canonical task evaluation packs', () => {
    it('derives complete cases only from declared task families in all canonical profiles and languages', () => {
        let tasks = 0;
        for (const id of listCanonicalSubtypeExperienceProfileIds()) {
            const [industry, subtype] = id.split('/');
            const domain = buildDomainContractDraft(industry, subtype);
            for (const language of EVAL_LANGUAGES) {
                const pack = composeSubtypeEvalPack({ industry, subtype, language });
                for (const intent of domain.intents) {
                    const cases = pack.filter(scenario => scenario.key.startsWith(`intent_${intent.key}_canonical_`));
                    // Domain-specific object, price and pet-field assertions are
                    // verified by dedicated pack suites; they need no booking email.
                    if(separatelyVerified.has(intent.key)) {
                        expect(cases.length).toBeGreaterThan(0);
                        for(const scenario of cases) expect(JSON.stringify(bindCanonicalEvalFixtures(scenario,fixture))).not.toMatch(/\{\{fixture\.|2099/);
                        continue;
                    }
                    if (!supported.has(intent.key) || !intent.commits) { expect(cases).toEqual([]); continue; }
                    tasks++;
                    expect(cases.length).toBeGreaterThanOrEqual(3);
                    expect(cases.every(scenario => scenario.language === language && scenario.profileId === id)).toBe(true);
                    expect(cases.every(scenario => scenario.messages.length <= 8)).toBe(true);
                    for (const scenario of cases) {
                        const bound = bindCanonicalEvalFixtures(scenario, fixture);
                        expect(JSON.stringify(bound)).not.toMatch(/\{\{fixture\.|2099/);
                    }
                    const complete = cases.find(scenario => scenario.key.endsWith('_complete_v1'))!;
                    expect(complete.expectedActions).toEqual(expect.arrayContaining([
                        expect.objectContaining({ kind: 'tool_call', type: 'called' }),
                        expect.objectContaining({ kind: 'db_effect', type: 'row_count', count: 1 }),
                        expect.objectContaining({ kind: 'db_effect', type: 'row_exists' }),
                    ]));
                    expect(complete.messages.some(message => message.includes('{{fixture.customerEmail}}'))).toBe(true);
                }
            }
        }
        expect(tasks).toBeGreaterThan(4 * 3);
    });
    it('asserts the precise appointment slot, a single operation on replay, and a cancelled row on cancellation', () => {
        const pack = composeSubtypeEvalPack({ industry: 'salud', subtype: 'dental', language: 'en' });
        const scenario = (key: string) => bindCanonicalEvalFixtures(pack.find(item => item.key === key)!, fixture);
        const correction = scenario('intent_book_appointment_canonical_correction_v1');
        expect(correction.messages[2]).toContain('09:30');
        expect(correction.messages[2]).toContain('not 09:00');
        expect(correction.expectedActions).toContainEqual(expect.objectContaining({ type: 'row_exists', where: expect.objectContaining({ start_at: '2026-09-09T09:30:00', status: 'confirmed' }) }));
        const reschedule = scenario('intent_book_appointment_canonical_reschedule_v1');
        expect(reschedule.expectedActions).toContainEqual({ kind: 'tool_call', type: 'called', tool: 'reschedule_appointment' });
        const repeat = scenario('intent_book_appointment_canonical_repeat_v1');
        expect(repeat.expectedActions).toContainEqual({ kind: 'db_effect', type: 'row_count', family: 'appointments', table: 'appointments', count: 1 });
        const cancel = scenario('intent_cancel_appointment_canonical_complete_v1');
        expect(cancel.expectedActions).toContainEqual(expect.objectContaining({ type: 'row_exists', where: expect.objectContaining({ status: 'cancelled' }) }));
        expect(cancel.expectedActions).toContainEqual({ kind: 'tool_call', type: 'called', tool: 'cancel_appointment' });
    });
    it('checks ownership-bearing references and truthful pending payment, not just existence of any row', () => {
        const matrix = buildTaskCompetenceMatrix();
        for (const taskKey of ['book_class', 'enrol_student']) {
            const profile = matrix.profiles.find(item => item.tasks.some(task => task.key === taskKey))!;
            const [industry, subtype] = profile.profileId.split('/');
            const pack = composeSubtypeEvalPack({ industry, subtype, language: 'en' });
            const complete = bindCanonicalEvalFixtures(pack.find(item => item.key === `intent_${taskKey}_canonical_complete_v1`)!, fixture);
            const action = complete.expectedActions!.find(item => item.kind === 'db_effect' && item.type === 'row_exists')! as any;
            if (taskKey === 'book_class') expect(action.where).toMatchObject({ class_id: expect.any(String), member_id: expect.any(String), credits_used: 1, status: 'confirmed' });
            else expect(action.where).toMatchObject({ cohort_id: expect.any(String), course_id: expect.any(String), student_name: 'Alex Rivera', student_email: 'alex.rivera@example.invalid', payment_status: 'pending' });
            const recovery = pack.find(item => item.key === `intent_${taskKey}_canonical_recovery_v1`)!;
            expect(recovery.messages[0]).toContain(taskKey === 'book_class' ? '{{fixture.unavailableClassId}}' : '{{fixture.unavailableCohortId}}');
            expect(recovery.expectedActions).toContainEqual(expect.objectContaining({ type: 'row_count', count: 1 }));
        }
    });
    it('does not label an absence of writes as successful task or handoff execution', () => {
        const pack = composeSubtypeEvalPack({ industry: 'salud', subtype: 'dental', language: 'en' });
        const handoff = pack.find(item => item.key === 'intent_book_appointment_canonical_handoff_v1')!;
        expect(handoff.expectedActions).toEqual([
            { kind: 'tool_call', type: 'not_called', tool: 'create_appointment' },
            { kind: 'db_effect', type: 'no_row', family: 'appointments', table: 'appointments' },
        ]);
        expect(handoff.criteria).toContain('handoff requires its own evidence');
        const matrix = buildTaskCompetenceMatrix();
        expect(matrix.summary.tasksMissingPositiveCases).toBeGreaterThan(0);
        expect(matrix.summary.tasksMissingPositiveCases).toBeLessThan(matrix.summary.committingTasks);
        expect(matrix.summary.certifiedProfiles).toBe(0);
        expect(matrix.profiles.every(profile => profile.certification.evidence === 'not_loaded')).toBe(true);
    });
});
