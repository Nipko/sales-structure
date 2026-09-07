import { CONVERSATIONAL_CHANNELS, EVAL_LANGUAGES, listCanonicalSubtypeExperienceProfileIds } from '@parallext/shared';
import { buildTaskCompetenceMatrix } from './task-competence-matrix';

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
        expect(booking.scenarios.every(scenario => scenario.positiveAssertions === 0)).toBe(true);
        expect(booking.gaps).toContain('positive_task_case_missing');
    });
    it('shows workshop verification while its writer is still unavailable in preview', () => {
        const matrix = buildTaskCompetenceMatrix();
        const repair = matrix.profiles.flatMap(profile => profile.tasks).flatMap(task => task.tools).find(tool => tool.name === 'create_repair_order');
        expect(repair).toMatchObject({ registered: true, previewExecutable: false,
            effectVerifier: { table: 'repair_orders', ownershipColumn: 'contact_id' } });
    });
    it('rejects unknown profiles instead of falling back to another profile', () => {
        expect(() => buildTaskCompetenceMatrix('salud/unknown')).toThrow('canonical_profile_required');
    });
});
