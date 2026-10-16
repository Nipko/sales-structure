import * as fs from 'fs';
import * as path from 'path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import type { AgentConfigurationWorkspace, AgentDraftBody } from '@parallext/shared';
import { interact, type RenderedScreen } from '@/test/a11y';
import AgentEditorPage from './page';

/**
 * Local preregistered functional validation. File:
 * apps/dashboard/src/app/admin/agent/[agentId]/agent-editor-context-order.a11y.spec.tsx
 *
 * Twelve positive functional cases: 4 real locales x 3 response orders.
 * All context changes are between two synthetic agents in the SAME tenant.
 * The tenant_admin actor and active tenant remain valid and unchanged.
 * No claim about authentication, HTTP guards, cross-tenant authorization,
 * real navigation, production persistence or global certification is made.
 *
 * The real page is rerendered with changed router hook values, as the App
 * Router would supply. No DOM injection, hidden state or private cancellation
 * implementation is inspected. Oracles are visible loading/name/heading/links.
 */
const TENANT = '11111111-1111-4111-8111-111111111111';
const AGENT_A = '22222222-2222-4222-8222-222222222222';
const AGENT_B = '33333333-3333-4333-8333-333333333333';
const LOCALES = ['es', 'en', 'pt', 'fr'] as const;
type Locale = typeof LOCALES[number];
const MESSAGES = Object.fromEntries(LOCALES.map(locale => [
    locale, JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../../messages', locale + '.json'), 'utf8')),
])) as Record<Locale, any>;
let mockAgentId = AGENT_A;
const mockUnexpectedCalls: string[] = [];

jest.mock('@/lib/api', () => {
    const methods: Record<string, jest.Mock> = {};
    return { api: new Proxy(methods, {
        get(target, key) {
            if (typeof key !== 'string') return undefined;
            target[key] ??= jest.fn(async () => {
                mockUnexpectedCalls.push(key);
                throw new Error('Unexpected API call: ' + key);
            });
            return target[key];
        },
    }) };
});
jest.mock('@/contexts/TenantContext', () => ({
    useTenant: () => ({ activeTenantId: '11111111-1111-4111-8111-111111111111' }),
}));
jest.mock('@/contexts/AuthContext', () => ({
    useAuth: () => ({
        user: { id: '44444444-4444-4444-8444-444444444444', role: 'tenant_admin',
            tenantId: '11111111-1111-4111-8111-111111111111' },
        verticalConfig: null, isVerticalConfigLoading: false,
    }),
}));
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), forward: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() }),
    usePathname: () => '/admin/agent/' + mockAgentId,
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({ agentId: mockAgentId }),
}));
const { api } = jest.requireMock('@/lib/api') as { api: Record<string, jest.Mock> };

if (typeof globalThis.structuredClone !== 'function') {
    const v8 = require('v8') as typeof import('v8');
    (globalThis as any).structuredClone = (value: unknown) => v8.deserialize(v8.serialize(value));
}

type ReadEnvelope = { success: true; data: AgentConfigurationWorkspace } | { success: false; error: string };
function deferred<T>() {
    let resolve!: (value: T) => void, reject!: (reason: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
function agentBody(agentId: string): AgentDraftBody {
    const name = agentId === AGENT_A ? 'Synthetic Agent A Older' : 'Synthetic Agent B Current';
    return {
        name,
        configJson: {
            persona: { name, role: 'Synthetic support assistant', greeting: 'Hello QA', fallbackMessage: 'No confirmed information.' },
            behavior: { rules: ['Use confirmed facts.'], forbiddenTopics: [], handoffTriggers: ['A person is requested.'] },
        },
        channels: [], channelBindings: [], scheduleMode: '24_7', isActive: true, isDefault: agentId === AGENT_B,
    };
}
function readEnvelope(agentId: string): ReadEnvelope {
    return { success: true, data: {
        agentId,
        operational: { version: agentId === AGENT_A ? 3 : 8, hash: (agentId === AGENT_A ? 'a' : 'b').repeat(64), body: agentBody(agentId) },
        draft: null, evaluationRevisionId: null, directCommit: true,
    } };
}
function unexpected(method: string): never {
    mockUnexpectedCalls.push(method);
    throw new Error('Unexpected API call: ' + method);
}
function configureApi(reads: Map<string, Promise<ReadEnvelope>>) {
    for (const [method, mock] of Object.entries(api)) mock.mockReset().mockImplementation(() => unexpected(method));
    api.getAgentConfiguration.mockImplementation((tenantId: string, agentId: string) => {
        if (tenantId !== TENANT || !reads.has(agentId)) return unexpected('getAgentConfiguration:' + tenantId + ':' + agentId);
        return reads.get(agentId)!;
    });
    api.listAgents.mockImplementation(async (tenantId: string) => {
        if (tenantId !== TENANT) return unexpected('listAgents:' + tenantId);
        return { success: true, data: [AGENT_A, AGENT_B].map(agentId => {
            const body = agentBody(agentId);
            return { id: agentId, name: body.name, is_active: true, is_default: body.isDefault,
                config_json: body.configJson, channels: [], channel_bindings: [] };
        }) };
    });
    api.fetch.mockImplementation(async (endpoint: string) => endpoint === '/channels/overview'
        ? { success: true, data: [{ channelType: 'telegram', accountId: 'synthetic-account', displayName: 'QA connection' }] }
        : unexpected('fetch:' + endpoint));
    for (const method of ['getServices', 'getAvailability']) {
        api[method].mockImplementation(async (tenantId: string) => {
            if (tenantId !== TENANT) return unexpected(method + ':' + tenantId);
            return { success: true, data: [] };
        });
    }
    api.getAgentQualityOverview.mockImplementation(async (tenantId: string, agentId: string) => {
        if (tenantId !== TENANT || ![AGENT_A, AGENT_B].includes(agentId)) return unexpected('getAgentQualityOverview:' + tenantId + ':' + agentId);
        return { success: false, error: 'Synthetic quality read unavailable' };
    });
    // Any save/activation/proposal/etc remains an unexpected call. These
    // tests only read and switch the mocked current route.
}

interface ContextScreen extends RenderedScreen { rerender: () => Promise<void> }
async function openEditor(locale: Locale): Promise<ContextScreen> {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const rerender = async () => {
        await act(async () => root.render(
            <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]} timeZone="America/Bogota">
                <AgentEditorPage />
            </NextIntlClientProvider>,
        ));
        await interact(() => {});
    };
    await rerender();
    return {
        container, rerender,
        unmount: () => { act(() => root.unmount()); container.remove(); },
    };
}
function expectLoadingCurrentContext(screen: RenderedScreen, locale: Locale) {
    expect(screen.container.textContent).toContain(MESSAGES[locale].agent.loading);
    expect(screen.container.querySelector('#tour-target-agent-name input')).toBeNull();
    expect(screen.container.querySelector('h1')).toBeNull();
    expect(screen.container.textContent).not.toContain(MESSAGES[locale].common.loadFailed);
}
function expectCurrentAgentB(screen: RenderedScreen) {
    const body = agentBody(AGENT_B);
    expect(screen.container.querySelector<HTMLInputElement>('#tour-target-agent-name input')?.value).toBe(body.name);
    expect(screen.container.querySelector('h1')?.textContent).toBe(body.name);
    const hrefs = Array.from(screen.container.querySelectorAll<HTMLAnchorElement>('a[href]')).map(anchor => anchor.getAttribute('href'));
    expect(hrefs).toContain('/admin/agent/' + AGENT_B + '/test');
    expect(hrefs).not.toContain('/admin/agent/' + AGENT_A + '/test');
    expect(screen.container.querySelector<HTMLInputElement>('#tour-target-agent-name input')?.value).not.toBe(agentBody(AGENT_A).name);
}
function expectOnlyReadsForCurrentActorContext() {
    const configurations = api.getAgentConfiguration.mock.calls;
    expect(configurations.every(([tenantId]) => tenantId === TENANT)).toBe(true);
    expect(mockUnexpectedCalls).toEqual([]);
}

describe.each(LOCALES)('editor response order within one authenticated tenant (%s)', locale => {
    beforeEach(() => {
        mockAgentId = AGENT_A;
        mockUnexpectedCalls.length = 0;
        for (const value of [MESSAGES[locale].agent.loading, MESSAGES[locale].common.loadFailed])
            expect(typeof value).toBe('string');
    });
    afterEach(() => expectOnlyReadsForCurrentActorContext());

    it('positive: a late success for agent A cannot replace the visible identity and links of current agent B', async () => {
        const older = deferred<ReadEnvelope>(), current = deferred<ReadEnvelope>();
        configureApi(new Map([[AGENT_A, older.promise], [AGENT_B, current.promise]]));
        const screen = await openEditor(locale);
        try {
            expectLoadingCurrentContext(screen, locale);
            mockAgentId = AGENT_B;
            await screen.rerender();
            expectLoadingCurrentContext(screen, locale);
            expect(api.getAgentConfiguration.mock.calls).toEqual([[TENANT, AGENT_A], [TENANT, AGENT_B]]);
            await interact(() => current.resolve(readEnvelope(AGENT_B)));
            expectCurrentAgentB(screen);
            await interact(() => older.resolve(readEnvelope(AGENT_A)));
            expectCurrentAgentB(screen);
            expect(screen.container.textContent).not.toContain(MESSAGES[locale].common.loadFailed);
        } finally { screen.unmount(); }
    });

    it('positive: an old failed read for agent A cannot replace the pending current B read with an error or an old form', async () => {
        const older = deferred<ReadEnvelope>(), current = deferred<ReadEnvelope>();
        configureApi(new Map([[AGENT_A, older.promise], [AGENT_B, current.promise]]));
        const screen = await openEditor(locale);
        try {
            mockAgentId = AGENT_B;
            await screen.rerender();
            expectLoadingCurrentContext(screen, locale);
            await interact(() => older.resolve({ success: false, error: 'Synthetic retired-context read failure' }));
            expectLoadingCurrentContext(screen, locale);
            await interact(() => current.resolve(readEnvelope(AGENT_B)));
            expectCurrentAgentB(screen);
            expect(screen.container.textContent).not.toContain(MESSAGES[locale].common.loadFailed);
            expect(api.getAgentConfiguration.mock.calls).toEqual([[TENANT, AGENT_A], [TENANT, AGENT_B]]);
        } finally { screen.unmount(); }
    });

    it('control: the current agent B response does replace loading with its own operational identity and links', async () => {
        mockAgentId = AGENT_B;
        const current = deferred<ReadEnvelope>();
        configureApi(new Map([[AGENT_B, current.promise]]));
        const screen = await openEditor(locale);
        try {
            expectLoadingCurrentContext(screen, locale);
            await interact(() => current.resolve(readEnvelope(AGENT_B)));
            expectCurrentAgentB(screen);
            expect(screen.container.textContent).not.toContain(MESSAGES[locale].agent.loading);
            expect(screen.container.textContent).not.toContain(MESSAGES[locale].common.loadFailed);
            expect(api.getAgentConfiguration.mock.calls).toEqual([[TENANT, AGENT_B]]);
        } finally { screen.unmount(); }
    });
});

