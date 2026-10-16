/** @jest-environment jsdom */
import { runInNewContext } from 'vm';
import { getLoaderScript } from './widget-loader';

/**
 * PREPARED ONLY: apps/api/src/modules/widget/widget-loader.connection-status.spec.ts
 * 12 cases: ES/EN/PT/FR x pre-handshake status, acknowledged lifecycle status,
 * and a positive control preserving composer identity/content across callbacks.
 * V2: greeting invariant compares initially observed DOM only; cleanup has no assertions.
 * Public widget preChatEnabled=false; independent of DEF128 prechat recovery.
 * Runs UNMODIFIED generated JavaScript with LOCAL real jsdom nodes in a VM.
 * Only the socket boundary's registered .on callbacks are invoked. No state or
 * source injection, actual websocket, CDN, HTTP, LLM, credentials or persistence.
 * Explicit BEFORE-JEST acceptance lexicon below is a proposed UI contract, NOT
 * existing translation keys. Connected means accepted widget session only.
 * Gateway widget:connected/sessionId proves admission of THIS session at that
 * moment; it does not prove AI availability, human availability or future replies.
 */
const API = 'https://api.synthetic-widget.test/api/v1';
const WIDGET = 'synthetic-status';
const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'local-only-synthetic-token';
const DRAFT = 'Synthetic unsent draft';
const COPY = {
    es: { connecting: 'Conectando el chat…', connected: 'Chat conectado', disconnected: 'Chat desconectado' },
    en: { connecting: 'Connecting chat…', connected: 'Chat connected', disconnected: 'Chat disconnected' },
    pt: { connecting: 'Conectando o chat…', connected: 'Chat conectado', disconnected: 'Chat desconectado' },
    fr: { connecting: 'Connexion du chat…', connected: 'Chat connecté', disconnected: 'Chat déconnecté' },
} as const;
const LOCALES = ['es', 'en', 'pt', 'fr'] as const;
type Locale = typeof LOCALES[number];
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(yes => { resolve = yes; });
    return { promise, resolve };
}
async function flush() { for (let turn = 0; turn < 32; turn++) await Promise.resolve(); }
async function mount(locale: Locale) {
    const session = deferred<{ success: true; data: { sessionId: string; token: string } }>();
    const requests: Array<{ url: string; body?: any }> = [];
    const unexpected: string[] = [];
    const stored = new Map<string, string>();
    const handlers: Record<string, (value?: any) => void> = {};
    const managerHandlers: Record<string, (value?: any) => void> = {};
    const socket = {
        on: jest.fn((event: string, callback: (value?: any) => void) => { handlers[event] = callback; }),
        io: { on: jest.fn((event: string, callback: (value?: any) => void) => { managerHandlers[event] = callback; }) },
        emit: jest.fn(() => { unexpected.push('socket emit'); throw new Error('No messages allowed'); }),
        connect: jest.fn(),
    };
    const io = jest.fn(() => socket);
    const host = document.createElement('div'); host.id = 'local-status-host'; document.body.appendChild(host);
    let shadow: ShadowRoot | undefined;
    const createElement = document.createElement.bind(document);
    const localDocument = {
        readyState: 'complete', body: document.body, head: document.head,
        querySelector: document.querySelector.bind(document),
        createDocumentFragment: document.createDocumentFragment.bind(document),
        createElement: (tag: string) => {
            if (tag.toLowerCase() === 'script') { unexpected.push('CDN script'); throw new Error('No scripts allowed'); }
            const node = createElement(tag); const attach = node.attachShadow.bind(node);
            node.attachShadow = ((options: ShadowRootInit) => { shadow = attach(options); return shadow; }) as typeof node.attachShadow;
            return node;
        },
        addEventListener: () => { unexpected.push('unexpected readiness listener'); },
    };
    const fetchMock = jest.fn((url: string, options?: any) => {
        if (url === API + '/widget/config/' + WIDGET && options === undefined) {
            requests.push({ url });
            return Promise.resolve({ json: () => Promise.resolve({ success: true, data: {
                locale, preChatEnabled: false, agentName: 'Synthetic QA', welcomeMessage: 'Synthetic greeting',
            } }) });
        }
        if (url === API + '/widget/sessions' && options?.method === 'POST') {
            const body = JSON.parse(options.body); requests.push({ url, body });
            if (body.widgetId !== WIDGET || body.page !== 'https://host.synthetic-widget.test/status'
                || typeof body.visitorId !== 'string' || !body.visitorId.length) unexpected.push('invalid request body');
            return session.promise.then(body => ({ json: () => Promise.resolve(body) }));
        }
        unexpected.push('unexpected fetch ' + url); return Promise.reject(new Error('No network available'));
    });
    runInNewContext(getLoaderScript(API), {
        window: { __paralllyWidget: { widgetId: WIDGET, mode: 'page', host: '#local-status-host' }, io },
        io, document: localDocument, fetch: fetchMock,
        localStorage: { getItem: (key: string) => stored.get(key) ?? null,
            setItem: (key: string, value: string) => stored.set(key, value) },
        location: { href: 'https://host.synthetic-widget.test/status' }, URL,
        console: { warn: jest.fn(), error: jest.fn(), log: jest.fn() },
        setTimeout: () => { unexpected.push('timer'); throw new Error('No timers expected'); }, clearTimeout: jest.fn(),
    });
    await flush();
    if (!shadow) throw new Error('Actual loader did not mount local DOM');
    const root = shadow;
    const status = () => root.querySelector<HTMLElement>('.pw-hdr-status')?.textContent?.trim();
    const input = root.querySelector<HTMLTextAreaElement>('.pw-input');
    if (!input) throw new Error('Actual loader did not mount composer');
    // Snapshot observed initial greeting DOM; this status suite does not certify welcome visibility.
    const initialGreeting = root.querySelector('.pw-welcome')?.textContent ?? null;
    function invariants() {
        expect(unexpected).toEqual([]); expect(socket.emit).not.toHaveBeenCalled();
        expect(requests.map(request => request.url)).toEqual([API + '/widget/config/' + WIDGET, API + '/widget/sessions']);
        expect(root.querySelectorAll('.pw-input')).toHaveLength(1);
        expect(root.querySelector('.pw-input')).toBe(input);
        expect(root.querySelectorAll('.pw-msg')).toHaveLength(0);
        expect(root.querySelector('.pw-hdr-name')?.textContent).toBe('Synthetic QA');
        expect(root.querySelector('.pw-welcome')?.textContent ?? null).toBe(initialGreeting);
        expect(root.querySelector('.pw-form')).toBeNull();
        expect(document.head.querySelector('script')).toBeNull();
    }
    async function acceptSession() {
        session.resolve({ success: true, data: { sessionId: SESSION_ID, token: TOKEN } }); await flush();
        expect(io).toHaveBeenCalledTimes(1);
        expect(io.mock.calls[0]).toEqual([API.replace('/api/v1', '') + '/widget', {
            auth: { token: TOKEN }, transports: ['websocket', 'polling'], reconnection: true,
            reconnectionDelay: 2000, reconnectionAttempts: 15,
        }]);
    }
    // Missing handlers deliberately act as no-ops: lack of an event listener is
    // diagnosed by the visible status oracle rather than a harness TypeError.
    const event = (name: string, value?: any) => { handlers[name]?.(value); };
    const managerEvent = (name: string, value?: any) => { managerHandlers[name]?.(value); };
    return { root, input, status, event, managerEvent, acceptSession, io, invariants,
        // Cleanup must never assert and mask the primary product oracle.
        dispose: () => { host.remove(); } };
}

describe.each(LOCALES)('public widget connection status (%s)', locale => {
    it('product: before session and matching application ack, never claims an accepted chat connection', async () => {
        const view = await mount(locale);
        try {
            const observed = [view.status()]; expect(view.io).not.toHaveBeenCalled();
            await view.acceptSession(); observed.push(view.status());
            view.event('connect'); observed.push(view.status());
            view.event('widget:connected', {}); observed.push(view.status());
            view.event('widget:connected', { sessionId: 'different-session' }); observed.push(view.status());
            expect(observed).toEqual(Array(5).fill(COPY[locale].connecting));
            view.invariants();
        } finally { view.dispose(); }
    });
    it('product: matching ack and connection-loss/recovery events produce truthful translated chat status', async () => {
        const view = await mount(locale);
        try {
            await view.acceptSession(); const observed: Array<string | undefined> = [];
            const snapshot = () => observed.push(view.status());
            view.event('widget:connected', { sessionId: SESSION_ID }); snapshot();
            view.event('disconnect', 'transport close'); snapshot();
            view.event('connect'); snapshot();
            view.event('widget:connected', { sessionId: SESSION_ID }); snapshot();
            view.event('connect_error', new Error('synthetic transport failure')); snapshot();
            view.event('widget:connected', { sessionId: SESSION_ID }); snapshot();
            view.managerEvent('reconnect_failed'); snapshot();
            view.event('connect'); snapshot();
            view.event('widget:connected', { sessionId: SESSION_ID }); snapshot();
            const t = COPY[locale];
            expect(observed).toEqual([t.connected, t.disconnected, t.connecting, t.connected,
                t.disconnected, t.connected, t.disconnected, t.connecting, t.connected]);
            expect(view.root.textContent).not.toContain('synthetic transport failure');
            view.invariants();
        } finally { view.dispose(); }
    });
    it('control: accepted-session recovery preserves the unsent composer, greeting and identity without new messages', async () => {
        const view = await mount(locale);
        try {
            await view.acceptSession();
            view.input.value = DRAFT; view.input.dispatchEvent(new Event('input', { bubbles: true }));
            view.event('connect'); view.event('widget:connected', { sessionId: SESSION_ID });
            view.event('disconnect', 'transport close'); view.event('connect_error', new Error('synthetic failure'));
            view.managerEvent('reconnect_failed'); view.event('connect');
            view.event('widget:connected', { sessionId: SESSION_ID });
            expect(view.input.value).toBe(DRAFT);
            expect(view.input.disabled).toBe(false);
            expect(view.io).toHaveBeenCalledTimes(1);
            view.invariants();
        } finally { view.dispose(); }
    });
});