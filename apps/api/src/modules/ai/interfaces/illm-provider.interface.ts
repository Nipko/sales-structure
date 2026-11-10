import { ChatMessage, ToolDefinition, ToolCall } from '@parallext/shared';
import type { LLMUsage } from '../router/llm-cost';

export interface LLMResponse {
    content: string;
    toolCalls?: ToolCall[];
    finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'error';
    /** `promptTokens` es toda la entrada; la parte en caché va aparte (ADR-0027). */
    usage?: LLMUsage;
    raw?: any;
}

export interface LLMRequestOptions {
    model: string;
    messages: ChatMessage[];
    systemPrompt?: string;
    /**
     * Length (chars) of the byte-stable prefix of systemPrompt (contract + persona)
     * that is identical across turns and safe to cache. Providers that support
     * prompt caching (Anthropic via cache_control; OpenAI GPT-5.6+ via
     * prompt_cache_breakpoint, ADR-0032) may use it; others ignore it. The full systemPrompt is unchanged.
     */
    cacheableSystemPromptChars?: number;
    temperature?: number;
    maxTokens?: number;
    tools?: ToolDefinition[];
    jsonMode?: boolean;
}

/** Internal transport settings, separate from model input and tenant JSON. */
export interface LLMTransportOptions {
    /** The router revalidates source authority before each retry. */
    maxRetries: 0;
}

export interface ILLMProvider {
    readonly providerName: string;
    
    /**
     * Generate text or tool calls from the model
     */
    generate(options: LLMRequestOptions, transport?: LLMTransportOptions): Promise<LLMResponse>;
    
    /**
     * Generate a stream of text from the model
     */
    generateStream(options: LLMRequestOptions, transport?: LLMTransportOptions): AsyncGenerator<string, void, unknown>;
}
