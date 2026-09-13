import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AgentConfigurationWorkspace } from '@parallext/shared';
import { AgentDraftStatus } from './AgentDraftStatus';
import { agentDraftTestHref, prepareDraftSave } from '@/lib/agent-draft-save';

let mockLocale = 'es', mockRole = 'tenant_admin';
const mockMessages: Record<string, any> = Object.fromEntries(['es', 'en', 'pt', 'fr'].map(locale => [locale, require(`../../../messages/${locale}.json`).agentDraft]));
jest.mock('next-intl', () => ({ useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    const value = mockMessages[mockLocale][key];
    if (typeof value !== 'string') throw new Error(`Missing draft translation: ${mockLocale}.${key}`);
    return value.replace(/\{(\w+)\}/g, (_match: string, name: string) => String(values?.[name] ?? name));
} }));
jest.mock('@/hooks/useRole', () => ({ useRole: () => ({ role: mockRole }) }));
jest.mock('@/lib/api', () => ({ api: { discardAgentDraft: jest.fn() } }));
function workspace(): AgentConfigurationWorkspace {
    const body = { name: 'Alex', configJson: { persona: { name: 'Alex', greeting: 'Stored greeting' }, tools: { faqs: { enabled: true } } },
        channels: ['web_widget'], channelBindings: [], scheduleMode: 'business_hours', isActive: true, isDefault: true };
    return { agentId: '22222222-2222-4222-8222-222222222222', operational: { version: 7, hash: 'a'.repeat(64), body }, draft: {
        id: '33333333-3333-4333-8333-333333333333', baseOperationalVersion: 7, baseOperationalHash: 'a'.repeat(64), bodyHash: 'b'.repeat(64),
        body: { ...body, configJson: { ...body.configJson, persona: { ...body.configJson.persona, greeting: 'Draft greeting' } } },
        currentBase: true, createdAt: '2026-09-07T10:00:00.000Z' }, evaluationRevisionId: '33333333-3333-4333-8333-333333333333' };
}
describe('Draft configuration review and retry contract', () => {
    beforeEach(() => { mockLocale = 'es'; mockRole = 'tenant_admin'; });
    it.each(['es', 'en', 'pt', 'fr'])('identifies live vs draft and links the exact revision in %s', locale => {
        mockLocale = locale;
        const state = workspace();
        const html = renderToStaticMarkup(createElement(AgentDraftStatus, { workspace: state, tenantId: 'tenant' }));
        expect(html).toContain(mockMessages[locale].saveHint);
        expect(html).toContain(mockMessages[locale].draftPrepared);
        expect(html).toContain(mockMessages[locale].operationalVersion.replace('{version}', '7'));
        expect(html).toContain(`configurationRevisionId=${state.draft!.id}`);
        expect(html).toContain(mockMessages[locale].discard);
    });
    it('does not offer the stale draft for testing and keeps absence distinct from failed reads', () => {
        const state = workspace(); state.draft!.currentBase = false; state.evaluationRevisionId = null;
        const stale = renderToStaticMarkup(createElement(AgentDraftStatus, { workspace: state }));
        expect(stale).toContain(mockMessages.es.baseChanged); expect(stale).not.toContain('configurationRevisionId=');
        state.draft = null;
        expect(renderToStaticMarkup(createElement(AgentDraftStatus, { workspace: state }))).toContain(mockMessages.es.noDraft);
        expect(renderToStaticMarkup(createElement(AgentDraftStatus, { workspace: null }))).toContain(mockMessages.es.loadUnavailable);
    });
    it.each(['tenant_supervisor', 'tenant_agent'])('does not expose discard to %s', role => {
        mockRole = role;
        const html = renderToStaticMarkup(createElement(AgentDraftStatus, { workspace: workspace(), tenantId: 'tenant' }));
        expect(html).not.toContain('<button');
    });
    it('retries identical content with the original UUID and keeps both CAS values', () => {
        const state = workspace(), body = structuredClone(state.draft!.body);
        const first = prepareDraftSave(state, body), retry = prepareDraftSave(state, structuredClone(body), first);
        expect(retry).toBe(first);
        expect(first.request).toMatchObject({ expectedOperationalVersion: 7, expectedDraftRevision: state.draft!.id, body });
        body.configJson.persona.greeting = 'A later edit';
        const changed = prepareDraftSave(state, body, first);
        expect(changed.request.requestKey).not.toBe(first.request.requestKey);
        expect(first.request.body.configJson.persona.greeting).toBe('Draft greeting');
        state.draft!.id = '44444444-4444-4444-8444-444444444444';
        expect(prepareDraftSave(state, body, changed).request.requestKey).not.toBe(changed.request.requestKey);
    });
    it('refuses a stale base before issuing a command and never sends configuration in a test URL', () => {
        const state = workspace();
        expect(agentDraftTestHref(state)).toBe(`/admin/agent/${state.agentId}/test?configurationRevisionId=${state.draft!.id}`);
        expect(agentDraftTestHref(state)).not.toContain('greeting');
        state.draft!.currentBase = false;
        expect(() => prepareDraftSave(state, state.draft!.body)).toThrow('agent_operational_configuration_changed');
    });
});
