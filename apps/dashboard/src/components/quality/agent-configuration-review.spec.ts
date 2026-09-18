import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AGENT_CONFIGURATION_PATHS, type AgentConfigurationProposal } from '@parallext/shared';
import { AgentConfigurationReview } from './AgentConfigurationReview';

let mockLocale = 'es';
let mockRole = 'tenant_admin';
let mockMode: 'immediate' | 'reviewed' | 'unknown' = 'unknown';
const mockMessages: Record<string, any> = Object.fromEntries(['es', 'en', 'pt', 'fr'].map(locale => [locale, require(`../../../messages/${locale}.json`).agentConfiguration]));
const mockDraftMessages: Record<string, any> = Object.fromEntries(['es', 'en', 'pt', 'fr'].map(locale => [locale, require(`../../../messages/${locale}.json`).agentDraft]));
jest.mock('next-intl', () => ({ useTranslations: (namespace: string) => {
    const lookup = (key: string) => key.split('.').reduce((node: any, part) => node?.[part], namespace === 'agentDraft' ? mockDraftMessages[mockLocale] : mockMessages[mockLocale]);
    const t = (key: string, values?: Record<string, unknown>) => String(lookup(key) ?? key).replace(/\{(\w+)\}/g, (_match, variable) => String(values?.[variable] ?? variable));
    t.has = (key: string) => typeof lookup(key) === 'string';
    return t;
} }));
jest.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ activeTenantId: 'tenant' }) }));
jest.mock('@/hooks/useRole', () => ({ useRole: () => ({ role: mockRole }) }));
jest.mock('@/lib/api', () => ({ api: { applyAgentConfiguration: jest.fn() } }));
jest.mock('@/hooks/useAgentReviewMode', () => ({ useAgentReviewMode: () => mockMode }));
const proposal = (): AgentConfigurationProposal => ({ id: 'review', agentId: 'agent', agentName: 'Luna', expectedVersion: 7, digest: 'a'.repeat(64),
    targetScope: 'agent_draft', expectedDraftRevision: null,
    status: 'proposed', expiresAt: new Date(Date.now() + 60000).toISOString(), changes: [{ path: 'persona.greeting', before: 'Saludo actual', value: 'Hola <cliente>' },
        { path: 'mission', before: null, value: { version: 1, objective: 'Ayudar a comprar', intentKeys: ['browse_catalog'], successCriteria: ['Compra confirmada'], handoffConditions: ['Falta información'] } }] });

describe('reviewable agent configuration UI', () => {
    beforeEach(() => { mockLocale = 'es'; mockRole = 'tenant_admin'; mockMode = 'unknown'; });
    it.each(['es', 'en', 'pt', 'fr'])('shows exact old/new values and a localized mission in %s', locale => {
        mockLocale = locale;
        const html = renderToStaticMarkup(createElement(AgentConfigurationReview, { proposal: proposal() }));
        for (const text of ['Luna', 'Saludo actual', 'Hola &lt;cliente&gt;', 'Compra confirmada', 'Falta información', mockMessages[locale].intentLabels.browse_catalog]) expect(html).toContain(text);
        for (const path of AGENT_CONFIGURATION_PATHS) expect(mockMessages[locale].fields[path.replace(/\./g, '_')]).toEqual(expect.any(String));
    });
    // D25: the card said "a draft is saved; what answers does not change" to
    // every tenant, while the default mode applies the change the moment the
    // button is pressed. Each mode now says what that mode does.
    it.each(['es', 'en', 'pt', 'fr'])('says what applying does in each change mode, in %s', locale => {
        mockLocale = locale;
        const render = () => renderToStaticMarkup(createElement(AgentConfigurationReview, { proposal: proposal() }));
        const escape = (text: string) => text.replace(/'/g, '&#x27;');
        mockMode = 'immediate';
        const live = render();
        expect(live).toContain(escape(mockDraftMessages[locale].proposalLiveReview));
        expect(live).toContain(escape(mockDraftMessages[locale].saveLive));
        expect(live).not.toContain(escape(mockDraftMessages[locale].proposalDraftReview));
        mockMode = 'reviewed';
        const reviewed = render();
        expect(reviewed).toContain(escape(mockDraftMessages[locale].proposalDraftReview));
        expect(reviewed).toContain(escape(mockDraftMessages[locale].save));
        mockMode = 'unknown';
        const unknown = render();
        expect(unknown).toContain(escape(mockDraftMessages[locale].proposalUnknownReview));
        expect(unknown).toContain(`>${escape(mockDraftMessages[locale].saveUnknown)}</button>`);
        expect(unknown).not.toContain(escape(mockDraftMessages[locale].proposalDraftReview));
        expect(unknown).not.toContain(escape(mockDraftMessages[locale].proposalLiveReview));
    });
    it.each(['tenant_agent', 'tenant_supervisor'])('does not render an apply action for %s', role => {
        mockRole = role;
        const html = renderToStaticMarkup(createElement(AgentConfigurationReview, { proposal: proposal() }));
        expect(html).not.toContain('<button');
        expect(html).toContain('Saludo actual');
    });
    it('shows expiry instead of an apply button, and distinguishes already applied proposals', () => {
        const p = proposal(); p.expiresAt = new Date(Date.now() - 1000).toISOString();
        const expired = renderToStaticMarkup(createElement(AgentConfigurationReview, { proposal: p }));
        expect(expired).toContain(mockMessages.es.expired);
        expect(expired).not.toContain('<button');
        p.status = 'applied';
        mockMode = 'reviewed';
        const applied = renderToStaticMarkup(createElement(AgentConfigurationReview, { proposal: p }));
        expect(applied).toContain(mockDraftMessages.es.saved);
        mockMode = 'immediate';
        expect(renderToStaticMarkup(createElement(AgentConfigurationReview, { proposal: p }))).toContain(mockDraftMessages.es.savedLive);
        expect(applied).not.toContain(mockMessages.es.expired);
    });
    it('labels an account proposal as affecting every agent and retains its explicit apply action', () => {
        const p = proposal(); p.targetScope = 'account'; p.changes = [];
        const html = renderToStaticMarkup(createElement(AgentConfigurationReview, { proposal: p }));
        expect(html).toContain(mockDraftMessages.es.accountReview); expect(html).toContain(mockMessages.es.apply);
        expect(html).not.toContain(mockDraftMessages.es.proposalDraftReview);
    });
    it('expires a cached legacy proposal instead of claiming its old live write was a draft save', () => {
        const p = proposal(); delete (p as any).targetScope; p.status = 'applied';
        const html = renderToStaticMarkup(createElement(AgentConfigurationReview, { proposal: p }));
        expect(html).toContain(mockMessages.es.expired); expect(html).not.toContain(mockDraftMessages.es.saved);
        expect(html).not.toContain(mockDraftMessages.es.savedLive); expect(html).not.toContain(mockDraftMessages.es.savedUnknown);
        expect(html).not.toContain('<button');
    });
});
