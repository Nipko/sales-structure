import {
    AGENT_CHANGE_MODES, AGENT_ISSUE_RESOLUTIONS, agentIssueResolutionDefects, issueResolutionControl,
    resolutionForIssueCode,
} from '@parallext/shared';

/**
 * The answer to `agent_active` depends on how the tenant applies changes.
 *
 * Audit #62 (sep-2026): the table resolved it with the publication tour for
 * everyone, so a tenant in the default, immediate mode — whose editor shows no
 * draft, candidate or publication screen at all — was walked through all of
 * them to turn on an agent that one switch turns on. The row now says both
 * answers, and every caller that does not know the mode gets the default one.
 */
describe('agent_active resolves in the tenant\'s change mode', () => {
    it('is the switch in immediate mode, and that is what a caller without a mode gets', () => {
        for (const code of ['agent_active', 'fix_agent_active']) {
            expect(resolutionForIssueCode(code, 'immediate')).toMatchObject({ clears: 'closes', tourId: 'publish_agent_revision' });
            expect(resolutionForIssueCode(code)).toEqual(resolutionForIssueCode(code, 'immediate'));
            expect(issueResolutionControl(code)).toBe('agent_switch');
        }
        expect(resolutionForIssueCode('agent_active')!.note).toMatch(/switch/);
        expect(resolutionForIssueCode('agent_active')!.note).not.toMatch(/draft|publish/i);
    });

    it('is the publication in reviewed mode, which a person still has to do', () => {
        const reviewed = resolutionForIssueCode('agent_active', 'reviewed')!;
        expect(reviewed).toMatchObject({ clears: 'needs_person', tourId: 'publish_agent_revision' });
        expect(reviewed.note).toMatch(/publish/);
        expect(issueResolutionControl('agent_active', 'reviewed')).toBe('agent_publication');
    });

    it('leaves every code that does not depend on the mode exactly as it was', () => {
        for (const row of AGENT_ISSUE_RESOLUTIONS.filter(candidate => !candidate.byMode)) {
            for (const mode of AGENT_CHANGE_MODES) expect(resolutionForIssueCode(row.code, mode)).toBe(row);
            expect(issueResolutionControl(row.code)).toBeNull();
        }
    });

    it('refuses a mode-dependent row whose default disagrees with its immediate answer', () => {
        // The check this relies on, proven on a doctored copy rather than trusted.
        const doctor = (patch: Record<string, unknown>) => AGENT_ISSUE_RESOLUTIONS
            .map(row => (row.code === 'agent_active' ? { ...row, ...patch } : row)) as typeof AGENT_ISSUE_RESOLUTIONS;
        expect(agentIssueResolutionDefects(doctor({ clears: 'needs_person', note: 'Publish it.' })))
            .toContain('agent_active: the row disagrees with byMode.immediate, the default mode');
        const sameControl = doctor({ byMode: {
            immediate: { control: 'agent_switch', clears: 'closes', note: resolutionForIssueCode('agent_active')!.note },
            reviewed: { control: 'agent_switch', clears: 'needs_person' },
        } });
        expect(agentIssueResolutionDefects(sameControl)).toEqual(expect.arrayContaining([
            'agent_active: byMode.reviewed needs_person without saying what is left to do',
            'agent_active: byMode names the same control in both modes; drop byMode',
        ]));
        expect(agentIssueResolutionDefects()).toEqual([]);
    });
});
