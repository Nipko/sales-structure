/** @jest-environment node */
import { runInNewContext } from 'vm';
import { JSDOM } from 'jsdom';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { getLoaderScript } from './widget-loader';
import { CreateWidgetSessionDto } from './dto/widget-public.dto';

// API worker setup imports Node PostgreSQL dependencies before each spec.
// Keep that Node environment and own only the DOM this loader test requires.
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>');
const { document, Event } = dom.window;
afterAll(() => dom.window.close());

/**
 * PREPARED ONLY. Future destination apps/api/src/modules/widget/widget-loader.prechat-recovery.spec.ts
 * 16 cases: ES/EN/PT/FR x envelope failure/retry, transport failure/retry,
 * reachable pending click control, first-session success with optional identity empty.
 * Runs the UNMODIFIED generated loader and actual browser click callbacks in a
 * LOCAL jsdom tree through a VM. DOM facade fixes only document readiness.
 * Own closed shadow root is retained when constructed for local assertions;
 * no closure/state injection, source replacement, real endpoint or credentials.
 * widget_configs.pre_chat_enabled/pre_chat_fields is distinct from admin pre_chat_forms.
 * Name/email/phone are OPTIONAL in CreateWidgetSessionDto. No invented required
 * policy: successful requests must meet the actual DTO's required widget/visitor IDs
 * and optional email validation. Existing widget-security.spec.ts owns malformed DTO tests.
 * Runtime LLM, DB, browser network, storage, CDN and websocket transmission are absent.
 */
const API = 'https://api.synthetic-widget.test/api/v1';
const WIDGET = 'synthetic-prechat';
const PAGE = 'https://host.synthetic-widget.test/local-prechat';
const SESSION_KEY = 'parallly_w_' + WIDGET;
const LOCALES = ['es', 'en', 'pt', 'fr'] as const;
const VALID_IDENTITY = ['Synthetic QA', 'synthetic@example.test', '+12025550100'];
const START = { es: 'Iniciar chat', en: 'Start chat', pt: 'Iniciar chat', fr: 'Démarrer le chat' };
type Result = { success: true; data: { sessionId: string; token: string } } | { success: false; error: string };
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
async function flush() { for (let turn = 0; turn < 32; turn++) await Promise.resolve(); }
function validDto(payload: unknown) {
    const dto = plainToInstance(CreateWidgetSessionDto, payload);
    expect(validateSync(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
}
async function mount(locale: typeof LOCALES[number], outcomes: ReturnType<typeof deferred<Result>>[]) {
    const requests: Array<{ url: string; options?: any; body?: any }> = [];
    const unexpected: string[] = [];
    const stored = new Map<string, string>();
    const writes: Array<[string, string]> = [];
    const socket = { on: jest.fn(), io: { on: jest.fn() }, emit: jest.fn(() => {
        unexpected.push('socket emit'); throw new Error('No visitor or acknowledgement messages allowed');
    }) };
    const io = jest.fn(() => socket);
    let shadow: ShadowRoot | undefined;
    const host = document.createElement('div'); host.id = 'local-widget-host';
    document.body.appendChild(host);
    const realCreate = document.createElement.bind(document);
    const localDocument = {
        readyState: 'complete', body: document.body, head: document.head,
        querySelector: document.querySelector.bind(document),
        createDocumentFragment: document.createDocumentFragment.bind(document),
        createElement: (tag: string) => {
            if (tag.toLowerCase() === 'script') {
                unexpected.push('external script'); throw new Error('CDN must not be used');
            }
            const element = realCreate(tag);
            const attach = element.attachShadow.bind(element);
            element.attachShadow = ((options: ShadowRootInit) => {
                shadow = attach(options); return shadow;
            }) as typeof element.attachShadow;
            return element;
        },
        addEventListener: () => { unexpected.push('unexpected readiness listener'); },
    };
    const fetchMock = jest.fn((url: string, options?: any) => {
        if (url === API + '/widget/config/' + WIDGET && options === undefined) {
            requests.push({ url });
            return Promise.resolve({ json: () => Promise.resolve({ success: true, data: {
                locale, preChatEnabled: true, preChatFields: ['name', 'email', 'phone'],
                agentName: 'Synthetic QA', primaryColor: '#123456',
            } }) });
        }
        if (url === API + '/widget/sessions' && options?.method === 'POST') {
            const body = JSON.parse(options.body);
            validDto(body);
            if (options.headers?.['Content-Type'] !== 'application/json') unexpected.push('session content type');
            if (body.widgetId !== WIDGET || body.page !== PAGE || typeof body.visitorId !== 'string' || !body.visitorId.length) {
                unexpected.push('session identity mismatch');
            }
            requests.push({ url, options, body });
            const index = requests.filter(request => request.body).length - 1;
            if (!outcomes[index]) {
                unexpected.push('unplanned session request');
                return Promise.reject(new Error('unplanned session request'));
            }
            return outcomes[index].promise.then(result => ({ json: () => Promise.resolve(result) }));
        }
        unexpected.push('unexpected fetch ' + url);
        return Promise.reject(new Error('network unavailable in local harness'));
    });
    const localStorage = {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => { stored.set(key, value); writes.push([key, value]); },
    };
    const warn = jest.fn();
    runInNewContext(getLoaderScript(API), {
        window: { __paralllyWidget: { widgetId: WIDGET, mode: 'page', host: '#local-widget-host' }, io },
        io, document: localDocument, fetch: fetchMock, localStorage,
        location: { href: PAGE }, URL,
        console: { warn, error: jest.fn(), log: jest.fn() },
        setTimeout: () => { unexpected.push('unexpected timer'); throw new Error('no timers expected'); }, clearTimeout: jest.fn(),
    });
    await flush();
    if (!shadow) throw new Error('Generated loader did not mount actual shadow DOM');
    const root = shadow;
    const form = () => root.querySelector<HTMLElement>('.pw-form');
    const start = () => root.querySelector<HTMLButtonElement>('.pw-form-btn');
    const fields = () => Array.from(root.querySelectorAll<HTMLInputElement>('.pw-form input'));
    const sessions = () => requests.filter(request => request.body);
    expect(requests).toHaveLength(1); expect(sessions()).toHaveLength(0);
    expect(form()).not.toBeNull(); expect(start()?.textContent).toBe(START[locale]);
    expect(fields()).toHaveLength(3);
    function fill(values = VALID_IDENTITY) {
        fields().forEach((field, index) => { field.value = values[index]; field.dispatchEvent(new Event('input', { bubbles: true })); });
    }
    function checkNoTransmission() {
        expect(unexpected).toEqual([]); expect(socket.emit).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled();
        expect(document.head.querySelector('script')).toBeNull();
    }
    function dispose() { host.remove(); checkNoTransmission(); }
    return { root, form, start, fields, sessions, io, stored, writes, fill, checkNoTransmission, dispose };
}
const success = () => ({ success: true as const, data: { sessionId: 'local-session', token: 'local-only-synthetic-token' } });

// Observable UI only: retaining a form + values + visible feedback + actionable retry,
// then exactly one chat/session credential. No assertion against pcDone internals.
function recoverable(view: Awaited<ReturnType<typeof mount>>) {
    expect(view.form()).not.toBeNull();
    expect(view.fields().map(field => field.value)).toEqual(VALID_IDENTITY);
    const alert = view.root.querySelector<HTMLElement>('[role="alert"]');
    expect(alert).not.toBeNull(); expect(alert?.textContent?.trim().length).toBeGreaterThan(0);
    expect(alert?.hidden).toBe(false);
    expect(view.start()?.disabled).toBe(false);
    expect(view.root.querySelector('.pw-input')).toBeNull();
    expect(view.stored.has(SESSION_KEY)).toBe(false); expect(view.io).not.toHaveBeenCalled();
}
function successful(view: Awaited<ReturnType<typeof mount>>, count: number) {
    expect(view.form()).toBeNull();
    expect(view.root.querySelectorAll('.pw-input')).toHaveLength(1);
    expect(view.sessions()).toHaveLength(count);
    expect(view.io).toHaveBeenCalledTimes(1);
    expect(view.io.mock.calls[0]).toEqual([API.replace('/api/v1', '') + '/widget', {
        auth: { token: 'local-only-synthetic-token' }, transports: ['websocket', 'polling'],
        reconnection: true, reconnectionDelay: 2000, reconnectionAttempts: 15,
    }]);
    expect(JSON.parse(view.stored.get(SESSION_KEY)!)).toEqual(success().data);
    expect(view.writes.filter(([key]) => key === SESSION_KEY)).toHaveLength(1);
    view.checkNoTransmission();
}

describe.each(LOCALES)('generated public widget pre-chat first-session recovery (%s)', locale => {
    it('product: rejected session envelope retains identity and visible retry, then succeeds once', async () => {
        const first = deferred<Result>(); const retry = deferred<Result>();
        const view = await mount(locale, [first, retry]);
        try {
            view.fill(); view.start()!.click();
            first.resolve({ success: false, error: 'synthetic_session_unavailable' }); await flush();
            expect(view.sessions()).toHaveLength(1); recoverable(view);
            expect(view.root.textContent).not.toContain('synthetic_session_unavailable');
            view.start()!.click(); retry.resolve(success()); await flush();
            expect(view.sessions()[1].body).toEqual(view.sessions()[0].body);
            successful(view, 2);
        } finally { view.dispose(); }
    });
    it('product: transport rejection retains identity and visible retry without messages or a phantom chat', async () => {
        const first = deferred<Result>(); const retry = deferred<Result>();
        const view = await mount(locale, [first, retry]);
        try {
            view.fill(); view.start()!.click();
            first.reject(new Error('synthetic private transport diagnostic')); await flush();
            expect(view.sessions()).toHaveLength(1); recoverable(view);
            expect(view.root.textContent).not.toContain('synthetic private transport diagnostic');
            view.start()!.click(); retry.resolve(success()); await flush();
            expect(view.sessions()[1].body).toEqual(view.sessions()[0].body);
            successful(view, 2);
        } finally { view.dispose(); }
    });
    it('control: a second reachable click while pending cannot create two sessions', async () => {
        const first = deferred<Result>(); const extra = deferred<Result>();
        const view = await mount(locale, [first, extra]);
        try {
            view.fill(); const button = view.start()!;
            button.click();
            // Never act on a captured detached node: the only second user action
            // is a connected, visible and enabled button still in the current form.
            const reachable = view.start();
            if (reachable?.isConnected && !reachable.disabled && !reachable.hidden
                && reachable.closest('.pw-form')?.isConnected) reachable.click();
            const pendingCount = view.sessions().length;
            first.resolve(success()); extra.resolve(success()); await flush();
            expect(pendingCount).toBe(1);
            successful(view, 1);
        } finally { view.dispose(); }
    });
    it('control: optional pre-chat identity can remain empty and a successful session opens one empty composer', async () => {
        const first = deferred<Result>();
        const view = await mount(locale, [first]);
        try {
            view.fill(['', '', '']); view.start()!.click();
            expect(view.sessions()).toHaveLength(1);
            const payload = view.sessions()[0].body;
            expect(payload).not.toHaveProperty('name'); expect(payload).not.toHaveProperty('email'); expect(payload).not.toHaveProperty('phone');
            first.resolve(success()); await flush();
            successful(view, 1);
            expect(view.root.querySelector<HTMLTextAreaElement>('.pw-input')?.value).toBe('');
        } finally { view.dispose(); }
    });
});
