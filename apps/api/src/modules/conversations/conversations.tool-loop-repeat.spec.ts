import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';

/**
 * F4300-19 (production 2026-10-22, real-estate tenant): a stale booking mission owned the turn and the model, asked about
 * the listing for sale, (A) called list_customer_appointments four times with the same empty arguments, or (B) wandered
 * between unrelated reads until the rounds ran out. The customer got «no pude responderle bien… escríbame su pregunta
 * otra vez» (or «No he podido completar esa acción…» when the question said «apartamento»).
 */
const TOOLS = ['list_customer_appointments', 'list_services', 'get_customer_context', 'search_listings', 'search_faqs'];
const ANSWER = 'El apartamento en venta de la zona norte tiene 2 habitaciones y 80 m2.';
const ANSWER_LOST = 'Disculpe, no pude responderle bien en este mensaje. ¿Puede escribirme su pregunta otra vez?';
const ACTION_NOT_DONE = 'No he podido completar esa acción en este mensaje.';
const call = (id: string, name: string, args: any = {}) => ({ id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } });
const usage = { model: 'test', usage: { promptTokens: 20, completionTokens: 5 }, cost: 0.001 };

function fixture() {
    const f = agentTurnFixture();
    publishTools(f, TOOLS);
    f.toolExecutor.execute.mockImplementation(async (_s: any, _t: any, _c: any, name: string) =>
        name === 'search_listings' ? { listings: [{ id: 'listing-1', operation: 'venta', bedrooms: 2, areaM2: 80, price: 250000, currency: 'EUR' }] }
            : { items: [] });
    const turn = (message: string) => f.service.test('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { message, channelType: 'telegram' }, { agentSnapshot: undefined });
    const executed = (): string[] => f.toolExecutor.execute.mock.calls.map((c: any[]) => c[3]);
    const llmCalls = (): any[] => f.llmRouter.execute.mock.calls.map((c: any[]) => c[0]);
    return { f, turn, executed, llmCalls };
}

afterEach(() => jest.restoreAllMocks());

describe('F4300-19 case A: the same read asked for again is not run again', () => {
    it('runs the read once, returns the earlier result marked as repeated, and makes the model answer', async () => {
        const h = fixture();
        let n = 0;
        // Offered tools, the model keeps asking for the same read (with the arguments written three different ways). The
        // agent-test harness has no customer identity, so list_customer_appointments is not offered there; get_customer_context is the
        // same kind of argument-less customer read.
        h.f.llmRouter.execute.mockImplementation(async (req: any) => req.tools
            ? { ...usage, content: '', toolCalls: [call(`c${++n}`, 'get_customer_context', ['{}', '', '{ }', {}][Math.min(n - 1, 3)])] }
            : { ...usage, content: ANSWER });
        const r = await h.turn('¿Cuánto cuesta el apartamento en venta?');
        expect(r.debug.runtimeError).toBeUndefined();
        expect(h.executed().filter(name => name === 'get_customer_context')).toHaveLength(1);
        expect(r.reply).toBe(ANSWER);
        const calls = h.llmCalls();
        // 1 execution + 2 repeats, then the next call is offered no tools and told to answer.
        expect(calls.filter(c => c.tools)).toHaveLength(3);
        const last = calls[calls.length - 1];
        expect(last.tools).toBeUndefined();
        const toolMessages = last.messages.filter((m: any) => m.role === 'tool' && /^c\d$/.test(m.toolCallId));
        expect(toolMessages).toHaveLength(3);
        expect(toolMessages[0].content).not.toContain('repeatedCall');
        expect(toolMessages[1].content).toContain('repeatedCall');
        expect(toolMessages[2].content).toContain('repeatedCall');
        expect(last.messages[last.messages.length - 1]).toEqual(expect.objectContaining({ role: 'user', content: expect.stringContaining('Responde ahora') }));
    });

    it('runs a read again when its arguments differ', async () => {
        const h = fixture();
        const script = [
            [call('a1', 'list_services', { category: 'venta' })],
            [call('a2', 'list_services', { category: 'arriendo' })],
        ];
        let n = 0;
        h.f.llmRouter.execute.mockImplementation(async (req: any) => req.tools && n < script.length
            ? { ...usage, content: '', toolCalls: script[n++] } : { ...usage, content: ANSWER });
        const r = await h.turn('¿Qué servicios tienen?');
        expect(r.reply).toBe(ANSWER);
        expect(h.executed().filter(name => name === 'list_services')).toHaveLength(2);
    });
});

describe('F4300-19 case B: rounds used up end in an answer from what was read, not «repeat your question»', () => {
    const wander = [
        [call('b1', 'list_services')],
        [call('b2', 'search_listings', { operation: 'venta' })],
        [call('b3', 'list_customer_appointments')],
        [call('b4', 'get_customer_context')],
        [call('b5', 'search_faqs', { query: 'apartamento zona norte' })],
    ];

    it('makes one closing call without tools, told to answer from the tool results, and sends that answer', async () => {
        const h = fixture();
        let n = 0;
        h.f.llmRouter.execute.mockImplementation(async (req: any) => req.tools
            ? { ...usage, content: '', toolCalls: wander[Math.min(n++, wander.length - 1)] }
            : { ...usage, content: ANSWER });
        const r = await h.turn('cuántas habitaciones y metros tiene el apartamento?');
        expect(r.debug.runtimeError).toBeUndefined();
        expect(r.reply).toBe(ANSWER);
        expect(r.reply).not.toBe(ANSWER_LOST);
        const calls = h.llmCalls();
        const last = calls[calls.length - 1];
        expect(last.tools).toBeUndefined();
        expect(last.messages.some((m: any) => m.role === 'tool' && m.content.includes('"bedrooms":2'))).toBe(true);
        expect(last.messages[last.messages.length - 1]).toEqual(expect.objectContaining({ role: 'user', content: expect.stringContaining('Responde ahora') }));
    });

    it('a tool call written as text on the last round also goes to the closing answer', async () => {
        const h = fixture();
        let n = 0;
        h.f.llmRouter.execute.mockImplementation(async (req: any) => {
            if (!req.tools) return { ...usage, content: ANSWER };
            n++;
            return n < 5 ? { ...usage, content: '', toolCalls: wander[n - 1] }
                : { ...usage, content: '<search_listings><operation>venta</operation></search_listings>' };
        });
        const r = await h.turn('cuántas habitaciones y metros tiene el apartamento?');
        expect(r.reply).toBe(ANSWER);
    });

    it('keeps the fixed text only as the last resort, and a question about an «apartamento» is not an action left undone', async () => {
        const h = fixture();
        h.f.llmRouter.execute.mockImplementation(async (req: any) => {
            if (!req.tools) return { ...usage, content: '<search_listings><operation>venta</operation></search_listings>' };
            return { ...usage, content: '', toolCalls: [call(`x${Math.random()}`, 'search_faqs', { query: String(Math.random()) })] };
        });
        const r = await h.turn('cuántas habitaciones y metros tiene el apartamento?');
        expect(r.reply).toBe(ANSWER_LOST);
        expect(r.reply).not.toContain(ACTION_NOT_DONE);
    });
});
