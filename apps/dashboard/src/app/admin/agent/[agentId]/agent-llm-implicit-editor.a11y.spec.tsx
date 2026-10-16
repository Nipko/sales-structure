import * as fs from 'fs';
import * as path from 'path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import type { AgentConfigurationWorkspace, AgentDraftBody, SaveAgentDraftRequest } from '@parallext/shared';
import { interact, type RenderedScreen } from '@/test/a11y';
import AgentEditorPage from './page';

/** PREPARED ONLY. Proposed destination agent-llm-implicit-editor.a11y.spec.tsx.
 * Exactly16: four existing saved LLM shapes x ES/EN/PT/FR. Root preregisters.
 * Full editor/NextIntl/workspace/read and Save request are real; infrastructure
 * API doubles are strict and Save returns false without persistence. Edit only
 * the visible name once and inspect the captured request, not internal state.
 * Paired API16 executes the real turn and establishes the effective request
 * options before an edit. This spec projects that independently established
 * public consumer contract onto the saved payload. It does not assert exact
 * serialization of omissions: explicit .8 is equivalent to omitted sampling;
 * an omitted token cap remains unpinned rather than assuming provider length.
 * No model, SQL, real writes, auth guards, production UI or real AT.
 */
const TENANT = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';
const LOCALES = ['es', 'en', 'pt', 'fr'] as const;
type Locale = typeof LOCALES[number];
const MESSAGES = Object.fromEntries(LOCALES.map(locale => [locale,
    JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../../messages', locale + '.json'), 'utf8')),
])) as Record<Locale, any>;
const CASES = [
    { name: 'omitted saved LLM settings', llm: undefined, expected: { temperature: 0.8, maxTokens: undefined } },
    { name: 'explicit zero temperature with omitted token cap', llm: { temperature: 0 }, expected: { temperature: 0, maxTokens: undefined } },
    { name: 'explicit token cap with omitted temperature', llm: { maxTokens: 2500 }, expected: { temperature: 0.8, maxTokens: 2500 } },
    { name: 'explicit custom temperature and token cap control', llm: { temperature: 0.25, maxTokens: 600 }, expected: { temperature: 0.25, maxTokens: 600 } },
] as const;
const mockUnexpectedCalls: string[] = [];
let mockBody: AgentDraftBody;

jest.mock('@/lib/api', () => {
    const methods: Record<string, jest.Mock> = {};
    return { api: new Proxy(methods, { get(target, key) {
        if (typeof key !== 'string') return undefined;
        target[key] ??= jest.fn(async () => { mockUnexpectedCalls.push(key); throw new Error('Unexpected API: ' + key); });
        return target[key];
    } }) };
});
jest.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ activeTenantId: '11111111-1111-4111-8111-111111111111' }) }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({
    user: { id: '33333333-3333-4333-8333-333333333333', role: 'tenant_admin', tenantId: '11111111-1111-4111-8111-111111111111' },
    verticalConfig: { industry: 'retail', subType: 'moda' }, isVerticalConfigLoading: false,
    planFeatures: { customerPayments: false },
}) }));
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), forward: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() }),
    usePathname: () => '/admin/agent/22222222-2222-4222-8222-222222222222',
    useParams: () => ({ agentId: '22222222-2222-4222-8222-222222222222' }),
    useSearchParams: () => new URLSearchParams(),
}));
const { api } = jest.requireMock('@/lib/api') as { api: Record<string, jest.Mock> };
if (typeof globalThis.structuredClone !== 'function') {
    const v8 = require('v8') as typeof import('v8');
    (globalThis as any).structuredClone = (value: unknown) => v8.deserialize(v8.serialize(value));
}
if (typeof globalThis.crypto?.randomUUID !== 'function') {
    const { randomUUID } = require('crypto') as typeof import('crypto');
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { ...globalThis.crypto, randomUUID } });
}
function bodyFor(llm: typeof CASES[number]['llm'], locale: Locale): AgentDraftBody {
    return { name: 'Synthetic original name', channels: ['telegram'], channelBindings: [], scheduleMode: '24_7', isActive: true, isDefault: true,
        configJson: {
            persona: { name: 'Synthetic original name', role: 'Support', fallbackMessage: 'No confirmed information.' },
            behavior: { rules: ['Use confirmed facts.'], handoffTriggers: ['Human requested'] },
            language: locale, industry: 'retail', tools: {}, rag: { enabled: false, topK: 5, similarityThreshold: 0.35 }, ...(llm === undefined ? {} : { llm }),
        },
    };
}
function unexpected(method: string): never { mockUnexpectedCalls.push(method); throw new Error('Unexpected API: ' + method); }
function configureApi() {
    for (const [method, mock] of Object.entries(api)) mock.mockReset().mockImplementation(() => unexpected(method));
    api.getAgentConfiguration.mockImplementation(async (tenantId, agentId) => {
        expect([tenantId, agentId]).toEqual([TENANT, AGENT]);
        const data: AgentConfigurationWorkspace = { agentId: AGENT, operational: { version: 7, hash: 'a'.repeat(64), body: mockBody },
            draft: null, evaluationRevisionId: null, directCommit: true };
        return { success: true, data };
    });
    api.listAgents.mockImplementation(async tenantId => {
        expect(tenantId).toBe(TENANT);
        return { success: true, data: [{ id: AGENT, name: mockBody.name, config_json: mockBody.configJson, is_active: true, is_default: true,
            channels: mockBody.channels, channel_bindings: [] }] };
    });
    api.fetch.mockImplementation(async endpoint => endpoint === '/channels/overview'
        ? { success: true, data: [{ channelType: 'telegram', accountId: 'synthetic-account', displayName: 'Synthetic connection' }] }
        : unexpected('fetch:' + endpoint));
    for (const method of ['getServices', 'getAvailability']) api[method].mockImplementation(async tenantId => {
        expect(tenantId).toBe(TENANT); return { success: true, data: [] };
    });
    api.getAgentQualityOverview.mockImplementation(async (tenantId, agentId) => {
        expect([tenantId, agentId]).toEqual([TENANT, AGENT]);
        return { success: false, error: 'Synthetic optional quality unavailable' };
    });
    api.getPlanFeatures.mockImplementation(async tenantId => {
        expect(tenantId).toBe(TENANT); return { success: true, data: { customerPayments: false } };
    });
    api.getTenantPaymentsConfig.mockImplementation(async tenantId => {
        expect(tenantId).toBe(TENANT); return { success: false, error: 'Synthetic optional payment settings unavailable' };
    });
    api.saveAgentDraft.mockImplementation(async (tenantId, agentId) => {
        expect([tenantId, agentId]).toEqual([TENANT, AGENT]);
        return { success: false, error: 'Synthetic captured save; no persistence' };
    });
}
async function openEditor(locale: Locale): Promise<RenderedScreen> {
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="America/Bogota">
        <AgentEditorPage />
    </NextIntlClientProvider>));
    await interact(() => {});
    return { container, unmount: () => { act(() => root.unmount()); container.remove(); } };
}
describe.each(LOCALES)('real editor preserves effective saved LLM request options (%s)', locale => {
    beforeEach(() => {
        mockUnexpectedCalls.length = 0;
        for (const text of [MESSAGES[locale].common.save, MESSAGES[locale].agent.tabs.persona,
            MESSAGES[locale].agent.identity.agentNamePlaceholder]) {
            expect(typeof text).toBe('string'); expect(text.trim().length).toBeGreaterThan(0);
        }
    });
    afterEach(() => expect(mockUnexpectedCalls).toEqual([]));
    it.each(CASES)('$name keeps the same effective request options after a name-only save', async testcase => {
        mockBody = bodyFor(testcase.llm, locale); configureApi();
        const screen = await openEditor(locale);
        try {
            // PersonaTab owns the real name input and is unmounted on the
            // Tools tab. Edit it while that tab is visible, then capture the actual save.
            const personaTabs = Array.from(screen.container.querySelectorAll<HTMLButtonElement>('button[role="tab"][data-tab-id="persona"]'));
            expect(personaTabs).toHaveLength(1);
            expect(personaTabs[0].textContent?.trim()).toBe(MESSAGES[locale].agent.tabs.persona);
            await interact(() => personaTabs[0].click());
            expect(personaTabs[0].getAttribute('aria-selected')).toBe('true');
            const inputs = Array.from(screen.container.querySelectorAll<HTMLInputElement>('#tour-target-agent-name input'))
                .filter(input => input.placeholder === MESSAGES[locale].agent.identity.agentNamePlaceholder);
            expect(inputs).toHaveLength(1);
            const input = inputs[0];
            expect(input.value).toBe('Synthetic original name');
            expect(input.disabled || input.readOnly).toBe(false);
            await interact(() => {
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Synthetic changed name only');
                input.dispatchEvent(new Event('input', { bubbles: true }));
            });
            expect(input.value).toBe('Synthetic changed name only');
            const saves = Array.from(screen.container.querySelectorAll<HTMLButtonElement>('button'))
                .filter(button => button.textContent?.trim() === MESSAGES[locale].common.save && !button.disabled);
            expect(saves.length).toBeGreaterThan(0);
            await interact(() => saves[0].click());
            expect(api.saveAgentDraft).toHaveBeenCalledTimes(1);
            const request = api.saveAgentDraft.mock.calls[0][2] as SaveAgentDraftRequest;
            expect(request.body.name).toBe('Synthetic changed name only');
            const savedLlm = request.body.configJson.llm;
            // Contract independently established by API16 using the real turn,
            // no tools: temperature fallback .8; absent token cap is unpinned.
            const submittedOptions = {
                temperature: typeof savedLlm?.temperature === 'number' ? savedLlm.temperature : 0.8,
                maxTokens: typeof savedLlm?.maxTokens === 'number' && savedLlm.maxTokens > 0 ? savedLlm.maxTokens : undefined,
            };
            expect(submittedOptions).toEqual(testcase.expected);
            expect(request.body.configJson.rag).toMatchObject({ enabled: false, topK: 5, similarityThreshold: 0.35 });
            expect(mockBody.configJson.llm).toEqual(testcase.llm);
            expect(api.getAgentConfiguration).toHaveBeenCalledTimes(1);
        } finally { screen.unmount(); }
    });
});
