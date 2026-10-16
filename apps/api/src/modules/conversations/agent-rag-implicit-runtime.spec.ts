import { agentTurnFixture, publishTools } from './__fixtures__/agent-turn.fixture';
import { PersonaService } from '../persona/persona.service';
import { PromptAssemblerService } from './prompt-assembler.service';

/**
 * PREPARED ONLY. Proposed destination:
 * apps/api/src/modules/conversations/agent-rag-implicit-runtime-v2.spec.ts
 * Root preregisters and executes. Sixteen paired consumer controls establish
 * what the existing runtime does with omitted/partially enabled/false/true saved RAG settings.
 * AgentTestService -> ConversationsService.executeAgentTurn/generateResponse,
 * real PersonaService.buildSystemPrompt and real PromptAssemblerService.
 * Existing fixture substitutes infrastructure, source reader and LLM boundary.
 * No model, database, embedding search, source-lease ownership or transport is
 * executed or certified. The synthetic source canary proves prompt inclusion,
 * not that an LLM would use it or answer effectively. No tools are published.
 * This never replays the protected real AgentTest catalogue/document cases.
 */
const AGENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CANARY = 'QA_KB_IMPLICIT_RAG_CANARY_20261016';
const CASES = [
    { name: 'omitted saved RAG configuration', rag: undefined, expectedRetrieval: true, expectedTopK: 5, expectedBucket: 'retrieved' },
    { name: 'enabled RAG with omitted tuning', rag: { enabled: true }, expectedRetrieval: true, expectedTopK: 5, expectedBucket: 'retrieved' },
    { name: 'explicitly disabled RAG', rag: { enabled: false, topK: 3, similarityThreshold: 0.6 }, expectedRetrieval: false, expectedTopK: 3, expectedBucket: 'none' },
    { name: 'explicitly enabled RAG', rag: { enabled: true, topK: 3, similarityThreshold: 0.6 }, expectedRetrieval: true, expectedTopK: 3, expectedBucket: 'possible' },
] as const;
const LANGUAGE = [
    { code: 'es', question: '¿Qué información general está disponible?', reply: 'Puedo ayudar con información general.' },
    { code: 'en', question: 'What general information is available?', reply: 'I can help with general information.' },
    { code: 'pt', question: 'Que informação geral está disponível?', reply: 'Posso ajudar com informações gerais.' },
    { code: 'fr', question: 'Quelles informations générales sont disponibles ?', reply: 'Je peux vous aider avec des informations générales.' },
] as const;

describe.each(LANGUAGE)('existing RAG consumption contract (%s)', language => {
    it.each(CASES)('$name decides the real retrieval boundary and source inclusion in the assembled prompt', async testcase => {
        const f = agentTurnFixture();
        const persona = new PersonaService({} as any, {} as any, {} as any, {} as any, {} as any);
        f.personaService.buildSystemPrompt.mockImplementation((...args: any[]) => persona.buildSystemPrompt(args[0], args[1]));
        (f.runtime as any).promptAssembler = new PromptAssemblerService(f.personaService as any);
        const config = {
            persona: { name: 'Synthetic RAG agent', role: 'Support', fallbackMessage: 'No confirmed information.' },
            behavior: { rules: ['Use confirmed facts.'], handoffTriggers: ['Human requested'] },
            language: language.code, industry: 'retail', tools: {}, llm: {},
            ...(testcase.rag === undefined ? {} : { rag: testcase.rag }),
        };
        // This is a real canonical validator call. Omitted rag is not an
        // invented malformed payload: current agent validation accepts it.
        expect(() => persona.assertAgentConfigValid(config)).not.toThrow();
        f.personaService.getAgent.mockResolvedValue({ version: 1, config_json: config });
        publishTools(f, []);
        f.knowledgeService.tenantHasKnowledge.mockResolvedValue(true);
        f.knowledgeService.searchRelevant.mockResolvedValue([{
            id: 'synthetic-chunk', document_id: 'synthetic-document', title: 'Synthetic RAG contract',
            // 0.50 is between the runtime fallback threshold 0.35 and the
            // editor fallback 0.75; explicit custom 0.60 keeps it possible.
            chunk_text: CANARY, score: 0.5, doc_version: 1,
        }]);
        f.llmRouter.execute.mockResolvedValue({ content: language.reply, model: 'fixed-synthetic-sentinel',
            usage: { promptTokens: 0, completionTokens: 0 }, cost: 0 });

        const result = await f.service.test('tenant', AGENT, { message: language.question, channelType: 'telegram' });
        expect(result.debug.runtimeError).toBeUndefined();
        expect(f.knowledgeService.tenantHasKnowledge).toHaveBeenCalledTimes(1);
        expect(f.knowledgeService.searchRelevant).toHaveBeenCalledTimes(testcase.expectedRetrieval ? 1 : 0);
        const containsCanary = f.llmRouter.execute.mock.calls.some((call: any[]) => String(call[0]?.systemPrompt).includes(CANARY));
        expect(containsCanary).toBe(testcase.expectedRetrieval);
        const retrieved = testcase.expectedBucket === 'retrieved';
        const possible = testcase.expectedBucket === 'possible';
        expect(result.debug.ragHits.some((hit: any) => JSON.stringify(hit).includes(CANARY))).toBe(retrieved);
        expect((result.debug.turnContext.possibleKnowledge || []).some((hit: any) => JSON.stringify(hit).includes(CANARY))).toBe(possible);
        const systemPrompt = String(result.debug.systemPrompt || '');
        expect(systemPrompt).toContain('<turn>');
        const turnXml = systemPrompt.slice(systemPrompt.lastIndexOf('<turn>'));
        const retrievedBlock = /<retrieved_knowledge>([\s\S]*?)<\/retrieved_knowledge>/.exec(turnXml)?.[1] || '';
        const possibleBlock = /<possible_knowledge>([\s\S]*?)<\/possible_knowledge>/.exec(turnXml)?.[1] || '';
        expect(retrievedBlock.includes(CANARY)).toBe(retrieved);
        expect(possibleBlock.includes(CANARY)).toBe(possible);
        if (testcase.expectedRetrieval) {
            expect(f.knowledgeService.searchRelevant.mock.calls[0].slice(0, 3)).toEqual([
                'tenant', expect.any(String), testcase.expectedTopK,
            ]);
            expect(f.knowledgeService.searchRelevant.mock.calls[0][3]).toMatchObject({
                similarityThreshold: 0.25, audience: 'customer',
            });
        }
        expect(f.toolExecutor.execute).not.toHaveBeenCalled();
        expect(f.outboundQueue.enqueue).not.toHaveBeenCalled();
        expect(f.eventEmitter.emit).not.toHaveBeenCalled();
        expect(f.handoffService.executeHandoff).not.toHaveBeenCalled();
    });
});
