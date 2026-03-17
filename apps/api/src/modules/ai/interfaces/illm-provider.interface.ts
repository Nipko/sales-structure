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
