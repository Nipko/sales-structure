import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AGENT_OPERATIONAL_STATES, type AgentAssessment, type AgentOperationalState, type AgentToolExplanationV1 } from '@parallext/shared';
import { AgentAssessmentPanel } from './AgentAssessmentPanel';

/**
 * The six words have to arrive on screen as six different things to do.
 *
 * The API has computed `state` on the roll-up, on every setup task, on every
 * connection, on every required test and on every tool since the shared
 * vocabulary landed; the dashboard rendered none of it and showed a count of
 * pending steps instead. A count cannot say whether an agent is untested or
 * broken, and it certainly cannot say that nobody could look.
 *
 * So these assertions are about the reduction, not about markup: that the six
 * states never collapse into each other, that `unknown` is not spelled as a
 * zero or as a polite `false`, and that the panel repeats the server's roll-up
 * rather than recounting the parts underneath it.
 */

let mockLocale = 'es';
const LOCALES = ['es', 'en', 'pt', 'fr'] as const;
const mockMessages: Record<string, any> = Object.fromEntries(LOCALES.map(locale => [locale, require(`../../../messages/${locale}.json`)]));
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

const words = (locale: string) => mockMessages[locale].agentOperationalState;
const label = (locale: string, state: AgentOperationalState): string => words(locale).states[state].label;

const tool = (state: AgentOperationalState): AgentToolExplanationV1 => ({
    tool: `tool_${state}`, state,
    achieves: { effect: 'effect', commitsBusiness: false, confirmation: 'confirmation', externalEffect: 'none' },
    missionIntents: ['ask_question'], requires: { prerequisites: [], readiness: [] },
    missing: { reason: null, detail: null, repairRoute: null, readiness: [] },
    example: null, safeTest: { available: false, href: null }, result: 'not_verified',
});

/** Every part in one state, so a render can be read as one answer. */
const assessment = (state: AgentOperationalState, overrides: Partial<AgentAssessment> = {}): AgentAssessment => ({
    version: 1, revision: '1', generatedAt: new Date().toISOString(),
    agent: { id: 'agent', name: 'Luna', version: 1, isActive: true, updatedAt: new Date().toISOString() },
    mission: { source: 'configured', definition: null, templateId: null, profileId: null, availableIntentKeys: [], unsupportedIntents: [] },
    overview: null, configuration: null, nextTask: null,
    tasks: [{ key: 'agent', status: 'pass', state, checks: [], href: '/admin/agent', tourId: null, dependsOn: [] }],
    channels: [{ channelType: 'whatsapp', scope: 'assigned', contract: null, status: 'known', state }],
    requiredTests: [{ intentKey: 'ask_question', toolPlan: [], terminalStates: [], confirmation: '', fallback: '',
        evidence: 'not_verified', state, unavailableTools: [] }],
    tools: [tool(state)],
    state,
    ...overrides,
});

/** React escapes text; the message files do not. Compare on the same footing. */
const decode = (markup: string) => markup
    .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const render = (value: AgentAssessment) => decode(renderToStaticMarkup(createElement(AgentAssessmentPanel, { assessment: value })));

/**
 * The words the badges actually said.
 *
 * Every badge prefixes its word with a screen-reader-only "Estado:", which is
 * also what makes the state readable with the colour switched off — so the same
 * marker that serves a screen reader is what this test reads.
 */
const badgeWords = (markup: string): Set<string> =>
    new Set([...markup.matchAll(/<span class="sr-only">[^<]*<\/span>([^<]*)</g)].map(match => match[1]));

describe('the dashboard says the six operational states', () => {
    it.each(LOCALES)('gives each state its own word and its own sentence in %s', locale => {
        mockLocale = locale;
        const labels = AGENT_OPERATIONAL_STATES.map(state => label(locale, state));
        const meanings = AGENT_OPERATIONAL_STATES.map(state => words(locale).states[state].meaning);
        const agentSentences = AGENT_OPERATIONAL_STATES.map(state => words(locale).agent[state]);
        for (const set of [labels, meanings, agentSentences]) {
            expect(set.every(value => typeof value === 'string' && value.trim().length > 0)).toBe(true);
            // Six distinct values, not five: `tested` collapsing into `operating`
            // or `prepared` into `tested` is the failure this guards.
            expect(new Set(set).size).toBe(AGENT_OPERATIONAL_STATES.length);
        }
    });

    it.each(LOCALES)('renders the word for whichever state the parts are in, in %s', locale => {
        mockLocale = locale;
        for (const state of AGENT_OPERATIONAL_STATES) {
            const markup = render(assessment(state));
            // The word is in the text, not only in a Tailwind class: a status
            // told through colour alone is unreadable to half the people it is
            // meant for, and a review already flagged exactly that.
            expect(badgeWords(markup)).toEqual(new Set([label(locale, state)]));
            expect(markup).toContain(words(locale).agent[state]);
            expect(markup).toContain(words(locale).states[state].meaning);
        }
    });

    it.each(LOCALES)('keeps unknown out of pending, degraded and zero in %s', locale => {
        mockLocale = locale;
        const markup = render(assessment('unknown'));
        expect(markup).toContain(words(locale).states.unknown.meaning);
        for (const other of ['pending', 'prepared', 'tested', 'operating', 'degraded'] as const) {
            expect(badgeWords(markup).has(label(locale, other))).toBe(false);
            expect(markup).not.toContain(words(locale).agent[other]);
        }
        // "We could not read it" is not "we read it and found nothing": a count
        // of zero published tools would be a claim this assessment cannot make.
        expect(markup).not.toContain(mockMessages[locale].agentAssessment.capabilityEvidence.replace('{count}', '0'));
        expect(markup).toContain(mockMessages[locale].qualityHealth.setup.verificationUnavailable);
    });

    it.each(LOCALES)('says the server roll-up instead of recounting the parts in %s', locale => {
        mockLocale = locale;
        // Deliberately inconsistent: a client that re-derived the whole from the
        // parts would say "pendiente" here, and would then drift from Salud, the
        // onboarding card and Assist, which all read the assessment.
        const markup = render(assessment('pending', { state: 'operating' }));
        expect(markup).toContain(words(locale).agent.operating);
        expect(markup).not.toContain(words(locale).agent.pending);
        expect(badgeWords(markup)).toEqual(new Set([label(locale, 'operating'), label(locale, 'pending')]));
    });

    it.each(LOCALES)('tells a broken connection from one nobody could read in %s', locale => {
        mockLocale = locale;
        const assessed = mockMessages[locale].agentAssessment;
        const withChannel = (state: AgentOperationalState, status: 'known' | 'unavailable') => render(assessment('prepared', {
            channels: [{ channelType: 'whatsapp', scope: 'assigned', contract: null, status, state }],
        }));
        const degraded = withChannel('degraded', 'known');
        expect(degraded).toContain(assessed.capabilityDegraded);
        expect(degraded).not.toContain(mockMessages[locale].qualityHealth.setup.verificationUnavailable);
        const unreadable = withChannel('unknown', 'unavailable');
        expect(unreadable).toContain(mockMessages[locale].qualityHealth.setup.verificationUnavailable);
        expect(unreadable).not.toContain(assessed.capabilityDegraded);
        // And with nothing to read at all, neither sentence is honest.
        const none = render(assessment('pending', { channels: [] }));
        expect(none).toContain(assessed.capabilityNoChannels);
    });
});
