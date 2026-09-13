import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type { ILLMProvider, LLMRequestOptions, LLMResponse } from '../interfaces/illm-provider.interface';
import { LLMSourceAuthorityUnavailable, type LLMSourceAuthority } from '../interfaces/llm-source-authority';

/** SDK retries would send again inside one old authority check. With a source
 * scope, each request gets its own check and SDK retries are disabled. */
export async function generateWithSourceAuthority(
    provider: ILLMProvider,
    request: LLMRequestOptions,
    authority?: LLMSourceAuthority,
): Promise<LLMResponse> {
    if (!authority) return provider.generate(request);
    for (let attempt = 0; ; attempt++) {
        try {
            return await authority(() => provider.generate(request, { maxRetries: 0 }));
        } catch (error: any) {
            const retryable = [408, 409, 429].includes(error?.status) || error?.status >= 500
                || error instanceof OpenAI.APIConnectionError || error instanceof Anthropic.APIConnectionError;
            if (error instanceof LLMSourceAuthorityUnavailable || attempt >= 1 || !retryable) throw error;
            // Preserve one transient retry, but release the old source fence
            // before backoff. Cross-provider fallback remains in the router.
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    }
}
