import { runInNewContext } from 'vm';
import { getLoaderScript } from './widget-loader';

function element(tag: string): any {
    return { tag, children: [], style: {}, textContent: '', appendChild(child: any) { this.children.push(child); },
        querySelectorAll: () => [], insertBefore(child: any) { this.children = child.children; } };
}
function loader() {
    const handlers: Record<string, (value: any) => void> = {};
    const socket = { on: (event: string, handler: any) => { handlers[event] = handler; }, emit: jest.fn(), io: { on: jest.fn() } };
    const context: any = { window: { __paralllyWidget: { widgetId: 'synthetic-widget' }, io: () => socket }, io: () => socket,
        URL, console, document: { readyState: 'loading', addEventListener: jest.fn(), createElement: element, createDocumentFragment: () => element('fragment') } };
    // Expose the generated closure only inside the VM test; execute its actual browser handlers and renderer.
    const script = getLoaderScript('https://api.example.test/api/v1').replace('/* ─── INIT ─── */',
        'globalThis.testWidget={st:st,connect:connectWS,render:renderMsgs}; /* ─── INIT ─── */');
    runInNewContext(script, context);
    const { st, connect, render } = context.testWidget;
    st.sess = { token: 'session-credential' }; st.cfg = {};
    st.el.msgs = element('messages'); connect();
    return { st, render, handlers, socket };
}

describe('generated widget persisted-message protocol', () => {
    it('merges replay and live messages by persistent identity while acknowledging each pending replay', () => {
        const { st, handlers, socket } = loader();
        const message = { id: 'message-1', direction: 'outbound', content_text: 'Stored reply', created_at: '2026-09-07T10:00:00Z', receiptRequired: true };
        handlers['widget:history']({ messages: [message] });
        handlers['widget:message']({ ...message, messageId: message.id, content: 'Stored reply' });
        expect(st.msgs).toHaveLength(1); expect(st.unread).toBe(0);
        expect(socket.emit).toHaveBeenCalledTimes(2);
        expect(socket.emit).toHaveBeenLastCalledWith('widget:received', { messageId: message.id });
        handlers['widget:history']({ messages: [{ ...message, receiptRequired: false }] });
        expect(socket.emit).toHaveBeenCalledTimes(2);
    });
    it('preserves ordering and distinct repeated text across reconnections', () => {
        const { st, handlers } = loader();
        handlers['widget:message']({ id: 'later', content: 'Same text', timestamp: '2026-09-07T11:00:00Z' });
        handlers['widget:history']({ messages: [{ id: 'earlier', content_text: 'Same text', created_at: '2026-09-07T10:00:00Z' }] });
        expect(st.msgs.map((message: any) => message.id)).toEqual(['earlier', 'later']);
    });
    it('renders typed media and a canonical payment link safely without interpreting captions as HTML', () => {
        const { st, handlers } = loader();
        handlers['widget:history']({ messages: [
            { id: 'image', type: 'image', mediaUrl: 'https://media.example.test/image.png', caption: '<img onerror=attack()>' },
            { id: 'payment', type: 'text', content: 'https://pay.example.test/canonical' },
            { id: 'unsafe', type: 'image', mediaUrl: 'javascript:attack()', content: 'Unsafe media' },
        ] });
        const [image, payment, unsafe] = st.el.msgs.children;
        expect(image.textContent).toBe('<img onerror=attack()>'); expect(image.innerHTML).toBeUndefined();
        expect(image.children[0]).toMatchObject({ tag: 'img', src: 'https://media.example.test/image.png' });
        expect(payment.children[0]).toMatchObject({ tag: 'a', href: 'https://pay.example.test/canonical', rel: 'noopener noreferrer' });
        expect(unsafe.children.filter((child: any) => child.tag === 'img')).toHaveLength(0);
    });
    it('does not append an interleaved persisted human message to an older stream', () => {
        const { st, handlers } = loader();
        handlers['widget:stream_start']({ messageId: 'stream', timestamp: '2026-09-07T10:00:00Z' });
        handlers['widget:message']({ id: 'human', role: 'agent', content: 'Human reply', timestamp: '2026-09-07T11:00:00Z' });
        handlers['widget:stream_chunk']({ messageId: 'stream', delta: 'AI reply' });
        handlers['widget:stream_end']({ messageId: 'stream', content: 'AI reply' });
        expect(st.msgs.map((message: any) => message.content)).toEqual(['AI reply', 'Human reply']);
    });
});

/* ─── Page mode + server notices: a DOM-ish tree rich enough to run build() and the composer ─── */
function node(tag: string): any {
    const style: any = {}; style.setProperty = (key: string, value: string) => { style[key] = value; };
    const el: any = { tag, id: '', className: '', textContent: '', disabled: false, parentNode: null, children: [] as any[], style, listeners: {} as Record<string, any[]> };
    el.appendChild = (child: any) => el.insertBefore(child, null);
    el.insertBefore = (child: any, ref: any) => {
        const incoming: any[] = child.tag === 'fragment' ? child.children.splice(0) : [child];
        incoming.forEach((n: any) => { n.parentNode = el; });
        const at = ref ? el.children.indexOf(ref) : -1;
        if (at < 0) el.children.push(...incoming); else el.children.splice(at, 0, ...incoming);
        return child;
    };
    el.remove = () => { const parent = el.parentNode; if (!parent) return; const at = parent.children.indexOf(el); if (at >= 0) parent.children.splice(at, 1); el.parentNode = null; };
    el.attachShadow = () => { el.shadowRoot = node('shadow-root'); return el.shadowRoot; };
    el.addEventListener = (event: string, fn: any) => { el.listeners[event] = (el.listeners[event] || []).concat(fn); };
    el.focus = () => { el.focused = true; };
    el.querySelectorAll = (selector: string) => {
        const wanted = selector.split(',').map((s) => s.trim());
        const matches = (n: any) => wanted.some((w) => (w.startsWith('#') ? n.id === w.slice(1) : n.className.split(/\s+/).includes(w.slice(1))));
        const out: any[] = []; const walk = (n: any) => n.children.forEach((c: any) => { if (matches(c)) out.push(c); walk(c); }); walk(el); return out;
    };
    el.querySelector = (selector: string) => el.querySelectorAll(selector)[0] ?? null;
    const has = (c: string) => el.className.split(/\s+/).includes(c);
    el.classList = { contains: has,
        add: (c: string) => { if (!has(c)) el.className = (el.className + ' ' + c).trim(); },
        remove: (c: string) => { el.className = el.className.split(/\s+/).filter((x: string) => x && x !== c).join(' '); },
        toggle: (c: string, force?: boolean) => { const on = force === undefined ? !has(c) : force; if (on) el.classList.add(c); else el.classList.remove(c); return on; } };
    return el;
}
function mount(widget: Record<string, unknown>, options: { hostSelector?: string | null; cfg?: Record<string, unknown> } = {}) {
    const handlers: Record<string, (value?: any) => void> = {};
    const socket = { on: (event: string, handler: any) => { handlers[event] = handler; }, emit: jest.fn(), connect: jest.fn(), io: { on: jest.fn() } };
    const body = node('body'); const host = node('div'); const warn = jest.fn();
    const hostSelector = options.hostSelector === undefined ? '#h' : options.hostSelector; // null = the host is not on the page
    const context: any = { window: { __paralllyWidget: { widgetId: 'synthetic-widget', ...widget }, io: () => socket }, io: () => socket, URL,
        console: { log: console.log, error: jest.fn(), warn },
        // Resolved at call time on purpose: a test that installs fake timers after mounting still owns the retry.
        setTimeout: (fn: any, ms: number) => setTimeout(fn, ms), clearTimeout: (id: any) => clearTimeout(id),
        document: { readyState: 'loading', addEventListener: jest.fn(), createElement: node, createDocumentFragment: () => node('fragment'),
            body, head: node('head'), querySelector: (selector: string) => (hostSelector !== null && selector === hostSelector ? host : null) } };
    // Same INIT hook as loader(), plus the builder and the entry points page mode and the cap lock need.
    const script = getLoaderScript('https://api.example.test/api/v1').replace('/* ─── INIT ─── */',
        'globalThis.testWidget={st:st,connect:connectWS,render:renderMsgs,build:build,toggle:toggle,send:doSend}; /* ─── INIT ─── */');
    runInNewContext(script, context);
    const { st, connect, build, toggle, send } = context.testWidget;
    st.cfg = { locale: 'es', ...options.cfg }; build();
    st.sess = { token: 'session-credential' }; connect();
    return { st, handlers, socket, body, host, warn, toggle, send };
}
const notices = (st: any) => st.el.msgs.children.filter((child: any) => child.className === 'pw-msg sys');
const bubbles = (st: any) => st.el.msgs.children.filter((child: any) => child.className === 'pw-msg out' || child.className === 'pw-msg in');
const stamp = (bubble: any): string => {
    const time = bubble.children.find((child: any) => child.className === 'pw-msg-time');
    return time ? String(time.textContent) : '';
};

describe('generated widget page mode', () => {
    it('mounts inline inside the host, open from the start, with no launcher bubble and an inert toggle', () => {
        const { st, handlers, body, host, toggle } = mount({ mode: 'page', host: '#h' });
        expect(st.page).toBe(true); expect(st.open).toBe(true);
        expect(body.children).toHaveLength(0);
        const [mounted] = host.children; expect(mounted.id).toBe('parallly-widget');
        const wrap = mounted.shadowRoot.querySelector('.pw-wrap');
        expect(wrap.classList.contains('pw-page')).toBe(true);
        expect(wrap.querySelector('.pw-bubble')).toBeNull(); expect(st.el.bubble).toBeNull(); expect(st.el.badge).toBeNull();
        expect(st.el.panel.classList.contains('show')).toBe(true);
        // Same panel DOM as floating mode: header, messages and composer keep the protocol and render hooks unchanged.
        expect(wrap.querySelector('.pw-hdr-name').textContent).toBe('Asistente');
        expect(wrap.querySelector('.pw-close')).not.toBeNull(); expect(st.el.input.tag).toBe('textarea');
        toggle(); expect(st.open).toBe(true); expect(st.el.panel.classList.contains('show')).toBe(true);
        handlers['widget:message']({ id: 'reply', content: 'Hola', timestamp: '2026-09-07T11:00:00Z' });
        expect(st.unread).toBe(0);
    });
    it('honours the default host selector', () => {
        const { st, host } = mount({ mode: 'page' }, { hostSelector: '#parallly-widget-host' });
        expect(st.page).toBe(true); expect(host.children[0].id).toBe('parallly-widget');
    });
    it('falls back to the floating bubble on body when the host is missing', () => {
        const { st, body, host } = mount({ mode: 'page', host: '#h' }, { hostSelector: null });
        expect(st.page).toBe(false); expect(st.open).toBe(false);
        expect(host.children).toHaveLength(0); expect(body.children[0].id).toBe('parallly-widget');
        const wrap = body.children[0].shadowRoot.querySelector('.pw-wrap');
        expect(wrap.classList.contains('pw-page')).toBe(false);
        expect(wrap.querySelector('.pw-bubble')).toBe(st.el.bubble); expect(st.el.bubble.tag).toBe('button');
    });
});

describe('generated widget server notices', () => {
    afterEach(() => { jest.useRealTimers(); });

    it('renders a demo cap as one system bubble with the server text, acks nothing and locks the composer until the next reply', () => {
        const { st, handlers, socket, warn, send } = mount({});
        handlers['widget:error']({ code: 'demo_daily_cap', message: 'Este chat de prueba llegó a su tope de hoy.' });
        expect(notices(st)).toHaveLength(1);
        expect(notices(st)[0].textContent).toBe('Este chat de prueba llegó a su tope de hoy.');
        expect(notices(st)[0].children).toHaveLength(0);
        expect(st.msgs).toEqual([expect.objectContaining({ role: 'system' })]); expect(st.msgs[0].id).toBeUndefined();
        expect(socket.emit).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled();
        expect(st.el.input.disabled).toBe(true); expect(st.el.sendBtn.disabled).toBe(true);
        st.el.input.value = 'otro intento'; send();
        expect(socket.emit).not.toHaveBeenCalled(); expect(st.el.input.value).toBe('otro intento');
        handlers['widget:message']({ id: 'reply', content: 'Sigo aquí', timestamp: '2026-09-07T11:00:00Z' });
        expect(st.el.input.disabled).toBe(false); expect(st.el.sendBtn.disabled).toBe(false);
        expect(notices(st)).toHaveLength(1);
    });
    it.each([
        ['es', 'Este chat alcanzó su límite por hoy. Vuelve mañana.'],
        ['en', 'This chat reached its limit for today. Come back tomorrow.'],
        ['pt', 'Este chat atingiu o limite de hoje. Volte amanhã.'],
        ['fr', "Ce chat a atteint sa limite pour aujourd'hui. Revenez demain."],
    ])('falls back to the %s text without server text and unlocks on reconnect', (locale, text) => {
        const { st, handlers } = mount({}, { cfg: { locale } });
        handlers['widget:error']({ code: 'demo_allowance_exhausted' });
        handlers['widget:error']({ code: 'demo_allowance_exhausted', message: '   ' });
        expect(notices(st)).toHaveLength(1); expect(notices(st)[0].textContent).toBe(text);
        expect(st.el.input.disabled).toBe(true);
        handlers['connect']();
        expect(st.el.input.disabled).toBe(false); expect(st.el.sendBtn.disabled).toBe(false);
    });
    // The cap is decided BEFORE the server persists anything and it does not hang up, so nothing
    // else will ever resolve the bubble the visitor just sent: it must not keep claiming to be in flight.
    it('marks the message the cap refused as not sent instead of leaving it in flight forever', () => {
        const { st, handlers, socket, send } = mount({});
        st.el.input.value = 'quiero una cita'; send();
        expect(socket.emit).toHaveBeenCalledWith('widget:message', { content: 'quiero una cita' });
        expect(st.msgs[0]).toMatchObject({ role: 'user', pending: true });
        expect(stamp(bubbles(st)[0])).toContain('↻');

        handlers['widget:error']({ code: 'demo_daily_cap', message: 'Este chat de prueba llegó a su tope de hoy.', retryAfterSeconds: 86400 });
        expect(st.msgs[0]).toMatchObject({ role: 'user', pending: false, failed: true });
        const [bubble] = bubbles(st);
        expect(bubble.style.opacity).toBe('0.6');
        expect(stamp(bubble)).toContain('⚠ no enviado'); expect(stamp(bubble)).not.toContain('↻');
        // A refused turn was never persisted: there is no server id to acknowledge.
        expect(socket.emit).toHaveBeenCalledTimes(1);
        expect(socket.emit).not.toHaveBeenCalledWith('widget:received', expect.anything());
        expect(notices(st)[0].textContent).toBe('Este chat de prueba llegó a su tope de hoy.');
    });
    // The server's rate-limit text is a hardcoded English developer string, not a localised one.
    it.each([
        ['es', 'Estás enviando mensajes muy rápido. Espera un momento e inténtalo de nuevo.'],
        ['en', 'You are sending messages too quickly. Wait a moment and try again.'],
        ['pt', 'Você está enviando mensagens muito rápido. Aguarde um momento e tente novamente.'],
        ['fr', 'Vous envoyez des messages trop rapidement. Attendez un instant et réessayez.'],
    ])('says the rate limit in %s and never repeats the English server text', (locale, text) => {
        jest.useFakeTimers(); // the payload also arms the retry below: do not leak a real 60s timer
        const { st, handlers } = mount({}, { cfg: { locale } });
        handlers['widget:error']({ code: 'rate_limited', message: 'Rate limit exceeded', retryAfterSeconds: 3600 });
        expect(notices(st)).toHaveLength(1);
        expect(notices(st)[0].textContent).toBe(text);
        expect(notices(st)[0].textContent).not.toContain('Rate limit exceeded');
        expect(st.el.input.disabled).toBe(true);
    });
    it('keeps every other code as a console warning only', () => {
        const { st, handlers, warn } = mount({});
        handlers['widget:error']({ code: 'assistant_turn_failed', message: 'Failed to process message' });
        handlers['widget:error']({ message: 'Origin not allowed' });
        expect(warn).toHaveBeenCalledTimes(2); expect(warn).toHaveBeenCalledWith('Parallly:', 'Failed to process message');
        expect(st.msgs).toHaveLength(0); expect(notices(st)).toHaveLength(0);
        expect(st.el.input.disabled).toBe(false); expect(st.el.sendBtn.disabled).toBe(false);
    });
});

// The server hangs up on a rate limit, and socket.io never reconnects from a server-initiated
// disconnect: without the timer below the composer stays dead until the visitor reloads the page.
describe('generated widget rate-limit recovery', () => {
    afterEach(() => { jest.useRealTimers(); });

    it('re-enables the composer and reconnects once the reported window elapses', () => {
        jest.useFakeTimers();
        const { st, handlers, socket } = mount({});
        handlers['widget:error']({ code: 'rate_limited', message: 'Rate limit exceeded', retryAfterSeconds: 2 });
        expect(st.capped).toBe(true); expect(st.el.input.disabled).toBe(true);

        jest.advanceTimersByTime(1999);
        expect(st.el.input.disabled).toBe(true); expect(socket.connect).not.toHaveBeenCalled();

        jest.advanceTimersByTime(1);
        expect(st.capped).toBe(false); expect(st.el.input.disabled).toBe(false); expect(st.el.sendBtn.disabled).toBe(false);
        expect(socket.connect).toHaveBeenCalledTimes(1);
        expect(st.retryTimer).toBeNull();
        jest.advanceTimersByTime(60000);
        expect(socket.connect).toHaveBeenCalledTimes(1);
    });
    it('clamps an hour-long window to a wait a visitor will actually sit through', () => {
        jest.useFakeTimers();
        const { st, handlers, socket } = mount({});
        handlers['widget:error']({ code: 'rate_limited', retryAfterSeconds: 3600 });
        jest.advanceTimersByTime(59999);
        expect(st.el.input.disabled).toBe(true);
        jest.advanceTimersByTime(1);
        expect(st.el.input.disabled).toBe(false); expect(socket.connect).toHaveBeenCalledTimes(1);
    });
    it('lets a reconnect or a live reply cancel the pending retry', () => {
        jest.useFakeTimers();
        const first = mount({});
        first.handlers['widget:error']({ code: 'rate_limited', retryAfterSeconds: 30 });
        first.handlers['connect']();
        expect(first.st.el.input.disabled).toBe(false); expect(first.st.retryTimer).toBeNull();
        jest.advanceTimersByTime(60000);
        expect(first.socket.connect).not.toHaveBeenCalled();

        const second = mount({});
        second.handlers['widget:error']({ code: 'rate_limited', retryAfterSeconds: 30 });
        second.handlers['widget:message']({ id: 'reply', content: 'Sigo aquí', timestamp: '2026-09-07T11:00:00Z' });
        expect(second.st.el.input.disabled).toBe(false); expect(second.st.retryTimer).toBeNull();
        jest.advanceTimersByTime(60000);
        expect(second.socket.connect).not.toHaveBeenCalled();
    });
    it('schedules nothing without a usable window, and never for a demo cap that carries one', () => {
        jest.useFakeTimers();
        const { st, handlers, socket } = mount({});
        handlers['widget:error']({ code: 'rate_limited' });
        expect(st.retryTimer).toBeNull();
        handlers['widget:error']({ code: 'rate_limited', retryAfterSeconds: null });
        handlers['widget:error']({ code: 'rate_limited', retryAfterSeconds: 'soon' });
        expect(st.retryTimer).toBeNull();

        handlers['widget:error']({ code: 'demo_daily_cap', message: 'Tope de hoy.', retryAfterSeconds: 86400 });
        expect(st.retryTimer).toBeNull();
        jest.advanceTimersByTime(120000);
        expect(st.el.input.disabled).toBe(true); expect(socket.connect).not.toHaveBeenCalled();
    });
});
