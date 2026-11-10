import { OpenAIProvider, isCacheBreakpointRejection } from './openai.provider';

// ADR-0032: el prefijo estable del system lleva prompt_cache_breakpoint en GPT-5.6+/GPT-6.
function provider(create: jest.Mock) {
    const p = new OpenAIProvider({ getKey: async () => 'sk-test' } as any);
    (p as any).ensureClient = async () => ({ chat: { completions: { create } } });
    (p as any).logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn() };
    return p;
}
const ok = { choices: [{ message: { content: 'hola' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 } };
const stable = '<contract>reglas</contract>\n\n<persona>Valeria</persona>';
const systemPrompt = `${stable}\n\n<turn><now>2026-11-10T10:00</now></turn>`;
const options = (model: string) => ({
    model, systemPrompt, cacheableSystemPromptChars: stable.length,
    messages: [{ role: 'user', content: 'hola' }] as any,
    tools: [{ name: 'search_services', description: 'Busca servicios', parameters: { type: 'object', properties: {} } }] as any,
});
const rejection = Object.assign(new Error('400 Unrecognized request argument supplied: messages[0].content[0].prompt_cache_breakpoint'), { status: 400 });

describe('OpenAIProvider: breakpoint de caché (ADR-0032)', () => {
    it('gpt-6-luna recibe el prefijo estable con breakpoint y el <turn> aparte; las herramientas no cambian', async () => {
        const create = jest.fn().mockResolvedValue(ok);
        await provider(create).generate(options('gpt-6-luna'));
        const req = create.mock.calls[0][0];
        expect(req.messages[0]).toEqual({ role: 'system', content: [
            { type: 'text', text: stable, prompt_cache_breakpoint: { mode: 'explicit' } },
            { type: 'text', text: '\n\n<turn><now>2026-11-10T10:00</now></turn>' },
        ] });
        expect(req.messages[0].content.map((part: any) => part.text).join('')).toBe(systemPrompt);
        expect(req.tools.map((t: any) => t.function.name)).toEqual(['search_services']);
        expect(req.reasoning_effort).toBe('none');
    });

    it('un modelo anterior recibe el system como texto', async () => {
        const create = jest.fn().mockResolvedValue(ok);
        await provider(create).generate(options('gpt-4.1-mini'));
        expect(create.mock.calls[0][0].messages[0]).toEqual({ role: 'system', content: systemPrompt });
    });

    it('si el modelo rechaza el campo, repite sin él una vez y deja de mandarlo', async () => {
        const create = jest.fn().mockRejectedValueOnce(rejection).mockResolvedValue(ok);
        const p = provider(create);
        await expect(p.generate(options('gpt-6-luna'))).resolves.toMatchObject({ content: 'hola' });
        expect(create).toHaveBeenCalledTimes(2);
        expect(create.mock.calls[1][0].messages[0].content).toBe(systemPrompt);
        await p.generate(options('gpt-6-luna'));
        expect(create).toHaveBeenCalledTimes(3);
        expect(create.mock.calls[2][0].messages[0].content).toBe(systemPrompt);
    });

    it('cualquier otro error sale tal cual, sin segundo intento', async () => {
        const quota = Object.assign(new Error('429 You have no credits remaining.'), { status: 429 });
        const create = jest.fn().mockRejectedValue(quota);
        await expect(provider(create).generate(options('gpt-6-luna'))).rejects.toBe(quota);
        expect(create).toHaveBeenCalledTimes(1);
        expect(isCacheBreakpointRejection(quota)).toBe(false);
        expect(isCacheBreakpointRejection(Object.assign(new Error('400 Invalid tools'), { status: 400 }))).toBe(false);
        expect(isCacheBreakpointRejection(rejection)).toBe(true);
    });

    it('el streaming usa el mismo contenido del system', async () => {
        async function* chunks() { yield { choices: [{ delta: { content: 'ho' } }] }; yield { choices: [{ delta: { content: 'la' } }] }; }
        const create = jest.fn().mockResolvedValue(chunks());
        let text = '';
        for await (const chunk of provider(create).generateStream(options('gpt-6-luna'))) text += chunk;
        expect(text).toBe('hola');
        expect(create.mock.calls[0][0].stream).toBe(true);
        expect(create.mock.calls[0][0].messages[0].content[0].prompt_cache_breakpoint).toEqual({ mode: 'explicit' });
    });
});
