import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { ILLMProvider, LLMRequestOptions, LLMResponse } from '../interfaces/illm-provider.interface';
import { LlmKeyService } from '../../settings/llm-key.service';

@Injectable()
export class OpenAIProvider implements ILLMProvider {
    private client: OpenAI | null = null;
    private currentKey = '';
    private readonly logger = new Logger(OpenAIProvider.name);
    readonly providerName = 'openai';

    constructor(private llmKeys: LlmKeyService) {}

    private async ensureClient(): Promise<OpenAI> {
        const key = await this.llmKeys.getKey('openai');
        if (!key) throw new Error('OpenAI API key not configured');
        if (this.client && key === this.currentKey) return this.client;
        this.client = new OpenAI({ apiKey: key });
        this.currentKey = key;
        return this.client;
    }

    async generate(options: LLMRequestOptions): Promise<LLMResponse> {
        try {
            const openai = await this.ensureClient();
            const formattedMessages = this.formatMessages(options);

            const req: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
                model: options.model,
                messages: formattedMessages as any,
                temperature: Number(options.temperature ?? 0.7),
                max_tokens: options.maxTokens != null ? Number(options.maxTokens) : undefined,
            };

            if (options.tools && options.tools.length > 0) {
                req.tools = options.tools.map(t => ({
                    type: 'function',
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

            const response = await openai.chat.completions.create(req);
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
            this.logger.error(`OpenAI error: ${error.message}`, error.stack);
            throw error;
        }
    }

    async *generateStream(options: LLMRequestOptions): AsyncGenerator<string, void, unknown> {
        try {
            const openai = await this.ensureClient();
            const formattedMessages = this.formatMessages(options);

            const req: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
                model: options.model,
                messages: formattedMessages as any,
                temperature: Number(options.temperature ?? 0.7),
                max_tokens: options.maxTokens != null ? Number(options.maxTokens) : undefined,
                stream: true,
            };

            const stream = await openai.chat.completions.create(req);

            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content;
                if (content) {
                    yield content;
                }
            }
        } catch (error: any) {
            this.logger.error(`OpenAI stream error: ${error.message}`, error.stack);
            throw error;
        }
    }

    private formatMessages(options: LLMRequestOptions): any[] {
        const messages: any[] = [];

        if (options.systemPrompt) {
            messages.push({ role: 'system', content: options.systemPrompt });
        }

        for (const msg of options.messages) {
            const formattedMsg: any = {
                role: msg.role,
                content: Array.isArray(msg.content) ? msg.content : msg.content,
            };
            if (msg.name) formattedMsg.name = msg.name;
            if (msg.toolCallId) formattedMsg.tool_call_id = msg.toolCallId;
            if (msg.toolCalls) {
                formattedMsg.tool_calls = msg.toolCalls.map(tc => ({
                    id: tc.id,
                    type: 'function',
                    function: {
                        name: tc.function.name,
                        arguments: tc.function.arguments
                    }
                }));
            }
            messages.push(formattedMsg);
        }

        return messages;
    }
}
