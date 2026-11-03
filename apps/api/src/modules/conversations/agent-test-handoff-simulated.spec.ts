import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';

/**
 * D1k (E2g, 2-nov-2026): production answers a request for a person before the model, with the queue notice. Agent
 * Test skipped that step, so the model improvised «no hay nadie disponible, pero yo le ayudo» and a rehearsal
 * measured something that never ships. The preview now does what production does, without touching the queue.
 */
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function fixture(decision: string | null) {
    const f = agentTurnFixture();
    const config = {
        persona: { name: 'Synthetic agent', role: 'Support' },
        behavior: { rules: [], handoffTriggers: ['Human requested'] },
        language: 'es', industry: 'retail', tools: {}, llm: {},
    };
    f.personaService.getAgent.mockResolvedValue({ version: 1, config_json: config });
    publishTools(f, []);
    (f.handoffService as any).decideHandoff = jest.fn().mockResolvedValue(decision);
    f.llmRouter.execute.mockResolvedValue({ content: 'Por el momento no hay nadie disponible, pero yo puedo ayudarle.',
        model: 'fixed-synthetic-sentinel', usage: { promptTokens: 0, completionTokens: 0 }, cost: 0 });
    return f;
}

describe('Agent Test: a request for a person is answered as production does (D1k)', () => {
    it('answers with the queue notice, without the model and without touching the queue', async () => {
        const f = fixture('customer_requested_human');
        const result = await f.service.test('tenant', AGENT, { message: 'Quiero hablar con una persona', channelType: 'telegram' });
        expect(result.reply).toBe('Entiendo su solicitud. Le estoy transfiriendo con nuestro equipo de atención. Un agente le responderá en breve. 🙋');
        expect(f.llmRouter.execute).not.toHaveBeenCalled();
        expect((f.handoffService as any).decideHandoff).toHaveBeenCalledWith('Quiero hablar con una persona', expect.anything(),
            expect.anything(), undefined, 'tenant', expect.objectContaining({ mode: 'agent_test' }));
    });

    it('leaves every other message to the model', async () => {
        const f = fixture(null);
        const result = await f.service.test('tenant', AGENT, { message: '¿Qué venden?', channelType: 'telegram' });
        expect(f.llmRouter.execute).toHaveBeenCalled();
        expect(result.reply).not.toContain('Le estoy transfiriendo');
    });
});
