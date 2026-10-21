import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
const ID = '57542cc7-de10-4166-b731-704bc7fa403d';
const NAME = 'Spark QA Inmueble 20261018T2220Z';
function fixture(allowed = ['search_listings', 'get_listing_details']) {
    const f = agentTurnFixture();
    f.personaService.getAgent.mockResolvedValue({ version: 1, config_json: {
        language: 'es', industry: 'inmobiliaria', tools: { realEstate: { enabled: true } }, rag: { enabled: false }, llm: {},
    } });
    f.verticalTurnContext.resolve.mockResolvedValue({ industry: 'inmobiliaria', subType: 'inmobiliaria' });
    publishTools(f, allowed);
    f.toolExecutor.execute.mockImplementation(async (_s: string, _t: string, _c: string, name: string) => {
        if (name === 'search_listings') return { listings: [{ id: ID, name: NAME, status: 'available' }] };
        if (name === 'get_listing_details') return { id: ID, name: NAME, areaM2: 80, parkingSpots: 0, externalUrl: null };
        throw new Error(`Unexpected tool ${name}`);
    });
    const turn = () => f.service.test('tenant', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {
        message: `¿Cuántos metros cuadrados tiene el ${NAME}? Solo consulto el área.`, channelType: 'telegram',
    }, { agentSnapshot: undefined });
    return { f, turn };
}
describe('named listing questions use the current property reader', () => {
    it('provides 80m2, zero parking and null URL to the model even without a model tool call', async () => {
        const h = fixture(); const result = await h.turn();
        expect(result.debug.runtimeError).toBeUndefined();
        const calls = h.f.toolExecutor.execute.mock.calls;
        expect(calls.map((c: any[]) => c[3])).toEqual(['search_listings', 'get_listing_details']);
        expect(calls[1][4]).toEqual({ listingId: ID });
        expect(calls[1][6].executionContext.persistence).toBe('disabled');
        expect(calls[1][6].authority.allowedTools).toContain('get_listing_details');
        const messages = h.f.llmRouter.execute.mock.calls[0][0].messages;
        expect(messages.some((m: any) => m.role === 'tool' && m.content.includes('"areaM2":80')
            && m.content.includes('"parkingSpots":0') && m.content.includes('"externalUrl":null'))).toBe(true);
    });
    it('does not grant an unavailable detail reader', async () => {
        const h = fixture(['search_listings']); await h.turn();
        expect(h.f.toolExecutor.execute.mock.calls.map((c: any[]) => c[3])).toEqual(['search_listings']);
    });
    it('does not grant an unavailable family', async () => {
        const h = fixture([]); await h.turn(); expect(h.f.toolExecutor.execute).not.toHaveBeenCalled();
    });
    it('never guesses a detail id after a failed catalogue read', async () => {
        const h = fixture(); h.f.toolExecutor.execute.mockResolvedValue({ error: 'tool_failed' });
        await h.turn(); expect(h.f.toolExecutor.execute.mock.calls.map((c: any[]) => c[3])).toEqual(['search_listings']);
    });
});
