/** @jest-environment node */
import { runInNewContext } from 'vm';
import { JSDOM } from 'jsdom';
import { getLoaderScript } from './widget-loader';

// API worker setup imports Node PostgreSQL dependencies before each spec.
// Keep that Node environment and own only the DOM this loader test requires.
const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>');
const { document } = dom.window;
afterAll(() => dom.window.close());

/**
 * PREPARED ONLY: apps/api/src/modules/widget/widget-loader.welcome.spec.ts
 * Eight independent cases: configured greeting visible initially (4 locales)
 * and no synthetic message when welcomeMessage is empty (4 controls).
 * Config public contract maps widget_configs.welcome_message -> welcomeMessage.
 * No claim this is an LLM reply: it is configured local greeting content.
 * Uses unmodified generated JS, actual LOCAL jsdom nodes, literal .test fetch,
 * session pending, no actual transport/LLM/SQL/storage/CDN and no closure injection.
 * Cleanup contains NO assertions; all relevant invariants are in test bodies.
 */
const API = 'https://api.synthetic-widget.test/api/v1';
const WIDGET = 'synthetic-welcome';
const LOCALES = ['es', 'en', 'pt', 'fr'] as const;
const GREETING = {
    es: 'Bienvenida sintética de QA', en: 'Synthetic QA greeting',
    pt: 'Boas-vindas sintéticas de QA', fr: 'Bienvenue synthétique QA',
} as const;
type Locale = typeof LOCALES[number];
async function flush() { for (let turn = 0; turn < 32; turn++) await Promise.resolve(); }
async function mount(locale: Locale, greeting: string) {
    const unexpected: string[] = [];
    const calls: string[] = [];
    const stored = new Map<string, string>();
    const io = jest.fn(() => { unexpected.push('socket before session success'); throw new Error('No socket allowed'); });
    const host = document.createElement('div'); host.id = 'local-welcome-host'; document.body.appendChild(host);
    let shadow: ShadowRoot | undefined;
    const createElement = document.createElement.bind(document);
    const localDocument = {
        readyState: 'complete', body: document.body, head: document.head,
        querySelector: document.querySelector.bind(document),
        createDocumentFragment: document.createDocumentFragment.bind(document),
        createElement: (tag: string) => {
            if (tag.toLowerCase() === 'script') { unexpected.push('CDN'); throw new Error('No scripts'); }
            const node = createElement(tag); const attach = node.attachShadow.bind(node);
            node.attachShadow = ((options: ShadowRootInit) => { shadow = attach(options); return shadow; }) as typeof node.attachShadow;
            return node;
        }, addEventListener: () => { unexpected.push('unexpected readiness listener'); },
    };
    const fetchMock = jest.fn((url: string, options?: any) => {
        calls.push(url);
        if (url === API + '/widget/config/' + WIDGET && options === undefined) {
            return Promise.resolve({ json: () => Promise.resolve({ success: true, data: {
                locale, preChatEnabled: false, agentName: 'Synthetic QA', welcomeMessage: greeting,
            } }) });
        }
        if (url === API + '/widget/sessions' && options?.method === 'POST') {
            const body = JSON.parse(options.body);
            if (body.widgetId !== WIDGET || typeof body.visitorId !== 'string' || !body.visitorId.length
                || body.page !== 'https://host.synthetic-widget.test/welcome') unexpected.push('invalid body');
            // Pending until this test-only VM becomes unreachable; no timer/socket,
            // outbound event or production session is ever created.
            return new Promise<never>(() => {});
        }
        unexpected.push('unexpected fetch ' + url); return Promise.reject(new Error('No network'));
    });
    runInNewContext(getLoaderScript(API), {
        window: { __paralllyWidget: { widgetId: WIDGET, mode: 'page', host: '#local-welcome-host' }, io },
        io, document: localDocument, fetch: fetchMock,
        localStorage: { getItem: (key: string) => stored.get(key) ?? null,
            setItem: (key: string, value: string) => stored.set(key, value) },
        location: { href: 'https://host.synthetic-widget.test/welcome' }, URL,
        console: { warn: jest.fn(), error: jest.fn(), log: jest.fn() },
        setTimeout: () => { unexpected.push('timer'); throw new Error('No timers'); }, clearTimeout: jest.fn(),
    });
    await flush();
    if (!shadow) throw new Error('Actual loader failed to mount local DOM');
    const root = shadow;
    function invariants() {
        expect(unexpected).toEqual([]); expect(io).not.toHaveBeenCalled();
        expect(calls).toEqual([API + '/widget/config/' + WIDGET, API + '/widget/sessions']);
        expect(root.querySelectorAll('.pw-msg')).toHaveLength(0);
        expect(root.querySelectorAll('.pw-input')).toHaveLength(1);
        expect(root.querySelector<HTMLTextAreaElement>('.pw-input')?.value).toBe('');
        expect(root.querySelector('.pw-form')).toBeNull();
        expect(root.querySelector('.pw-hdr-name')?.textContent).toBe('Synthetic QA');
        expect(stored.has('parallly_w_' + WIDGET)).toBe(false);
        expect(document.head.querySelector('script')).toBeNull();
    }
    return { root, invariants, dispose: () => { host.remove(); } };
}

describe.each(LOCALES)('generated public widget initial welcome (%s)', locale => {
    it('product: a configured nonempty welcome is rendered as one visible local greeting before any session reply', async () => {
        const view = await mount(locale, GREETING[locale]);
        try {
            const greetings = view.root.querySelectorAll<HTMLElement>('.pw-welcome');
            expect(greetings).toHaveLength(1);
            expect(greetings[0].textContent).toBe(GREETING[locale]);
            expect(greetings[0].isConnected).toBe(true); expect(greetings[0].hidden).toBe(false);
            expect(greetings[0].closest('.pw-msgs')).not.toBeNull();
            view.invariants();
        } finally { view.dispose(); }
    });
    it('control: an empty configured welcome creates no fake greeting or conversation message', async () => {
        const view = await mount(locale, '');
        try {
            expect(view.root.querySelectorAll('.pw-welcome')).toHaveLength(0);
            view.invariants();
        } finally { view.dispose(); }
    });
});
