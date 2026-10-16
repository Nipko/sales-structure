/** @jest-environment node */
import { JSDOM } from 'jsdom';
import { runInNewContext } from 'vm';
import { webcrypto } from 'crypto';
import { TextEncoder, TextDecoder } from 'util';
import { WidgetTriggersService } from './widget-triggers.service';
import { WidgetTriggersController } from './widget-triggers.controller';
import { WidgetPublicController } from './widget-public.controller';
import { getLoaderScript } from './widget-loader';

/** PREPARED ONLY: widget-loader.saved-trigger.spec.ts
 * 12 cases / four locales: real admin save + real public selection/projection
 * reaches actual generated loader, open_widget for page_url contains '/pricing'.
 * Matching path opens floating panel; nonmatching or inactive rule does not.
 * Frequency=0 (UI: once per session), fresh local storage, first session only.
 * No tests of other operators/actions, timing, scroll, visits, binding or caps.
 * Controllers are invoked locally, not HTTP: no auth/guard/global security claim.
 * SQL below is a STRICT SEMANTIC IN-MEMORY ADAPTER, NOT PostgreSQL or persistence.
 * Public base widget row is a strict boundary fixture; no getConfig runtime/DDL.
 */
const TENANT = '11111111-1111-4111-8111-111111111111';
const CONFIG = '22222222-2222-4222-8222-222222222222';
const TRIGGER = '33333333-3333-4333-8333-333333333333';
const SESSION = '44444444-4444-4444-8444-444444444444';
const WIDGET = 'synthetic-saved-trigger';
const API = 'https://api.synthetic-widget.test/api/v1';
const ORIGIN = 'https://host.synthetic-widget.test';
const LOCALES = ['es', 'en', 'pt', 'fr'] as const;
/** Infrastructure-only clock/native-crypto adaptation for the unchanged12.
 * Await actual native digest promises, not a fixed Promise.resolve count.
 * No condition, SQL, test assertion, expected request or product oracle change.
 */
function fixtureClock() {
    const now = 0; let sequence = 0;
    const pending = new Set<Promise<unknown>>(); const nativeErrors: unknown[] = [];
    const jobs = new Map<number, { at: number; every: number; callback: () => void }>();
    function track<T>(promise: Promise<T>): Promise<T> {
        pending.add(promise);
        promise.then(() => { pending.delete(promise); }, error => { pending.delete(promise); nativeErrors.push(error); });
        return promise;
    }
    function schedule(callback: () => void, delay = 0, every = 0) {
        const id = ++sequence; jobs.set(id, { at: now + Math.max(0, Number(delay) || 0), every, callback }); return id;
    }
    async function flush() {
        let quiet = 0; let budget = 10000;
        for (let turn = 0; turn < 100; turn++) {
            const results = await Promise.allSettled([...pending]);
            const rejected = results.find(result => result.status === 'rejected');
            if (rejected?.status === 'rejected') throw rejected.reason;
            await new Promise<void>(resolve => setImmediate(resolve));
            if (nativeErrors.length) throw nativeErrors[0];
            let fired = false;
            for (;;) {
                const next = [...jobs].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
                if (!next || next[1].at > now) break;
                if (--budget < 0) throw new Error('Original12 synthetic timer runaway');
                const [id, job] = next;
                if (job.every) job.at += job.every; else jobs.delete(id);
                job.callback(); fired = true;
            }
            quiet = pending.size || fired ? 0 : quiet + 1;
            if (quiet >= 2) return;
        }
        throw new Error('Original12 native crypto/microtasks did not quiesce');
    }
    return { now: () => now, wall: () => 1800000000000 + now, track, flush,
        setTimeout: (cb: () => void, delay = 0) => schedule(cb, delay),
        setInterval: (cb: () => void, delay = 0) => schedule(cb, delay, Math.max(1, delay)),
        clear: (id: number) => { jobs.delete(Number(id)); }, dispose: () => { jobs.clear(); } };
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

async function savedPublicConfig(locale: string, active: boolean) {
    const unexpected: string[] = [];
    const widget = { id: CONFIG, tenant_id: TENANT, widget_id: WIDGET,
        is_active: true, is_demo: false, allowed_domains: ['host.synthetic-widget.test'],
        locale, welcome_message: '', agent_name: 'Synthetic QA', pre_chat_enabled: false,
        pre_chat_fields: ['name', 'email'], position: 'bottom-right', primary_color: '#123456' };
    const saved: any[] = [];
    const fail = (name: string): never => { unexpected.push(name); throw new Error('Unexpected boundary: ' + name); };
    const prisma = { $queryRawUnsafe: jest.fn(async (source: string, ...args: any[]) => {
        const sql = source.replace(/\s+/g, ' ').trim();
        if (sql.startsWith('SELECT COUNT(wt.id)::int AS count') && sql.includes('LEFT JOIN public.widget_triggers')) {
            if (args[0] !== TENANT || args[1] !== CONFIG) return [];
            return [{ count: saved.length }];
        }
        if (sql.startsWith('INSERT INTO public.widget_triggers') && sql.includes('SELECT wc.id')) {
            if (args[0] !== TENANT || args[1] !== CONFIG) return [];
            const row = { id: TRIGGER, widget_config_id: CONFIG, name: args[2], conditions: JSON.parse(args[3]),
                condition_operator: args[4], action_type: args[5], action_config: JSON.parse(args[6]),
                frequency_minutes: args[7], is_active: args[8], priority: args[9] };
            saved.push(row); return [clone(row)];
        }
        if (sql.startsWith('SELECT widget_id FROM public.widget_configs')) {
            return args[0] === TENANT && args[1] === CONFIG ? [{ widget_id: WIDGET }] : [];
        }
        if (sql.startsWith('SELECT wt.conditions, wt.condition_operator, wt.action_type,')
            && sql.includes('JOIN public.widget_configs wc')) {
            if (args[0] !== TENANT || args[1] !== CONFIG || !widget.is_active) return [];
            return clone(saved.filter(row => row.is_active).sort((a, b) => a.priority - b.priority));
        }
        return fail('SQL ' + sql);
    }) };
    const redis = {
        get: jest.fn(async (key: string) => key === 'widget_triggers_table_ok' ? '1' : fail('redis.get ' + key)),
        set: jest.fn(async () => fail('redis.set/DDL path')),
        del: jest.fn(async (key: string) => { if (key !== 'widget:config:' + WIDGET) fail('redis.del ' + key); }),
    };
    const throttle = { enforcePlanLimit: jest.fn(async (...args: any[]) => {
        if (JSON.stringify(args) !== JSON.stringify([TENANT, 'widgetTriggers', 0, 'widget triggers'])) fail('plan limit args');
    }) };
    const triggers = new WidgetTriggersService(prisma as any, redis as any);
    const admin = new WidgetTriggersController(triggers, throttle as any, prisma as any, redis as any);
    const input = { name: 'Synthetic page action', conditions: [{ type: 'page_url', operator: 'contains', value: '/pricing' }],
        conditionOperator: 'AND', actionType: 'open_widget', actionConfig: {}, frequencyMinutes: 0,
        isActive: active, priority: 0 };
    const created = await admin.create(TENANT, CONFIG, input);
    expect(created.success).toBe(true); expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ conditions: input.conditions, action_type: 'open_widget', is_active: active });
    expect(redis.del).toHaveBeenCalledWith('widget:config:' + WIDGET);
    const widgetBoundary = { getConfig: jest.fn(async (id: string) => id === WIDGET ? clone(widget) : fail('widget id')) };
    const publicController = new WidgetPublicController(widgetBoundary as any, triggers, {} as any);
    const response = await publicController.getConfig({ widgetId: WIDGET }, ORIGIN);
    expect(response.success).toBe(true);
    const data = (response as any).data;
    expect(data.locale).toBe(locale); expect(data.welcomeMessage).toBe('');
    expect(data.preChatFields).toEqual(['name', 'email']); expect(data.preChatEnabled).toBe(false);
    expect(data.triggers).toEqual(active ? [{ conditions: input.conditions, condition_operator: 'AND',
        action_type: 'open_widget', action_config: {}, frequency_minutes: 0, priority: 0 }] : []);
    expect(data.triggers.some((row: any) => 'name' in row || 'id' in row || 'widget_config_id' in row)).toBe(false);
    expect(unexpected).toEqual([]);
    return { response, unexpected };
}

async function mount(response: unknown, path: '/pricing' | '/support') {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: ORIGIN + path, pretendToBeVisual: true });
    const win = dom.window; const document = win.document; const timer = fixtureClock();
    const flush = timer.flush;
    const unexpected: string[] = [];
    const requests: string[] = [];
    const stored = new Map<string, string>();
    const handlers: Record<string, (value?: any) => void> = {};
    const socket = { on: jest.fn((name: string, callback: (value?: any) => void) => { handlers[name] = callback; }),
        io: { on: jest.fn() }, emit: jest.fn(() => { unexpected.push('socket emit'); throw new Error('No messages'); }) };
    const io = jest.fn(() => socket);
    let host: HTMLElement | undefined; let shadow: ShadowRoot | undefined;
    const createElement = document.createElement.bind(document);
    const localDocument = new Proxy(document, { get(target, key) {
        if (key === 'readyState') return 'complete';
        if (key === 'createElement') return (tag: string) => {
            if (tag.toLowerCase() === 'script') { unexpected.push('CDN'); throw new Error('No CDN'); }
            const node = createElement(tag); const attach = node.attachShadow.bind(node);
            node.attachShadow = ((options: ShadowRootInit) => { host = node as unknown as HTMLElement; shadow = attach(options) as unknown as ShadowRoot; return shadow; }) as typeof node.attachShadow;
            return node;
        };
        const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
    const href = ORIGIN + path;
    const fetchMock = jest.fn((url: string, options?: any) => {
        requests.push(url);
        if (url === API + '/widget/config/' + WIDGET && options === undefined) {
            return Promise.resolve({ json: () => Promise.resolve(clone(response)) });
        }
        if (url === API + '/widget/sessions' && options?.method === 'POST') {
            const body = JSON.parse(options.body);
            if (body.widgetId !== WIDGET || body.page !== href || !body.visitorId) unexpected.push('session body');
            return Promise.resolve({ json: () => Promise.resolve({ success: true,
                data: { sessionId: SESSION, token: 'synthetic-local-token' } }) });
        }
        unexpected.push('fetch ' + url); return Promise.reject(new Error('No real network'));
    });
    const localStorage = { getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => { stored.set(key, value); }, removeItem: (key: string) => { stored.delete(key); } };
    const sessionStorage = { getItem: (key: string) => stored.get('session:' + key) ?? null,
        setItem: (key: string, value: string) => { stored.set('session:' + key, value); }, removeItem: (key: string) => { stored.delete('session:' + key); } };
    const subtle = new Proxy(webcrypto.subtle, { get(target, key) {
        const value = Reflect.get(target, key, target);
        if (key === 'digest') return (...args: Parameters<typeof webcrypto.subtle.digest>) => timer.track(target.digest(...args));
        return typeof value === 'function' ? value.bind(target) : value;
    } });
    const crypto = { subtle, getRandomValues: webcrypto.getRandomValues.bind(webcrypto), randomUUID: webcrypto.randomUUID.bind(webcrypto) };
    class ClockDate extends Date { constructor(value?: any) { super(value === undefined ? timer.wall() : value); } static now() { return timer.wall(); } }
    const performance = { now: timer.now, timeOrigin: timer.wall() };
    Object.assign(win, { __paralllyWidget: { widgetId: WIDGET }, io, fetch: fetchMock,
        setTimeout: timer.setTimeout, clearTimeout: timer.clear, setInterval: timer.setInterval, clearInterval: timer.clear,
        TextEncoder, TextDecoder });
    Object.defineProperties(win, { crypto: { configurable: true, value: crypto }, performance: { configurable: true, value: performance },
        localStorage: { configurable: true, value: localStorage }, sessionStorage: { configurable: true, value: sessionStorage }, Date: { configurable: true, value: ClockDate } });
    runInNewContext(getLoaderScript(API), {
        window: win, io,
        document: localDocument, fetch: fetchMock, URL,
        location: win.location, localStorage, sessionStorage, crypto, TextEncoder, TextDecoder, Date: ClockDate, performance,
        console: { warn: jest.fn(), error: jest.fn(), log: jest.fn() },
        setTimeout: timer.setTimeout, clearTimeout: timer.clear, setInterval: timer.setInterval, clearInterval: timer.clear,
    });
    await flush();
    if (!shadow || !host) throw new Error('Actual loader did not mount');
    const root = shadow; const mountedHost = host;
    expect(io).toHaveBeenCalledTimes(1);
    handlers.connect?.(); handlers['widget:connected']?.({ sessionId: SESSION }); await flush();
    function invariants() {
        expect(unexpected).toEqual([]); expect(socket.emit).not.toHaveBeenCalled();
        expect(requests).toEqual([API + '/widget/config/' + WIDGET, API + '/widget/sessions']);
        expect(root.querySelectorAll('.pw-input')).toHaveLength(1);
        expect(root.querySelector<HTMLTextAreaElement>('.pw-input')?.value).toBe('');
        expect(root.querySelectorAll('.pw-msg')).toHaveLength(0);
        expect(root.querySelector('.pw-bubble')).not.toBeNull();
        expect(root.querySelector('.pw-hdr-name')?.textContent).toBe('Synthetic QA');
    }
    return { root, invariants, dispose: () => { win.dispatchEvent(new win.Event('pagehide')); timer.dispose(); mountedHost.remove(); win.close(); } };
}

describe.each(LOCALES)('saved widget proactive page trigger reaches public loader (%s)', locale => {
    it('product: active saved open_widget opens the floating panel when page URL contains the configured substring', async () => {
        const selected = await savedPublicConfig(locale, true);
        const view = await mount(selected.response, '/pricing');
        try {
            expect(view.root.querySelector('.pw-panel')?.classList.contains('show')).toBe(true);
            expect(view.root.querySelector('.pw-bubble')?.classList.contains('open')).toBe(true);
            view.invariants(); expect(selected.unexpected).toEqual([]);
        } finally { view.dispose(); }
    });
    it('control: the same active saved rule does not open a nonmatching page', async () => {
        const selected = await savedPublicConfig(locale, true);
        const view = await mount(selected.response, '/support');
        try {
            expect(view.root.querySelector('.pw-panel')?.classList.contains('show')).toBe(false);
            view.invariants(); expect(selected.unexpected).toEqual([]);
        } finally { view.dispose(); }
    });
    it('control: an inactive saved rule is excluded by real public projection and cannot open a matching page', async () => {
        const selected = await savedPublicConfig(locale, false);
        const view = await mount(selected.response, '/pricing');
        try {
            expect(view.root.querySelector('.pw-panel')?.classList.contains('show')).toBe(false);
            view.invariants(); expect(selected.unexpected).toEqual([]);
        } finally { view.dispose(); }
    });
});
