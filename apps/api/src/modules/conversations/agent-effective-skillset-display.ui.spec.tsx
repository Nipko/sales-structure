/** @jest-environment node */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import type { AgentDraftBody } from '@parallext/shared';
import { agentTurnFixture } from './__fixtures__/agent-turn.fixture';
import { authorityFor } from './__fixtures__/tool-authority.fixture';
import { PersonaService } from '../persona/persona.service';
import { PromptAssemblerService } from './prompt-assembler.service';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';
import { resolveKnowledgeReplica } from '../evaluation-revision/evaluation-knowledge-replica';

/** PREPARATION ONLY, not copied/compiled/imported/run. Proposed destination:
 * apps/api/src/modules/conversations/agent-effective-skillset-display.ui.spec.tsx
 * Exactly12 PAIRED cases: 4 locales x salud omitted / salud explicit both /
 * retail omitted. One immutable saved object feeds the actual full Editor and
 * the actual AgentTest -> Conversations -> Persona/PromptAssembler consumer.
 * ONLY final LLMRouter.execute is a fixed external sentinel, not a provider.
 * Runtime defaults are already unit-covered: the new criterion compares the
 * editor's displayed mode/upsell section to the same config's effective prompt.
 * No Save, private interception, real DB/cache/model/channel or AT/paint claim.
 * Root must reconcile the actual successor base and review mixed Node/DOM seams
 * before preregistration/copy/first Jest; excluded from the current14-file batch.
 */
const TENANT = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';
const SCHEMA = 'tenant_test';
const LANGUAGE = [
    { code: 'es', question: '¿Qué información general está disponible?', reply: 'Puedo ayudar con información general.' },
    { code: 'en', question: 'What general information is available?', reply: 'I can help with general information.' },
    { code: 'pt', question: 'Que informação geral está disponível?', reply: 'Posso ajudar com informações gerais.' },
    { code: 'fr', question: 'Quelles informations générales sont disponibles ?', reply: 'Je peux vous aider avec des informations générales.' },
] as const;
type Locale = typeof LANGUAGE[number]['code'];
const CASES = [
    { id: 'SHOW-SUPPORT', industry: 'salud', subType: 'dental', configured: undefined,
        expected: { mode: 'support', sales: false, support: true, balance: false, noPitch: true, upsell: false } },
    { id: 'SHOW-EXPLICIT-BOTH', industry: 'salud', subType: 'dental', configured: 'both',
        expected: { mode: 'both', sales: true, support: true, balance: true, noPitch: true, upsell: false } },
    { id: 'SHOW-RETAIL-BOTH', industry: 'retail', subType: 'moda', configured: undefined,
        expected: { mode: 'both', sales: true, support: true, balance: true, noPitch: false, upsell: false } },
] as const;
type Case = typeof CASES[number];
const MESSAGES = Object.fromEntries(LANGUAGE.map(({ code }) => [code,
    JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../dashboard/messages', code + '.json'), 'utf8')),
])) as Record<Locale, any>;
const json = (value: unknown) => JSON.stringify(value);
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
function freeze<T>(value: T): T {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        for (const child of Object.values(value)) freeze(child);
        Object.freeze(value);
    }
    return value;
}
let mockBody: AgentDraftBody;
let mockIndustry = 'retail';
let mockSubType = 'moda';
const mockUnexpected: string[] = [];
const mockNavigation: string[] = [];
const mockParams = new URLSearchParams();
function mockFail(label: string): never { mockUnexpected.push(label); throw new Error('Unexpected boundary: ' + label); }

jest.mock('@/lib/api', () => {
    const methods: Record<string, jest.Mock> = {};
    return { api: new Proxy(methods, { get(target, key) {
        if (typeof key !== 'string') return undefined;
        target[key] ??= jest.fn(async () => mockFail('editor.api.' + key));
        return target[key];
    } }) };
});
jest.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ activeTenantId: '11111111-1111-4111-8111-111111111111' }) }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({
    user: { id: '33333333-3333-4333-8333-333333333333', role: 'tenant_admin', tenantId: '11111111-1111-4111-8111-111111111111' },
    verticalConfig: { industry: mockIndustry, subType: mockSubType }, isVerticalConfigLoading: false,
    planFeatures: { customerPayments: false },
}) }));
jest.mock('next/navigation', () => ({
    useRouter: () => Object.fromEntries(['push', 'replace', 'back', 'forward', 'refresh', 'prefetch']
        .map(key => [key, (...args: unknown[]) => { mockNavigation.push(key + ':' + JSON.stringify(args)); mockFail('navigation.' + key); }])),
    usePathname: () => '/admin/agent/22222222-2222-4222-8222-222222222222',
    useParams: () => ({ agentId: '22222222-2222-4222-8222-222222222222' }),
    useSearchParams: () => mockParams,
}));
// Same host-only shims as dashboard a11y-setup: no app state/policy substitute.
jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children, ...rest }: any) =>
    createElement('a', { href: typeof href === 'string' ? href : '#', ...rest }, children) }));
jest.mock('motion/react', () => ({ __esModule: true,
    motion: new Proxy({}, { get: (_target, tag: string) => ({ children, ...rest }: any) => {
        const animation = new Set(['initial','animate','exit','transition','whileHover','whileTap','whileInView','whileFocus',
            'whileDrag','variants','layout','layoutId','viewport','drag','onAnimationComplete']);
        return createElement(tag, Object.fromEntries(Object.entries(rest).filter(([key]) => !animation.has(key))), children);
    } }), AnimatePresence: ({ children }: any) => children,
}));
const { api } = jest.requireMock('@/lib/api') as { api: Record<string, jest.Mock> };
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://local-skillset.test/admin/agent/' + AGENT });
const globals: Record<string, unknown> = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
    HTMLButtonElement: dom.window.HTMLButtonElement, Element: dom.window.Element,
    Node: dom.window.Node, Event: dom.window.Event, MutationObserver: dom.window.MutationObserver,
    localStorage: dom.window.localStorage, sessionStorage: dom.window.sessionStorage,
    fetch: jest.fn(async () => mockFail('network.fetch')),
    WebSocket: class { constructor() { mockFail('network.WebSocket'); } },
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} }, IS_REACT_ACT_ENVIRONMENT: true,
};
const previous = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries(globals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
dom.window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as any;
dom.window.Element.prototype.scrollIntoView = () => {};
// Only now import the DOM consumers. API services above have no bootstrap.
const { createRoot } = require('react-dom/client') as typeof import('react-dom/client');
const { NextIntlClientProvider } = require('next-intl') as typeof import('next-intl');
const AgentEditorPage = require('../../../../dashboard/src/app/admin/agent/[agentId]/page').default;
afterAll(() => {
    dom.window.close();
    for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as Record<string, unknown>)[key];
    }
});
async function interact(action: () => void) { await act(async () => action()); await act(async () => { await Promise.resolve(); }); }

function savedBody(testcase: Case, locale: Locale): AgentDraftBody {
    return freeze({ name: 'Synthetic saved skillset agent', channels: ['telegram'], channelBindings: [], scheduleMode: '24_7', isActive: true, isDefault: true,
        configJson: { persona: { name: 'Synthetic saved skillset agent', role: 'Support', greeting: '', fallbackMessage: 'No confirmed information.',
            personality: { tone: 'friendly', formality: 'casual-professional', emojiUsage: 'none', humor: '' } },
            behavior: { mainInstructions: '', rules: ['Use confirmed facts.'], forbiddenTopics: [], handoffTriggers: ['Human requested'], requiredFields: {} },
            language: locale, industry: testcase.industry, tools: {},
            hours: { timezone: 'America/Bogota', schedule: {}, aiOutsideHours: true, afterHoursMessage: '' },
            llm: { temperature: 0.25, maxTokens: 600, memory: { shortTerm: 20, longTerm: false, summaryAfter: 30 } },
            rag: { enabled: false, topK: 5, similarityThreshold: 0.35 }, upsell: { enabled: false, intensity: 'subtle', maxDiscountPercent: 0 },
            ...(testcase.configured === undefined ? {} : { skillset: testcase.configured }),
        },
    });
}
function configureEditor() {
    for (const [method, mock] of Object.entries(api)) mock.mockReset().mockImplementation(() => mockFail('editor.api.' + method));
    api.getAgentConfiguration.mockImplementation(async (tenant: string, agent: string) => {
        if (tenant !== TENANT || agent !== AGENT) return mockFail('editor.identity');
        return { success: true, data: { agentId: AGENT, operational: { version: 7, hash: 'a'.repeat(64), body: mockBody },
            draft: null, evaluationRevisionId: null, directCommit: true } };
    });
    api.listAgents.mockImplementation(async (tenant: string) => {
        if (tenant !== TENANT) return mockFail('editor.list.identity');
        return { success: true, data: [{ id: AGENT, name: mockBody.name, config_json: mockBody.configJson, is_active: true,
            is_default: true, channels: mockBody.channels, channel_bindings: [] }] };
    });
    api.fetch.mockImplementation(async (endpoint: string) => endpoint === '/channels/overview'
        ? { success: true, data: [{ channelType: 'telegram', accountId: 'synthetic-account', displayName: 'Synthetic connection' }] }
        : mockFail('editor.fetch.' + endpoint));
    for (const method of ['getServices', 'getAvailability']) api[method].mockImplementation(async (tenant: string) => {
        if (tenant !== TENANT) return mockFail(method + '.identity'); return { success: true, data: [] };
    });
    api.getAgentQualityOverview.mockImplementation(async (tenant: string, agent: string) => {
        if (tenant !== TENANT || agent !== AGENT) return mockFail('editor.quality.identity');
        return { success: false, error: 'Synthetic optional quality unavailable' };
    });
    api.getPlanFeatures.mockImplementation(async (tenant: string) => {
        if (tenant !== TENANT) return mockFail('editor.plan.identity'); return { success: true, data: { customerPayments: false } };
    });
    api.getTenantPaymentsConfig.mockImplementation(async (tenant: string) => {
        if (tenant !== TENANT) return mockFail('editor.payments.identity'); return { success: false, error: 'Synthetic optional payment settings unavailable' };
    });
    // All Save/update/create/Apply methods retain the throwing default.
}

const REGIONAL_KEYS = ['id','language','settings','operatingCurrency','billingCountry','operatingCountry','operatingTimezone',
    'defaultLocale','phoneRegion','addressSchemaId','countryPackId','countryPackVersion'].sort();
const HOURS_SQL = 'SELECT a.user_id, a.day_of_week, a.start_time::text AS start_time, a.end_time::text AS end_time '
    + 'FROM availability_slots a JOIN public.tenants tenant_owner ON tenant_owner.schema_name = $1 AND tenant_owner.is_active = true '
    + 'JOIN public.users u ON u.id = a.user_id AND u.tenant_id = tenant_owner.id AND u.is_active = true WHERE a.is_active = true';
function runtimeFor(testcase: Case, language: typeof LANGUAGE[number]) {
    const config = mockBody.configJson;
    const fail = (label: string): never => mockFail('runtime.' + label);
    const forbidden = (label: string) => jest.fn((..._args: unknown[]) => fail(label));
    const knowledgePresenceReads: any[] = [];
    const tenantRow = { id: TENANT, language: language.code, industry: testcase.industry,
        settings: { timezone: 'America/Bogota' }, operatingCurrency: 'COP', billingCountry: 'CO', operatingCountry: 'CO',
        operatingTimezone: 'America/Bogota', defaultLocale: language.code, phoneRegion: 'CO', addressSchemaId: null, countryPackId: null, countryPackVersion: null };
    const prisma = {
        tenant: { findUnique: jest.fn(async (query: any) => {
            const keys = Object.keys(query.select || {}).sort();
            if (json(query.where) !== json({ id: TENANT }) || Object.values(query.select || {}).some(value => value !== true)
                || ![json(['industry','settings']), json(REGIONAL_KEYS)].includes(json(keys))) return fail('tenant.query');
            return Object.fromEntries(keys.map(key => [key, tenantRow[key as keyof typeof tenantRow]]));
        }) },
        getTenantSchemaName: jest.fn(async (tenant: string) => tenant === TENANT ? SCHEMA : fail('schema.identity')),
        executeInTenantSchema: jest.fn(async (schema: string, sql: string, args: unknown[]) => {
            if (schema !== SCHEMA || sql.replace(/\s+/g, ' ').trim() !== HOURS_SQL || json(args) !== json([SCHEMA])) return fail('SQL.unreviewed');
            return []; // Empty synthetic availability; no SQL engine is executed.
        }),
    };
    const redis = Object.fromEntries(['get','getJson','set','setJson','del'].map(key => [key, forbidden('redis.' + key)]));
    const persona = new PersonaService(prisma as any, redis as any, {} as any, {} as any, {} as any);
    const configValidationError = (() => { try { persona.assertAgentConfigValid(config); return null; } catch (e) { return String(e); } })();
    const personaBoundary = {
        getAgent: jest.fn(async (tenant: string, agent: string, context: unknown) => {
            if (tenant !== TENANT || agent !== AGENT || context !== AGENT_TEST_EXECUTION_CONTEXT) return fail('persona.identity/context');
            return { id: AGENT, version: 7, name: mockBody.name, config_json: config, channels: mockBody.channels,
                channel_bindings: [], is_active: true, is_default: true };
        }),
        buildSystemPrompt: jest.fn((...args: any[]) => persona.buildSystemPrompt(args[0], args[1])),
    };
    const contract = { version: 1, publishedTools: [], excluded: [], publishedGroups: [],
        publishedByOrigin: { core: [], vertical: [], provider: [], mcp: [] }, writersBlocked: false,
        unmetReadiness: [], decisionInputs: {}, subtypeProfileId: testcase.industry + '/' + testcase.subType, resolvedAt: new Date().toISOString() };
    const composer = { resolve: jest.fn(async (input: any) => {
        if (input.tenantId !== TENANT || input.agentId !== AGENT || input.schemaName !== SCHEMA || input.industry !== testcase.industry
            || input.subType !== testcase.subType || input.channelType !== 'telegram' || input.executionContext !== AGENT_TEST_EXECUTION_CONTEXT
            || json(input.config) !== json(config)) return fail('capability.input');
        return { contract, status: { status: 'ok', profileId: contract.subtypeProfileId }, tools: [], authority: authorityFor(), deniedTools: [], commitmentBlocked: null };
    }) };
    const tenantsService = { getSchemaName: jest.fn(async (tenant: string, context?: unknown) => {
        if (tenant !== TENANT || context !== AGENT_TEST_EXECUTION_CONTEXT) return fail('tenantSchema.context'); return SCHEMA;
    }) };
    const verticalTurnContext = { resolve: jest.fn(async (input: any) => {
        if (input.tenantId !== TENANT || !LANGUAGE.some(row => row.code === input.language) || json(input.toolsConfig) !== '{}'
            || input.executionContext !== AGENT_TEST_EXECUTION_CONTEXT) return fail('vertical.input');
        return { industry: testcase.industry, subType: testcase.subType };
    }) };
    const businessInfoService = { getPrimary: forbidden('business.live'), captureForEvaluation: jest.fn(async (tenant: string, context: unknown) => {
        if (tenant !== TENANT || context !== AGENT_TEST_EXECUTION_CONTEXT) return fail('business.context'); return null;
    }) };
    const activeOperationsContext = { populateTurnContext: jest.fn(async (_turn: any, input: any) => {
        if (input.tenantId !== TENANT || input.schemaName !== SCHEMA || json(input.config.tools) !== '{}') return fail('activeOperations.input');
        return { failures: [] }; // No published active-object capability in this fixture.
    }) };
    const f = agentTurnFixture({ prisma, redis, personaService: personaBoundary, tenantsService, verticalTurnContext,
        businessInfoService, activeOperationsContext, turnCapabilityComposer: composer,
        promptAssembler: new PromptAssemblerService(personaBoundary as any),
        toolExecutor: { execute: forbidden('tool.execute') },
        knowledgeService: { tenantHasKnowledge: jest.fn(async (tenant: string, context: unknown, scope: any) => {
            const scopeKeys = Object.keys(scope || {}).sort();
            if (tenant !== TENANT || context !== AGENT_TEST_EXECUTION_CONTEXT || scope?.agentId !== AGENT
                || scope?.audience !== 'customer' || scope?.jurisdiction !== 'CO'
                || json(scopeKeys) !== json(['agentId','audience','evaluationKnowledge','jurisdiction'])) return fail('knowledge.presence.scope');
            let replica: ReturnType<typeof resolveKnowledgeReplica>;
            try { replica = resolveKnowledgeReplica(scope.evaluationKnowledge, TENANT); }
            catch (error) { return fail('knowledge.presence.descriptor:' + String(error)); }
            if (replica.lease.sourceSchema !== SCHEMA || replica.usage?.agentId !== AGENT
                || Object.values(replica.collections).some(collection => collection.state !== 'present' || collection.rows !== 0)) return fail('knowledge.presence.nonempty_or_foreign');
            knowledgePresenceReads.push({ tenant, context: { ...AGENT_TEST_EXECUTION_CONTEXT }, agentId: scope.agentId,
                audience: scope.audience, jurisdiction: scope.jurisdiction, scopeKeys, replicaIntegrityHash: replica.integrityHash,
                sourceSchema: replica.lease.sourceSchema, replicaSchema: replica.lease.schemaName,
                collectionRows: Object.fromEntries(Object.entries(replica.collections).map(([name, collection]) => [name, collection.rows])),
                declaredEmpty: true, returned: false });
            return false; // Strict declared-empty memory port; no real COUNT/DB/cache.
        }), searchRelevant: forbidden('knowledge.search') },
        customerMemory: { getMemory: forbidden('memory.read'), extractAndPersist: forbidden('memory.write') },
    });
    f.llmRouter.execute.mockImplementation(async (request: any) => {
        if (request.task !== 'conversation' || request.tenantId !== TENANT || request.tools !== undefined) return fail('router.unreviewedTask');
        return { content: language.reply, model: 'fixed-synthetic-sentinel', usage: { promptTokens: 0, completionTokens: 0 }, cost: 0 };
    });
    return { f, configValidationError, knowledgePresenceReads };
}
function promptObservation(prompt: unknown) {
    const value = typeof prompt === 'string' ? prompt : '';
    const blocks = value.match(/<skillset>[\s\S]*?<\/skillset>/g) || [];
    const block = blocks.length === 1 ? blocks[0] : '';
    return { promptSha256: sha(value), promptLength: value.length, blocks: blocks.length,
        mode: /<mode>([^<]*)<\/mode>/.exec(block)?.[1] || null,
        sales: /<sales>/.test(block), support: /<support>/.test(block), balance: /<balance>/.test(block),
        noPitch: /<no_pitch>/.test(block), upsell: /<upsell\b/.test(block) };
}
async function editorObservation(locale: Locale) {
    const copy = MESSAGES[locale].agent.capabilities;
    const container = document.createElement('div'); document.body.appendChild(container);
    const root = createRoot(container);
    let error: string | null = null;
    let tabs = 0, tabSelected: string | null = null;
    let upsellTitleCount = -1;
    const cards: Record<string, { count: number; selectedByDeclaredClass: boolean }> = {};
    try {
        await act(async () => root.render(createElement(NextIntlClientProvider, { locale, messages: MESSAGES[locale], timeZone: 'America/Bogota', children: createElement(AgentEditorPage) })));
        await interact(() => {});
        const found = Array.from(container.querySelectorAll<HTMLButtonElement>('button[role="tab"][data-tab-id="tools"]'));
        tabs = found.length;
        if (found.length !== 1 || !found[0].textContent?.includes(MESSAGES[locale].agent.tabs.tools)) throw new Error('tools_tab_boundary');
        await interact(() => found[0].click());
        tabSelected = found[0].getAttribute('aria-selected');
        for (const key of ['sales','support','both']) {
            const matches = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).filter(button =>
                Array.from(button.querySelectorAll('div')).some(div => div.textContent?.trim() === copy['skillset_' + key]));
            cards[key] = { count: matches.length, selectedByDeclaredClass: matches.length === 1 && matches[0].classList.contains('border-indigo-400') };
        }
        upsellTitleCount = Array.from(container.querySelectorAll('span')).filter(node => node.textContent?.trim() === copy.upsellTitle).length;
    } catch (e) { error = String(e); }
    finally { act(() => root.unmount()); container.remove(); }
    return { capturedAt: new Date().toISOString(), error, tabs, tabSelected, cards, upsellTitleCount };
}

describe.each(LANGUAGE)('same saved skillset: real runtime and full editor (%s)', language => {
    it.each(CASES)('$id displays the effective mode without editing or saving', async testcase => {
        mockUnexpected.length = 0; mockNavigation.length = 0;
        mockIndustry = testcase.industry; mockSubType = testcase.subType;
        mockBody = savedBody(testcase, language.code);
        const sourceBefore = json(mockBody), sourceSha256 = sha(sourceBefore);
        configureEditor();
        const copy = MESSAGES[language.code].agent.capabilities;
        const stringsValid = [MESSAGES[language.code].agent.tabs.tools, copy.skillsetTitle, copy.skillset_sales,
            copy.skillset_support, copy.skillset_both, copy.upsellTitle].every(text => typeof text === 'string' && text.trim().length > 0);
        const { f, configValidationError, knowledgePresenceReads } = runtimeFor(testcase, language);
        let runtimeResult: any, runtimeError: string | null = null;
        try { runtimeResult = await f.service.test(TENANT, AGENT, { message: language.question, channelType: 'telegram' }); }
        catch (e) { runtimeError = String(e); }
        // BOTH observations are captured before any final UI/product assertion.
        const requests = f.llmRouter.execute.mock.calls.map((call: any[]) => call[0]);
        const consumer = promptObservation(requests.length === 1 ? requests[0].systemPrompt : undefined);
        const debug = promptObservation(runtimeResult?.debug?.systemPrompt);
        const runtimeCapturedAt = new Date().toISOString();
        const editor = await editorObservation(language.code);
        const observation = { id: testcase.id + ':' + language.code, sourceSha256, sourceUnchanged: json(mockBody) === sourceBefore,
            stringsValid, configValidationError, runtime: { capturedAt: runtimeCapturedAt, error: runtimeError,
                debugError: runtimeResult?.debug?.runtimeError ?? null, routerCalls: requests.length, consumer, debug,
                finalSystemPrompt: requests.length === 1 ? requests[0].systemPrompt : null,
                tasks: requests.map((request: any) => request.task), finalToolCounts: requests.map((request: any) => request.tools?.length ?? 0),
                syntheticAccounting: { reserve: f.throttle.reserveAiMessageCount.mock.calls.length, commit: f.throttle.commitAiMessageCount.mock.calls.length,
                    release: f.throttle.releaseAiMessageCount.mock.calls.length }, tenantReads: f.prisma.tenant.findUnique.mock.calls.length,
                informationalSqlReads: f.prisma.executeInTenantSchema.mock.calls.length, knowledgePresenceReads,
            }, editor, unexpected: [...mockUnexpected], navigation: [...mockNavigation] };
        console.info('SKILLSET_PAIR_OBSERVATION ' + json(observation));
        // Prerequisites/controls first; classify these failures as harness until reviewed.
        expect(stringsValid).toBe(true); expect(configValidationError).toBeNull();
        expect(runtimeError).toBeNull(); expect(runtimeResult?.debug?.runtimeError).toBeUndefined();
        expect(mockUnexpected).toEqual([]); expect(mockNavigation).toEqual([]);
        expect(requests).toHaveLength(1); expect(requests[0].task).toBe('conversation'); expect(requests[0].tools).toBeUndefined();
        expect(consumer.blocks).toBe(1); expect(debug).toEqual(consumer);
        expect({ mode: consumer.mode, sales: consumer.sales, support: consumer.support, balance: consumer.balance,
            noPitch: consumer.noPitch, upsell: consumer.upsell }).toEqual(testcase.expected);
        expect(f.personaService.getAgent).toHaveBeenCalledTimes(1);
        expect(f.personaService.getAgent.mock.results[0].type).toBe('return');
        expect(api.getAgentConfiguration).toHaveBeenCalledTimes(1); expect(api.listAgents).toHaveBeenCalledTimes(1);
        expect(api.saveAgentDraft).not.toHaveBeenCalled();
        expect(f.toolExecutor.execute).not.toHaveBeenCalled(); expect(f.outboundQueue.enqueue).not.toHaveBeenCalled();
        expect(f.eventEmitter.emit).not.toHaveBeenCalled(); expect(f.handoffService.executeHandoff).not.toHaveBeenCalled();
        expect(f.knowledgeService.searchRelevant).not.toHaveBeenCalled(); expect(json(mockBody)).toBe(sourceBefore);
        expect(editor.error).toBeNull(); expect(editor.tabs).toBe(1); expect(editor.tabSelected).toBe('true');
        for (const key of ['sales','support','both']) expect(editor.cards[key].count).toBe(1);
        // Primary independent product oracle: rendered upsell controls versus
        // final effective mode from the SAME immutable saved config.
        expect(editor.upsellTitleCount).toBe(consumer.mode === 'support' ? 0 : 1);
        expect(Object.entries(editor.cards).filter(([, card]) => card.selectedByDeclaredClass).map(([key]) => key)).toEqual([consumer.mode]);
    });
});
