import * as fs from 'fs';
import * as path from 'path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import type { AgentConfigurationWorkspace, AgentDraftBody, SaveAgentDraftRequest } from '@parallext/shared';
import { interact, type RenderedScreen } from '@/test/a11y';
import AgentEditorPage from './page';

/**
 * PREPARED ONLY. Root preregisters before execution.
 * Destination: apps/dashboard/src/app/admin/agent/[agentId]/
 * agent-rag-implicit-editor-v3.a11y.spec.tsx
 *
 * Real full editor and NextIntl, strict API envelopes. Sixteen cases pair with
 * agent-rag-implicit-runtime-v2.spec.ts. Existing runtime treats omitted RAG as
 * enabled/topK5/threshold0.35. An unrelated name edit must preserve that
 * effective behavior, while explicit false/true must remain explicit.
 * API save only captures the request and returns success:false; no persistence
 * is certified. Router/auth contexts remain one valid synthetic tenant_admin.
 * No production UI, SQL, model, real AT, backend guards or global acceptance.
 * V3 harness repair: normal Persona tab -> visible input edit -> Tools tab
 * -> RAG switch -> Save; API v2 runtime16 already passed, do NOT rerun it.
 * No private function or hidden state is exported/inspected. The owner-visible
 * RAG switch and actual submitted config are the oracles.
 */
const TENANT = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';
const LOCALES = ['es', 'en', 'pt', 'fr'] as const;
type Locale = typeof LOCALES[number];
const MESSAGES = Object.fromEntries(LOCALES.map(locale => [locale,
    JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../../messages', locale + '.json'), 'utf8')),
])) as Record<Locale, any>;
const CASES = [
    { name: 'omitted RAG', rag: undefined, expected: { enabled: true, topK: 5, similarityThreshold: 0.35 } },
    { name: 'enabled RAG with omitted tuning', rag: { enabled: true }, expected: { enabled: true, topK: 5, similarityThreshold: 0.35 } },
    { name: 'explicit RAG disabled', rag: { enabled: false, topK: 3, similarityThreshold: 0.6 }, expected: { enabled: false, topK: 3, similarityThreshold: 0.6 } },
    { name: 'explicit RAG enabled', rag: { enabled: true, topK: 3, similarityThreshold: 0.6 }, expected: { enabled: true, topK: 3, similarityThreshold: 0.6 } },
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
function bodyFor(rag: typeof CASES[number]['rag']): AgentDraftBody {
    return { name: 'Synthetic original name', channels: ['telegram'], channelBindings: [], scheduleMode: '24_7', isActive: true, isDefault: true,
        configJson: {
            persona: { name: 'Synthetic original name', role: 'Support', fallbackMessage: 'No confirmed information.' },
            behavior: { rules: ['Use confirmed facts.'], handoffTriggers: ['Human requested'] },
            language: 'es', industry: 'retail', tools: {}, llm: {}, ...(rag === undefined ? {} : { rag }),
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
describe.each(LOCALES)('real editor preserves effective saved RAG behavior (%s)', locale => {
    beforeEach(() => { mockUnexpectedCalls.length = 0; });
    afterEach(() => expect(mockUnexpectedCalls).toEqual([]));
    it.each(CASES)('$name remains consistent in the shown switch and an unrelated name-edit payload', async testcase => {
        mockBody = bodyFor(testcase.rag); configureApi();
        const screen = await openEditor(locale);
        try {
            // PersonaTab owns the real name input and is unmounted on the
            // Tools tab. Edit it while that tab is visible, then inspect RAG.
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
            const toolsTabs = Array.from(screen.container.querySelectorAll<HTMLButtonElement>('button[role="tab"][data-tab-id="tools"]'));
            expect(toolsTabs).toHaveLength(1);
            expect(toolsTabs[0].textContent?.trim()).toBe(MESSAGES[locale].agent.tabs.tools);
            await interact(() => toolsTabs[0].click());
            expect(toolsTabs[0].getAttribute('aria-selected')).toBe('true');
            const rag = screen.container.querySelector<HTMLButtonElement>('button[data-rag-control="automatic-retrieval"]');
            expect(rag).not.toBeNull();
            const shownEnabled = rag!.getAttribute('aria-checked') === 'true';
            const saves = Array.from(screen.container.querySelectorAll<HTMLButtonElement>('button'))
                .filter(button => button.textContent?.trim() === MESSAGES[locale].common.save && !button.disabled);
            expect(saves.length).toBeGreaterThan(0);
            await interact(() => saves[0].click());
            expect(api.saveAgentDraft).toHaveBeenCalledTimes(1);
            const request = api.saveAgentDraft.mock.calls[0][2] as SaveAgentDraftRequest;
            expect(request.body.name).toBe('Synthetic changed name only');
            const savedRag = request.body.configJson.rag;
            expect({ shownEnabled, submittedRag: {
                enabled: savedRag?.enabled, topK: savedRag?.topK, similarityThreshold: savedRag?.similarityThreshold,
            } }).toEqual({ shownEnabled: testcase.expected.enabled, submittedRag: testcase.expected });
            expect(api.getAgentConfiguration).toHaveBeenCalledTimes(1);
        } finally { screen.unmount(); }
    });
});
