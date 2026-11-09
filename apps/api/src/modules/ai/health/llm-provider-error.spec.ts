import { classifyProviderError, summarizeProviderError } from './llm-provider-error';

describe('classifyProviderError', () => {
    it('OpenAI sin creditos (el caso del 8-nov) es quota, no rate limit', () => {
        const err = Object.assign(new Error('429 You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.'), { status: 429 });
        expect(classifyProviderError(err, 'openai')).toBe('quota');
    });

    it('OpenAI insufficient_quota por codigo', () => {
        expect(classifyProviderError({ status: 429, code: 'insufficient_quota', message: '429 You exceeded your current quota' }, 'openai')).toBe('quota');
    });

    it('Anthropic credito bajo llega como 400 y es quota', () => {
        expect(classifyProviderError({ status: 400, message: 'Your credit balance is too low to access the Anthropic API.' }, 'anthropic')).toBe('quota');
    });

    it('DeepSeek 402 Insufficient Balance', () => {
        expect(classifyProviderError({ status: 402, message: 'Insufficient Balance' }, 'deepseek')).toBe('quota');
    });

    it('xAI sin creditos aunque sea 403', () => {
        expect(classifyProviderError({ status: 403, message: "Your team doesn't have any credits yet." }, 'xai')).toBe('quota');
        expect(classifyProviderError({ status: 429, message: 'Your team has either used all available credits or reached its monthly spending limit.' }, 'xai')).toBe('quota');
    });

    it('un 429 de Google es rate limit aunque diga "quota"', () => {
        expect(classifyProviderError({ status: 429, message: 'You exceeded your current quota, please check your plan and billing details.' }, 'google')).toBe('rate_limit');
    });

    it('rate limit normal', () => {
        expect(classifyProviderError({ status: 429, message: 'Rate limit reached for gpt-4o-mini' }, 'openai')).toBe('rate_limit');
    });

    it('clave invalida: 401, 403 y el 400 de Gemini', () => {
        expect(classifyProviderError({ status: 401, message: 'Incorrect API key provided: sk-abc' }, 'openai')).toBe('auth');
        expect(classifyProviderError({ status: 403, message: 'Forbidden' }, 'xai')).toBe('auth');
        expect(classifyProviderError({ status: 400, message: 'API key not valid. Please pass a valid API key.', type: 'INVALID_ARGUMENT' }, 'google')).toBe('auth');
    });

    it('caidas: 5xx, 529 overloaded, timeouts y red', () => {
        expect(classifyProviderError({ status: 503, message: 'Service Unavailable' })).toBe('unavailable');
        expect(classifyProviderError({ status: 529, message: 'Overloaded' })).toBe('unavailable');
        expect(classifyProviderError({ name: 'APIConnectionTimeoutError', message: 'Request timed out.' })).toBe('unavailable');
        expect(classifyProviderError({ name: 'TimeoutError', message: 'The operation was aborted due to timeout' })).toBe('unavailable');
        expect(classifyProviderError({ code: 'ECONNRESET', message: 'socket' })).toBe('unavailable');
        expect(classifyProviderError({ cause: { code: 'ENOTFOUND' }, message: 'fetch failed' })).toBe('unavailable');
    });

    it('modelo retirado y peticion mala no se confunden con caida', () => {
        expect(classifyProviderError({ status: 404, message: 'models/gemini-2.5-pro is no longer available to new users' })).toBe('model_not_found');
        expect(classifyProviderError({ status: 400, message: "Invalid parameter: 'tools[0].function.name'" })).toBe('bad_request');
    });

    it('sin forma conocida', () => {
        expect(classifyProviderError(new Error('boom'))).toBe('unknown');
        expect(classifyProviderError(undefined)).toBe('unknown');
    });
});

describe('summarizeProviderError', () => {
    it('no deja pasar claves', () => {
        const s = summarizeProviderError({ message: 'Incorrect API key provided: sk-proj-abcdefghijklmnop1234' });
        expect(s).not.toContain('abcdefghijklmnop');
        expect(s).toContain('sk-***');
    });
});
