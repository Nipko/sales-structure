import * as fs from 'fs';
import * as path from 'path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import type { AgentConfigurationWorkspace, AgentDraftBody, SaveAgentDraftRequest } from '@parallext/shared';
import { interact, type RenderedScreen } from '@/test/a11y';
import AgentEditorPage from './page';

/**
 * PREPARATION ONLY. Root preregisters and executes 16 cases, no product verdict.
 * Full saved editor, NextIntl and real parent updateConfig/deepMerge. All input
 * comes from native visible controls; no isolated RequiredFieldsSection mock.
 * Every case edits the Persona name first so Save remains legitimately enabled
 * even when rejecting a collision or making no required-fields change.
 * Save captures the faithful request and returns success:false; no persistence,
 * model, SQL, production UI, HTTP, or AT. Canonical contexts only; DEF019/133
 * and the prior API16/legacy editor16 controls are not rerun by this spec.
 * Exact keys and question arrays matter: no deduplicated-inventory-only oracle.
 * Destination: apps/dashboard/src/app/admin/agent/[agentId]/
 * agent-required-context-mutations.a11y.spec.tsx
 */
const TENANT = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';
const LOCALES = ['es', 'en', 'pt', 'fr'] as const;
type Locale = typeof LOCALES[number];
const MESSAGES = Object.fromEntries(LOCALES.map(locale => [locale,
    JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../../messages', locale + '.json'), 'utf8')),
])) as Record<Locale, any>;
const CANONICAL = {
    support: [{ field: 'name', question: 'QA_NAME_QUESTION' }],
    quote: [{ field: 'email', question: 'QA_EMAIL_QUESTION' }],
};
const CASES = [
    { name: 'unique context rename replaces its old key', action: 'rename_unique',
        expected: { support_qa: CANONICAL.support, quote: CANONICAL.quote } },
    { name: 'colliding context rename preserves both original contexts', action: 'rename_collision', expected: CANONICAL },
    { name: 'remove context removes only the selected context', action: 'remove', expected: { quote: CANONICAL.quote } },
    { name: 'unchanged required contexts survive unrelated name save', action: 'unchanged', expected: CANONICAL },
] as const;
const LOCALE_CODES = { es: 'es-CO', en: 'en-US', pt: 'pt-BR', fr: 'fr-FR' } as const;
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
function bodyFor(fields: typeof CANONICAL, locale: Locale): AgentDraftBody {
    return { name: 'Synthetic required-information agent', channels: ['telegram'], channelBindings: [], scheduleMode: '24_7', isActive: true, isDefault: true,
        configJson: {
            persona: { name: 'Synthetic required-information agent', role: 'Support', fallbackMessage: 'No confirmed information.' },
            behavior: { rules: ['Use confirmed facts.'], forbiddenTopics: [], handoffTriggers: ['Human requested'], requiredFields: fields },
            language: LOCALE_CODES[locale], industry: 'retail', tools: { appointments: { enabled: false } },
            llm: {}, rag: { enabled: false, topK: 5, similarityThreshold: 0.75 },
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
function requiredInventory(value: any): string[] {
    const fields: string[] = [];
    for (const [key, entry] of Object.entries(value || {})) {
        if (Array.isArray(entry)) fields.push(...entry.map(field => field.field));
        else if (entry && typeof entry === 'object' && (entry as any).required === true && ['name', 'email', 'phone'].includes(key)) fields.push(key);
    }
    return fields.sort();
}
function changeText(input: HTMLInputElement, value: string) {
    expect(input.disabled || input.readOnly).toBe(false);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
}
function contextSnapshot(section: HTMLElement, text: any): Record<string, Array<{ field: string; question: string }>> {
    const result: Record<string, Array<{ field: string; question: string }>> = {};
    for (const context of Array.from(section.querySelectorAll<HTMLInputElement>('input'))
        .filter(input => input.placeholder === text.contextPlaceholder)) {
        const card = context.parentElement!.parentElement!;
        const names = Array.from(card.querySelectorAll<HTMLInputElement>('input')).filter(input => input.placeholder === text.fieldNamePlaceholder);
        const questions = Array.from(card.querySelectorAll<HTMLInputElement>('input')).filter(input => input.placeholder === text.questionPlaceholder);
        expect(names).toHaveLength(questions.length);
        result[context.value] = names.map((input, index) => ({ field: input.value, question: questions[index].value }));
    }
    return result;
}
describe.each(LOCALES)('saved canonical required context mutations through full editor (%s)', locale => {
    beforeEach(() => { mockUnexpectedCalls.length = 0; });
    afterEach(() => expect(mockUnexpectedCalls).toEqual([]));
    it.each(CASES)('$name in both visible form and captured request', async testcase => {
        mockBody = bodyFor(structuredClone(CANONICAL), locale);
        const original = structuredClone(mockBody.configJson.behavior!.requiredFields);
        configureApi(); const screen = await openEditor(locale);
        try {
            const persona = Array.from(screen.container.querySelectorAll<HTMLButtonElement>('button[role="tab"][data-tab-id="persona"]'));
            expect(persona).toHaveLength(1);
            expect(persona[0].textContent?.trim()).toContain(MESSAGES[locale].agent.tabs.persona);
            await interact(() => persona[0].click());
            expect(persona[0].getAttribute('aria-selected')).toBe('true');
            const nameInput = screen.container.querySelector<HTMLInputElement>('#tour-target-agent-name input');
            expect(nameInput).not.toBeNull();
            expect(nameInput!.placeholder).toBe(MESSAGES[locale].agent.identity.agentNamePlaceholder);
            expect(nameInput!.value).toBe(mockBody.name);
            await interact(() => changeText(nameInput!, 'Synthetic context-mutation QA'));
            const tabs = Array.from(screen.container.querySelectorAll<HTMLButtonElement>('button[role="tab"][data-tab-id="instructions"]'));
            expect(tabs).toHaveLength(1);
            // Instructions has a count badge; this is a navigation guard.
            expect(tabs[0].textContent?.trim()).toContain(MESSAGES[locale].agent.tabs.instructions);
            await interact(() => tabs[0].click());
            expect(tabs[0].getAttribute('aria-selected')).toBe('true');
            const advanced = Array.from(screen.container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]'))
                .filter(button => button.textContent?.trim() === MESSAGES[locale].agent.advanced.title);
            expect(advanced).toHaveLength(1);
            await interact(() => advanced[0].click());
            expect(advanced[0].getAttribute('aria-expanded')).toBe('true');
            const text = MESSAGES[locale].agent.behaviorSection.requiredFields;
            const headings = Array.from(screen.container.querySelectorAll('h4')).filter(heading => heading.textContent?.trim() === text.title);
            expect(headings).toHaveLength(1);
            const section = headings[0].closest('section')!;
            expect(section).not.toBeNull();
            const visibleBaseline = contextSnapshot(section, text);
            expect(visibleBaseline).toEqual(original);
            const support = Array.from(section.querySelectorAll<HTMLInputElement>('input'))
                .filter(input => input.placeholder === text.contextPlaceholder && input.value === (testcase.action === 'rename_collision' ? 'quote' : 'support'));
            expect(support).toHaveLength(1);
            expect(support[0].disabled || support[0].readOnly).toBe(false);
            if (testcase.action === 'rename_unique') await interact(() => changeText(support[0], 'support_qa'));
            // Direction fixed BEFORE preregistration: quote -> support with base
            // order support(name), quote(email) makes last-assignment overwrite observable.
            if (testcase.action === 'rename_collision') await interact(() => changeText(support[0], 'support'));
            if (testcase.action === 'remove') {
                // The visible context header contains its input and exactly
                // one native remove-context button, per actual source JSX.
                const remove = Array.from(support[0].parentElement!.querySelectorAll<HTMLButtonElement>('button'));
                expect(remove).toHaveLength(1); expect(remove[0].disabled).toBe(false);
                await interact(() => remove[0].click());
            }
            const visibleAfter = contextSnapshot(section, text);
            const saves = Array.from(screen.container.querySelectorAll<HTMLButtonElement>('button'))
                .filter(button => button.textContent?.trim() === MESSAGES[locale].common.save && !button.disabled);
            expect(saves.length).toBeGreaterThan(0);
            await interact(() => saves[0].click());
            expect(api.saveAgentDraft).toHaveBeenCalledTimes(1);
            const request = api.saveAgentDraft.mock.calls[0][2] as SaveAgentDraftRequest;
            expect(request.body.name).toBe('Synthetic context-mutation QA');
            const submitted = request.body.configJson.behavior?.requiredFields;
            expect({ visibleAfter, submitted }).toEqual({ visibleAfter: testcase.expected, submitted: testcase.expected });
            expect(mockBody.configJson.behavior!.requiredFields).toEqual(original);
            expect(api.getAgentConfiguration).toHaveBeenCalledTimes(1);
        } finally { screen.unmount(); }
    });
});
