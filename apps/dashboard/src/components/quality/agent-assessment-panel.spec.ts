import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AgentAssessment } from '@parallext/shared';
import { AgentAssessmentPanel } from './AgentAssessmentPanel';

let mockLocale = 'es';
const mockMessages: Record<string, any> = Object.fromEntries(['es', 'en', 'pt', 'fr'].map(locale => [locale, require(`../../../messages/${locale}.json`)]));
jest.mock('next-intl', () => ({ useLocale: () => mockLocale, useTranslations: (namespace: string) => {
    const lookup = (key: string) => `${namespace}.${key}`.split('.').reduce((node: any, part) => node?.[part], mockMessages[mockLocale]);
    const t = (key: string, values?: Record<string, unknown>) => {
        if (typeof lookup(key) !== 'string') throw new Error(`Missing translation: ${mockLocale}.${namespace}.${key}`);
        return lookup(key).replace(/\{(\w+)\}/g, (_match: string, name: string) => String(values?.[name] ?? name));
    };
    t.has = (key: string) => typeof lookup(key) === 'string'; return t;
} }));
jest.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ activeTenantId: 'tenant' }) }));
jest.mock('@/hooks/useRole', () => ({ useRole: () => ({ role: 'tenant_admin', canAccess: () => true }) }));
jest.mock('@/lib/api', () => ({ api: {} }));

const assessment = (hasAgent: boolean): AgentAssessment => ({ version: 1, revision: '1', generatedAt: new Date().toISOString(),
    agent: hasAgent ? { id: 'agent', name: 'Luna', version: 1, isActive: true, updatedAt: new Date().toISOString() } : null,
    mission: { source: 'not_configured', definition: null, templateId: null, profileId: null, availableIntentKeys: [], unsupportedIntents: [] },
    channels: [], tasks: [], nextTask: null, requiredTests: [], configuration: null, overview: null });

describe('mission guidance distinguishes a missing mission from a missing agent', () => {
    it.each(['es', 'en', 'pt', 'fr'])('keeps the existing agent editable when its mission is missing in %s', locale => {
        mockLocale = locale;
        const existing = renderToStaticMarkup(createElement(AgentAssessmentPanel, { assessment: assessment(true) }));
        expect(existing).toContain(mockMessages[locale].agentAssessment.sources.not_configured);
        expect(existing).toContain(mockMessages[locale].agentConfiguration.editMission);
        const noAgent = renderToStaticMarkup(createElement(AgentAssessmentPanel, { assessment: assessment(false) }));
        expect(noAgent).not.toContain(mockMessages[locale].agentConfiguration.editMission);
    });
});
