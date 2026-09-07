import { composeSubtypeEvalPack, CONVERSATIONAL_CHANNELS, EVAL_LANGUAGES, listCanonicalSubtypeExperienceProfileIds } from '@parallext/shared';
import { buildTaskCompetenceMatrix, hasPositiveTaskAssertion } from './task-competence-matrix';

describe('profile-specific competence coverage', () => {
    it('covers every canonical profile, channel and language without inheriting a certificate', () => {
        const matrix = buildTaskCompetenceMatrix();
        expect(matrix.profiles.map(profile => profile.profileId).sort()).toEqual(listCanonicalSubtypeExperienceProfileIds().sort());
        expect(matrix.summary.certifiedProfiles).toBe(0);
        for (const profile of matrix.profiles) {
            expect(profile.certification.certified).toBe(false);
            for (const task of profile.tasks) {
                expect(task.channelEvidence.map(row => row.channel)).toEqual(CONVERSATIONAL_CHANNELS);
                for (const channel of task.channelEvidence) {
                    expect(channel.languages.map(row => row.language)).toEqual(EVAL_LANGUAGES);
                    expect(channel.languages.every(row => row.result === 'not_run')).toBe(true);
                }
            }
        }
    });
    it('does not count a generic happy-path label with negative assertions as a positive task', () => {
        const profile = buildTaskCompetenceMatrix('salud/dental').profiles[0];
        const booking = profile.tasks.find(task => task.tools.some(tool => tool.name === 'create_appointment'))!;
        expect(booking.scenarios.every(scenario => scenario.negativeAssertions > 0)).toBe(true);
        expect(booking.scenarios.every(scenario => scenario.positiveAssertions > 0)).toBe(true);
        expect(booking.gaps).not.toContain('positive_task_case_missing');
        const generic = composeSubtypeEvalPack({ industry: 'salud', subtype: 'dental' }).find(scenario => scenario.key === 'intent_book_appointment_happy_path')!;
        expect(generic.expectedActions?.every(action => action.type === 'no_row' || action.type === 'not_called')).toBe(true);
        expect(booking.gaps).toContain('profile_execution_evidence_missing');
        const otherTasks = buildTaskCompetenceMatrix().profiles.flatMap(item => item.tasks);
        expect(otherTasks.filter(task => task.tools.some(tool => tool.name === 'place_catalog_order'))
            .every(task => task.gaps.includes('positive_task_case_missing'))).toBe(true);
    });
    it('shows workshop verification while its writer is still unavailable in preview', () => {
        const matrix = buildTaskCompetenceMatrix();
        const repair = matrix.profiles.flatMap(profile => profile.tasks).flatMap(task => task.tools).find(tool => tool.name === 'create_repair_order');
        expect(repair).toMatchObject({ registered: true, previewExecutable: false,
            effectVerifier: { table: 'repair_orders', ownershipColumn: 'contact_id' } });
    });
    it('does not count a preparatory booking as evidence that a cancellation task succeeded', () => {
        const pack = composeSubtypeEvalPack({ industry: 'salud', subtype: 'dental', language: 'en' });
        const handoff = pack.find(scenario => scenario.key === 'intent_cancel_appointment_canonical_handoff_v1')!;
        const complete = pack.find(scenario => scenario.key === 'intent_cancel_appointment_canonical_complete_v1')!;
        expect(hasPositiveTaskAssertion(['list_customer_appointments', 'cancel_appointment'], handoff)).toBe(false);
        expect(hasPositiveTaskAssertion(['list_customer_appointments', 'cancel_appointment'], complete)).toBe(true);
        expect(hasPositiveTaskAssertion(['cancel_appointment'], { expectedActions: [
            { kind: 'tool_call', type: 'called', tool: 'cancel_appointment' },
            { kind: 'db_effect', type: 'row_exists', family: 'enrollments', table: 'enrollments' },
        ] })).toBe(false);
        const cancellation = buildTaskCompetenceMatrix('salud/dental').profiles[0].tasks.find(task => task.key === 'cancel_appointment')!;
        expect(cancellation.scenarios.every(scenario => scenario.positiveAssertions === 2)).toBe(true);
    });
    it('rejects unknown profiles instead of falling back to another profile', () => {
        expect(() => buildTaskCompetenceMatrix('salud/unknown')).toThrow('canonical_profile_required');
    });
});
