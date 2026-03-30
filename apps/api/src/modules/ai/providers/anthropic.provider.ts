import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { ILLMProvider, LLMRequestOptions, LLMResponse } from '../interfaces/illm-provider.interface';

@Injectable()
export class AnthropicProvider implements ILLMProvider {
    private anthropic: Anthropic;
    private readonly logger = new Logger(AnthropicProvider.name);
    readonly providerName = 'anthropic';

    constructor(private configService: ConfigService) {
        this.anthropic = new Anthropic({
            apiKey: this.configService.get<string>('ANTHROPIC_API_KEY') || '',
        });
    }

    async generate(options: LLMRequestOptions): Promise<LLMResponse> {
        try {
            const req: Anthropic.MessageCreateParamsNonStreaming = {
                model: options.model,
                messages: this.formatMessages(options.messages),
                max_tokens: Number(options.maxTokens || 4096),
                temperature: Number(options.temperature ?? 0.7),
            };

            if (options.systemPrompt) {
                req.system = options.systemPrompt;
            }

            if (options.tools && options.tools.length > 0) {
                req.tools = options.tools.map(t => ({
                    name: t.name,
                    description: t.description,
                    input_schema: {
                        type: 'object',
                        properties: t.parameters.properties || {},
                        required: t.parameters.required || [],
                    }
                }));
            }

            const response = await this.anthropic.messages.create(req);
            
            // Parse response content
            let textContent = '';
            const toolCalls = [];
            
            for (const block of response.content) {
                if (block.type === 'text') {
                    textContent += block.text;
                } else if (block.type === 'tool_use') {
                    toolCalls.push({
                        id: block.id,
                        type: 'function' as const,
                        function: {
                            name: block.name,
                            arguments: JSON.stringify(block.input),
                        }
                    });
                }
            }

            let finishReason: 'stop' | 'tool_calls' | 'length' | 'error' = 'stop';
            if (response.stop_reason === 'tool_use') finishReason = 'tool_calls';
            if (response.stop_reason === 'max_tokens') finishReason = 'length';

            return {
                content: textContent,
                finishReason,
                toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                usage: {
                    promptTokens: response.usage.input_tokens,
                    completionTokens: response.usage.output_tokens,
                    totalTokens: response.usage.input_tokens + response.usage.output_tokens,
                },
                raw: response,
            };
        } catch (error: any) {
            this.logger.error(`Anthropic error: ${error.message}`, error.stack);
            throw error;
        }
    }

    async *generateStream(options: LLMRequestOptions): AsyncGenerator<string, void, unknown> {
        try {
            const req: Anthropic.MessageCreateParamsStreaming = {
                model: options.model,
                messages: this.formatMessages(options.messages),
                max_tokens: Number(options.maxTokens || 4096),
                temperature: Number(options.temperature ?? 0.7),
                stream: true,
            };

            if (options.systemPrompt) {
                req.system = options.systemPrompt;
            }

            const stream = await this.anthropic.messages.create(req);

            for await (const chunk of stream) {
                if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                    yield chunk.delta.text;
                }
            }
        } catch (error: any) {
            this.logger.error(`Anthropic stream error: ${error.message}`, error.stack);
            throw error;
        }
    }

    private formatMessages(messages: any[]): Anthropic.MessageParam[] {
        const formatted: Anthropic.MessageParam[] = [];
        let currentRole: 'user' | 'assistant' = 'user';
        
        for (const msg of messages) {
            if (msg.role === 'system') continue; // Handled separately
            
            if (msg.role === 'tool') {
                formatted.push({
                    role: 'user',
                    content: [
                        {
                            type: 'tool_result',
                            tool_use_id: msg.toolCallId,
                            content: msg.content,
                        }
                    ]
                });
                currentRole = 'assistant';
                continue;
            }
            
            const anthropicRole = msg.role === 'assistant' ? 'assistant' : 'user';
            
            // Combine consecutive messages of the same role (Anthropic requires alternating)
            if (formatted.length > 0 && formatted[formatted.length - 1].role === anthropicRole) {
                const prevMsg = formatted[formatted.length - 1];
                if (typeof prevMsg.content === 'string') {
                    prevMsg.content += '\n\n' + msg.content;
                }
            } else {
                let content: any = msg.content;
                
                // Add tool calls if present
                if (msg.toolCalls && msg.toolCalls.length > 0) {
                    content = [];
                    if (msg.content) {
                        content.push({ type: 'text', text: msg.content });
                    }
                    for (const tc of msg.toolCalls) {
                        content.push({
                            type: 'tool_use',
                            id: tc.id,
                            name: tc.function.name,
                            input: JSON.parse(tc.function.arguments),
                        });
                    }
                }
                
                formatted.push({
                    role: anthropicRole,
                    content,
                });
            }
            currentRole = anthropicRole === 'user' ? 'assistant' : 'user';
        }
        
        return formatted;
    }
}
