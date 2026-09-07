import { projectReleaseConfiguration, releaseReviewSubject } from './agent-release-review-subject';
import { releaseReviewEvidence } from './agent-release-contract';
import { evaluationSnapshot } from '../conversations/agent-evaluation-snapshot';
import { randomUUID } from 'crypto';

describe('frozen public release review subject', () => {
    const config = () => ({ persona: { name: 'Alex', role: 'Support', greeting: 'Welcome', personality: { tone: 'Warm', secret: 'PRIVATE' } },
        behavior: { rules: ['Use confirmed facts'], forbiddenTopics: ['Private data'], handoffTriggers: ['Human requested'],
            requiredFields: { booking: [{ field: 'name', question: 'Your name?', validation: 'nonempty', accessToken: 'PRIVATE' }] } },
        mission: { objective: 'Resolve support requests', intentKeys: ['ask_question'], successCriteria: ['Confirmed response'], handoffConditions: ['Unverified answer'] },
        tools: { appointments: { enabled: true, canBook: false, canCancel: true, apiKey: 'PRIVATE', provider: { password: 'PRIVATE' } },
            payments: { enabled: false, merchantSecret: 'PRIVATE' }, credentials: { enabled: true, token: 'PRIVATE' } },
        hours: { timezone: 'America/Bogota', schedule: { monday: '09:00-17:00', apiKey: 'PRIVATE' }, afterHoursMessage: 'We will reply tomorrow.' },
        llm: { provider: { apiKey: 'PRIVATE' }, pricing: { perToken: 'PRIVATE' } }, secret: 'PRIVATE' });
    it('preserves reviewable instructions and explicit tool limits without credentials, provider pricing or unknown tool families', () => {
        const fields = projectReleaseConfiguration(config());
        expect(fields).toEqual(expect.arrayContaining([{ key: 'objective', value: 'Resolve support requests' }, { key: 'monday', value: '09:00-17:00' },
            { key: 'toolsEnabled', value: ['appointments'] }, { key: 'toolPermissions', value: ['appointments.canBook: false', 'appointments.canCancel: true'] }]));
        expect(JSON.stringify(fields)).not.toContain('PRIVATE');
        expect(JSON.stringify(fields)).not.toContain('credentials');
        expect(fields.find(row => row.key === 'requiredInformation')?.value).toEqual(['booking · name · Your name? · nonempty']);
    });
    it('uses only the frozen baseline for comparison and does not mislabel the candidate hash as its baseline', () => {
        const snapshot = evaluationSnapshot(randomUUID(), randomUUID(), { version: 7, config_json: config() });
        snapshot.configurationRevisionId = randomUUID(); snapshot.configurationRevisionHash = 'a'.repeat(64);
        const absent = releaseReviewSubject(snapshot);
        expect(absent).toMatchObject({ configurationHash: 'a'.repeat(64), baseOperationalVersion: 7, baseOperationalHash: null, changes: null });
        snapshot.configurationBaseOperationalHash = 'b'.repeat(64);
        snapshot.configurationBaseOperationalBody = { name: 'Alex', configJson: config(), channels: [], channelBindings: [], isActive: true, isDefault: true, scheduleMode: '24_7' };
        snapshot.config.persona.greeting = 'Candidate greeting';
        expect(releaseReviewSubject(snapshot)).toMatchObject({ baseOperationalHash: 'b'.repeat(64),
            changes: [{ key: 'greeting', before: 'Welcome', after: 'Candidate greeting' }] });
        expect(snapshot.configurationBaseOperationalBody.configJson.persona.greeting).toBe('Welcome');
    });
    it('shows missing values explicitly and preserves free instructions and their invariants', () => {
        const fields = projectReleaseConfiguration({ ...config(), editorMode: 'prompt', customPrompt: 'My full instructions <user input>',
            persona: { name: 'Alex' }, behavior: { forbiddenTopics: ['Private data'] } });
        expect(fields).toContainEqual({ key: 'customPrompt', value: 'My full instructions <user input>' });
        expect(fields).toContainEqual({ key: 'forbiddenTopics', value: ['Private data'] });
        expect(fields).toContainEqual({ key: 'role', value: null });
        expect(fields).toContainEqual({ key: 'handoffTriggers', value: null });
    });
    it('binds the displayed subject and both sides of the comparison into the same evidence hash used for review', () => {
        const snapshot = evaluationSnapshot(randomUUID(), randomUUID(), { version: 7, config_json: config() });
        snapshot.configurationRevisionId = randomUUID(); snapshot.configurationRevisionHash = 'a'.repeat(64);
        const candidate = { id: randomUUID(), agent_id: snapshot.agentId, configuration_revision_id: snapshot.configurationRevisionId, channels: [], agent_snapshot: snapshot };
        const before = releaseReviewEvidence(candidate, []);
        snapshot.config.persona.greeting = 'Changed review subject';
        const changed = releaseReviewEvidence(candidate, []);
        expect(changed.evidenceHash).not.toBe(before.evidenceHash);
        expect(changed.subject.fields).toContainEqual({ key: 'greeting', value: 'Changed review subject' });
        snapshot.configurationBaseOperationalHash = 'b'.repeat(64);
        expect(releaseReviewEvidence(candidate, []).evidenceHash).not.toBe(changed.evidenceHash);
    });
});
