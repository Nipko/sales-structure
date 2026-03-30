import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { ILLMProvider, LLMRequestOptions, LLMResponse } from '../interfaces/illm-provider.interface';

@Injectable()
export class DeepSeekProvider implements ILLMProvider {
    private openai: OpenAI;
    private readonly logger = new Logger(DeepSeekProvider.name);
    readonly providerName = 'deepseek';

    constructor(private configService: ConfigService) {
        this.openai = new OpenAI({
            baseURL: 'https://api.deepseek.com',
            apiKey: this.configService.get<string>('DEEPSEEK_API_KEY') || '',
        });
    }

    async generate(options: LLMRequestOptions): Promise<LLMResponse> {
        try {
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

            const response = await this.openai.chat.completions.create(req);
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
            this.logger.error(`DeepSeek error: ${error.message}`, error.stack);
            throw error;
        }
    }

    async *generateStream(options: LLMRequestOptions): AsyncGenerator<string, void, unknown> {
        try {
            const formattedMessages = this.formatMessages(options);
            
            const req: OpenAI.Chat.ChatCompletionCreateParamsStreaming = {
                model: options.model,
                messages: formattedMessages as any,
                temperature: Number(options.temperature ?? 0.7),
                max_tokens: options.maxTokens != null ? Number(options.maxTokens) : undefined,
                stream: true,
            };

            const stream = await this.openai.chat.completions.create(req);

            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content;
                if (content) {
                    yield content;
                }
            }
        } catch (error: any) {
            this.logger.error(`DeepSeek stream error: ${error.message}`, error.stack);
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
                content: msg.content,
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
