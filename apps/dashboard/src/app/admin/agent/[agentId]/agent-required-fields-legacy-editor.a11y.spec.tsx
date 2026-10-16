import * as fs from 'fs';
import * as path from 'path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import type { AgentConfigurationWorkspace, AgentDraftBody, SaveAgentDraftRequest } from '@parallext/shared';
import { interact, type RenderedScreen } from '@/test/a11y';
import AgentEditorPage from './page';

/**
 * PREPARED V2 HARNESS REPAIR ONLY. Root preregisters and executes.
 * The real Instructions tab appends a count badge; localized text containment
 * plus exact role/data-tab-id uniqueness and selected state identify the tab.
 * All functional field-preservation and Save payload oracles are unchanged.
 * Prior API16 controls passed; do not rerun API for this selector repair.
 * Destination: apps/dashboard/src/app/admin/agent/[agentId]/
 * agent-required-fields-legacy-editor.a11y.spec.tsx
 *
 * Real full saved editor/workspace hydration, NextIntl, Instructions tab and
 * advanced RequiredFieldsSection. Strict read/save API boundary doubles.
 * Add one context and one named question through visible controls; preserve
 * all existing semantically required fields in the shown UI and save payload.
 * Save double returns success:false and never persists. No model/SQL/HTTP/
 * production UI/real AT. No catalogue query or PII gate and no DEF019 reopening.
 * No private state, injected DOM or isolated child lifecycle is inspected.
 * Paired consumer spec uses the real source template/validator/Persona/Assembler.
 */
const TENANT = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';
const LOCALES = ['es', 'en', 'pt', 'fr'] as const;
type Locale = typeof LOCALES[number];
const MESSAGES = Object.fromEntries(LOCALES.map(locale => [locale,
    JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../../messages', locale + '.json'), 'utf8')),
])) as Record<Locale, any>;
const LEGACY = { name: { required: true }, email: { required: true }, phone: { required: false } };
const CASES = [
    { name: 'legacy technology template requirements', fields: LEGACY, expected: ['email', 'name'] },
    { name: 'mixed legacy and canonical context', fields: { ...LEGACY,
        quote: [{ field: 'tax_id', question: 'QA_TAX_ID_QUESTION' }] }, expected: ['email', 'name', 'tax_id'] },
    { name: 'canonical requirement context', fields: { general: [
        { field: 'name', question: 'QA_NAME_QUESTION' }, { field: 'email', question: 'QA_EMAIL_QUESTION' },
    ] }, expected: ['email', 'name'] },
    { name: 'no prior required information', fields: {}, expected: [] },
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
function bodyFor(fields: typeof CASES[number]['fields'], locale: Locale): AgentDraftBody {
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
describe.each(LOCALES)('saved required information survives an additive editor change (%s)', locale => {
    beforeEach(() => { mockUnexpectedCalls.length = 0; });
    afterEach(() => expect(mockUnexpectedCalls).toEqual([]));
    it.each(CASES)('$name stays visible and remains in the submitted required fields', async testcase => {
        mockBody = bodyFor(testcase.fields, locale); configureApi();
        const screen = await openEditor(locale);
        try {
            const behaviorTabs = Array.from(screen.container.querySelectorAll<HTMLButtonElement>('button[role="tab"][data-tab-id="instructions"]'));
            expect(behaviorTabs).toHaveLength(1);
            expect(behaviorTabs[0].textContent?.trim()).toContain(MESSAGES[locale].agent.tabs.instructions);
            await interact(() => behaviorTabs[0].click());
            expect(behaviorTabs[0].getAttribute('aria-selected')).toBe('true');
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
            const visibleBefore = Array.from(section.querySelectorAll<HTMLInputElement>('input'))
                .filter(input => input.placeholder === text.fieldNamePlaceholder).map(input => input.value).sort();
            const addContexts = Array.from(section.querySelectorAll<HTMLButtonElement>('button')).filter(button => button.textContent?.trim() === text.addContext);
            expect(addContexts).toHaveLength(1);
            await interact(() => addContexts[0].click());
            const contexts = Array.from(section.querySelectorAll<HTMLInputElement>('input'))
                .filter(input => input.placeholder === text.contextPlaceholder && input.value === 'nuevo_contexto');
            expect(contexts).toHaveLength(1);
            // Source: context input belongs to its header row; that row's
            // parent is this visible context card containing Add field.
            const contextCard = contexts[0].parentElement!.parentElement!;
            const addFields = Array.from(contextCard.querySelectorAll<HTMLButtonElement>('button')).filter(button => button.textContent?.trim() === text.addField);
            expect(addFields).toHaveLength(1);
            await interact(() => addFields[0].click());
            const fieldNames = Array.from(contextCard.querySelectorAll<HTMLInputElement>('input')).filter(input => input.placeholder === text.fieldNamePlaceholder);
            const questions = Array.from(contextCard.querySelectorAll<HTMLInputElement>('input')).filter(input => input.placeholder === text.questionPlaceholder);
            expect(fieldNames).toHaveLength(1); expect(questions).toHaveLength(1);
            await interact(() => changeText(fieldNames[0], 'qa_preference'));
            await interact(() => changeText(questions[0], 'QA_PREFERENCE_QUESTION_' + locale));
            const saves = Array.from(screen.container.querySelectorAll<HTMLButtonElement>('button'))
                .filter(button => button.textContent?.trim() === MESSAGES[locale].common.save && !button.disabled);
            expect(saves.length).toBeGreaterThan(0);
            await interact(() => saves[0].click());
            expect(api.saveAgentDraft).toHaveBeenCalledTimes(1);
            const request = api.saveAgentDraft.mock.calls[0][2] as SaveAgentDraftRequest;
            expect(request.body.name).toBe('Synthetic required-information agent');
            const submitted = request.body.configJson.behavior?.requiredFields;
            expect(submitted?.nuevo_contexto).toEqual([{ field: 'qa_preference', question: 'QA_PREFERENCE_QUESTION_' + locale }]);
            expect({ visibleBefore, submittedFields: requiredInventory(submitted) }).toEqual({
                visibleBefore: testcase.expected, submittedFields: [...testcase.expected, 'qa_preference'].sort(),
            });
            expect(api.getAgentConfiguration).toHaveBeenCalledTimes(1);
        } finally { screen.unmount(); }
    });
});
