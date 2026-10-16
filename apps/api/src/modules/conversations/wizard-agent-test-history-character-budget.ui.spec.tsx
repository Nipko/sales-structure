/** @jest-environment node */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import { HttpException } from '@nestjs/common';
import type { AgentDraftBody } from '@parallext/shared';
import { agentTurnFixture } from './__fixtures__/agent-turn.fixture';
import { authorityFor } from './__fixtures__/tool-authority.fixture';
import { PersonaService } from '../persona/persona.service';
import { PromptAssemblerService } from './prompt-assembler.service';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';
import { resolveKnowledgeReplica } from '../evaluation-revision/evaluation-knowledge-replica';
import { AgentTestRequestGuard } from './agent-test-request.guard';
import { AgentTestController } from './agent-test.controller';
import { AGENT_TEST_HISTORY_MAX_ITEMS, AGENT_TEST_HISTORY_MAX_CHARS, AGENT_TEST_MESSAGE_MAX_CHARS } from './dto/agent-test-request.dto';

// PREPARATION ONLY. Root must reconcile WT6 and preregister BEFORE copy/import/Jest.
// Four locale cases; each owns12 native sends. Checkpoint11 controls20-history,
// then checkpoint12 tests continued use. No state injection or seeded history.
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
type Case = { industry: string; subType: string };
const MESSAGES = Object.fromEntries(LANGUAGE.map(({ code }) => [code,
    JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../dashboard/messages', code + '.json'), 'utf8')),
])) as Record<Locale, any>;
const json = (value: unknown) => JSON.stringify(value);
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const clone = <T,>(value: T): T => JSON.parse(json(value));
function freeze<T>(value: T): T {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        for (const child of Object.values(value)) freeze(child);
        Object.freeze(value);
    }
    return value;
}
let mockBody: AgentDraftBody;
const mockUnexpected: string[] = [];
const mockNavigation: string[] = [];
const mockParams = new URLSearchParams();
function mockFail(label: string): never { mockUnexpected.push(label); throw new Error('Unexpected boundary: ' + label); }
jest.mock('@/lib/api', () => {
    const methods: Record<string, jest.Mock> = {};
    return { api: new Proxy(methods, { get(target, key) {
        if (typeof key !== 'string') return undefined;
        target[key] ??= jest.fn(async () => mockFail('page.api.' + key));
        return target[key];
    } }) };
});
jest.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ activeTenantId: '11111111-1111-4111-8111-111111111111' }) }));
jest.mock('next/navigation', () => ({
    useRouter: () => Object.fromEntries(['push', 'replace', 'back', 'forward', 'refresh', 'prefetch']
        .map(key => [key, (...args: unknown[]) => { mockNavigation.push(key + ':' + JSON.stringify(args)); mockFail('navigation.' + key); }])),
    useParams: () => ({ agentId: '22222222-2222-4222-8222-222222222222' }),
    useSearchParams: () => mockParams,
}));
jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children, ...rest }: any) =>
    createElement('a', { href: typeof href === 'string' ? href : '#', ...rest }, children) }));
const { api } = jest.requireMock('@/lib/api') as { api: Record<string, jest.Mock> };
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://local-history.test/admin/agent/' + AGENT + '/test' });
const globals: Record<string, unknown> = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
    HTMLButtonElement: dom.window.HTMLButtonElement, HTMLSelectElement: dom.window.HTMLSelectElement,
    Element: dom.window.Element, Node: dom.window.Node, Event: dom.window.Event,
    MutationObserver: dom.window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true,
    fetch: jest.fn(async () => mockFail('network.fetch')),
    WebSocket: class { constructor() { mockFail('network.WebSocket'); } },
};
const previous = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries(globals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
// API classes above do not bootstrap. DOM consumers are required only now.
const { createRoot } = require('react-dom/client') as typeof import('react-dom/client');
const { NextIntlClientProvider } = require('next-intl') as typeof import('next-intl');
const WizardAgentTestChat = require('../../../../dashboard/src/app/admin/setup-wizard/_components/AgentTestChat').default;
afterAll(() => {
    dom.window.close();
    for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as Record<string, unknown>)[key];
    }
});
async function interact(action: () => void) {
    await act(async () => action());
    await act(async () => { await Promise.resolve(); });
}
function savedBody(locale: Locale): AgentDraftBody {
    return freeze({ name: 'Synthetic history continuity agent', channels: ['web_widget'], channelBindings: [],
        scheduleMode: '24_7', isActive: true, isDefault: true, configJson: {
            persona: { name: 'Synthetic history continuity agent', role: 'Support', greeting: '', fallbackMessage: 'No confirmed information.',
                personality: { tone: 'friendly', formality: 'casual-professional', emojiUsage: 'none', humor: '' } },
            behavior: { mainInstructions: '', rules: ['Use confirmed facts.'], forbiddenTopics: [], handoffTriggers: ['Human requested'], requiredFields: {} },
            language: locale, industry: 'retail', skillset: 'support', tools: {},
            hours: { timezone: 'America/Bogota', schedule: {}, aiOutsideHours: true, afterHoursMessage: '' },
            llm: { temperature: 0.25, maxTokens: 600, memory: { shortTerm: 20, longTerm: false, summaryAfter: 30 } },
            rag: { enabled: false, topK: 5, similarityThreshold: 0.35 }, upsell: { enabled: false, intensity: 'subtle', maxDiscountPercent: 0 },
        } });
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
            || input.subType !== testcase.subType || input.channelType !== 'web_widget' || input.executionContext !== AGENT_TEST_EXECUTION_CONTEXT
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

type BoundaryRow = {
    send: number; request: any; transformed?: any; guardAccepted: boolean;
    controllerCalled: boolean; envelope?: any; status?: number; guardError?: any;
    runtimeError?: string; routerBefore: number; routerAfter?: number;
};
function fieldErrors(body: any) {
    if (!Array.isArray(body?.fields)) return undefined;
    const result = body.fields.map((entry: any) => typeof entry === 'string' ? { path: entry } : entry)
        .filter((entry: any) => entry && typeof entry === 'object' && typeof entry.path === 'string').slice(0, 50)
        .map((entry: any) => ({ path: String(entry.path).slice(0, 120),
            ...(typeof entry.constraint === 'string' ? { constraint: entry.constraint.slice(0, 80) } : {}),
            ...(typeof entry.message === 'string' ? { message: entry.message.slice(0, 300) } : {}),
        }));
    return result.length ? result : undefined;
}
function preparePageBoundary(f: ReturnType<typeof agentTurnFixture>, rows: BoundaryRow[]) {
    for (const [method, mock] of Object.entries(api)) mock.mockReset().mockImplementation(() => mockFail('page.api.' + method));
    api.getAgentConfiguration.mockImplementation(async (tenant: string, agent: string) => {
        if (tenant !== TENANT || agent !== AGENT) return mockFail('workspace.identity');
        return { success: true, data: { agentId: AGENT, operational: { version: 7, hash: 'a'.repeat(64), body: mockBody },
            draft: null, evaluationRevisionId: null, directCommit: true } };
    });
    const guard = new AgentTestRequestGuard();
    const controller = new AgentTestController(f.service); // Optional Prisma omitted: onboarding bookkeeping excluded.
    api.testAgent.mockImplementation(async (tenant: string, agent: string, original: any) => {
        if (tenant !== TENANT || agent !== AGENT) return mockFail('request.identity');
        const request = { body: clone(original) }; // Same JSON transport omission of undefined, no history repair.
        const row: BoundaryRow = { send: rows.length + 1, request: clone(request.body), guardAccepted: false,
            controllerCalled: false, routerBefore: f.llmRouter.execute.mock.calls.length };
        rows.push(row);
        try {
            await guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }) } as any);
            row.guardAccepted = true; row.transformed = clone(request.body); row.controllerCalled = true;
            const envelope = await controller.test(tenant, agent, request.body);
            row.envelope = clone(envelope); row.status = 200;
            row.runtimeError = envelope.data?.debug?.runtimeError;
            row.routerAfter = f.llmRouter.execute.mock.calls.length;
            return envelope;
        } catch (error) {
            row.routerAfter = f.llmRouter.execute.mock.calls.length;
            if (error instanceof HttpException) {
                const status = error.getStatus(); const response = error.getResponse();
                const body: any = typeof response === 'string' ? { message: response } : response;
                row.status = status; row.guardError = clone(body);
                // Actual apiPost envelope mapping. Preserve array messages as the client does.
                const envelope = { success: false, httpStatus: status,
                    error: body.message || 'Error ' + status, errorCode: body.error, fields: fieldErrors(body) };
                row.envelope = clone(envelope); return envelope;
            }
            mockUnexpected.push('request.unreviewed_error:' + String(error));
            row.guardError = { unexpected: String(error) };
            // Actual apiPost catch text; unexpected is still a prerequisite failure.
            row.envelope = { success: false, error: 'Error de conexión' }; return row.envelope;
        }
    });
}
function exactButton(container: HTMLElement, text: string): HTMLButtonElement {
    const found = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).filter(node => node.textContent?.trim() === text);
    if (found.length !== 1) return mockFail('DOM.button.' + text + ':' + found.length);
    return found[0];
}
function exactInput(container: HTMLElement, placeholder: string): HTMLInputElement {
    const found = Array.from(container.querySelectorAll<HTMLInputElement>('input')).filter(node => node.placeholder === placeholder);
    if (found.length !== 1) return mockFail('DOM.input:' + found.length);
    return found[0];
}
function conversationView(container: HTMLElement, copy: any) {
    // The real component has no region label. Own mount container is the exact
    // focal component; inspect existing paragraphs, do not add product DOM.
    return { text: container.textContent || '', bubbles: Array.from(container.querySelectorAll('p.whitespace-pre-wrap')).map(node => node.textContent || ''),
        error: container.querySelector('p.text-red-500')?.textContent?.trim() || null,
        inputDisabled: exactInput(container, copy.placeholder).disabled,
        sendDisabled: exactButton(container, copy.send).disabled };
}

const runtimeErrors: string[] = [];
const windowError = (event: any) => { runtimeErrors.push(String(event.error?.stack || event.message || event.reason)); event.preventDefault(); };
dom.window.addEventListener('error', windowError);
dom.window.addEventListener('unhandledrejection', windowError);
const transportRestore: Array<() => void> = [];
const block = (host: any, key: string, value: unknown) => { const d=Object.getOwnPropertyDescriptor(host,key); Object.defineProperty(host,key,{configurable:true,writable:true,value}); transportRestore.push(()=>{if(d)Object.defineProperty(host,key,d);else delete host[key];}); };
for (const key of ['fetch','WebSocket','EventSource','XMLHttpRequest']) block(dom.window,key,key==='fetch'?async()=>mockFail('window.fetch'):class{constructor(){mockFail('window.'+key);}});
for (const [name,methods] of [['node:http',['request','get']],['node:https',['request','get']],['node:net',['connect','createConnection']],['node:tls',['connect']]] as const) for (const method of methods) block(require(name),method,()=>mockFail(name+'.'+method));
block(require('node:net').Socket.prototype,'connect',()=>mockFail('node:net.Socket.connect'));
block(require('node:dgram'),'createSocket',()=>mockFail('node:dgram.createSocket'));
afterAll(()=>{for(const restore of transportRestore.reverse())restore();});

const questionFor = (language: typeof LANGUAGE[number], send: number) => (language.question+' [CHAR-H'+send+'] ').padEnd(4000,'x');
const replyFor = (language: typeof LANGUAGE[number], send: number) => (language.reply+' [CHAR-R'+send+'] ').padEnd(2000,'y');
describe.each(LANGUAGE)('WizardAgentTestChat total history character budget (%s)', language => {
    it('continues send6 after send5 legitimately used exactly24000 history characters below20items', async () => {
        const outdir=process.env.AGENT_BUDGET_EVIDENCE_DIR;
        if(!outdir||!path.isAbsolute(outdir)||!fs.statSync(outdir).isDirectory())throw new Error('Root-created exclusive evidence directory required');
        mockUnexpected.length=0;mockNavigation.length=0;runtimeErrors.length=0;
        mockBody=savedBody(language.code);const originalBody=json(mockBody);
        const {f,configValidationError,knowledgePresenceReads}=runtimeFor({industry:'retail',subType:'moda'},language);
        const rows:BoundaryRow[]=[],runtimeRequests:any[]=[],steps:any[]=[];
        f.llmRouter.execute.mockImplementation(async(request:any)=>{
            if(request.task!=='conversation'||request.tenantId!==TENANT||request.tools!==undefined)return mockFail('router.budget_scope');
            const send=runtimeRequests.length+1;runtimeRequests.push({task:request.task,tenantId:request.tenantId,messages:clone(request.messages),systemPromptSha256:sha(request.systemPrompt)});
            return{content:replyFor(language,send),model:'fixed-character-budget-sentinel',usage:{promptTokens:0,completionTokens:0},cost:0};
        });
        preparePageBoundary(f,rows);const copy=MESSAGES[language.code].setupWizard.test;
        const container=document.createElement('div');document.body.appendChild(container);const root=createRoot(container);
        let error:string|null=null,cleanup:any=null;
        try{
            await act(async()=>root.render(createElement(NextIntlClientProvider,{locale:language.code,messages:MESSAGES[language.code],timeZone:'America/Bogota',children:createElement(WizardAgentTestChat,{tenantId:TENANT,agentId:AGENT,blocked:false,suggestions:[]})})));
            await interact(()=>{});
            if(!exactInput(container,copy.placeholder))return mockFail('DOM.wizard_input');
            for(let send=1;send<=6;send++){
                const question=questionFor(language,send),input=exactInput(container,copy.placeholder);
                if(input.disabled)return mockFail('DOM.disabled_before_budget_send:'+send);
                await interact(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,question);input.dispatchEvent(new Event('input',{bubbles:true}));});
                const button=exactButton(container,copy.send);if(input.value!==question||button.disabled)return mockFail('DOM.budget_input:'+send);
                await act(async()=>{button.click();const result=api.testAgent.mock.results.at(-1);if(result?.type!=='return')return mockFail('DOM.budget_click:'+send);await result.value;});await interact(()=>{});
                const request=rows.at(-1)?.request,history=request?.conversationHistory||[];
                steps.push({send,requestCount:rows.length,messageChars:request?.message?.length,historyItems:history.length,historyChars:history.reduce((sum:number,r:any)=>sum+r.content.length,0),maxHistoryItemChars:Math.max(0,...history.map((r:any)=>r.content.length)),guardAccepted:rows.at(-1)?.guardAccepted,routerCalls:runtimeRequests.length,view:conversationView(container,copy)});
            }
        }catch(caught){error=String(caught);}finally{await act(async()=>root.unmount());container.remove();cleanup={remainingCaseContainers:document.body.children.length,runtime:[...runtimeErrors],unexpected:[...mockUnexpected],navigation:[...mockNavigation]};}
        const observed={locale:language.code,error,configValidationError,bodyUnchanged:json(mockBody)===originalBody,steps,requests:rows,runtimeRequests,knowledgePresenceReads,cleanup,accounting:{reserve:f.throttle.reserveAiMessageCount.mock.calls.length,commit:f.throttle.commitAiMessageCount.mock.calls.length,release:f.throttle.releaseAiMessageCount.mock.calls.length}};
        fs.writeFileSync(path.join(outdir,language.code+'-observed.json'),json(observed)+'\n',{flag:'wx'});
        // Fresh exact24000 control precedes the single product boundary assertion.
        expect(error).toBeNull();expect(configValidationError).toBeNull();expect(cleanup.runtime).toEqual([]);expect(cleanup.unexpected).toEqual([]);expect(cleanup.navigation).toEqual([]);expect(cleanup.remainingCaseContainers).toBe(0);expect(json(mockBody)).toBe(originalBody);
        expect(AGENT_TEST_HISTORY_MAX_ITEMS).toBe(20);expect(AGENT_TEST_HISTORY_MAX_CHARS).toBe(24000);expect(AGENT_TEST_MESSAGE_MAX_CHARS).toBe(4000);expect(rows).toHaveLength(6);expect(steps).toHaveLength(6);expect(api.getAgentConfiguration).not.toHaveBeenCalled();expect(api.createFaq).not.toHaveBeenCalled();
        const expected:Array<{role:string;content:string}>=[];
        for(let send=1;send<=5;send++){
            expect(rows[send-1].request.message).toBe(questionFor(language,send));expect(rows[send-1].request.conversationHistory).toEqual(expected);expect(rows[send-1].guardAccepted).toBe(true);expect(rows[send-1].controllerCalled).toBe(true);expect(rows[send-1].runtimeError).toBeUndefined();expect(rows[send-1].envelope?.data?.reply).toBe(replyFor(language,send));
            expected.push({role:'user',content:questionFor(language,send)},{role:'assistant',content:replyFor(language,send)});expect(steps[send-1].view.bubbles).toEqual(expected.map(r=>r.content));expect(steps[send-1].view.error).toBeNull();expect(steps[send-1].view.inputDisabled).toBe(false);
        }
        expect(steps[4].historyChars).toBe(24000);expect(steps[4].historyItems).toBe(8);const session=rows[0].envelope?.data?.debug.runtimeSessionId;expect(session).toMatch(/^[a-f0-9-]{36}$/i);for(const row of rows.slice(1))expect(row.request.runtimeSessionId).toBe(session);
        expect(f.toolExecutor.execute).not.toHaveBeenCalled();expect(f.outboundQueue.enqueue).not.toHaveBeenCalled();expect(f.eventEmitter.emit).not.toHaveBeenCalled();expect(f.handoffService.executeHandoff).not.toHaveBeenCalled();expect(f.knowledgeService.searchRelevant).not.toHaveBeenCalled();
        // No later assertions are credited when the actual first one fails.
        expect(steps[5].historyChars).toBeLessThanOrEqual(AGENT_TEST_HISTORY_MAX_CHARS);
        expect(rows[5].request.conversationHistory).toEqual(expected.slice(-8));expect(rows[5].guardAccepted).toBe(true);expect(rows[5].controllerCalled).toBe(true);expect(steps[5].routerCalls).toBe(6);expect(steps[5].view.error).toBeNull();expect(steps[5].view.bubbles).toEqual([...expected.map(r=>r.content),questionFor(language,6),replyFor(language,6)]);
    });
});
