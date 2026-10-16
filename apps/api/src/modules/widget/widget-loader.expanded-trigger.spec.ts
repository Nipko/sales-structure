/** @jest-environment node */
import { JSDOM } from 'jsdom';
import { runInNewContext } from 'vm';
import { webcrypto } from 'crypto';
import { TextEncoder, TextDecoder } from 'util';
import { WidgetTriggersService } from './widget-triggers.service';
import { WidgetTriggersController } from './widget-triggers.controller';
import { WidgetPublicController } from './widget-public.controller';
import { getLoaderScript } from './widget-loader';

/** E-ONLY PREPARATION. Not run, compiled, preregistered or copied to WT.
 * Proposed target: modules/widget/widget-loader.expanded-trigger.spec.ts.
 * Exactly58 declared cases:40ES +18action EN/PT/FR. Original12 are separate
 * green regression only; never rewrite/replay their red as new evidence.
 * Proposed product semantics are pinned in the design before this suite:
 * c12f1631aac67bd48d4c637483ea79eaf027c7983c647c2540fdc64291fd6167.
 * Real local admin/controller/service/public projection/generated loader;
 * strict synthetic SQL (NOT PG), clock, storage, fetch and socket boundaries.
 * No guard/auth/global acceptance, browser geometry, provider or model claim.
 * Root must review/accept semantics and preregister before first Jest.
 */
const API = 'https://api.synthetic-widget.test/api/v1';
const ORIGIN = 'https://host.synthetic-widget.test';
const HREF = ORIGIN + '/catalog/offers?campaign=qa';
const TENANT = '11111111-1111-4111-8111-111111111111';
const CONFIG = '22222222-2222-4222-8222-222222222222';
const SESSION_A = '44444444-4444-4444-8444-444444444444';
const SESSION_B = '55555555-5555-4555-8555-555555555555';
const WIDGET = 'synthetic-expanded-trigger';
const DRAFT = 'Draft remains synthetic and unsent';
const SECONDARY = 'QA valid secondary';
const LITERAL = '<img src=x onerror="window.__qaUnsafe=1"><script>window.__qaUnsafe=2</script>';
type Locale = 'es' | 'en' | 'pt' | 'fr';
type Condition = { type: string; operator?: string; value?: unknown };
type Rule = { name: string; conditions: Condition[] | null; conditionOperator: string;
    actionType: string; actionConfig: Record<string, unknown>; frequencyMinutes: number;
    priority: number; isActive: boolean };
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const url = (value = '/catalog/', operator = 'contains'): Condition => ({ type: 'page_url', operator, value });
const rule = (patch: Partial<Rule> = {}): Rule => ({ name: 'Synthetic declared trigger',
    conditions: [url()], conditionOperator: 'AND', actionType: 'open_widget', actionConfig: {},
    frequencyMinutes: 0, priority: 0, isActive: true, ...patch });
const bubble = (message: string, patch: Partial<Rule> = {}) => rule({
    actionType: 'show_bubble_message', actionConfig: { message }, ...patch });
const banner = (message: string, position = 'top', bgColor = '#123456', patch: Partial<Rule> = {}) => rule({
    actionType: 'show_banner', actionConfig: { message, position, bgColor }, ...patch });

/** No implementation of condition evaluation, promotion, fingerprint or cap
 * belongs in this DB double. It models only existing SQL selection/save shape.
 */
async function savedProjection(rules: Rule[], locale: Locale = 'es', options: {
    widgetId?: string; prechat?: boolean; reversePublicTies?: boolean;
} = {}) {
    const widgetId = options.widgetId || WIDGET;
    const unexpected: string[] = [];
    const saved: Array<Record<string, any>> = [];
    const fail = (label: string): never => { unexpected.push(label); throw new Error('Unexpected boundary: ' + label); };
    const widget = { id: CONFIG, tenant_id: TENANT, widget_id: widgetId, is_active: true,
        is_demo: false, allowed_domains: ['host.synthetic-widget.test'], locale,
        welcome_message: '', agent_name: 'Synthetic QA', pre_chat_enabled: !!options.prechat,
        pre_chat_fields: ['name', 'email'], position: 'bottom-right', primary_color: '#123456' };
    const prisma = { $queryRawUnsafe: jest.fn(async (source: string, ...args: any[]) => {
        const sql = source.replace(/\s+/g, ' ').trim();
        if (args[0] !== TENANT || args[1] !== CONFIG) return fail('tenant/config bindings');
        if (sql.startsWith('SELECT COUNT(wt.id)::int AS count') && sql.includes('LEFT JOIN public.widget_triggers')) {
            return [{ count: saved.length }];
        }
        if (sql.startsWith('INSERT INTO public.widget_triggers') && sql.includes('SELECT wc.id')) {
            const row = { id: '33333333-3333-4333-8333-' + String(saved.length + 1).padStart(12, '0'),
                widget_config_id: CONFIG, name: args[2], conditions: JSON.parse(args[3]),
                condition_operator: args[4], action_type: args[5], action_config: JSON.parse(args[6]),
                frequency_minutes: args[7], is_active: args[8], priority: args[9] };
            saved.push(row); return [clone(row)];
        }
        if (sql.startsWith('SELECT widget_id FROM public.widget_configs')) return [{ widget_id: widgetId }];
        if (sql.startsWith('SELECT wt.conditions, wt.condition_operator, wt.action_type,') && sql.includes('JOIN public.widget_configs wc')) {
            const rows = saved.filter(row => row.is_active).sort((a, b) => a.priority - b.priority);
            // SQL specifies priority only; either tied input order is legal.
            if (options.reversePublicTies) rows.sort((a, b) => a.priority - b.priority || saved.indexOf(b) - saved.indexOf(a));
            return clone(rows);
        }
        return fail('SQL ' + sql);
    }) };
    const redis = { get: jest.fn(async (key: string) => key === 'widget_triggers_table_ok' ? '1' : fail('redis.get ' + key)),
        set: jest.fn(async () => fail('redis.set/DDL path')),
        del: jest.fn(async (key: string) => { if (key !== 'widget:config:' + widgetId) fail('redis.del ' + key); }) };
    let expectedCount = 0;
    const throttle = { enforcePlanLimit: jest.fn(async (...args: any[]) => {
        if (JSON.stringify(args) !== JSON.stringify([TENANT, 'widgetTriggers', expectedCount, 'widget triggers'])) fail('plan count');
    }) };
    const service = new WidgetTriggersService(prisma as any, redis as any);
    const admin = new WidgetTriggersController(service, throttle as any, prisma as any, redis as any);
    for (const input of rules) {
        expectedCount = saved.length;
        const created = await admin.create(TENANT, CONFIG, clone(input) as any);
        expect(created.success).toBe(true);
        expect(saved[saved.length - 1]).toMatchObject({ conditions: input.conditions || [],
            action_type: input.actionType, frequency_minutes: input.frequencyMinutes, is_active: input.isActive });
    }
    const widgetBoundary = { getConfig: jest.fn(async (id: string) => id === widgetId ? clone(widget) : fail('widget id')) };
    const controller = new WidgetPublicController(widgetBoundary as any, service, {} as any);
    const response = await controller.getConfig({ widgetId }, ORIGIN);
    expect(response.success).toBe(true);
    const data = (response as any).data;
    expect(data.locale).toBe(locale);
    expect(data.preChatEnabled).toBe(!!options.prechat);
    expect(data.triggers).toHaveLength(rules.filter(r => r.isActive).length);
    for (const item of data.triggers) {
        expect(Object.keys(item).sort()).toEqual(['action_config', 'action_type', 'condition_operator', 'conditions', 'frequency_minutes', 'priority']);
    }
    expect(unexpected).toEqual([]);
    return { response, widgetId, locale, prechat: !!options.prechat, unexpected, saved };
}
type Projection = Awaited<ReturnType<typeof savedProjection>>;

/** Deterministic synthetic clock. No wall sleep/Jest global timers. Track and
 * await real native digest promises instead of assuming a fixed yield count.
 * Rejections remain observable as harness errors; no failed digest is hidden.
 * Due0 tasks run in same virtual tick. Bounded quiet-turn budget guards loops.
 */
function clock() {
    let mono = 0; let wall = 1800000000000; let sequence = 0;
    const jobs = new Map<number, { at: number; every: number; callback: () => void }>();
    const pending = new Set<Promise<unknown>>();
    const nativeErrors: unknown[] = [];
    const cancel = (id: number) => { jobs.delete(Number(id)); };
    function schedule(callback: () => void, delay = 0, every = 0) {
        const id = ++sequence;
        jobs.set(id, { at: mono + Math.max(0, Number(delay) || 0), every, callback }); return id;
    }
    function track<T>(promise: Promise<T>): Promise<T> {
        pending.add(promise);
        promise.then(() => { pending.delete(promise); }, error => { pending.delete(promise); nativeErrors.push(error); });
        return promise;
    }
    async function flush() {
        let quiet = 0;
        for (let turn = 0; turn < 100; turn++) {
            const results = await Promise.allSettled([...pending]);
            const rejected = results.find(result => result.status === 'rejected');
            if (rejected?.status === 'rejected') throw rejected.reason;
            await new Promise<void>(resolve => setImmediate(resolve));
            if (nativeErrors.length) throw nativeErrors[0];
            quiet = pending.size ? 0 : quiet + 1;
            if (quiet >= 2) return;
        }
        throw new Error('Native crypto/microtask fixture did not quiesce within100 turns');
    }
    async function advance(ms: number) {
        if (!Number.isFinite(ms) || ms < 0) throw new Error('Invalid synthetic advance');
        const target = mono + ms; let budget = 10000;
        while (jobs.size) {
            const [id, job] = [...jobs].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
            if (job.at > target) break;
            if (--budget < 0) throw new Error('Synthetic timer runaway');
            wall += job.at - mono; mono = job.at;
            if (job.every) job.at += job.every; else jobs.delete(id);
            job.callback(); await flush();
        }
        wall += target - mono; mono = target; await flush();
    }
    return { now: () => mono, wall: () => wall, rewindWall: (ms: number) => { wall -= ms; },
        setTimeout: (cb: () => void, ms = 0) => schedule(cb, ms),
        setInterval: (cb: () => void, ms = 0) => schedule(cb, ms, Math.max(1, ms)),
        clearTimeout: cancel, clearInterval: cancel, track, flush, advance, clear: () => jobs.clear() };
}
type Clock = ReturnType<typeof clock>;
type Stores = { local: Map<string, string>; session: Map<string, string> };
const stores = (): Stores => ({ local: new Map(), session: new Map() });

function documentFixture(href = HREF, timer = clock()) {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: href, pretendToBeVisual: true });
    const win = dom.window;
    const roots: ShadowRoot[] = [];
    const nativeAttach = win.Element.prototype.attachShadow;
    win.Element.prototype.attachShadow = function (options: ShadowRootInit) {
        const root = nativeAttach.call(this, options); roots.push(root as unknown as ShadowRoot); return root;
    };
    const nativeCreate = win.document.createElement.bind(win.document);
    const document = new Proxy(win.document, { get(target, key) {
        if (key === 'readyState') return 'complete';
        if (key === 'createElement') return (tag: string, options?: any) => {
            if (tag.toLowerCase() === 'script') throw new Error('CDN forbidden in fixture');
            return nativeCreate(tag, options);
        };
        const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
    } });
    let top = 0; let height = 2000; let viewport = 1000;
    for (const node of [win.document.documentElement, win.document.body]) {
        Object.defineProperties(node, { scrollHeight: { configurable: true, get: () => height },
            clientHeight: { configurable: true, get: () => viewport }, scrollTop: { configurable: true,
                get: () => top, set: (value: number) => { top = Number(value); } } });
    }
    Object.defineProperties(win, { scrollY: { configurable: true, get: () => top },
        pageYOffset: { configurable: true, get: () => top }, innerHeight: { configurable: true, get: () => viewport },
        crypto: { configurable: true, value: webcrypto } });
    return { dom, win, document, roots, timer,
        geometry(nextTop: number, nextHeight = 2000, nextViewport = 1000) { top = nextTop; height = nextHeight; viewport = nextViewport; },
        dispose() { timer.clear(); win.close(); } };
}
type Doc = ReturnType<typeof documentFixture>;
type MountOptions = { shared?: Stores; doc?: Doc; sessionId?: string; token?: string; refreshInvalid?: boolean;
    blockedFrequencyStorage?: boolean; mode?: 'page' };

async function mount(selected: Projection, options: MountOptions = {}) {
    const doc = options.doc || documentFixture(); const { win, timer } = doc;
    const shared = options.shared || stores();
    const unexpected: string[] = []; const requests: Array<{ url: string; body?: any }> = [];
    const handlers: Record<string, (value?: any) => void> = {};
    const sid = options.sessionId || SESSION_A; const token = options.token || 'synthetic-local-token-A';
    const fail = (label: string): never => { unexpected.push(label); throw new Error(label); };
    const storage = (map: Map<string, string>) => ({
        get length() { return map.size; }, key: (index: number) => [...map.keys()][index] ?? null,
        getItem: (key: string) => {
            if (options.blockedFrequencyStorage && !key.startsWith('parallly_w_' + selected.widgetId)) throw new Error('Synthetic storage unavailable');
            return map.get(key) ?? null;
        },
        setItem: (key: string, value: string) => {
            // Preserve credential/getVid namespace so failure tests concern
            // frequency infrastructure, not the old unrelated getVid throw.
            const credential = key === 'parallly_w_' + selected.widgetId || key === 'parallly_w_' + selected.widgetId + '_vid';
            if (options.blockedFrequencyStorage && !credential) throw new Error('Synthetic storage unavailable');
            map.set(String(key), String(value));
        }, removeItem: (key: string) => { map.delete(key); }, clear: () => { throw new Error('No global storage clear'); },
    });
    const localStorage = storage(shared.local); const sessionStorage = storage(shared.session);
    const socket = { on: jest.fn((name: string, callback: (value?: any) => void): unknown => { handlers[name] = callback; return socket; }),
        off: jest.fn(), disconnect: jest.fn(), close: jest.fn(), io: { on: jest.fn(), off: jest.fn() },
        emit: jest.fn(() => fail('socket emit forbidden')) };
    const io = jest.fn(() => socket);
    const fetchMock = jest.fn(async (request: string | URL, init?: any) => {
        const target = String(request); const body = init?.body ? JSON.parse(init.body) : undefined;
        requests.push({ url: target, body });
        if (target === API + '/widget/config/' + selected.widgetId && !init) return { json: async () => clone(selected.response) };
        if (target === API + '/widget/sessions/refresh' && init?.method === 'POST' && typeof body?.token === 'string') {
            return { json: async () => options.refreshInvalid ? { success: false, error: 'invalid_token' }
                : { success: true, data: { sessionId: sid, token } } };
        }
        if (target === API + '/widget/sessions' && init?.method === 'POST') {
            if (body?.widgetId !== selected.widgetId || body.page !== win.location.href || typeof body.visitorId !== 'string') fail('session request bindings');
            if (Object.keys(body).some(key => !['widgetId', 'visitorId', 'page', 'resumeToken', 'name', 'email', 'phone'].includes(key))) fail('session body fields');
            return { json: async () => ({ success: true, data: { sessionId: sid, token } }) };
        }
        return fail('unexpected fetch ' + target);
    });
    const subtle = new Proxy(webcrypto.subtle, { get(target, key) {
        const value = Reflect.get(target, key, target);
        if (key === 'digest') return (...args: Parameters<typeof webcrypto.subtle.digest>) => timer.track(target.digest(...args));
        return typeof value === 'function' ? value.bind(target) : value;
    } });
    const crypto = { subtle, getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
        randomUUID: webcrypto.randomUUID.bind(webcrypto) };
    class ClockDate extends Date {
        constructor(value?: any) { super(value === undefined ? timer.wall() : value); }
        static now() { return timer.wall(); }
    }
    const performance = { now: timer.now, timeOrigin: timer.wall() - timer.now() };
    Object.assign(win, { __paralllyWidget: { widgetId: selected.widgetId, ...(options.mode ? { mode: options.mode } : {}) },
        io, fetch: fetchMock, setTimeout: timer.setTimeout, clearTimeout: timer.clearTimeout,
        setInterval: timer.setInterval, clearInterval: timer.clearInterval,
        requestAnimationFrame: (cb: () => void) => timer.setTimeout(cb, 16), cancelAnimationFrame: timer.clearTimeout,
        TextEncoder, TextDecoder });
    Object.defineProperties(win, { localStorage: { configurable: true, value: localStorage },
        sessionStorage: { configurable: true, value: sessionStorage }, performance: { configurable: true, value: performance },
        Date: { configurable: true, value: ClockDate }, crypto: { configurable: true, value: crypto } });
    const beforeRoots = doc.roots.length;
    runInNewContext(getLoaderScript(API), { window: win, document: doc.document, location: win.location,
        localStorage, sessionStorage, navigator: win.navigator, io, fetch: fetchMock, URL, URLSearchParams,
        Date: ClockDate, performance, crypto, TextEncoder, TextDecoder,
        setTimeout: timer.setTimeout, clearTimeout: timer.clearTimeout, setInterval: timer.setInterval,
        clearInterval: timer.clearInterval, requestAnimationFrame: (cb: () => void) => timer.setTimeout(cb, 16),
        cancelAnimationFrame: timer.clearTimeout, queueMicrotask, console: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } });
    await timer.flush(); await timer.advance(0);
    const root = doc.roots[beforeRoots]; if (!root) throw new Error('Actual generated loader did not mount');
    if (io.mock.calls.length) { handlers.connect?.(); handlers['widget:connected']?.({ sessionId: sid }); }
    await timer.flush(); await timer.advance(0);
    let contextNumber = 0;
    const opened = () => !!root.querySelector('.pw-panel')?.classList.contains('show');
    const input = () => root.querySelector<HTMLTextAreaElement>('.pw-input');
    function textNodes(text: string) {
        // A real literal text node may share a parent with its close button.
        // Do not force a future implementation to wrap it in a named span.
        const found: HTMLElement[] = [];
        const walker = win.document.createTreeWalker(root as any, win.NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
            if (node.nodeValue === text && node.parentElement) found.push(node.parentElement as unknown as HTMLElement);
            node = walker.nextNode();
        }
        return found;
    }
    function invariant() {
        expect(unexpected).toEqual([]); expect(selected.unexpected).toEqual([]); expect(socket.emit).not.toHaveBeenCalled();
        expect(root.querySelectorAll('.pw-msg')).toHaveLength(0);
        expect(root.querySelector('.pw-hdr-name')?.textContent).toBe('Synthetic QA');
        expect(requests.filter(item => item.url.includes('/widget/config/'))).toHaveLength(1);
        expect(requests.filter(item => item.url.endsWith('/widget/sessions')).length).toBeLessThanOrEqual(1);
        expect(requests.filter(item => item.url.endsWith('/widget/sessions/refresh')).length).toBeLessThanOrEqual(1);
        expect(io.mock.calls.length).toBeLessThanOrEqual(1);
        expect((win as any).__qaUnsafe).toBeUndefined();
    }
    async function settle() { await timer.flush(); await timer.advance(0); }
    return { root, doc, shared, requests, socket, io, opened, input, textNodes, invariant, settle,
        async advance(ms: number) { await timer.advance(ms); },
        async close() { const btn = root.querySelector<HTMLButtonElement>('.pw-close'); if (!btn) throw new Error('No normal close'); btn.click(); await settle(); },
        async open() { const btn = root.querySelector<HTMLButtonElement>('.pw-bubble'); if (!btn) throw new Error('No launcher'); btn.click(); await settle(); },
        async pageEvent(path?: string) {
            win.history.pushState({}, '', path || '/catalog/offers?context=' + (++contextNumber));
            win.dispatchEvent(new win.PopStateEvent('popstate')); await settle();
        },
        async scroll(top: number, height = 2000, viewport = 1000) {
            doc.geometry(top, height, viewport); win.document.dispatchEvent(new win.Event('scroll')); win.dispatchEvent(new win.Event('scroll')); await settle();
        },
        async resize() { win.dispatchEvent(new win.Event('resize')); await settle(); },
        async exit(y = 0, related: EventTarget | null = null) {
            win.document.dispatchEvent(new win.MouseEvent('mouseout', { clientY: y, relatedTarget: related as any, bubbles: true })); await settle();
        },
        async dismiss(text: string) {
            const leaf = textNodes(text)[0]; if (!leaf) throw new Error('Promotion not present');
            let container: Element | null = leaf;
            while (container && container !== root.host) {
                const button = [...container.querySelectorAll<HTMLButtonElement>('button')].find(btn => !btn.matches('.pw-close,.pw-bubble,.pw-send,.pw-form-btn'));
                if (button) {
                    const accessible = (button.getAttribute('aria-label') || button.textContent || '').trim();
                    expect(accessible).toMatch(({ es: /^Cerrar\b/, en: /^Close\b/, pt: /^Fechar\b/, fr: /^Fermer\b/ } as const)[selected.locale]);
                    button.click(); await settle(); return;
                }
                container = container.parentElement;
            }
            throw new Error('No normal named promotion close control');
        },
        unmount() { win.dispatchEvent(new win.Event('pagehide')); root.host.remove(); },
        dispose() { win.dispatchEvent(new win.Event('pagehide')); root.host.remove(); if (!options.doc) doc.dispose(); },
    };
}
type View = Awaited<ReturnType<typeof mount>>;

async function withView(rules: Rule[], run: (view: View) => Promise<void>, locale: Locale = 'es',
    projectionOptions: Parameters<typeof savedProjection>[2] = {}, mountOptions: MountOptions = {}) {
    const selected = await savedProjection(rules, locale, projectionOptions);
    const view = await mount(selected, mountOptions);
    try { await run(view); view.invariant(); } finally { view.dispose(); }
}
function promotion(view: View, text: string) {
    const nodes = view.textNodes(text); expect(nodes).toHaveLength(1);
    expect(nodes[0].closest('.pw-msgs,.pw-msg')).toBeNull(); return nodes[0];
}
/** JSDOM does not apply closed-shadow stylesheets to getComputedStyle fully.
 * Resolve actual matching stylesheet declarations through real CSSOM, without
 * depending on a proposed promotion classname or requiring inline styles.
 * This checks declared DOM/CSS semantics, never pixel geometry or cascade parity.
 */
function declaredStyle(view: View, element: Element, property: string) {
    let value = '';
    for (const source of view.root.querySelectorAll('style')) {
        const parser = view.doc.win.document.createElement('style'); parser.textContent = source.textContent;
        view.doc.win.document.head.appendChild(parser);
        try {
            for (const item of [...(parser.sheet?.cssRules || [])]) {
                const css = item as CSSStyleRule;
                if (!css.selectorText || !css.style) continue;
                if (css.selectorText.split(',').some(selector => {
                    try { return element.matches(selector.trim()); } catch { return false; }
                })) {
                    value = css.style.getPropertyValue(property) || value;
                }
            }
        } finally { parser.remove(); }
    }
    return (element as HTMLElement).style.getPropertyValue(property) || value;
}

type Scenario = { id: string; name: string; run: () => Promise<void> };
const cases: Scenario[] = [];
function scenario(id: string, name: string, run: () => Promise<void>) { cases.push({ id, name, run }); }

// URL + boolean8. Positive branches distinguish absent engine from a valid negative.
scenario('U1', 'equals complete href positive', async () => {
    await withView([rule({ conditions: [url(HREF, 'equals')] })], async v => { expect(v.opened()).toBe(true); });
});
scenario('U2', 'equals different query negative then matching normal transition', async () => {
    await withView([rule({ conditions: [url(ORIGIN + '/catalog/offers?campaign=other', 'equals')] })], async v => {
        expect(v.opened()).toBe(false); await v.pageEvent('/catalog/offers?campaign=other'); expect(v.opened()).toBe(true);
    });
});
scenario('U3', 'starts_with matching origin and path', async () => {
    await withView([rule({ conditions: [url(ORIGIN + '/catalog/', 'starts_with')] })], async v => { expect(v.opened()).toBe(true); });
});
scenario('U4', 'starts_with different path then matching normal transition', async () => {
    await withView([rule({ conditions: [url(ORIGIN + '/support/', 'starts_with')] })], async v => {
        expect(v.opened()).toBe(false); await v.pageEvent('/support/help'); expect(v.opened()).toBe(true);
    });
});
scenario('U5', 'AND all conditions true', async () => {
    await withView([rule({ conditions: [url('/catalog/'), url('campaign=qa')] })], async v => { expect(v.opened()).toBe(true); });
});
scenario('U6', 'AND one valid condition false until route changes', async () => {
    await withView([rule({ conditions: [url('/catalog/'), url('campaign=later')] })], async v => {
        expect(v.opened()).toBe(false); await v.pageEvent('/catalog/offers?campaign=later'); expect(v.opened()).toBe(true);
    });
});
scenario('U7', 'OR one valid condition true', async () => {
    await withView([rule({ conditionOperator: 'OR', conditions: [url('/support/'), url('/catalog/')] })], async v => { expect(v.opened()).toBe(true); });
});
scenario('U8', 'OR all valid conditions false until one becomes true', async () => {
    await withView([rule({ conditionOperator: 'OR', conditions: [url('/support/'), url('/pricing/')] })], async v => {
        expect(v.opened()).toBe(false); await v.pageEvent('/pricing/options'); expect(v.opened()).toBe(true);
    });
});

// Other conditions8. Own-document metrics/events are synthetic, not real geometry.
scenario('C1', 'time before threshold then after threshold', async () => {
    await withView([rule({ conditions: [{ type: 'time_on_page', value: 2 }] })], async v => {
        await v.advance(1999); expect(v.opened()).toBe(false); await v.advance(1); expect(v.opened()).toBe(true);
    });
});
scenario('C2', 'time exact threshold triggers once without periodic repeat', async () => {
    await withView([rule({ conditions: [{ type: 'time_on_page', value: 1 }], frequencyMinutes: 1 })], async v => {
        await v.advance(1000); expect(v.opened()).toBe(true); await v.close();
        await v.advance(180000); expect(v.opened()).toBe(false);
    });
});
scenario('C3', 'scroll below threshold and zero denominator never auto100', async () => {
    await withView([rule({ conditions: [{ type: 'scroll_depth', value: 50 }] })], async v => {
        await v.scroll(0, 1000, 1000); expect(v.opened()).toBe(false);
        await v.scroll(499); expect(v.opened()).toBe(false); await v.scroll(500); expect(v.opened()).toBe(true);
    });
});
scenario('C4', 'scroll exact threshold measured from real local event', async () => {
    await withView([rule({ conditions: [{ type: 'scroll_depth', value: 50 }] })], async v => {
        await v.scroll(500); expect(v.opened()).toBe(true); await v.close();
        await v.scroll(750); expect(v.opened()).toBe(false);
    });
});
scenario('C5', 'exit top document boundary', async () => {
    await withView([rule({ conditions: [{ type: 'exit_intent' }] })], async v => {
        expect(v.opened()).toBe(false); await v.exit(0, null); expect(v.opened()).toBe(true);
    });
});
scenario('C6', 'lateral and internal transition are not exit', async () => {
    await withView([rule({ conditions: [{ type: 'exit_intent' }] })], async v => {
        await v.exit(30, null); expect(v.opened()).toBe(false);
        await v.exit(0, v.doc.win.document.body); expect(v.opened()).toBe(false);
        await v.exit(-1, null); expect(v.opened()).toBe(true);
    });
});
scenario('C7', 'visit eq1 retained by same-document remount without increment', async () => {
    const selected = await savedProjection([bubble('QA visit one', { conditions: [{ type: 'visit_count', operator: 'eq', value: 1 }], frequencyMinutes: 1 })]);
    const shared = stores(); const doc = documentFixture();
    const first = await mount(selected, { shared, doc });
    try {
        promotion(first, 'QA visit one'); await first.dismiss('QA visit one'); first.invariant(); first.unmount();
        await doc.timer.advance(60000);
        const second = await mount(selected, { shared, doc });
        try { promotion(second, 'QA visit one'); second.invariant(); } finally { second.unmount(); }
    } finally { doc.dispose(); }
});
scenario('C8', 'future visit threshold negative then new document reaches it', async () => {
    const selected = await savedProjection([rule({ conditions: [{ type: 'visit_count', operator: 'gte', value: 2 }] })]);
    const shared = stores(); const first = await mount(selected, { shared });
    try { expect(first.opened()).toBe(false); first.invariant(); } finally { first.dispose(); }
    const second = await mount(selected, { shared });
    try { expect(second.opened()).toBe(true); second.invariant(); } finally { second.dispose(); }
});

// Six action oracles are reused four locales, yielding24 bodies total.
const actionScenarios: Array<{ id: string; name: string; run: (locale: Locale) => Promise<void> }> = [
    { id: 'A1', name: 'open is idempotent and already-open does not consume frequency', run: async locale => {
        await withView([rule({ conditions: [{ type: 'time_on_page', value: 1 }] })], async v => {
            await v.open(); expect(v.opened()).toBe(true);
            const input = v.input(); expect(input).not.toBeNull(); input!.value = DRAFT; input!.focus();
            await v.advance(1000); expect(v.opened()).toBe(true); expect(v.input()?.value).toBe(DRAFT);
            await v.close(); expect(v.opened()).toBe(false);
            // A legitimate new time context reaches threshold. Since the first
            // action was already satisfied, once/session must remain available.
            await v.pageEvent(); await v.advance(1000); expect(v.opened()).toBe(true); expect(v.input()?.value).toBe(DRAFT);
        }, locale);
    } },
    { id: 'A2', name: 'bubble promotion is literal notice outside history without opening', run: async locale => {
        await withView([bubble('QA bubble promotion', { conditions: [{ type: 'time_on_page', value: 1 }] })], async v => {
            const input = v.input(); expect(input).not.toBeNull(); input!.value = DRAFT;
            const external = v.doc.win.document.createElement('button'); external.textContent = 'Host focus'; v.doc.win.document.body.appendChild(external); external.focus();
            await v.advance(1000); promotion(v, 'QA bubble promotion'); expect(v.opened()).toBe(false);
            expect(v.input()?.value).toBe(DRAFT); expect(v.doc.win.document.activeElement).toBe(external);
            await v.dismiss('QA bubble promotion'); expect(v.textNodes('QA bubble promotion')).toHaveLength(0);
            await v.advance(120000); expect(v.textNodes('QA bubble promotion')).toHaveLength(0); external.remove();
        }, locale);
    } },
    { id: 'A3', name: 'bubble HTML payload remains text and executes no markup', run: async locale => {
        await withView([bubble(LITERAL)], async v => {
            promotion(v, LITERAL); expect(v.opened()).toBe(false);
            expect(v.root.querySelectorAll('img[src="x"],script')).toHaveLength(0);
            await v.dismiss(LITERAL); expect(v.textNodes(LITERAL)).toHaveLength(0);
        }, locale);
    } },
    { id: 'A4', name: 'banner top is text notice outside history', run: async locale => {
        await withView([banner('QA banner top', 'top')], async v => {
            const node = promotion(v, 'QA banner top'); expect(v.opened()).toBe(false);
            const chain: Element[] = []; for (let parent: Element | null = node; parent; parent = parent.parentElement) chain.push(parent);
            expect(chain.some(item => declaredStyle(v, item, 'position') === 'fixed' && /^0(?:px)?$/.test(declaredStyle(v, item, 'top')))).toBe(true);
            await v.dismiss('QA banner top'); expect(v.textNodes('QA banner top')).toHaveLength(0);
        }, locale);
    } },
    { id: 'A5', name: 'banner bottom color and draft preserved', run: async locale => {
        await withView([banner('QA banner bottom', 'bottom', '#12AB34', { conditions: [{ type: 'time_on_page', value: 1 }] })], async v => {
            const input = v.input(); expect(input).not.toBeNull(); input!.value = DRAFT;
            await v.advance(1000); const node = promotion(v, 'QA banner bottom'); expect(v.opened()).toBe(false);
            const chain: Element[] = []; for (let parent: Element | null = node; parent; parent = parent.parentElement) chain.push(parent);
            expect(chain.some(item => {
                const color = declaredStyle(v, item, 'background-color') || declaredStyle(v, item, 'background');
                const normalized = v.doc.win.document.createElement('span'); normalized.style.backgroundColor = color;
                return declaredStyle(v, item, 'position') === 'fixed' && /^0(?:px)?$/.test(declaredStyle(v, item, 'bottom'))
                    && normalized.style.backgroundColor === 'rgb(18, 171, 52)';
            })).toBe(true);
            expect(v.input()?.value).toBe(DRAFT); await v.dismiss('QA banner bottom'); expect(v.input()?.value).toBe(DRAFT);
        }, locale);
    } },
    { id: 'A6', name: 'banner HTML remains text and is normally dismissible', run: async locale => {
        await withView([banner(LITERAL)], async v => {
            promotion(v, LITERAL); expect(v.root.querySelectorAll('img[src="x"],script')).toHaveLength(0);
            expect(v.opened()).toBe(false); await v.dismiss(LITERAL); expect(v.textNodes(LITERAL)).toHaveLength(0);
        }, locale);
    } },
];
for (const item of actionScenarios) scenario(item.id, item.name, () => item.run('es'));

// Frequency10: session identity is sessionId, never token; no periodic campaign.
scenario('F1', 'once second normal event after close remains suppressed', async () => {
    await withView([rule()], async v => { expect(v.opened()).toBe(true); await v.close(); await v.pageEvent(); expect(v.opened()).toBe(false); });
});
scenario('F2', 'once same-session remount remains suppressed', async () => {
    const selected = await savedProjection([rule()]); const shared = stores();
    const first = await mount(selected, { shared });
    try { expect(first.opened()).toBe(true); await first.close(); first.invariant(); } finally { first.dispose(); }
    const second = await mount(selected, { shared });
    try { expect(second.opened()).toBe(false); expect(second.requests.filter(item => item.url.endsWith('/refresh'))).toHaveLength(1); second.invariant(); } finally { second.dispose(); }
});
scenario('F3', 'invalid old credential creates new session and rearms', async () => {
    const selected = await savedProjection([rule()]); const shared = stores();
    const first = await mount(selected, { shared });
    try { expect(first.opened()).toBe(true); await first.close(); first.invariant(); } finally { first.dispose(); }
    const second = await mount(selected, { shared, refreshInvalid: true, sessionId: SESSION_B, token: 'synthetic-local-token-B' });
    try {
        expect(second.opened()).toBe(true);
        expect(second.requests.filter(item => item.url.endsWith('/refresh'))).toHaveLength(1);
        expect(second.requests.filter(item => item.url.endsWith('/widget/sessions'))).toHaveLength(1); second.invariant();
    } finally { second.dispose(); }
});
scenario('F4', 'prechat provisional effect migrates to confirmed session without second opening', async () => {
    const selected = await savedProjection([rule()], 'es', { prechat: true });
    const shared = stores(); const first = await mount(selected, { shared });
    try {
        expect(first.opened()).toBe(true); expect(first.root.querySelector('.pw-form')).not.toBeNull();
        expect(first.requests.filter(item => item.url.endsWith('/widget/sessions'))).toHaveLength(0); expect(first.io).not.toHaveBeenCalled();
        // Normal own-DOM inputs, synthetic values. Filling legacy name/email
        // also respects the separately prepared required-fields contract; this
        // scenario does not test blank-required behavior or duplicate its72.
        const fields = first.root.querySelectorAll<HTMLInputElement>('.pw-form input'); expect(fields).toHaveLength(2);
        fields[0].value = 'Synthetic visitor'; fields[1].value = 'synthetic@example.test';
        for (const field of fields) field.dispatchEvent(new first.doc.win.Event('input', { bubbles: true }));
        const start = first.root.querySelector<HTMLButtonElement>('.pw-form-btn'); expect(start).not.toBeNull(); start!.click(); await first.settle();
        expect(first.requests.filter(item => item.url.endsWith('/widget/sessions'))).toHaveLength(1);
        expect(first.root.querySelector('.pw-form')).toBeNull(); await first.close(); await first.pageEvent(); expect(first.opened()).toBe(false); first.invariant();
    } finally { first.dispose(); }
    const second = await mount(selected, { shared });
    try { expect(second.opened()).toBe(false); second.invariant(); } finally { second.dispose(); }
});
scenario('F5', 'token rotation same sessionID does not rearm', async () => {
    const selected = await savedProjection([rule()]); const shared = stores();
    const first = await mount(selected, { shared });
    try { expect(first.opened()).toBe(true); await first.close(); first.invariant(); } finally { first.dispose(); }
    const second = await mount(selected, { shared, token: 'synthetic-rotated-token-same-session' });
    try { expect(second.opened()).toBe(false); expect(second.requests.filter(item => item.url.endsWith('/refresh'))).toHaveLength(1); second.invariant(); } finally { second.dispose(); }
});
scenario('F6', 'cooldown before59999 and exact60000 permits only normal event', async () => {
    await withView([rule({ frequencyMinutes: 1 })], async v => {
        expect(v.opened()).toBe(true); await v.close(); await v.advance(59999); await v.pageEvent(); expect(v.opened()).toBe(false);
        await v.advance(1); expect(v.opened()).toBe(false); await v.pageEvent(); expect(v.opened()).toBe(true);
    });
});
scenario('F7', 'wall clock rollback after remount cannot allow early or indefinite cooldown', async () => {
    const selected = await savedProjection([rule({ frequencyMinutes: 1 })]); const shared = stores(); const timer = clock();
    const firstDoc = documentFixture(HREF, timer); const first = await mount(selected, { shared, doc: firstDoc });
    try { expect(first.opened()).toBe(true); await first.close(); first.invariant(); first.unmount(); } finally { firstDoc.win.close(); timer.clear(); }
    timer.rewindWall(3600000);
    const secondDoc = documentFixture(HREF, timer); const second = await mount(selected, { shared, doc: secondDoc });
    try {
        expect(second.opened()).toBe(false); await second.advance(59999); await second.pageEvent(); expect(second.opened()).toBe(false);
        await second.advance(1); await second.pageEvent(); expect(second.opened()).toBe(true); second.invariant();
    } finally { second.unmount(); secondDoc.dispose(); }
});
scenario('F8', 'identical effective fingerprint ignores private label priority and duplicate rule order', async () => {
    const shared = stores(); const firstSelected = await savedProjection([bubble('QA fingerprint'), bubble('QA fingerprint', { name: 'Other private label', priority: 8 })]);
    const first = await mount(firstSelected, { shared });
    try { promotion(first, 'QA fingerprint'); await first.dismiss('QA fingerprint'); first.invariant(); } finally { first.dispose(); }
    const secondSelected = await savedProjection([bubble('QA fingerprint', { name: 'Changed private label', priority: -4 }), bubble('QA fingerprint', { priority: 2 })]);
    const second = await mount(secondSelected, { shared });
    try { expect(second.textNodes('QA fingerprint')).toHaveLength(0); second.invariant(); } finally { second.dispose(); }
});
scenario('F9', 'widget scope A suppression cannot suppress B', async () => {
    const shared = stores(); const selectedA = await savedProjection([rule()], 'es', { widgetId: WIDGET + '-A' });
    const first = await mount(selectedA, { shared });
    try { expect(first.opened()).toBe(true); await first.close(); first.invariant(); } finally { first.dispose(); }
    const selectedB = await savedProjection([rule()], 'es', { widgetId: WIDGET + '-B' }); const second = await mount(selectedB, { shared });
    try { expect(second.opened()).toBe(true); second.invariant(); } finally { second.dispose(); }
});
scenario('F10', 'frequency storage unavailable fails closed while manual launcher remains usable', async () => {
    await withView([bubble('QA blocked storage')], async v => {
        expect(v.textNodes('QA blocked storage')).toHaveLength(0); expect(v.opened()).toBe(false);
        await v.open(); expect(v.opened()).toBe(true); expect(v.input()).not.toBeNull(); await v.close(); expect(v.opened()).toBe(false);
    }, 'es', {}, { blockedFrequencyStorage: true });
});

// Validation/cross-rule8. Valid secondary avoids vacuous negative passes.
const invalidRules: Array<{ id: string; name: string; bad: Rule }> = [
    { id: 'V1', name: 'empty conditions invalid whole rule', bad: rule({ conditions: [] }) },
    { id: 'V2', name: 'null actual admin-normalized empty rule invalid', bad: rule({ conditions: null }) },
    { id: 'V3', name: 'unknown condition invalid even in trueOR', bad: rule({ conditionOperator: 'OR', conditions: [url(), { type: 'unknown_qa', value: 1 }] }) },
    { id: 'V4', name: 'unknown operator invalid even in trueOR', bad: rule({ conditionOperator: 'OR', conditions: [url(), url('/catalog/', 'unknown_qa')] }) },
    { id: 'V5', name: 'scroll101 invalid whole rule', bad: rule({ conditions: [{ type: 'scroll_depth', value: 101 }] }) },
    { id: 'V6', name: 'unknown action cannot consume priority or frequency', bad: rule({ actionType: 'unknown_qa' }) },
];
for (const item of invalidRules) scenario(item.id, item.name, async () => {
    await withView([item.bad, bubble(SECONDARY, { priority: 10 })], async v => {
        expect(v.opened()).toBe(false); promotion(v, SECONDARY); await v.dismiss(SECONDARY);
        await v.pageEvent(); expect(v.opened()).toBe(false); expect(v.textNodes(SECONDARY)).toHaveLength(0);
    });
});
scenario('V7', 'priority tie stable under reversed public order selects one identical winner', async () => {
    const tied = [bubble('QA tied A'), bubble('QA tied B')];
    const winners: string[] = [];
    for (const reversePublicTies of [false, true]) {
        await withView(tied, async v => {
            const visible = ['QA tied A', 'QA tied B'].filter(text => v.textNodes(text).length > 0);
            expect(visible).toHaveLength(1); promotion(v, visible[0]); winners.push(visible[0]); expect(v.opened()).toBe(false);
        }, 'es', { reversePublicTies });
    }
    expect(winners[0]).toBe(winners[1]);
});
scenario('V8', 'SPA resets time context preserves visit1 without config session socket reload', async () => {
    const selected = await savedProjection([rule({ conditions: [url('/support/'), { type: 'time_on_page', value: 1 }, { type: 'visit_count', operator: 'eq', value: 1 }] })]);
    const view = await mount(selected);
    try {
        await view.advance(1500); expect(view.opened()).toBe(false);
        const counts = { requests: view.requests.length, io: view.io.mock.calls.length };
        // pushState alone, no popstate: the declared href observer must detect
        // this without monkeypatching history and without a network reload.
        view.doc.win.history.pushState({}, '', '/support/help'); await view.advance(500);
        expect(view.opened()).toBe(false); await view.advance(999); expect(view.opened()).toBe(false);
        await view.advance(1); expect(view.opened()).toBe(true);
        expect(view.requests).toHaveLength(counts.requests); expect(view.io).toHaveBeenCalledTimes(counts.io); view.invariant();
    } finally { view.dispose(); }
});

for (const locale of ['en', 'pt', 'fr'] as const) {
    for (const item of actionScenarios) scenario(item.id + '-' + locale, item.name + ' (' + locale + ')', () => item.run(locale));
}

describe('declared expanded saved trigger semantics admin→publicDTO→generated VM', () => {
    // Static count guards prevent accidentally shipping a partial denominator.
    if (cases.length !== 58 || new Set(cases.map(item => item.id)).size !== 58) throw new Error('Expected58 unique prepared scenario bodies');
    for (const item of cases) it(item.id + ': ' + item.name, item.run);
});

/** Two correction-risk controls, separate from the original58 denominator.
 * No new functional run/DEF. Root preregisters their addition before first Jest.
 * The original cases array and exact58 uniqueness guard above remain intact.
 * Host pushState is followed by a normal event BEFORE the500ms href observer.
 * No monkeypatch of history, source closure injection or hidden engine reads.
 */
describe('correction risk: immediate normal event after unobserved SPA URL change', () => {
    it('R1 resets old elapsed time before scroll can satisfy support AND time1 AND scroll50', async () => {
        await withView([rule({ conditions: [url('/support/'),
            { type: 'time_on_page', value: 1 }, { type: 'scroll_depth', value: 50 }], conditionOperator: 'AND' })], async v => {
            expect(v.doc.win.location.pathname).toBe('/catalog/offers');
            expect(v.opened()).toBe(false);
            const input = v.input(); expect(input).not.toBeNull(); input!.value = DRAFT;
            await v.advance(1500);
            expect(v.opened()).toBe(false);
            const counts = { requests: v.requests.length, io: v.io.mock.calls.length };
            // No popstate and no clock advance: this normal scroll is the first
            // signal after pushState, before the next500ms href observation.
            v.doc.win.history.pushState({}, '', '/support/help');
            await v.scroll(500, 2000, 1000);
            expect(v.doc.win.location.pathname).toBe('/support/help');
            expect(v.opened()).toBe(false);
            await v.advance(999); expect(v.opened()).toBe(false);
            await v.advance(1); expect(v.opened()).toBe(true);
            expect(v.input()?.value).toBe(DRAFT);
            expect(v.requests).toHaveLength(counts.requests);
            expect(v.io).toHaveBeenCalledTimes(counts.io);
        });
    });
    it('R2 clears the old exit flag before immediate support scroll and requires a new normal exit', async () => {
        await withView([rule({ conditions: [url('/support/'),
            { type: 'scroll_depth', value: 50 }, { type: 'exit_intent' }], conditionOperator: 'AND' })], async v => {
            expect(v.doc.win.location.pathname).toBe('/catalog/offers');
            const input = v.input(); expect(input).not.toBeNull(); input!.value = DRAFT;
            // Scroll ensures the real loader installs/uses its scroll listener;
            // old exit alone never satisfies this rule while URL is catalog.
            await v.scroll(500, 2000, 1000);
            await v.exit(0, null); expect(v.opened()).toBe(false);
            const counts = { requests: v.requests.length, io: v.io.mock.calls.length };
            v.doc.win.history.pushState({}, '', '/support/help');
            await v.scroll(500, 2000, 1000);
            expect(v.doc.win.location.pathname).toBe('/support/help');
            expect(v.opened()).toBe(false);
            // Same new context now receives its own top-boundary exit. It may
            // open exactly once; no500ms poll or artificial timer tie is needed.
            await v.exit(0, null); expect(v.opened()).toBe(true);
            expect(v.input()?.value).toBe(DRAFT);
            expect(v.requests).toHaveLength(counts.requests);
            expect(v.io).toHaveBeenCalledTimes(counts.io);
        });
    });
});
/** PREPARED APPEND ONLY; NOT REGISTERED OR RUN.
 * Append after immutable expanded60 prefix only if root reviews/preregisters.
 * Reuses actual admin→publicDTO→generated VM fixture above. Four structural
 * correction controls, NOT real-browser geometry and NOT four new defects.
 * Existing60 assertions/original12 remain unchanged. Composite76 only after
 * root explicitly adopts4 and a real source change justifies fresh green.
 */
describe('DEF132 correction risk: bubble width containing block', () => {
    const message = 'Aviso sintético QA: teclado con panel cerrado';
    const status = (view: View) => {
        const text = promotion(view, message);
        const node = text.closest<HTMLElement>('[role="status"]');
        expect(node).not.toBeNull();
        expect(node!.textContent).toContain(message);
        expect(node!.querySelector('button')?.getAttribute('aria-label')).toBe('Cerrar aviso');
        return node!;
    };
    for (const position of ['bottom-right', 'bottom-left'] as const) {
        it('P-' + position + ' gives floating bubble an explicit viewport-bounded width', async () => {
            const selected = await savedProjection([bubble(message)]);
            // Standard real publicDTO field; vary only layout input, not the
            // trigger projection, frequency, runtime or persistence oracle.
            const data = selected.response.data;
            if (!data) throw new Error('Public config absent before layout input');
            data.position = position;
            const view = await mount(selected);
            try {
                const node = status(view);
                expect(declaredStyle(view, node, 'position')).toBe('absolute');
                expect(declaredStyle(view, node, 'width')).toBe('280px');
                expect(declaredStyle(view, node, 'max-width')).toBe('calc(100vw - 40px)');
                expect(declaredStyle(view, node, 'bottom')).toBe('76px');
                expect(declaredStyle(view, node, position === 'bottom-left' ? 'left' : 'right')).toMatch(/^0(?:px)?$/);
                expect(view.opened()).toBe(false);
                view.invariant();
            } finally { view.dispose(); }
        });
    }
    it('P-page keeps inline bubble width relative to the normal page container', async () => {
        const selected = await savedProjection([bubble(message)]);
        const doc = documentFixture();
        const host = doc.document.createElement('div'); host.id = 'parallly-widget-host';
        doc.document.body.appendChild(host);
        const view = await mount(selected, { doc, mode: 'page' });
        try {
            const node = status(view);
            expect(declaredStyle(view, node, 'position')).toBe('relative');
            expect(declaredStyle(view, node, 'max-width')).toBe('280px');
            expect(declaredStyle(view, node, 'width')).toBe('');
            expect(declaredStyle(view, node, 'margin-bottom')).toBe('10px');
            expect(host.contains(view.root.host)).toBe(true);
            expect(view.root.querySelector('.pw-bubble')).toBeNull();
            view.invariant();
        } finally { view.dispose(); doc.dispose(); }
    });
    it('P-banner keeps fixed edge-to-edge layout without bubble width constraints', async () => {
        await withView([banner(message, 'top', '#123456')], async view => {
            const node = status(view);
            expect(declaredStyle(view, node, 'position')).toBe('fixed');
            expect(declaredStyle(view, node, 'left')).toMatch(/^0(?:px)?$/);
            expect(declaredStyle(view, node, 'right')).toMatch(/^0(?:px)?$/);
            expect(declaredStyle(view, node, 'top')).toMatch(/^0(?:px)?$/);
            expect(declaredStyle(view, node, 'width')).toBe('');
            expect(declaredStyle(view, node, 'max-width')).toBe('');
            expect(view.opened()).toBe(false);
        });
    });
});
