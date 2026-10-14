import { AgentTurnTrace } from './agent-turn-session';

describe('AgentTurnTrace provider model evidence', () => {
    it('reads the actual model from the raw OpenAI-compatible provider response', () => {
        const trace = new AgentTurnTrace();
        trace.provider({ raw: { model: 'provider-actual-model' }, usage: { promptTokens: 20, completionTokens: 4 } });
        expect(trace.model).toBe('provider-actual-model');
        expect(trace.inputTokens).toBe(20);
        expect(trace.outputTokens).toBe(4);
    });
    it('uses the router-selected model when the provider does not report an identifier', () => {
        const trace = new AgentTurnTrace();
        trace.provider({ routingDecision: { selectedModel: { id: 'fallback-model-selected-by-router' } } });
        expect(trace.model).toBe('fallback-model-selected-by-router');
    });
    it('prefers the provider-reported model over the router identifier', () => {
        const trace = new AgentTurnTrace();
        trace.provider({ raw: { model: 'provider-resolved-version' }, routingDecision: { selectedModel: { id: 'router-alias' } } });
        expect(trace.model).toBe('provider-resolved-version');
    });
    it('retains existing modelUsed precedence', () => {
        const trace = new AgentTurnTrace();
        trace.provider({ modelUsed: 'already-reported', model: 'legacy', raw: { model: 'raw' } });
        expect(trace.model).toBe('already-reported');
    });
    it('does not invent a model from a requested model or from missing evidence', () => {
        const trace = new AgentTurnTrace();
        trace.provider({ requestedModel: 'requested-only', usage: { inputTokens: 2 } });
        expect(trace.model).toBe('');
        trace.provider({ raw: { model: 'known-provider' } });
        trace.provider({ raw: {} });
        expect(trace.model).toBe('known-provider');
    });
    it('ignores malformed identifiers and falls through to valid model evidence', () => {
        const trace = new AgentTurnTrace();
        trace.provider({ modelUsed: { id: 'invalid-shape' }, model: ' ', raw: { model: 'valid-provider' } });
        expect(trace.model).toBe('valid-provider');
    });
});
