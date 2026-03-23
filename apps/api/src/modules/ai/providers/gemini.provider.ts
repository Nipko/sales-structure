import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ILLMProvider, LLMRequestOptions, LLMResponse } from '../interfaces/illm-provider.interface';

@Injectable()
export class GeminiProvider implements ILLMProvider {
    private genAI: GoogleGenerativeAI;
    private readonly logger = new Logger(GeminiProvider.name);
    readonly providerName = 'google';

    constructor(private configService: ConfigService) {
        this.genAI = new GoogleGenerativeAI(this.configService.get<string>('GEMINI_API_KEY') || '');
    }

    async generate(options: LLMRequestOptions): Promise<LLMResponse> {
        try {
            const model = this.genAI.getGenerativeModel({ model: options.model });

            // Format for Gemini
            const contents = this.formatMessages(options.messages);

            const requestParams: any = {
                contents,
                generationConfig: {
                    temperature: options.temperature ?? 0.7,
                    maxOutputTokens: options.maxTokens,
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
            const model = this.genAI.getGenerativeModel({ model: options.model });
            
            const contents = this.formatMessages(options.messages);
            const requestParams: any = {
                contents,
                generationConfig: {
                    temperature: options.temperature ?? 0.7,
                    maxOutputTokens: options.maxTokens,
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
            
            // Gemini groups user/model interactions
            contents.push({
                role,
                parts: [{ text: msg.content || '' }]
            });
        }
        
        return contents;
    }
}
