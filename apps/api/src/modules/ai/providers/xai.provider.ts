import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { ILLMProvider, LLMRequestOptions, LLMResponse } from '../interfaces/illm-provider.interface';
import { LlmKeyService } from '../../settings/llm-key.service';

@Injectable()
export class XAIProvider implements ILLMProvider {
    private client: OpenAI | null = null;
    private currentKey = '';
    private readonly logger = new Logger(XAIProvider.name);
    readonly providerName = 'xai';

    constructor(private llmKeys: LlmKeyService) {}

    private async ensureClient(): Promise<OpenAI> {
        const key = await this.llmKeys.getKey('xai');
        if (!key) throw new Error('xAI API key not configured');
        if (this.client && key === this.currentKey) return this.client;
        this.client = new OpenAI({ apiKey: key, baseURL: 'https://api.x.ai/v1' });
        this.currentKey = key;
        return this.client;
    }

    async generate(options: LLMRequestOptions): Promise<LLMResponse> {
        try {
            const client = await this.ensureClient();
            const formattedMessages = this.formatMessages(options);

            const req: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
                model: options.model,
                messages: formattedMessages as any,
                temperature: Number(options.temperature ?? 0.7),
                max_tokens: options.maxTokens != null ? Number(options.maxTokens) : undefined,
            };

            if (options.tools && options.tools.length > 0) {
                req.tools = options.tools.map(t => ({
                    type: 'function' as const,
                    function: {
                        name: t.name,
                        description: t.description,
                        parameters: t.parameters,
                    }
                }));
            }

            if (options.jsonMode) {
                req.response_format = { type: 'json_object' };
            }

            const response = await client.chat.completions.create(req);
            const choice = response.choices[0];

            return {
                content: choice.message.content || '',
                finishReason: choice.finish_reason as any,
                toolCalls: choice.message.tool_calls?.map(tc => ({
                    id: tc.id,
                    type: 'function',
                    function: {
                        name: tc.function.name,
                        arguments: tc.function.arguments,
                    }
                })),
                usage: response.usage ? {
                    promptTokens: response.usage.prompt_tokens,
                    completionTokens: response.usage.completion_tokens,
                    totalTokens: response.usage.total_tokens,
                } : undefined,
                raw: response,
            };
        } catch (error: any) {
            this.logger.error(`xAI/Grok error: ${error.message}`, error.stack);
            throw error;
        }
    }

    async *generateStream(options: LLMRequestOptions): AsyncGenerator<string, void, unknown> {
        try {
            const client = await this.ensureClient();
            const formattedMessages = this.formatMessages(options);
            const req: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
                model: options.model,
                messages: formattedMessages as any,
                temperature: Number(options.temperature ?? 0.7),
                stream: true,
            };
            const stream = await client.chat.completions.create(req);
            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content;
                if (content) yield content;
            }
        } catch (error: any) {
            this.logger.error(`xAI/Grok stream error: ${error.message}`, error.stack);
            throw error;
        }
    }

    private formatMessages(options: LLMRequestOptions) {
        const messages: any[] = [];
        if (options.systemPrompt) {
            messages.push({ role: 'system', content: options.systemPrompt });
        }
        if (options.messages) {
            for (const msg of options.messages) {
                messages.push(msg);
            }
        }
        return messages;
    }
}
