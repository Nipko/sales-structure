import { AgentTurnTrace, callCostUsd } from './agent-turn-session';

/** Los ensayos guardaban cost_usd = 0: el router no devuelve el costo de la llamada y la traza sumaba `response.cost`. */
describe('agent turn trace: each provider call is priced', () => {
    it('prices a dated snapshot as its base model, and an unknown model as 0', () => {
        expect(callCostUsd('gpt-4o-mini-2024-07-18', 1000, 1000)).toBeCloseTo(0.00015 + 0.0006, 10);
        expect(callCostUsd('gpt-4o', 1000, 0)).toBeCloseTo(0.0025, 10);
        expect(callCostUsd('some-local-model', 1000, 1000)).toBe(0);
    });

    it('adds the catalogue price when the response has no cost, and keeps a cost the provider reported', () => {
        const session = new AgentTurnTrace();
        session.provider({ usage: { promptTokens: 2000, completionTokens: 500 }, model: 'gpt-4.1-mini' });
        expect(session.cost).toBeCloseTo(2 * 0.0004 + 0.5 * 0.0016, 10);
        session.provider({ usage: { promptTokens: 10, completionTokens: 10 }, model: 'gpt-4.1-mini', cost: 0.5 });
        expect(session.cost).toBeCloseTo(2 * 0.0004 + 0.5 * 0.0016 + 0.5, 10);
        expect(session.inputTokens).toBe(2010);
    });
});
