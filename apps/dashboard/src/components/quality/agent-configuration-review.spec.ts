import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AGENT_CONFIGURATION_PATHS, type AgentConfigurationProposal } from '@parallext/shared';
import { AgentConfigurationReview } from './AgentConfigurationReview';

let mockLocale = 'es';
let mockRole = 'tenant_admin';
const mockMessages: Record<string, any> = Object.fromEntries(['es', 'en', 'pt', 'fr'].map(locale => [locale, require(`../../../messages/${locale}.json`).agentConfiguration]));
jest.mock('next-intl', () => ({ useTranslations: () => {
    const lookup = (key: string) => key.split('.').reduce((node: any, part) => node?.[part], mockMessages[mockLocale]);
    const t = (key: string, values?: Record<string, unknown>) => String(lookup(key) ?? key).replace(/\{(\w+)\}/g, (_match, variable) => String(values?.[variable] ?? variable));
    t.has = (key: string) => typeof lookup(key) === 'string';
    return t;
} }));
jest.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ activeTenantId: 'tenant' }) }));
jest.mock('@/hooks/useRole', () => ({ useRole: () => ({ role: mockRole }) }));
jest.mock('@/lib/api', () => ({ api: { applyAgentConfiguration: jest.fn() } }));
const proposal = (): AgentConfigurationProposal => ({ id: 'review', agentId: 'agent', agentName: 'Luna', expectedVersion: 7, digest: 'a'.repeat(64),
    status: 'proposed', expiresAt: new Date(Date.now() + 60000).toISOString(), changes: [{ path: 'persona.greeting', before: 'Saludo actual', value: 'Hola <cliente>' },
        { path: 'mission', before: null, value: { version: 1, objective: 'Ayudar a comprar', intentKeys: ['browse_catalog'], successCriteria: ['Compra confirmada'], handoffConditions: ['Falta información'] } }] });

describe('reviewable agent configuration UI', () => {
    beforeEach(() => { mockLocale = 'es'; mockRole = 'tenant_admin'; });
    it.each(['es', 'en', 'pt', 'fr'])('shows exact old/new values and a localized mission in %s', locale => {
        mockLocale = locale;
        const html = renderToStaticMarkup(createElement(AgentConfigurationReview, { proposal: proposal() }));
        for (const text of ['Luna', 'Saludo actual', 'Hola &lt;cliente&gt;', 'Compra confirmada', 'Falta información', mockMessages[locale].intentLabels.browse_catalog, mockMessages[locale].apply]) expect(html).toContain(text);
        for (const path of AGENT_CONFIGURATION_PATHS) expect(mockMessages[locale].fields[path.replace(/\./g, '_')]).toEqual(expect.any(String));
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
        const applied = renderToStaticMarkup(createElement(AgentConfigurationReview, { proposal: p }));
        expect(applied).toContain(mockMessages.es.applied);
        expect(applied).not.toContain(mockMessages.es.expired);
    });
});
