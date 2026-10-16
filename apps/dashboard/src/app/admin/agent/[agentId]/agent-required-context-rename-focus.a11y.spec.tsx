import * as fs from 'fs';
import * as path from 'path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import type { AgentConfigurationWorkspace, AgentDraftBody, SaveAgentDraftRequest } from '@parallext/shared';
import { interact, type RenderedScreen } from '@/test/a11y';
import AgentEditorPage from './page';

/**
 * PREPARATION ONLY: one Spanish correction-risk control, root preregisters.
 * Native focus() and two native value/input changes on CURRENT visible context
 * inputs, without refocusing after the first change. Captures activeElement
 * and DOM identity after both changes; then captures Save success:false.
 * It is not physical keyboard, browser painted focus, real AT or LLM evidence.
 * Existing 72 cases are preserved and not repeated by this control.
 * Destination: apps/dashboard/src/app/admin/agent/[agentId]/
 * agent-required-context-rename-focus.a11y.spec.tsx
 */
const TENANT = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';
const LOCALES = ['es'] as const;
type Locale = typeof LOCALES[number];
const MESSAGES = Object.fromEntries(LOCALES.map(locale => [locale,
    JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../../messages', locale + '.json'), 'utf8')),
])) as Record<Locale, any>;
const CANONICAL = {
    support: [{ field: 'name', question: 'QA_NAME_QUESTION' }],
    quote: [{ field: 'email', question: 'QA_EMAIL_QUESTION' }],
};
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
describe('required context rename retains editable input focus (es)', () => {
    beforeEach(() => { mockUnexpectedCalls.length = 0; });
    afterEach(() => expect(mockUnexpectedCalls).toEqual([]));
    it('keeps the same focused input across two visible native edits and captures the final map', async () => {
        const locale: Locale = 'es';
        mockBody = bodyFor(structuredClone(CANONICAL), locale);
        const original = structuredClone(mockBody.configJson.behavior!.requiredFields);
        configureApi(); const screen = await openEditor(locale);
        try {
            const tabs = Array.from(screen.container.querySelectorAll<HTMLButtonElement>('button[role="tab"][data-tab-id="instructions"]'));
            expect(tabs).toHaveLength(1);
            expect(tabs[0].textContent?.trim()).toContain(MESSAGES[locale].agent.tabs.instructions);
            await interact(() => tabs[0].click());
            expect(tabs[0].getAttribute('aria-selected')).toBe('true');
            const advanced = Array.from(screen.container.querySelectorAll<HTMLButtonElement>('button[aria-expanded]'))
                .filter(button => button.textContent?.trim() === MESSAGES[locale].agent.advanced.title);
            expect(advanced).toHaveLength(1); await interact(() => advanced[0].click());
            expect(advanced[0].getAttribute('aria-expanded')).toBe('true');
            const text = MESSAGES[locale].agent.behaviorSection.requiredFields;
            const headings = Array.from(screen.container.querySelectorAll('h4')).filter(heading => heading.textContent?.trim() === text.title);
            expect(headings).toHaveLength(1); const section = headings[0].closest('section')!;
            expect(contextSnapshot(section, text)).toEqual(original);
            const contextByName = (name: string) => Array.from(section.querySelectorAll<HTMLInputElement>('input'))
                .filter(input => input.placeholder === text.contextPlaceholder && input.value === name);
            const before = contextByName('support'); expect(before).toHaveLength(1);
            const input = before[0]; expect(input.disabled || input.readOnly).toBe(false);
            await interact(() => input.focus()); expect(document.activeElement).toBe(input);
            await interact(() => changeText(input, 'support_q'));
            const first = contextByName('support_q'); expect(first).toHaveLength(1);
            // Capture continuity before the next visible action. Do not repair
            // focus or dispatch events to a detached original DOM node.
            const firstContinuity = { sameInput: first[0] === input, focused: document.activeElement === first[0], originalConnected: input.isConnected };
            expect(first[0].disabled || first[0].readOnly).toBe(false);
            await interact(() => changeText(first[0], 'support_qa'));
            const second = contextByName('support_qa'); expect(second).toHaveLength(1);
            const secondContinuity = { sameInput: second[0] === input, focused: document.activeElement === second[0], originalConnected: input.isConnected };
            const visibleFinal = contextSnapshot(section, text);
            const saves = Array.from(screen.container.querySelectorAll<HTMLButtonElement>('button'))
                .filter(button => button.textContent?.trim() === MESSAGES[locale].common.save && !button.disabled);
            expect(saves.length).toBeGreaterThan(0); await interact(() => saves[0].click());
            expect(api.saveAgentDraft).toHaveBeenCalledTimes(1);
            const submitted = (api.saveAgentDraft.mock.calls[0][2] as SaveAgentDraftRequest).body.configJson.behavior?.requiredFields;
            const finalMap = { support_qa: CANONICAL.support, quote: CANONICAL.quote };
            expect({ firstContinuity, secondContinuity, visibleFinal, submitted }).toEqual({
                firstContinuity: { sameInput: true, focused: true, originalConnected: true },
                secondContinuity: { sameInput: true, focused: true, originalConnected: true },
                visibleFinal: finalMap, submitted: finalMap,
            });
            expect(mockBody.configJson.behavior!.requiredFields).toEqual(original);
            expect(api.getAgentConfiguration).toHaveBeenCalledTimes(1);
        } finally { screen.unmount(); }
    });
});
