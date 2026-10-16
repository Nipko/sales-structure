/** @jest-environment node */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';

// PREPARED ONLY. Proposed API destination modules/copilot/copilot-rewrite-draft-concurrency.ui.spec.tsx.
// Root must review/copy/preregister before its first execution. No app bootstrap.
const TENANT = '11111111-1111-4111-8111-111111111111';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const A = '44444444-4444-4444-8444-444444444444';
const B = '55555555-5555-4555-8555-555555555555';
const LOCALES = ['es', 'en', 'pt', 'fr'] as const;
const CASES = ['stable', 'switch', 'edited', 'router-error'] as const;
type Case = typeof CASES[number];
const SENTENCES = {
    es: { a: 'Confirmo la información A.', revised: 'Con gusto confirmo la información A.', b: 'Información exclusiva de B.', edited: 'Edición posterior A3.' },
    en: { a: 'I confirm information A.', revised: 'I gladly confirm information A.', b: 'Information exclusively for B.', edited: 'Later revision A3.' },
    pt: { a: 'Confirmo a informação A.', revised: 'Confirmo com prazer a informação A.', b: 'Informação exclusiva de B.', edited: 'Edição posterior A3.' },
    fr: { a: "Je confirme l’information A.", revised: "Je confirme volontiers l’information A.", b: 'Information exclusive de B.', edited: 'Modification ultérieure A3.' },
};
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
    'returnConversationToAI', 'updateInboxContactMetadata', 'fetch'];
const allowedApi = new Set(['getInbox', 'getConversation', 'getMacros', 'getCustomAttributes', 'getCannedResponses',
    'getToolApprovals', 'getConversationActiveObjects', 'rewriteCopilotReply']);
const stableControls = new Set<string>();

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
    return { promise, resolve, reject };
}
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

function installDom() {
    const dom = new JSDOM('<!doctype html><html><body><main id="fixture-root"></main></body></html>', {
        url: 'https://owned-inbox-rewrite.test/admin/inbox',
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
    const schemaLookups: string[] = [];
    const buckets: Array<{ key: string; ttl: number }> = [];
    const counts = new Map<string, number>();
    const pending = deferred<{ content: string }>();
    const routerCalls: any[] = [];
    const prisma = {
        getTenantSchemaName: jest.fn(async (tenant: string) => {
            schemaLookups.push(tenant); if (tenant !== TENANT) return mockFail('prisma.tenant'); return 'tenant_synthetic_rewrite';
        }),
        executeInTenantSchema: jest.fn(async (schema: string, query: string, params: unknown[]) => {
            sql.push({ schema, query, params: [...params] });
            if (schema !== 'tenant_synthetic_rewrite' || params.length !== 1 || ![A, B].includes(String(params[0]))) return mockFail('prisma.scope');
            const normalized = query.replace(/\s+/g, ' ').trim();
            if (normalized === 'SELECT assigned_to FROM conversations WHERE id = $1::uuid LIMIT 1') return [{ assigned_to: ACTOR }];
            if (normalized === 'SELECT id, content_text, content_type, direction, created_at, metadata FROM messages WHERE conversation_id = $1::uuid ORDER BY created_at DESC LIMIT 10') {
                return [{ id: '66666666-6666-4666-8666-666666666666', content_text: 'Synthetic context ' + params[0],
                    content_type: 'text', direction: 'inbound', created_at: '2026-10-16T12:00:00Z', metadata: {} }];
            }
            return mockFail('prisma.sql.' + normalized);
        }),
    };
    const redis = { incrementRateLimit: jest.fn(async (key: string, ttl: number) => {
        const prefixes = [`copilot:rate:tenant:${TENANT}:user:${ACTOR}:minute:`, `copilot:rate:tenant:${TENANT}:user:${ACTOR}:day:`,
            `copilot:rate:tenant:${TENANT}:minute:`, `copilot:rate:tenant:${TENANT}:day:`];
        const prefix = prefixes.find(candidate => key.startsWith(candidate));
        if (!prefix || !/^\d+$/.test(key.slice(prefix.length)) || ![60, 86400].includes(ttl)) return mockFail('redis.scope');
        buckets.push({ key, ttl }); const count = (counts.get(key) || 0) + 1; counts.set(key, count); return count;
    }) };
    const inert = (name: string) => new Proxy({}, { get: (_host, key) => (..._args: unknown[]) => mockFail(name + '.' + String(key)) });
    const { CopilotRateLimitService } = require('./copilot-rate-limit.service');
    const { CopilotService } = require('./copilot.service');
    const { CopilotController } = require('./copilot.controller');
    const router = { execute: jest.fn(async (request: any) => { routerCalls.push(structuredClone(request)); return pending.promise; }) };
    const service = new CopilotService(inert('config'), prisma, redis, router, inert('knowledge'), inert('throttle'), inert('verticals'),
        new CopilotRateLimitService(redis), inert('quality'), inert('signals'), inert('assessment'), inert('configuration'), inert('operations'));
    const controller = new CopilotController(service, inert('assessment'), inert('configuration'), inert('operations'));
    const controllerCalls: unknown[] = [];
    for (const method of Object.values(api)) method.mockReset().mockImplementation(async () => mockFail('api.unconfigured'));
    const fixtureConversation = (id: string) => ({ id, contactName: id === A ? 'QA Alpha' : 'QA Beta', contactId: 'contact-' + id,
        status: 'active', channel: 'telegram', lastMessage: id === A ? 'Synthetic A context' : 'Synthetic B context',
        last_message_at: id === A ? '2026-10-16T12:01:00Z' : '2026-10-16T12:00:00Z', unreadCount: 0, isAiHandled: false });
    const scope = (tenant: string, id?: string) => { if (tenant !== TENANT || (id !== undefined && ![A, B].includes(id))) return mockFail('api.identity'); };
    api.getInbox.mockImplementation(async (tenant: string, filter: string) => {
        scope(tenant); if (filter !== 'all') return mockFail('api.filter'); return { success: true, data: [fixtureConversation(A), fixtureConversation(B)] };
    });
    api.getConversation.mockImplementation(async (tenant: string, id: string) => {
        scope(tenant, id); return { success: true, data: { id, contact: { id: 'contact-' + id, customFields: {} }, notes: [],
            messages: [{ id: 'message-' + id, content_text: 'Synthetic context ' + id, direction: 'inbound', content_type: 'text',
                created_at: '2026-10-16T12:00:00Z', metadata: {} }] } };
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
    api.rewriteCopilotReply.mockImplementation(async (id: string, draft: string, tone: string) => {
        if (id !== A || draft !== SENTENCES[locale].a || tone !== 'friendly') return mockFail('rewrite.input');
        controllerCalls.push({ tenant: TENANT, id, draft, tone, actor: ACTOR, role: 'tenant_admin' });
        return controller.rewriteReply(TENANT, id, { draft, tone }, { user: { id: ACTOR, role: 'tenant_admin' } });
    });
    return { pending, routerCalls, controllerCalls, sql, schemaLookups, buckets };
}

describe('Inbox Copilot rewrite preserves the current user draft across asynchronous completion', () => {
    for (const locale of LOCALES) for (const testcase of CASES) it(locale + ' ' + testcase, async () => {
        const outdir = process.env.COPILOT_REWRITE_EVIDENCE_DIR;
        if (!outdir || !path.isAbsolute(outdir) || !fs.statSync(outdir).isDirectory()) throw new Error('Root-created absolute exclusive evidence directory required');
        mockUnexpected.length = 0; mockSocketLog.length = 0; mockSockets.length = 0;
        jest.useFakeTimers({ now: new Date('2026-10-16T12:05:00Z'), doNotFake: ['setImmediate', 'nextTick', 'performance'] });
        const microtasks = trackFakeMicrotasks();
        const fixture = installDom();
        const { dom, runtime } = fixture;
        const snapshots: unknown[] = [];
        let root: any; let completed = false; let error: unknown;
        let cleanup: unknown;
        const messages = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../dashboard/messages', locale + '.json'), 'utf8'));
        const texts = SENTENCES[locale];
        let chain: ReturnType<typeof configureChain> | undefined;
        let host: HTMLElement | undefined;
        let input: HTMLInputElement | undefined;
        const snap = (step: string) => {
            const selected = host?.querySelector('button[aria-current="true"]');
            const active = dom.window.document.activeElement as HTMLElement | null;
            const state = { step, value: input?.value ?? null, selected: selected?.getAttribute('aria-label') ?? null,
                focusIsComposer: active === input, focusText: active?.textContent?.slice(0, 100) ?? null,
                pendingLabelPresent: host?.textContent?.includes(messages.inbox.copilotRewriting) ?? false,
                rewriteDisabled: Array.from(host?.querySelectorAll('button') ?? []).find(button => button.textContent?.trim() === messages.inbox.copilotRewrite)?.disabled ?? null,
                rewriteCalls: api.rewriteCopilotReply.mock.calls.length, routerCalls: chain?.routerCalls.length ?? 0,
                apiCalls: Object.fromEntries(Object.entries(api).filter(([, fn]) => fn.mock.calls.length).map(([key, fn]) => [key, structuredClone(fn.mock.calls)])) };
            snapshots.push(state); return state;
        };
        try {
            if (testcase !== 'stable' && !stableControls.has(locale)) throw new Error('Prerequisite blocked: stable rewrite control did not pass for ' + locale);
            chain = configureChain(locale);
            const { createRoot } = require('react-dom/client');
            const { NextIntlClientProvider } = require('next-intl');
            const InboxPage = require('../../../../dashboard/src/app/admin/inbox/page').default;
            host = required(dom.window.document.getElementById('fixture-root'), 'host');
            root = createRoot(host);
            await settle(() => root.render(createElement(NextIntlClientProvider, { locale, messages, timeZone: 'America/Bogota', children: createElement(InboxPage) })));
            input = required(host.querySelector<HTMLInputElement>('input[placeholder="' + messages.inbox.messagePlaceholder + '"]'), 'composer');
            await type(input, texts.a, dom.window);
            snap('before-rewrite');
            await click(exactButton(host, messages.inbox.copilotRewrite));
            await click(exactButton(host, messages.inbox.copilotToneFriendly));
            const pendingState = snap('rewrite-pending');
            // Prerequisites are observed before attempting the concurrent action. A missing prerequisite
            // blocks the dependent sequence; it cannot be reported as a concurrency-product failure.
            if (mockUnexpected.length || runtime.length) throw new Error('Harness boundary/runtime prerequisite: ' + JSON.stringify({ mockUnexpected, runtime }));
            if (!pendingState.pendingLabelPresent || pendingState.value !== texts.a || chain.routerCalls.length !== 1) {
                throw new Error('Prerequisite blocked: valid pending rewrite was not established');
            }
            if (testcase === 'switch') {
                const beta = required(Array.from(host.querySelectorAll<HTMLButtonElement>('button[aria-label]')).find(button => button.getAttribute('aria-label')?.endsWith('QA Beta')), 'Beta normal conversation button');
                await click(beta);
                await type(input, texts.b, dom.window);
                const detailCall = api.getConversation.mock.calls.at(-1);
                const selected = host.querySelector('button[aria-current="true"]')?.getAttribute('aria-label');
                if (detailCall?.[1] !== B || !selected?.endsWith('QA Beta') || input.value !== texts.b) {
                    snap('switch-prerequisite-blocked');
                    throw new Error('Prerequisite blocked: Beta detail, selected thread and typed draft were not established');
                }
            } else if (testcase === 'edited') await type(input, texts.edited, dom.window);
            const immediatelyBeforeResponse = snap('immediately-before-response');
            await settle(() => {
                if (testcase === 'router-error') chain!.pending.reject(new Error('Synthetic unavailable router'));
                else chain!.pending.resolve({ content: texts.revised });
            });
            const finalState = snap('after-response');
            // Capture the complete sequence before the first product assertion. No private handler/state invocation.
            const wanted = testcase === 'switch' ? texts.b : testcase === 'edited' ? texts.edited : testcase === 'router-error' ? texts.a : texts.revised;
            const preconditions = { pendingState, immediatelyBeforeResponse, finalState,
                sql: chain.sql, schemaLookups: chain.schemaLookups, buckets: chain.buckets,
                controllerCalls: chain.controllerCalls, routerCalls: chain.routerCalls };
            fs.writeFileSync(path.join(outdir, locale + '-' + testcase + '-observed.json'), JSON.stringify(preconditions, null, 2) + '\n', { flag: 'wx' });
            expect(mockUnexpected).toEqual([]);
            expect(runtime).toEqual([]);
            expect(pendingState.pendingLabelPresent).toBe(true);
            expect(pendingState.value).toBe(texts.a);
            expect(chain.controllerCalls).toHaveLength(1);
            expect(chain.routerCalls).toHaveLength(1);
            expect(chain.routerCalls[0].messages).toEqual([{ role: 'user', content: texts.a }]);
            expect(chain.routerCalls[0].tenantId).toBe(TENANT);
            expect(chain.routerCalls[0].systemPrompt).toContain('Synthetic context ' + A);
            expect(chain.sql).toHaveLength(2);
            expect(chain.sql.every(row => row.params[0] === A)).toBe(true);
            expect(chain.buckets).toHaveLength(4);
            expect(finalState.value).toBe(wanted);
            expect(finalState.pendingLabelPresent).toBe(false);
            expect(finalState.rewriteDisabled).toBe(false);
            expect(finalState.focusIsComposer).toBe(true);
            expect(finalState.selected?.endsWith(testcase === 'switch' ? 'QA Beta' : 'QA Alpha')).toBe(true);
            for (const method of writeMethods) expect(api[method]).not.toHaveBeenCalled();
            for (const [method, fn] of Object.entries(api)) if (!allowedApi.has(method)) expect(fn).not.toHaveBeenCalled();
            completed = true;
        } catch (caught) { error = caught; throw caught; }
        finally {
            try {
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
                // Cleanup is an independent harness gate; retain product failure as the first error if present.
                if (!error) {
                    if (drainError) throw drainError;
                    expect(mockUnexpected).toEqual([]);
                    expect(runtime).toEqual([]);
                    expect(mockSockets).toHaveLength(2);
                    expect(mockSockets.every(socket => socket.disconnect.mock.calls.length === 1)).toBe(true);
                    expect(jest.getTimerCount()).toBe(0);
                    if (completed && testcase === 'stable') stableControls.add(locale);
                }
            } finally { fixture.dispose(); microtasks.restore(); jest.useRealTimers(); }
        }
    });
});
