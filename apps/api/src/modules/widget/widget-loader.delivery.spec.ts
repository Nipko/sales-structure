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
