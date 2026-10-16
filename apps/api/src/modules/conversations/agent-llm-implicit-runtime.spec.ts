import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import { PersonaService } from '../persona/persona.service';
import { PromptAssemblerService } from './prompt-assembler.service';

/** PREPARED ONLY. Root decides eligibility/preregistration before first Jest.
 * Proposed destination apps/api/src/modules/conversations/agent-llm-implicit-runtime.spec.ts
 * Exactly16: four saved LLM shapes x ES/EN/PT/FR. No tools are published.
 * AgentTestService -> ConversationsService.generateResponse and real prompt
 * classes. LLMRouter.execute is the final public I/O substitute: capture the
 * request and return a fixed sentence, never select/invoke a provider/model.
 * This establishes existing effective options, not reply length, sampling
 * quality, provider defaults, model choice, cost or quota correctness.
 */
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CASES = [
    { name: 'omitted saved LLM settings', llm: undefined, expected: { temperature: 0.8, maxTokens: undefined } },
    { name: 'explicit zero temperature with omitted token cap', llm: { temperature: 0 }, expected: { temperature: 0, maxTokens: undefined } },
    { name: 'explicit token cap with omitted temperature', llm: { maxTokens: 2500 }, expected: { temperature: 0.8, maxTokens: 2500 } },
    { name: 'explicit custom temperature and token cap control', llm: { temperature: 0.25, maxTokens: 600 }, expected: { temperature: 0.25, maxTokens: 600 } },
] as const;
const LANGUAGE = [
    { code: 'es', question: '¿Qué información general está disponible?', reply: 'Puedo ayudar con información general.' },
    { code: 'en', question: 'What general information is available?', reply: 'I can help with general information.' },
    { code: 'pt', question: 'Que informação geral está disponível?', reply: 'Posso ajudar com informações gerais.' },
    { code: 'fr', question: 'Quelles informations générales sont disponibles ?', reply: 'Je peux vous aider avec des informations générales.' },
] as const;

describe.each(LANGUAGE)('existing LLM option consumption outside tool calling (%s)', language => {
    it.each(CASES)('$name reaches the final router request unchanged under its runtime defaults', async testcase => {
        const persona = new PersonaService({} as any, {} as any, {} as any, {} as any, {} as any);
        const personaBoundary = { getAgent: jest.fn(), buildSystemPrompt: jest.fn(
            (...args: any[]) => persona.buildSystemPrompt(args[0], args[1])) };
        // Public constructor dependencies enter through the existing fixture,
        // no private consumer method/property is patched after construction.
        const f = agentTurnFixture({ personaService: personaBoundary,
            promptAssembler: new PromptAssemblerService(personaBoundary as any) });
        const config = {
            persona: { name: 'Synthetic LLM-options agent', role: 'Support', fallbackMessage: 'No confirmed information.' },
            behavior: { rules: ['Use confirmed facts.'], handoffTriggers: ['Human requested'] },
            language: language.code, industry: 'retail', tools: {}, rag: { enabled: false },
            ...(testcase.llm === undefined ? {} : { llm: testcase.llm }),
        };
        expect(() => persona.assertAgentConfigValid(config)).not.toThrow();
        const original = JSON.stringify(config);
        f.personaService.getAgent.mockResolvedValue({ version: 1, config_json: config });
        publishTools(f, []);
        f.llmRouter.execute.mockResolvedValue({ content: language.reply, model: 'fixed-synthetic-sentinel',
            usage: { promptTokens: 0, completionTokens: 0 }, cost: 0 });
        const result = await f.service.test('tenant', AGENT, { message: language.question, channelType: 'telegram' });
        expect(result.debug.runtimeError).toBeUndefined();
        const calls = f.llmRouter.execute.mock.calls.filter((call: any[]) => call[0]?.task === 'conversation');
        expect(calls).toHaveLength(1);
        const request = calls[0][0];
        expect({ temperature: request.temperature, maxTokens: request.maxTokens }).toEqual(testcase.expected);
        expect(request.tools).toBeUndefined();
        expect(result.debug.systemPrompt).toContain('<persona>');
        expect(JSON.stringify(config)).toBe(original);
        expect(f.toolExecutor.execute).not.toHaveBeenCalled();
        expect(f.outboundQueue.enqueue).not.toHaveBeenCalled();
        expect(f.eventEmitter.emit).not.toHaveBeenCalled();
        expect(f.handoffService.executeHandoff).not.toHaveBeenCalled();
        expect(f.knowledgeService.searchRelevant).not.toHaveBeenCalled();
    });
});
