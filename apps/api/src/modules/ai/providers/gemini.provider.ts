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
            const model = genAI.getGenerativeModel({ model: options.model });

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

            const text = response.text();

            return {
                content: text,
                finishReason: 'stop',
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
            const model = genAI.getGenerativeModel({ model: options.model });

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
