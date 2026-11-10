import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { ILLMProvider, LLMRequestOptions, LLMResponse, LLMTransportOptions } from '../interfaces/illm-provider.interface';
import { LlmKeyService } from '../../settings/llm-key.service';
import { openAIChatParams, openAISupportsCacheBreakpoints, openAISystemContent } from './model-request-params';
import { usageFromOpenAICompatible } from '../router/llm-cost';

/**
 * A 400 that names the cache breakpoint field: the model does not take
 * `prompt_cache_breakpoint` (ADR-0032). Anything else is a real error.
 */
export function isCacheBreakpointRejection(error: any): boolean {
    return error?.status === 400 && /prompt_cache/i.test(String(error?.message ?? ''));
}

@Injectable()
export class OpenAIProvider implements ILLMProvider {
    private client: OpenAI | null = null;
    private currentKey = '';
    /** Models that answered 400 to a cache breakpoint: sent without it from then on. */
    private readonly breakpointRejected = new Set<string>();
    private readonly logger = new Logger(OpenAIProvider.name);
    readonly providerName = 'openai';

    constructor(private llmKeys: LlmKeyService) {}

    private async ensureClient(): Promise<OpenAI> {
        const key = await this.llmKeys.getKey('openai');
        if (!key) throw new Error('OpenAI API key not configured');
        if (this.client && key === this.currentKey) return this.client;
        // Bound per-request latency (SDK default is 10min × 2 retries). The router
        // owns fallback across providers, so keep retries minimal.
        this.client = new OpenAI({ apiKey: key, timeout: 45_000, maxRetries: 1 });
        this.currentKey = key;
        return this.client;
    }

    async generate(options: LLMRequestOptions, transport?: LLMTransportOptions): Promise<LLMResponse> {
        try {
            const openai = await this.ensureClient();
            const build = (breakpoints: boolean): OpenAI.Chat.ChatCompletionCreateParamsNonStreaming => this.buildRequest(options, breakpoints);

            const response = await this.withBreakpointFallback(options.model,
                breakpoints => openai.chat.completions.create(build(breakpoints), transport));
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
                usage: usageFromOpenAICompatible(response.usage),
                raw: response,
            };
        } catch (error: any) {
            this.logger.error(`OpenAI error: ${error.message}`, error.stack);
            throw error;
        }
    }

    async *generateStream(options: LLMRequestOptions, transport?: LLMTransportOptions): AsyncGenerator<string, void, unknown> {
        try {
            const openai = await this.ensureClient();
            const stream = await this.withBreakpointFallback(options.model, breakpoints => openai.chat.completions.create({
                model: options.model,
                messages: this.formatMessages(options, breakpoints) as any,
                ...openAIChatParams(options.model, options),
                stream: true,
            }, transport ? { maxRetries: transport.maxRetries } : undefined));

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

    /** The non-streaming request; `breakpoints` marks the stable system prefix (ADR-0032). */
    buildRequest(options: LLMRequestOptions, breakpoints: boolean): OpenAI.Chat.ChatCompletionCreateParamsNonStreaming {
        const req: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
            model: options.model,
            messages: this.formatMessages(options, breakpoints) as any,
            ...openAIChatParams(options.model, options),
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
        return req;
    }

    /**
     * Sends with the cache breakpoint and, if this model rejects the field,
     * once more without it — the same prompt, only the caching hint is lost —
     * and stops sending it to that model. A 400 must never cost a turn.
     */
    private async withBreakpointFallback<T>(model: string, send: (breakpoints: boolean) => Promise<T>): Promise<T> {
        const breakpoints = openAISupportsCacheBreakpoints(model) && !this.breakpointRejected.has(model);
        try {
            return await send(breakpoints);
        } catch (error: any) {
            if (!breakpoints || !isCacheBreakpointRejection(error)) throw error;
            this.breakpointRejected.add(model);
            this.logger.warn(`[LLM_CACHE] ${model} rejected prompt_cache_breakpoint (${error.message}); retrying without it`);
            return send(false);
        }
    }

    private formatMessages(options: LLMRequestOptions, breakpoints = false): any[] {
        const messages: any[] = [];

        if (options.systemPrompt) {
            messages.push({
                role: 'system',
                content: openAISystemContent(options.model, options.systemPrompt, options.cacheableSystemPromptChars, breakpoints),
            });
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
