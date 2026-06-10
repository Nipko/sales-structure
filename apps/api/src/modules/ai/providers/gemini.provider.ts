import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ILLMProvider, LLMRequestOptions, LLMResponse } from '../interfaces/illm-provider.interface';
import { LlmKeyService } from '../../settings/llm-key.service';

@Injectable()
export class GeminiProvider implements ILLMProvider {
    private client: GoogleGenerativeAI | null = null;
    private currentKey = '';
    private readonly logger = new Logger(GeminiProvider.name);
    readonly providerName = 'google';

    constructor(private llmKeys: LlmKeyService) {}

    private async ensureClient(): Promise<GoogleGenerativeAI> {
        const key = await this.llmKeys.getKey('google');
        if (!key) throw new Error('Google AI API key not configured');
        if (this.client && key === this.currentKey) return this.client;
        this.client = new GoogleGenerativeAI(key);
        this.currentKey = key;
        return this.client;
    }

    async generate(options: LLMRequestOptions): Promise<LLMResponse> {
        try {
            const genAI = await this.ensureClient();
            // Bound per-request latency (default has no client timeout). The router
            // owns fallback across providers.
            const model = genAI.getGenerativeModel({ model: options.model }, { timeout: 45_000 });

            const contents = this.formatMessages(options.messages);

            const requestParams: any = {
                contents,
                generationConfig: {
                    temperature: Number(options.temperature ?? 0.7),
                    maxOutputTokens: options.maxTokens != null ? Number(options.maxTokens) : undefined,
                }
            };

            if (options.systemPrompt) {
                requestParams.systemInstruction = options.systemPrompt;
            }

            if (options.jsonMode) {
                requestParams.generationConfig.responseMimeType = 'application/json';
            }

            const result = await model.generateContent(requestParams);
            const response = result.response;

            // Map the real finish reason. A SAFETY/RECITATION block makes
            // response.text() THROW — which would wrongly open the circuit breaker
            // for the whole provider. Detect it and return content_filter instead.
            const fr = (response.candidates?.[0] as any)?.finishReason;
            let finishReason: 'stop' | 'length' | 'content_filter' | 'error' = 'stop';
            if (fr === 'MAX_TOKENS') finishReason = 'length';
            else if (fr === 'SAFETY' || fr === 'RECITATION' || fr === 'BLOCKLIST' || fr === 'PROHIBITED_CONTENT' || fr === 'SPII') finishReason = 'content_filter';

            let text = '';
            if (finishReason !== 'content_filter') {
                try {
                    text = response.text();
                } catch (e: any) {
                    this.logger.warn(`Gemini response.text() failed (likely safety block): ${e.message}`);
                    finishReason = 'content_filter';
                }
            }

            return {
                content: text,
                finishReason,
                usage: response.usageMetadata ? {
                    promptTokens: response.usageMetadata.promptTokenCount,
                    completionTokens: response.usageMetadata.candidatesTokenCount,
                    totalTokens: response.usageMetadata.totalTokenCount,
                } : undefined,
                raw: response,
            };
        } catch (error: any) {
            this.logger.error(`Gemini error: ${error.message}`, error.stack);
            throw error;
        }
    }

    async *generateStream(options: LLMRequestOptions): AsyncGenerator<string, void, unknown> {
        try {
            const genAI = await this.ensureClient();
            // Bound per-request latency (default has no client timeout). The router
            // owns fallback across providers.
            const model = genAI.getGenerativeModel({ model: options.model }, { timeout: 45_000 });

            const contents = this.formatMessages(options.messages);
            const requestParams: any = {
                contents,
                generationConfig: {
                    temperature: Number(options.temperature ?? 0.7),
                    maxOutputTokens: options.maxTokens != null ? Number(options.maxTokens) : undefined,
                }
            };

            if (options.systemPrompt) {
                requestParams.systemInstruction = options.systemPrompt;
            }

            const result = await model.generateContentStream(requestParams);

            for await (const chunk of result.stream) {
                const chunkText = chunk.text();
                if (chunkText) {
                    yield chunkText;
                }
            }
        } catch (error: any) {
            this.logger.error(`Gemini stream error: ${error.message}`, error.stack);
            throw error;
        }
    }

    private formatMessages(messages: any[]): any[] {
        const contents: any[] = [];

        for (const msg of messages) {
            if (msg.role === 'system') continue;

            const role = msg.role === 'assistant' ? 'model' : 'user';

            contents.push({
                role,
                parts: [{ text: msg.content || '' }]
            });
        }

        return contents;
    }
}
