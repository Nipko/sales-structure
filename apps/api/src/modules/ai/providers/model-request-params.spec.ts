import {
    anthropicAcceptsSampling, anthropicRequestParams, anthropicThinkingParam, deepseekChatExtras, geminiThinkingConfig,
    isOpenAIReasoningModel, modelFamily, openAIChatParams, openAISupportsCacheBreakpoints, openAISystemContent, xaiChatParams,
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

    // ADR-0032: GPT-5.6+ sólo cachea en límites exactos (fin de mensaje o breakpoint).
    describe('OpenAI: breakpoint de caché en el prefijo estable', () => {
        const prompt = '<contract>reglas</contract>\n\n<persona>Valeria</persona>\n\n<turn><now>2026-11-10T10:00</now></turn>';
        const cut = prompt.indexOf('\n\n<turn>');

        it('sólo GPT-5.6 en adelante (GPT-6 incluido) tiene breakpoints', () => {
            for (const model of ['gpt-6-luna', 'gpt-6-sol', 'gpt-5.6-luna', 'gpt-5.10', 'gpt-6-luna-2026-05-18', 'gpt-7']) {
                expect(openAISupportsCacheBreakpoints(model)).toBe(true);
            }
            for (const model of ['gpt-5.5', 'gpt-5', 'gpt-5-mini', 'gpt-4.1-mini', 'gpt-4o-mini', 'o4-mini', 'grok-4.3']) {
                expect(openAISupportsCacheBreakpoints(model)).toBe(false);
            }
        });

        it('parte el system en el prefijo estable con breakpoint y el <turn> sin él; juntos son el mismo texto', () => {
            const content = openAISystemContent('gpt-6-luna', prompt, cut);
            expect(content).toEqual([
                { type: 'text', text: '<contract>reglas</contract>\n\n<persona>Valeria</persona>', prompt_cache_breakpoint: { mode: 'explicit' } },
                { type: 'text', text: '\n\n<turn><now>2026-11-10T10:00</now></turn>' },
            ]);
            expect((content as Array<{ text: string }>).map(part => part.text).join('')).toBe(prompt);
        });

        it('el mismo prefijo da el mismo primer bloque aunque cambie el <turn>', () => {
            const other = prompt.replace('10:00', '10:05');
            expect((openAISystemContent('gpt-6-luna', other, cut) as unknown[])[0])
                .toEqual((openAISystemContent('gpt-6-luna', prompt, cut) as unknown[])[0]);
        });

        it('sin corte válido, con un modelo anterior o con breakpoints apagados queda el texto tal cual', () => {
            expect(openAISystemContent('gpt-6-luna', prompt, undefined)).toBe(prompt);
            expect(openAISystemContent('gpt-6-luna', prompt, 0)).toBe(prompt);
            expect(openAISystemContent('gpt-6-luna', prompt, prompt.length)).toBe(prompt);
            expect(openAISystemContent('gpt-6-luna', prompt, 12.5)).toBe(prompt);
            expect(openAISystemContent('gpt-4.1-mini', prompt, cut)).toBe(prompt);
            expect(openAISystemContent('gpt-6-luna', prompt, cut, false)).toBe(prompt);
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

    describe('modelFamily (ADR-0030)', () => {
        it('reconoce las familias verificadas', () => {
            expect(modelFamily('openai', 'gpt-6-luna')).toBe('openai_reasoning');
            expect(modelFamily('openai', 'gpt-5.6-luna')).toBe('openai_reasoning');
            expect(modelFamily('openai', 'gpt-4.1-mini')).toBe('openai_classic');
            expect(modelFamily('openai', 'gpt-4o-mini')).toBe('openai_classic');
            expect(modelFamily('anthropic', 'claude-haiku-5-5')).toBe('anthropic_no_sampling');
            expect(modelFamily('anthropic', 'claude-sonnet-4-20250514')).toBe('anthropic_sampling');
            expect(modelFamily('google', 'gemini-3.5-flash-lite')).toBe('gemini_3');
            expect(modelFamily('google', 'gemini-2.5-flash')).toBe('gemini_2');
            expect(modelFamily('xai', 'grok-4.3')).toBe('xai_reasoning');
            expect(modelFamily('deepseek', 'deepseek-flash')).toBe('deepseek');
        });
        it('una familia nueva o un proveedor equivocado es unknown: requiere código', () => {
            expect(modelFamily('openai', 'gpt-7-luna')).toBe('unknown');
            expect(modelFamily('openai', 'gpt-60')).toBe('unknown');
            expect(modelFamily('google', 'gemini-4-flash')).toBe('unknown');
            expect(modelFamily('anthropic', 'claude-sonnet-6-0')).toBe('unknown');
            expect(modelFamily('xai', 'grok-5')).toBe('unknown');
            expect(modelFamily('deepseek', 'deepseek-v5')).toBe('unknown');
            expect(modelFamily('openai', 'claude-haiku-5-5')).toBe('unknown');
            expect(modelFamily('mistral', 'mistral-large')).toBe('unknown');
        });
    });
});
