import * as fs from 'fs';
import * as path from 'path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { normalizeRequiredFields } from '@parallext/shared';
import type { AgentConfigurationWorkspace, AgentDraftBody, SaveAgentDraftRequest } from '@parallext/shared';
import { interact, type RenderedScreen } from '@/test/a11y';
import AgentEditorPage from './page';

/**
 * NEW CORRECTION CONTROL ONLY: 4 locales, one case each with 2 sequential
 * observable checkpoints (unrelated name Save; then additive required field).
 * Root fixes denominator=4 before first Jest. No new defect/global acceptance.
 * Saved fixture has supported legacy requirements, optional false, unknown
 * general passthrough, occupied general_legacy and empty canonical context.
 * All changes use real full editor/NextIntl and native visible controls.
 * Strict Save double returns success:false twice, never persists.
 * Real shared normalizer checks effective field/question inventory separately.
 * No previous red spec is modified; no API/model/DB/production UI/AT.
 * Destination: apps/dashboard/src/app/admin/agent/[agentId]/
 * agent-required-fields-adapter-preservation.a11y.spec.tsx
 */
const TENANT = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';
const LOCALES = ['es', 'en', 'pt', 'fr'] as const;
type Locale = typeof LOCALES[number];
const MESSAGES = Object.fromEntries(LOCALES.map(locale => [locale,
    JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../../messages', locale + '.json'), 'utf8')),
])) as Record<Locale, any>;
const FIXTURE: Record<string, any> = {
    name: { required: true }, email: { required: true }, phone: { required: false },
    general: { required: false, note: 'QA_UNKNOWN_GENERAL', opaque: { keep: true } },
    general_legacy: [{ field: 'tax_id', question: 'QA_TAX_ID_QUESTION' }],
    empty_context: [],
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
function bodyFor(fields: Record<string, any>, locale: Locale): AgentDraftBody {
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
function normalizedInventory(fields: unknown, locale: Locale) {
    return Object.values(normalizeRequiredFields(fields, { language: LOCALE_CODES[locale] }))
        .flat().map(field => ({ field: field.field, question: field.question }))
        .sort((a, b) => a.field.localeCompare(b.field) || a.question.localeCompare(b.question));
}
describe.each(LOCALES)('required-field adapter preserves author configuration (%s)', locale => {
    beforeEach(() => { mockUnexpectedCalls.length = 0; });
    afterEach(() => expect(mockUnexpectedCalls).toEqual([]));
    it('keeps raw data on unrelated save and preserves passthrough, empty contexts and consumed inventory on addition', async () => {
        mockBody = bodyFor(structuredClone(FIXTURE), locale);
        const original = structuredClone(mockBody.configJson.behavior!.requiredFields);
        const consumedBefore = normalizedInventory(original, locale);
        expect(consumedBefore.map(field => field.field)).toEqual(['email', 'name', 'tax_id']);
        configureApi(); const screen = await openEditor(locale);
        try {
            const persona = Array.from(screen.container.querySelectorAll<HTMLButtonElement>('button[role="tab"][data-tab-id="persona"]'));
            expect(persona).toHaveLength(1);
            expect(persona[0].textContent?.trim()).toContain(MESSAGES[locale].agent.tabs.persona);
            await interact(() => persona[0].click());
            expect(persona[0].getAttribute('aria-selected')).toBe('true');
            const name = screen.container.querySelector<HTMLInputElement>('#tour-target-agent-name input');
            expect(name).not.toBeNull();
            expect(name!.placeholder).toBe(MESSAGES[locale].agent.identity.agentNamePlaceholder);
            await interact(() => changeText(name!, 'Synthetic adapter-preservation QA'));
            const saveButtons = () => Array.from(screen.container.querySelectorAll<HTMLButtonElement>('button'))
                .filter(button => button.textContent?.trim() === MESSAGES[locale].common.save && !button.disabled);
            expect(saveButtons().length).toBeGreaterThan(0);
            await interact(() => saveButtons()[0].click());
            expect(api.saveAgentDraft).toHaveBeenCalledTimes(1);
            const unrelated = api.saveAgentDraft.mock.calls[0][2] as SaveAgentDraftRequest;
            expect(unrelated.body.name).toBe('Synthetic adapter-preservation QA');
            expect(unrelated.body.configJson.behavior?.requiredFields).toEqual(original);
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
            const initialView = contextSnapshot(section, text);
            expect(Object.keys(initialView).sort()).toEqual(['empty_context', 'general_legacy', 'general_legacy_1']);
            expect(initialView.empty_context).toEqual([]);
            expect(initialView.general_legacy).toEqual(FIXTURE.general_legacy);
            expect(normalizedInventory(initialView, locale)).toEqual(consumedBefore);
            const add = Array.from(section.querySelectorAll<HTMLButtonElement>('button')).filter(button => button.textContent?.trim() === text.addContext);
            expect(add).toHaveLength(1); await interact(() => add[0].click());
            const added = Array.from(section.querySelectorAll<HTMLInputElement>('input'))
                .filter(input => input.placeholder === text.contextPlaceholder && input.value === 'nuevo_contexto');
            expect(added).toHaveLength(1); expect(added[0].disabled || added[0].readOnly).toBe(false);
            const card = added[0].parentElement!.parentElement!;
            const addField = Array.from(card.querySelectorAll<HTMLButtonElement>('button')).filter(button => button.textContent?.trim() === text.addField);
            expect(addField).toHaveLength(1); await interact(() => addField[0].click());
            const names = Array.from(card.querySelectorAll<HTMLInputElement>('input')).filter(input => input.placeholder === text.fieldNamePlaceholder);
            const questions = Array.from(card.querySelectorAll<HTMLInputElement>('input')).filter(input => input.placeholder === text.questionPlaceholder);
            expect(names).toHaveLength(1); expect(questions).toHaveLength(1);
            await interact(() => changeText(names[0], 'qa_preference'));
            await interact(() => changeText(questions[0], 'QA_PREFERENCE_QUESTION_' + locale));
            expect(saveButtons().length).toBeGreaterThan(0); await interact(() => saveButtons()[0].click());
            expect(api.saveAgentDraft).toHaveBeenCalledTimes(2);
            const submitted = (api.saveAgentDraft.mock.calls[1][2] as SaveAgentDraftRequest).body.configJson.behavior!.requiredFields;
            expect(submitted.phone).toEqual(original.phone);
            expect(submitted.general).toEqual(original.general);
            expect(submitted.general_legacy).toEqual(original.general_legacy);
            expect(submitted.empty_context).toEqual([]);
            expect(submitted.general_legacy_1).toEqual(normalizeRequiredFields(original, { language: LOCALE_CODES[locale] }).general);
            expect(submitted.nuevo_contexto).toEqual([{ field: 'qa_preference', question: 'QA_PREFERENCE_QUESTION_' + locale }]);
            expect(Object.keys(submitted).sort()).toEqual(['phone', 'general', 'general_legacy', 'empty_context', 'general_legacy_1', 'nuevo_contexto'].sort());
            expect(normalizedInventory(submitted, locale)).toEqual([...consumedBefore,
                { field: 'qa_preference', question: 'QA_PREFERENCE_QUESTION_' + locale }]
                .sort((a, b) => a.field.localeCompare(b.field) || a.question.localeCompare(b.question)));
            const expectedView = { general_legacy: original.general_legacy, empty_context: [],
                general_legacy_1: submitted.general_legacy_1, nuevo_contexto: submitted.nuevo_contexto };
            expect(contextSnapshot(section, text)).toEqual(expectedView);
            expect(mockBody.configJson.behavior!.requiredFields).toEqual(original);
            expect(api.getAgentConfiguration).toHaveBeenCalledTimes(1);
        } finally { screen.unmount(); }
    });
});
