import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';

const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ID = '76775f40-2fdd-48e2-9db5-c6afa93573dc';
const NAME = 'Spark QA Tour 20261018T2140Z';
function fixture(allowed = ['search_packages', 'get_package_details']) {
    const f = agentTurnFixture();
    f.personaService.getAgent.mockResolvedValue({ version: 1, config_json: {
        language: 'es', industry: 'turismo', tools: { tours: { enabled: true } }, rag: { enabled: false }, llm: {},
    } });
    f.verticalTurnContext.resolve.mockResolvedValue({ industry: 'turismo', subType: 'agencia_viajes' });
    publishTools(f, allowed);
    f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string) => {
        if (name === 'search_packages') return { packages: [{ id: ID, name: NAME, price: 125, currency: 'EUR' }] };
        if (name === 'get_package_details') return { id: ID, name: NAME, languages: ['es'], includes: [], whatToBring: null, cancellationPolicy: null };
        throw new Error(`Unexpected tool ${name}`);
    });
    const turn = () => f.service.test('tenant', AGENT, {
        message: `Del ${NAME}, ¿qué equipaje debo llevar y qué incluye? Solo consulto esos datos.`, channelType: 'telegram',
    }, { agentSnapshot: undefined });
    return { f, turn };
}

describe('named tour details use current authorized catalogue before model reply', () => {
    it('reads the exact current package even if the model never calls a tool', async () => {
        const h = fixture();
        const result = await h.turn();
        expect(result.debug.runtimeError).toBeUndefined();
        const calls = h.f.toolExecutor.execute.mock.calls;
        expect(calls.map((call: any[]) => call[3])).toEqual(['search_packages', 'get_package_details']);
        expect(calls[1][4]).toEqual({ packageId: ID });
        expect(calls[1][6].executionContext.persistence).toBe('disabled');
        expect(calls[1][6].authority.allowedTools).toContain('get_package_details');
        expect(h.f.llmRouter.execute).toHaveBeenCalled();
        const messages = h.f.llmRouter.execute.mock.calls[0][0].messages;
        expect(messages.some((message: any) => message.role === 'tool'
            && message.content.includes('"languages":["es"]')
            && message.content.includes('"whatToBring":null'))).toBe(true);
    });
    it('does not manufacture permission when the details reader is unavailable', async () => {
        const h = fixture(['search_packages']);
        await h.turn();
        expect(h.f.toolExecutor.execute.mock.calls.some((call: any[]) => call[3] === 'get_package_details')).toBe(false);
    });
    it('does not read the catalogue when the family is unavailable', async () => {
        const h = fixture([]);
        await h.turn();
        expect(h.f.toolExecutor.execute).not.toHaveBeenCalled();
    });
});
