import {
    anthropicAcceptsSampling, anthropicRequestParams, anthropicThinkingParam, deepseekChatExtras, geminiThinkingConfig,
    isOpenAIReasoningModel, openAIChatParams, xaiChatParams,
} from './model-request-params';

// Cada caso reproduce una respuesta real de la API del 9-nov-2026 (ADR-0029).
describe('model-request-params', () => {
    describe('OpenAI', () => {
        it('GPT-5.6+/GPT-6: max_completion_tokens y reasoning none (max_tokens → 400; tools sin none → 400)', () => {
            for (const model of ['gpt-6-luna', 'gpt-5.6-luna', 'gpt-6-sol']) {
                expect(isOpenAIReasoningModel(model)).toBe(true);
                expect(openAIChatParams(model, { temperature: 0.7, maxTokens: 200 }))
                    .toEqual({ reasoning_effort: 'none', temperature: 0.7, max_completion_tokens: 200 });
            }
        });
        it('sin maxTokens no manda ningún tope', () => {
            expect(openAIChatParams('gpt-6-luna', {})).toEqual({ reasoning_effort: 'none', temperature: 0.7 });
        });
        it('los modelos clásicos siguen con max_tokens y sin reasoning_effort', () => {
            expect(openAIChatParams('gpt-4.1-mini', { temperature: 0, maxTokens: 24 })).toEqual({ temperature: 0, max_tokens: 24 });
        });
    });

    it('xAI: grok-4.3 razona por defecto (458 tokens en un «sí»), se apaga con none', () => {
        expect(xaiChatParams('grok-4.3', { temperature: 0, maxTokens: 24 }))
            .toEqual({ temperature: 0, max_tokens: 24, reasoning_effort: 'none' });
        expect(xaiChatParams('grok-4-1-fast-non-reasoning', {})).toEqual({ temperature: 0.7 });
    });

    it('DeepSeek: deepseek-flash piensa por defecto; sólo deepseek-reasoner lo conserva', () => {
        expect(deepseekChatExtras('deepseek-flash')).toEqual({ thinking: { type: 'disabled' } });
        expect(deepseekChatExtras('deepseek-reasoner')).toEqual({});
    });

    describe('Anthropic', () => {
        it('Claude 4.7+ y 5.x no aceptan temperature; 4.6 y anteriores sí', () => {
            expect(anthropicAcceptsSampling('claude-haiku-5-5')).toBe(false);
            expect(anthropicAcceptsSampling('claude-sonnet-5-5')).toBe(false);
            expect(anthropicAcceptsSampling('claude-opus-4-7')).toBe(false);
            expect(anthropicAcceptsSampling('claude-sonnet-4-6')).toBe(true);
            expect(anthropicAcceptsSampling('claude-sonnet-4-20250514')).toBe(true);
        });
        it('Haiku 5.x apaga el pensamiento; Sonnet 5.x rechaza disabled y usa between_tools', () => {
            expect(anthropicThinkingParam('claude-haiku-5-5')).toEqual({ type: 'disabled' });
            expect(anthropicThinkingParam('claude-sonnet-5-5')).toEqual({ type: 'between_tools' });
            expect(anthropicThinkingParam('claude-sonnet-4-6')).toBeUndefined();
        });
        it('la petición completa', () => {
            expect(anthropicRequestParams('claude-haiku-5-5', { temperature: 0.7 })).toEqual({ thinking: { type: 'disabled' } });
            expect(anthropicRequestParams('claude-sonnet-4-6', { temperature: 0 })).toEqual({ temperature: 0 });
        });
    });

    it('Gemini: 2.x apaga con presupuesto 0; 3.x rechaza el presupuesto y usa minimal', () => {
        expect(geminiThinkingConfig('gemini-2.5-flash')).toEqual({ thinkingBudget: 0 });
        expect(geminiThinkingConfig('gemini-3.5-flash-lite')).toEqual({ thinkingLevel: 'minimal' });
    });
});
