/** @jest-environment node */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';

// PREPARED ONLY. Proposed API destination modules/copilot/copilot-summary-selected-conversation.ui.spec.tsx.
// Root must review/copy/preregister before its first execution. No app bootstrap.
const TENANT = '11111111-1111-4111-8111-111111111111';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const A = '44444444-4444-4444-8444-444444444444';
const B = '55555555-5555-4555-8555-555555555555';
const LOCALES = ['es', 'en', 'pt', 'fr'] as const;
const CASES = ['same', 'switch'] as const; // New pending-summary control and navigation criterion.
const SENTENCES = {
    es: { a: 'Borrador exclusivo Alpha.', b: 'Borrador exclusivo Beta.' },
    en: { a: 'Draft exclusively for Alpha.', b: 'Draft exclusively for Beta.' },
    pt: { a: 'Rascunho exclusivo Alpha.', b: 'Rascunho exclusivo Beta.' },
    fr: { a: 'Brouillon exclusif Alpha.', b: 'Brouillon exclusif Beta.' },
};
function summaryFor(id: string, locale: typeof LOCALES[number]) {
    const identity = id === A ? 'ALPHA' : 'BETA';
    return { summary: 'QA ' + identity + ' SUMMARY ' + locale, customerIntent: 'QA ' + identity + ' INTENT ' + locale,
        keyInfoShared: ['QA ' + identity + ' FACT ' + locale], pendingQuestions: ['QA ' + identity + ' PENDING ' + locale] };
}
const mockUnexpected: string[] = [];
const mockSocketLog: unknown[] = [];
const mockSockets: Array<{ on: jest.Mock; emit: jest.Mock; disconnect: jest.Mock }> = [];
function mockFail(label: string): never { mockUnexpected.push(label); throw new Error('Unexpected I/O: ' + label); }
jest.mock('@/lib/api', () => ({ api: new Proxy({} as Record<string, jest.Mock>, {
    get(target, key) {
        if (typeof key !== 'string') return undefined;
        target[key] ??= jest.fn(async () => mockFail('api.' + key));
        return target[key];
    },
}) }));
jest.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({
    user: { id: '33333333-3333-4333-8333-333333333333', firstName: 'QA Operator', role: 'tenant_admin' },
    verticalConfig: null,
}) }));
jest.mock('@/contexts/TenantContext', () => ({ useTenant: () => ({ activeTenantId: '11111111-1111-4111-8111-111111111111' }) }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children, ...rest }: any) =>
    createElement('a', { ...rest, href: typeof href === 'string' ? href : '#' }, children) }));
jest.mock('socket.io-client', () => ({ io: jest.fn((url: string, options: unknown) => {
    if (!/\/(inbox|agent)$/.test(url)) return mockFail('socket.namespace.' + url);
    mockSocketLog.push({ kind: 'construct', namespace: url.replace(/^.*(?=\/(?:inbox|agent)$)/, ''), options });
    const socket = {
        on: jest.fn((name: string, _listener: unknown): unknown => { mockSocketLog.push({ kind: 'on', name }); return socket; }),
        emit: jest.fn((name: string, payload: unknown) => {
            if (!['conversation:viewing_start', 'conversation:heartbeat', 'conversation:viewing_stop'].includes(name)) return mockFail('socket.emit.' + name);
            mockSocketLog.push({ kind: 'emit', name, payload });
        }),
        disconnect: jest.fn(() => { mockSocketLog.push({ kind: 'disconnect' }); }),
    };
    mockSockets.push(socket);
    return socket;
}) }));
const { api } = jest.requireMock('@/lib/api') as { api: Record<string, jest.Mock> };
const nativeImmediate = setImmediate;
const writeMethods = ['sendMessage', 'addNote', 'claimConversation', 'assignConversation', 'resolveConversation',
    'reopenConversation', 'snoozeConversation', 'archiveConversation', 'deleteConversation', 'executeMacro',
    'returnConversationToAI', 'updateInboxContactMetadata', 'fetch', 'rewriteCopilotReply'];
const allowedApi = new Set(['getInbox', 'getConversation', 'getMacros', 'getCustomAttributes', 'getCannedResponses',
    'getToolApprovals', 'getConversationActiveObjects', 'getCopilotSummary']);
const sameControls = new Set<string>();

function trackFakeMicrotasks() {
    const original = globalThis.queueMicrotask;
    const pending = new Map<number, { id: number; stack: string }>();
    let serial = 0;
    globalThis.queueMicrotask = (callback: () => void) => {
        const id = ++serial;
        pending.set(id, { id, stack: new Error('Queued microtask creation').stack || '' });
        original(() => { pending.delete(id); callback(); });
    };
    return {
        snapshot: () => [...pending.values()],
        restore: () => { globalThis.queueMicrotask = original; },
    };
}

function trackTimeouts() {
    const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
    const pending = new Map<any, { delay: number; createdAt: number; stack: string }>();
    globalThis.setTimeout = ((callback: (...args: any[]) => void, delay?: number, ...args: any[]) => {
        let timer: any;
        timer = originalSet(() => { pending.delete(timer); callback(...args); }, delay);
        pending.set(timer, { delay: Number(delay || 0), createdAt: Date.now(), stack: new Error('Timeout creation').stack || '' });
        return timer;
    }) as typeof setTimeout;
    globalThis.clearTimeout = ((timer: any) => { pending.delete(timer); return originalClear(timer); }) as typeof clearTimeout;
    return { snapshot: () => [...pending.values()], restore: () => { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; } };
}

function installDom() {
    const dom = new JSDOM('<!doctype html><html><body><main id="fixture-root"></main></body></html>', {
        url: 'https://owned-inbox-summary.test/admin/inbox',
    });
    const descriptors = new Map<string, PropertyDescriptor | undefined>();
    const restores: Array<() => void> = [];
    const set = (host: any, key: string, value: unknown) => {
        const descriptor = Object.getOwnPropertyDescriptor(host, key);
        Object.defineProperty(host, key, { configurable: true, writable: true, value });
        restores.push(() => { if (descriptor) Object.defineProperty(host, key, descriptor); else delete host[key]; });
    };
    for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement',
        'Element', 'Node', 'Event', 'MouseEvent', 'FocusEvent', 'MutationObserver', 'localStorage', 'sessionStorage']) {
        descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, { configurable: true, writable: true,
            value: key === 'window' ? dom.window : (dom.window as any)[key] });
    }
    descriptors.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'));
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, writable: true, value: true });
    for (const host of [globalThis, dom.window]) {
        set(host, 'fetch', (..._args: unknown[]) => mockFail('network.fetch'));
        for (const key of ['WebSocket', 'EventSource', 'XMLHttpRequest']) set(host, key, class { constructor() { mockFail('network.' + key); } });
    }
    set(dom.window.navigator, 'sendBeacon', () => mockFail('network.sendBeacon'));
    set(dom.window.navigator, 'clipboard', { writeText: () => mockFail('clipboard.writeText') });
    // Block native transports too: constructor-silent API dependency imports are permitted; connections are not.
    for (const [moduleName, methods] of [['node:http', ['request', 'get']], ['node:https', ['request', 'get']],
        ['node:net', ['connect', 'createConnection']], ['node:tls', ['connect']]] as const) {
        const module = require(moduleName);
        for (const method of methods) set(module, method, () => mockFail(moduleName + '.' + method));
    }
    set(require('node:net').Socket.prototype, 'connect', () => mockFail('node:net.Socket.connect'));
    set(require('node:dgram'), 'createSocket', () => mockFail('node:dgram.createSocket'));
    const runtime: string[] = [];
    const windowError = (event: any) => { runtime.push(String(event.error?.stack || event.message || event.reason)); event.preventDefault(); };
    dom.window.addEventListener('error', windowError);
    dom.window.addEventListener('unhandledrejection', windowError);
    dom.window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null,
        addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as any;
    dom.window.Element.prototype.scrollIntoView = () => {};
    return { dom, runtime, dispose() {
        dom.window.removeEventListener('error', windowError);
        dom.window.removeEventListener('unhandledrejection', windowError);
        dom.window.close();
        for (const restore of restores.reverse()) restore();
        for (const [key, descriptor] of descriptors) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete (globalThis as any)[key];
        }
    } };
}

async function settle(action?: () => void) {
    await act(async () => { action?.(); for (let n = 0; n < 12; n++) await Promise.resolve(); });
    await new Promise<void>(resolve => nativeImmediate(resolve));
    await act(async () => { jest.advanceTimersByTime(60); for (let n = 0; n < 12; n++) await Promise.resolve(); });
}
function required<T>(item: T | null | undefined, label: string): T {
    if (!item) throw new Error('Harness precondition missing: ' + label);
    return item;
}
function exactButton(host: HTMLElement, text: string) {
    const matches = Array.from(host.querySelectorAll('button')).filter(button => button.textContent?.trim() === text);
    if (matches.length !== 1) throw new Error('Harness expected exactly one button: ' + text + ', found ' + matches.length);
    return matches[0];
}
async function click(button: HTMLElement) { await settle(() => { button.focus(); button.click(); }); }
async function type(input: HTMLInputElement, text: string, win: any) {
    await settle(() => {
        input.focus();
        required(Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')?.set, 'native value setter').call(input, text);
        input.dispatchEvent(new win.Event('input', { bubbles: true }));
    });
}
function configureChain(locale: typeof LOCALES[number]) {
    const sql: Array<{ schema: string; query: string; params: unknown[] }> = [];
    const buckets: Array<{ key: string; ttl: number }> = [];
    const counts = new Map<string, number>();
    const cache = new Map<string, { serialized: string; expiresAt: number }>();
    const cacheEvents: Array<{ op: string; key: string; ttl?: number; hit?: boolean }> = [];
    const routerCalls: any[] = [], controllerCalls: any[] = [];
    const scope = (tenant: string, id?: string) => {
        if (tenant !== TENANT || (id !== undefined && ![A, B].includes(id))) return mockFail('identity.scope');
    };
    const prisma = {
        getTenantSchemaName: jest.fn(async (tenant: string) => { scope(tenant); return 'tenant_synthetic_summary'; }),
        executeInTenantSchema: jest.fn(async (schema: string, query: string, params: unknown[]) => {
            sql.push({ schema, query, params: [...params] });
            if (schema !== 'tenant_synthetic_summary' || params.length !== 1 || ![A, B].includes(String(params[0]))) return mockFail('prisma.scope');
            const normalized = query.replace(/\s+/g, ' ').trim();
            if (normalized === 'SELECT assigned_to FROM conversations WHERE id = $1::uuid LIMIT 1') return [{ assigned_to: ACTOR }];
            if (normalized === 'SELECT id, content_text, content_type, direction, created_at, metadata FROM messages WHERE conversation_id = $1::uuid ORDER BY created_at DESC LIMIT 10') {
                return [{ id: '66666666-6666-4666-8666-666666666666', content_text: 'Synthetic conversation [' + params[0] + ']',
                    direction: 'inbound', content_type: 'text', created_at: '2026-10-16T12:00:00Z', metadata: {} }];
            }
            return mockFail('prisma.sql.' + normalized);
        }),
    };
    const { RedisService } = require('../redis/redis.service');
    const allowedCacheKeys = [A, B].map(id => 'tenant:' + TENANT + ':copilot:summary:' + id);
    const cacheScope = (key: string) => { if (!allowedCacheKeys.includes(key)) return mockFail('redis.cache.key'); };
    const redis = {
        tenantKey: (tenant: string, key: string) => {
            scope(tenant); if (![A, B].some(id => key === 'copilot:summary:' + id)) return mockFail('redis.tenantKey');
            const result = RedisService.prototype.tenantKey.call(null, tenant, key);
            cacheEvents.push({ op: 'tenantKey', key: result }); return result;
        },
        getJson: jest.fn(async (key: string) => {
            cacheScope(key); const value = cache.get(key); const hit = Boolean(value && value.expiresAt > Date.now());
            cacheEvents.push({ op: 'getJson', key, hit });
            return hit ? JSON.parse(value!.serialized) : null;
        }),
        setJson: jest.fn(async (key: string, value: unknown, ttl: number) => {
            cacheScope(key); if (ttl !== 60) return mockFail('redis.cache.ttl');
            cacheEvents.push({ op: 'setJson', key, ttl });
            cache.set(key, { serialized: JSON.stringify(value), expiresAt: Date.now() + ttl * 1000 });
        }),
        incrementRateLimit: jest.fn(async (key: string, ttl: number) => {
            const prefixes = ['copilot:rate:tenant:' + TENANT + ':user:' + ACTOR + ':minute:', 'copilot:rate:tenant:' + TENANT + ':user:' + ACTOR + ':day:',
                'copilot:rate:tenant:' + TENANT + ':minute:', 'copilot:rate:tenant:' + TENANT + ':day:'];
            const prefix = prefixes.find(candidate => key.startsWith(candidate));
            if (!prefix || !/^\d+$/.test(key.slice(prefix.length)) || ![60, 86400].includes(ttl)) return mockFail('redis.rate.scope');
            buckets.push({ key, ttl }); const count = (counts.get(key) || 0) + 1; counts.set(key, count); return count;
        }),
    };
    const inert = (name: string) => new Proxy({}, { get: (_host, key) => (..._args: unknown[]) => mockFail(name + '.' + String(key)) });
    const { CopilotRateLimitService } = require('./copilot-rate-limit.service');
    const { CopilotService } = require('./copilot.service');
    const { CopilotController } = require('./copilot.controller');
    const router = { execute: jest.fn(async (request: any) => {
        routerCalls.push(structuredClone(request));
        if (request.tenantId !== TENANT || !Array.isArray(request.messages)) return mockFail('router.scope');
        const corpus = request.messages.map((message: any) => message.content).join('\n');
        const ids = [A, B].filter(id => corpus.includes('[' + id + ']'));
        if (ids.length !== 1) return mockFail('router.history.identity');
        return { content: JSON.stringify(summaryFor(ids[0], locale)) };
    }) };
    const service = new CopilotService(inert('config'), prisma, redis, router, inert('knowledge'), inert('throttle'), inert('verticals'),
        new CopilotRateLimitService(redis), inert('quality'), inert('signals'), inert('assessment'), inert('configuration'), inert('operations'));
    const controller = new CopilotController(service, inert('assessment'), inert('configuration'), inert('operations'));
    for (const method of Object.values(api)) method.mockReset().mockImplementation(async () => mockFail('api.unconfigured'));
    const conversation = (id: string) => ({ id, contactName: id === A ? 'QA Alpha' : 'QA Beta', contactId: 'contact-' + id, status: 'active',
        channel: 'telegram', lastMessage: 'Synthetic context [' + id + ']', unreadCount: 0, isAiHandled: false,
        last_message_at: id === A ? '2026-10-16T12:01:00Z' : '2026-10-16T12:00:00Z' });
    api.getInbox.mockImplementation(async (tenant: string, filter: string) => {
        scope(tenant); if (filter !== 'all') return mockFail('api.filter'); return { success: true, data: [conversation(A), conversation(B)] };
    });
    api.getConversation.mockImplementation(async (tenant: string, id: string) => {
        scope(tenant, id); return { success: true, data: { id, contact: { id: 'contact-' + id, customFields: {} }, notes: [],
            messages: [{ id: 'message-' + id, content_text: 'Synthetic context [' + id + ']', direction: 'inbound',
                content_type: 'text', created_at: '2026-10-16T12:00:00Z', metadata: {} }] } };
    });
    for (const method of ['getMacros', 'getCannedResponses', 'getToolApprovals']) api[method].mockImplementation(async (tenant: string, id?: string) => {
        scope(tenant, id); return { success: true, data: [] };
    });
    api.getCustomAttributes.mockImplementation(async (tenant: string, entity: string) => {
        scope(tenant); if (entity !== 'contact') return mockFail('api.entity'); return { success: true, data: [] };
    });
    api.getConversationActiveObjects.mockImplementation(async (tenant: string, id: string) => {
        scope(tenant, id); return { success: true, data: { items: [] }, degraded: false };
    });
    api.getCopilotSummary.mockImplementation(async (id: string) => {
        scope(TENANT, id); controllerCalls.push({ tenant: TENANT, id, actor: ACTOR, role: 'tenant_admin' });
        return controller.getSummary(TENANT, id, { user: { id: ACTOR, role: 'tenant_admin' } });
    });
    return { sql, buckets, cacheEvents, routerCalls, controllerCalls, cache, router };
}


function deferredGate() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
describe('Inbox pending summary response remains associated with its original context',()=>{
    for(const locale of LOCALES)for(const testcase of CASES)it(locale+' '+testcase,async()=>{
        const outdir=process.env.COPILOT_SUMMARY_EVIDENCE_DIR;
        if(!outdir||!path.isAbsolute(outdir)||!fs.statSync(outdir).isDirectory())throw new Error('Exclusive root evidence directory required');
        mockUnexpected.length=0;mockSocketLog.length=0;mockSockets.length=0;
        jest.useFakeTimers({now:new Date('2026-10-16T12:05:00Z'),doNotFake:['setImmediate','nextTick','performance','queueMicrotask']});
        const microtasks=trackFakeMicrotasks(),timeouts=trackTimeouts(),fixture=installDom(),{dom,runtime}=fixture;
        let root:any,host:HTMLElement|undefined,input:HTMLInputElement|undefined,error:unknown,cleanup:unknown,completed=false,released=false;
        let chain:ReturnType<typeof configureChain>|undefined;const gate=deferredGate(),snapshots:unknown[]=[];
        const messages=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../../../dashboard/messages',locale+'.json'),'utf8')),dataA=summaryFor(A,locale),draft=SENTENCES[locale];
        const snap=(step:string)=>{const text=Array.from(host?.querySelectorAll<HTMLElement>('.whitespace-pre-line.leading-relaxed')??[]).map(n=>n.textContent||'').join('\n');const button=Array.from(host?.querySelectorAll<HTMLButtonElement>('button')??[]).find(n=>n.textContent?.trim()===messages.inbox.copilotSummarize);const s={step,summaryText:text,hasAlpha:text.includes(dataA.summary),hasBeta:text.includes(summaryFor(B,locale).summary),selected:host?.querySelector('button[aria-current="true"]')?.getAttribute('aria-label'),value:input?.value,disabled:button?.disabled,requests:structuredClone(chain?.controllerCalls??[]),routerCalls:chain?.routerCalls.length??0,sql:chain?.sql.length??0,cacheEvents:structuredClone(chain?.cacheEvents??[])};snapshots.push(s);return s;};
        try{
            if(testcase==='switch'&&!sameControls.has(locale))throw new Error('Prerequisite blocked: pending same-context control did not pass');
            chain=configureChain(locale);const original=chain.router.execute.getMockImplementation()!;
            chain.router.execute.mockImplementation(async(request:any)=>{const response=await original(request);await gate.promise;return response;});
            const {createRoot}=require('react-dom/client'),{NextIntlClientProvider}=require('next-intl'),InboxPage=require('../../../../dashboard/src/app/admin/inbox/page').default;
            host=required(dom.window.document.getElementById('fixture-root'),'host');root=createRoot(host);
            await settle(()=>root.render(createElement(NextIntlClientProvider,{locale,messages,timeZone:'America/Bogota',children:createElement(InboxPage)})));
            const choose=(name:string)=>required(Array.from(host!.querySelectorAll<HTMLButtonElement>('button[aria-label]')).find(n=>n.getAttribute('aria-label')?.endsWith(name)),name+' normal row');
            await click(choose('QA Alpha'));input=required(host.querySelector<HTMLInputElement>('input[placeholder="'+messages.inbox.messagePlaceholder+'"]'),'composer');await type(input,draft.a,dom.window);
            await click(exactButton(host,messages.inbox.copilotSummarize));const pendingA=snap('Alpha-router-pending-before-navigation');
            if(pendingA.hasAlpha||pendingA.hasBeta||pendingA.disabled!==true||chain.controllerCalls.length!==1||chain.routerCalls.length!==1||chain.cache.size!==0)throw new Error('Prerequisite blocked: controlled pending Alpha response not established');
            if(testcase==='switch'){await click(choose('QA Beta'));await type(input,draft.b,dom.window);const middle=snap('Beta-selected-while-Alpha-pending');if(!middle.selected?.endsWith('QA Beta')||input.value!==draft.b||api.getConversation.mock.calls.at(-1)?.[1]!==B)throw new Error('Prerequisite blocked: Beta selection/detail/input');}
            released=true;await settle(()=>gate.resolve());const finalState=snap('Alpha-response-completed-in-selected-context');
            fs.writeFileSync(path.join(outdir,locale+'-'+testcase+'-observed.json'),JSON.stringify({locale,testcase,pendingA,finalState,requests:chain.controllerCalls,routerCalls:chain.routerCalls,sql:chain.sql,buckets:chain.buckets,cacheEvents:chain.cacheEvents},null,2)+'\n',{flag:'wx'});
            expect(mockUnexpected).toEqual([]);expect(runtime).toEqual([]);expect(chain.controllerCalls).toHaveLength(1);expect(chain.routerCalls).toHaveLength(1);expect(chain.sql).toHaveLength(2);expect(chain.buckets).toHaveLength(4);expect(chain.cacheEvents.filter(r=>r.op==='setJson')).toHaveLength(1);
            for(const method of writeMethods)expect(api[method]).not.toHaveBeenCalled();
            // New product oracle after the response, distinct from completed-summary navigation.
            expect(finalState.hasAlpha).toBe(testcase==='same');
            expect(finalState.hasBeta).toBe(false);expect(finalState.disabled).toBe(false);expect(finalState.value).toBe(testcase==='same'?draft.a:draft.b);
            completed=true;
        }catch(caught){error=caught;throw caught;}
        finally {
            try {
                if (!released) { released = true; await settle(() => gate.resolve()); }
                const pendingBeforeDrain = timeouts.snapshot();
                // All product observations/assertions precede this bounded cleanup. Never clear or advance unknown work.
                const isBlur = (row: typeof pendingBeforeDrain[number]) => row.delay === 150 && row.stack.includes('onBlur') && /inbox[\\/]page\.tsx/.test(row.stack);
                const blurTasks = pendingBeforeDrain.filter(isBlur);
                const livePolls = pendingBeforeDrain.filter(row => !isBlur(row));
                const allowedBlur = livePolls.every(row => row.delay === 30000 && row.stack.includes('Window.setInterval') && row.stack.includes('ToolApprovalsPanel.tsx') && row.createdAt + row.delay - Date.now() > 150);
                const cleanupTrace = { before: pendingBeforeDrain, allowedBlur, advanced_ms: 0, after: [] as unknown[] };
                fs.writeFileSync(path.join(outdir, locale + '-' + testcase + '-timeout-before-cleanup.json'), JSON.stringify({ pendingBeforeDrain, allowedBlur, nativeNow: Date.now() }, null, 2) + '\n', { flag: 'wx' });
                if (!allowedBlur) throw new Error('Cleanup blocked: unknown or imminent other work ' + JSON.stringify(livePolls));
                if (blurTasks.length) {
                    if (!allowedBlur) throw new Error('Cleanup blocked: unknown pending timeout ' + JSON.stringify(pendingBeforeDrain));
                    await act(async () => { jest.advanceTimersByTime(150); for (let n = 0; n < 12; n++) await Promise.resolve(); });
                    cleanupTrace.advanced_ms = 150;
                }
                cleanupTrace.after = timeouts.snapshot();
                fs.writeFileSync(path.join(outdir, locale + '-' + testcase + '-timeout-cleanup.json'), JSON.stringify(cleanupTrace, null, 2) + '\n', { flag: 'wx' });
                if (root) await settle(() => root.unmount());
                const beforeTicks = { timerCount: jest.getTimerCount(), pendingMicrotasks: microtasks.snapshot() };
                let drainError: unknown;
                try { jest.runAllTicks(); } catch (caught) { drainError = caught; }
                const afterTicks = { timerCount: jest.getTimerCount(), pendingMicrotasks: microtasks.snapshot() };
                cleanup = { socketCount: mockSockets.length, disconnected: mockSockets.map(socket => socket.disconnect.mock.calls.length),
                    beforeTicks, afterTicks,
                    drainError: drainError instanceof Error ? { message: drainError.message, stack: drainError.stack } : String(drainError ?? ''),
                    timerCount: jest.getTimerCount(), runtime: [...runtime], unexpected: [...mockUnexpected] };
                fs.writeFileSync(path.join(outdir, locale + '-' + testcase + '-trace.json'), JSON.stringify({
                    locale, testcase, completed, error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error ?? ''),
                    snapshots, socketEvents: mockSocketLog, cleanup,
                }, null, 2) + '\n', { flag: 'wx' });
                if (!error) {
                    if (drainError) throw drainError;
                    expect(mockUnexpected).toEqual([]); expect(runtime).toEqual([]);
                    expect(mockSockets).toHaveLength(2);
                    expect(mockSockets.every(socket => socket.disconnect.mock.calls.length === 1)).toBe(true);
                    expect(jest.getTimerCount()).toBe(0);
                    if (completed && testcase === 'same') sameControls.add(locale);
                }
            } finally { fixture.dispose(); microtasks.restore(); timeouts.restore(); jest.useRealTimers(); }
        }
    });
});
