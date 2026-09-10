import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AgentConfigurationWorkspace } from '@parallext/shared';
import { AgentReleaseReview, AgentReleaseSubject } from './AgentReleaseReview';
import { canReviewRelease, emptyReleaseReviewChecks, prepareReleaseRequest, prepareReleaseReview, releaseErrorKind,
    type AgentReleaseDetail } from '@/lib/agent-release-review';

let mockLocale = 'es';
const mockMessages: Record<string, any> = Object.fromEntries(['es', 'en', 'pt', 'fr'].map(locale => [locale, require(`../../../messages/${locale}.json`)]));
jest.mock('next-intl', () => ({ useTranslations: (namespace: string) => {
    const lookup = (key: string) => `${namespace}.${key}`.split('.').reduce((node: any, part) => node?.[part], mockMessages[mockLocale]);
    const t = (key: string, values?: Record<string, unknown>) => {
        if (typeof lookup(key) !== 'string') throw new Error(`Missing release translation: ${mockLocale}.${namespace}.${key}`);
        return lookup(key).replace(/\{(\w+)\}/g, (_match: string, name: string) => String(values?.[name] ?? name));
    };
    t.has = (key: string) => typeof lookup(key) === 'string'; return t;
} }));
const allChecks = () => ({ objective: true, instructions: true, facts: true, tools: true, style: true, limits: true });
const candidate = (): AgentReleaseDetail => ({ id: 'candidate', agentId: 'agent', configurationRevisionId: 'draft', status: 'evaluated', version: 4,
    revisionState: 'current', channels: ['web_widget'], createdAt: '2026-09-07T12:00:00.000Z', error: null, activationAllowed: false, certified: false,
    evaluations: [{ id: 'evaluation', channel: 'web_widget', status: 'completed', attempts: 1, completedScenarios: 10, error: null, nextAttemptAt: null, runId: 'run' }],
    review: { evidenceHash: 'a'.repeat(64), configurationHash: 'b'.repeat(64), dependencyRevision: 'c'.repeat(64), eligibleForReview: true,
        operationChecks: [{ channel: 'web_widget', language: 'es', scenario: 'required-case', assertion: 'row_exists', family: 'appointments', tool: null,
            required: 3, passed: 3, failed: 0, unknown: 0, status: 'verified' }],
        readiness: { requiredCases: 10, verifiedCases: 10, eligibleForReview: true, gaps: [] }, sampleHashes: ['d'.repeat(64)],
        subject: { version: 1, configurationRevisionId: 'draft', configurationHash: 'b'.repeat(64), baseOperationalVersion: 7, baseOperationalHash: 'e'.repeat(64),
            fields: [{ key: 'greeting', value: 'Captured greeting' }, { key: 'toolsEnabled', value: ['appointments'] }, { key: 'rules', value: ['Use confirmed facts'] }],
            baseFields: [{ key: 'greeting', value: 'Before greeting' }], changes: [{ key: 'greeting', before: 'Before greeting', after: 'Captured greeting' }] },
        samples: [{ hash: 'd'.repeat(64), channel: 'web_widget', language: 'es', scenario: 'required-case', transcript: [{ role: 'user', content: 'Test question' }, { role: 'assistant', content: '<script>unsafe()</script> Actual generated reply' }] }] } });
const workspace = (): AgentConfigurationWorkspace => ({ agentId: 'agent', operational: { version: 7, hash: 'a'.repeat(64), body: {} as any },
    draft: { id: 'draft', currentBase: true } as any, evaluationRevisionId: 'draft' });

describe('reviewing release evidence without publishing', () => {
    beforeEach(() => { mockLocale = 'es'; });
    it.each(['es', 'en', 'pt', 'fr'])('renders real samples, source fields, scoped counts and explicit unchecked decisions in %s', locale => {
        mockLocale = locale;
        const html = renderToStaticMarkup(createElement(AgentReleaseReview, { candidate: candidate(), role: 'tenant_admin', busy: false, decide: async () => {} }));
        const t = mockMessages[locale].agentReleases;
        expect(html).toContain(t.reviewDoesNotPublish); expect(html).toContain('Captured greeting'); expect(html).toContain('Before greeting');
        expect(html).toContain('Actual generated reply'); expect(html).not.toContain('<script>'); expect(html).toContain('&lt;script&gt;');
        expect(html).toContain(t.caseCoverage.replace('{verified}', '10').replace('{required}', '10'));
        expect(html).toContain(t.checks.tools); expect(html).toContain(t.approve); expect(html).not.toContain(' checked=');
        expect(html).not.toContain('>Publicar<');
    });
    it.each(['changed', 'unavailable', 'invalidated'] as const)('withholds all old review material when the revision is %s', revisionState => {
        const data = candidate(); data.revisionState = revisionState;
        const html = renderToStaticMarkup(createElement(AgentReleaseReview, { candidate: data, role: 'tenant_admin', busy: false, decide: async () => {} }));
        expect(html).not.toContain('Captured greeting'); expect(html).not.toContain('Actual generated reply'); expect(html).not.toContain('type="checkbox"');
        expect(html).not.toContain(mockMessages.es.agentReleases.approve);
    });
    it.each(['tenant_supervisor', 'tenant_agent'])('does not expose approval actions to %s', role => {
        const data = candidate(); const html = renderToStaticMarkup(createElement(AgentReleaseReview, { candidate: data, role, busy: false, decide: async () => {} }));
        expect(html).not.toContain(mockMessages.es.agentReleases.approve);
        expect(canReviewRelease(data, role, 'approve', allChecks(), data.review!.sampleHashes)).toBe(false);
    });
    it('requires every sample hash, all six declarations and current completed evidence before approval', () => {
        const data = candidate(), seen = data.review!.sampleHashes;
        expect(canReviewRelease(data, 'tenant_admin', 'approve', allChecks(), [])).toBe(false);
        expect(canReviewRelease(data, 'tenant_admin', 'approve', { ...allChecks(), facts: false }, seen)).toBe(false);
        expect(canReviewRelease(data, 'tenant_admin', 'approve', allChecks(), [...seen, 'f'.repeat(64)])).toBe(false);
        expect(canReviewRelease(data, 'tenant_admin', 'approve', allChecks(), seen)).toBe(true);
        data.review!.operationChecks[0].unknown = 1;
        expect(canReviewRelease(data, 'tenant_admin', 'approve', allChecks(), seen)).toBe(false);
        data.review!.operationChecks[0].unknown = 0;
        data.review!.eligibleForReview = false;
        expect(canReviewRelease(data, 'tenant_admin', 'approve', allChecks(), seen)).toBe(false);
        expect(canReviewRelease(data, 'tenant_admin', 'reject', emptyReleaseReviewChecks(), [])).toBe(true);
        data.status = 'evaluating'; expect(canReviewRelease(data, 'tenant_admin', 'reject', allChecks(), seen)).toBe(false);
    });
    it('keeps empty samples and unknown baseline distinct from successful verification', () => {
        const data = candidate(); data.review!.samples = []; data.review!.sampleHashes = []; data.review!.subject.changes = null;
        expect(canReviewRelease(data, 'tenant_admin', 'approve', allChecks(), [])).toBe(false);
        const html = renderToStaticMarkup(createElement(AgentReleaseReview, { candidate: data, role: 'tenant_admin', busy: false, decide: async () => {} }));
        expect(html).toContain(mockMessages.es.agentReleases.noSamples); expect(html).toContain(mockMessages.es.agentReleases.baseUnavailable);
    });
    it('retries exactly the reviewed evidence and changes request identity when the candidate revision or decision changes', () => {
        const data = candidate(), seen = data.review!.sampleHashes, checks = allChecks();
        const first = prepareReleaseReview(data, 'tenant_admin', 'approve', checks, seen);
        expect(prepareReleaseReview(data, 'tenant_admin', 'approve', allChecks(), [...seen], first)).toBe(first);
        expect(first.body).toMatchObject({ expectedVersion: 4, evidenceHash: 'a'.repeat(64), decision: 'approve', sampleHashes: seen });
        checks.facts = false; expect(first.body.checks.facts).toBe(true);
        expect(JSON.stringify(first.body)).not.toContain('Captured greeting'); expect(JSON.stringify(first.body)).not.toContain('transcript');
        const rejected = prepareReleaseReview(data, 'tenant_admin', 'reject', allChecks(), seen, first);
        expect(rejected.body.requestKey).not.toBe(first.body.requestKey);
        data.version++; expect(prepareReleaseReview(data, 'tenant_admin', 'approve', allChecks(), seen, first).body.requestKey).not.toBe(first.body.requestKey);
    });
    it('prepares only the current server UUID and reuses its command through a lost response', () => {
        const state = workspace(), first = prepareReleaseRequest(state);
        expect(first.body.configurationRevisionId).toBe('draft'); expect(prepareReleaseRequest(state, first)).toBe(first);
        expect(Object.keys(first.body).sort()).toEqual(['configurationRevisionId', 'requestKey']);
        state.draft!.id = 'other'; expect(() => prepareReleaseRequest(state, first)).toThrow();
        state.evaluationRevisionId = 'other'; expect(prepareReleaseRequest(state, first).body.requestKey).not.toBe(first.body.requestKey);
        state.draft!.currentBase = false; expect(() => prepareReleaseRequest(state)).toThrow();
    });
    it('has translations for every projection field and sanitizes error categories', () => {
        for (const locale of ['es', 'en', 'pt', 'fr']) {
            mockLocale = locale;
            const subject = candidate().review!.subject;
            subject.fields = Object.keys(mockMessages.en.agentReleases.fields).map(key => ({ key, value: null }));
            expect(() => renderToStaticMarkup(createElement(AgentReleaseSubject, { subject }))).not.toThrow();
        }
        expect(releaseErrorKind('provider_secret_sql_body')).toBe('unavailable');
        expect(releaseErrorKind('agent_release_evidence_changed')).toBe('changed');
        expect(releaseErrorKind('eval_autorun_budget_exhausted')).toBe('budget');
    });
});
