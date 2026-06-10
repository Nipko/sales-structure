import { ChatMessage, ToolDefinition, ToolCall } from '@parallext/shared';

export interface LLMResponse {
    content: string;
    toolCalls?: ToolCall[];
    finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'error';
    usage?: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
    raw?: any;
}

export interface LLMRequestOptions {
    model: string;
    messages: ChatMessage[];
    systemPrompt?: string;
    /**
     * Length (chars) of the byte-stable prefix of systemPrompt (contract + persona)
     * that is identical across turns and safe to cache. Providers that support
     * prompt caching (Anthropic via cache_control; OpenAI auto-caches stable
     * prefixes) may use it; others ignore it. The full systemPrompt is unchanged.
     */
    cacheableSystemPromptChars?: number;
    temperature?: number;
    maxTokens?: number;
    tools?: ToolDefinition[];
    jsonMode?: boolean;
}

export interface ILLMProvider {
    readonly providerName: string;
    
    /**
     * Generate text or tool calls from the model
     */
    generate(options: LLMRequestOptions): Promise<LLMResponse>;
    
    /**
     * Generate a stream of text from the model
     */
    generateStream(options: LLMRequestOptions): AsyncGenerator<string, void, unknown>;
}
