import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { LlmKeyService } from '../settings/llm-key.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { openAIChatParams, xaiChatParams } from '../ai/providers/model-request-params';
import { roleModelForProvider } from '../ai/router/llm-catalog';

export interface VisionResult {
    description: string;
    model: string;
    provider: string;
    costCentsUsd: number;
}

// Vision costs per image (approximate, varies by resolution)
const VISION_COSTS: Record<string, number> = {
    // Estimaciones a precio de lista con hasta 300 tokens de salida (ADR-0029). Gemini 3.5 cuenta
    // ~1.090 tokens por imagen (medido el 9-nov-2026); OpenAI y xAI con detail low, unos cientos.
    'gemini-3.5-flash-lite': 0.11,  // ~$0.0011/img
    'gpt-6-luna': 0.018,            // ~$0.00018/img
    'grok-4.3': 0.11,               // ~$0.0011/img
};

const VISION_SYSTEM_PROMPT = `You are analyzing an image sent by a customer in a business chat conversation.
Describe what's in the image concisely (1-3 sentences max).
Focus on: what the image shows, any text visible, product details, or the customer's likely intent.
If it's a receipt or document, extract key details (amounts, dates, names).
If it's a screenshot of an issue, describe the problem shown.
Respond in the same language the customer has been using. Default to Spanish if unknown.
NEVER make up information not visible in the image.`;

@Injectable()
export class ImageVisionService {
    private openaiClient: OpenAI | null = null;
    private openaiKey = '';
    private xaiClient: OpenAI | null = null;
    private xaiKey = '';
    private readonly logger = new Logger(ImageVisionService.name);

    constructor(
        private readonly llmKeys: LlmKeyService,
        private readonly throttle: TenantThrottleService,
    ) {}

    async describe(
        imageBuffer: Buffer,
        mimeType: string,
        tenantId: string,
        conversationContext?: string,
    ): Promise<VisionResult> {
        const { model, provider, client } = await this.resolveVisionProvider(tenantId);
        const base64 = imageBuffer.toString('base64');
        const dataUrl = `data:${mimeType};base64,${base64}`;

        const userPrompt = conversationContext
            ? `The customer sent this image during a conversation. Recent context: "${conversationContext}". Describe what the image shows.`
            : 'The customer sent this image. Describe what it shows.';

        if (provider === 'google') {
            return this.describeWithGemini(imageBuffer, mimeType, model, userPrompt);
        }

        // OpenAI-compatible API (OpenAI, xAI)
        const response = await client!.chat.completions.create({
            model,
            messages: [
                { role: 'system', content: VISION_SYSTEM_PROMPT },
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: userPrompt },
                        { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } },
                    ],
                },
            ],
            // gpt-6-luna exige max_completion_tokens y reasoning none; grok-4.3, reasoning none (ADR-0029).
            ...((provider === 'xai'
                ? xaiChatParams(model, { temperature: 0.3, maxTokens: 300 })
                : openAIChatParams(model, { temperature: 0.3, maxTokens: 300 }))),
        });

        const description = response.choices[0]?.message?.content || '';
        const costCents = VISION_COSTS[model] || 0.05;

        this.logger.log(`[ImageVision] ${model}: "${description.substring(0, 80)}..." ($${(costCents / 100).toFixed(4)})`);
        return { description, model, provider, costCentsUsd: Math.ceil(costCents) };
    }

    private async describeWithGemini(
        imageBuffer: Buffer,
        mimeType: string,
        model: string,
        userPrompt: string,
    ): Promise<VisionResult> {
        const { GoogleGenerativeAI } = await import('@google/generative-ai');
        const key = await this.llmKeys.getKey('google');
        if (!key) throw new Error('Google AI key not configured for vision');

        const genAI = new GoogleGenerativeAI(key);
        const gemini = genAI.getGenerativeModel({ model });

        const result = await gemini.generateContent({
            contents: [{
                role: 'user',
                parts: [
                    { text: `${VISION_SYSTEM_PROMPT}\n\n${userPrompt}` },
                    { inlineData: { mimeType, data: imageBuffer.toString('base64') } },
                ],
            }],
            generationConfig: { maxOutputTokens: 300, temperature: 0.3 },
        });

        const description = result.response.text();
        const costCents = VISION_COSTS[model] || 0.034;

        this.logger.log(`[ImageVision] ${model}: "${description.substring(0, 80)}..." ($${(costCents / 100).toFixed(4)})`);
        return { description, model, provider: 'google', costCentsUsd: Math.ceil(costCents) };
    }

    private async resolveVisionProvider(tenantId: string): Promise<{
        model: string;
        provider: string;
        client: OpenAI | null;
    }> {
        const features = await this.throttle.getPlanFeatures(tenantId);
        const llmTier = features.llmTier as string;

        // Lower-tier plans → Gemini Flash (cheapest vision)
        if (llmTier === 'tier_4' || llmTier === 'tier_3') {
            const googleKey = await this.llmKeys.getKey('google');
            const googleModel = roleModelForProvider('vision', 'google');
            if (googleKey && googleModel) {
                return { model: googleModel, provider: 'google', client: null };
            }
        }

        // Higher-tier plans or Google not configured → try xAI (primary)
        const xaiKey = await this.llmKeys.getKey('xai');
        const xaiModel = roleModelForProvider('vision', 'xai');
        if (xaiKey && xaiModel) {
            if (!this.xaiClient || xaiKey !== this.xaiKey) {
                this.xaiClient = new OpenAI({ apiKey: xaiKey, baseURL: 'https://api.x.ai/v1' });
                this.xaiKey = xaiKey;
            }
            return { model: xaiModel, provider: 'xai', client: this.xaiClient };
        }

        // Fallback to OpenAI
        const openaiKey = await this.llmKeys.getKey('openai');
        const openaiModel = roleModelForProvider('vision', 'openai');
        if (openaiKey && openaiModel) {
            if (!this.openaiClient || openaiKey !== this.openaiKey) {
                this.openaiClient = new OpenAI({ apiKey: openaiKey });
                this.openaiKey = openaiKey;
            }
            return { model: openaiModel, provider: 'openai', client: this.openaiClient };
        }

        // Last resort: Google
        const googleKey = await this.llmKeys.getKey('google');
        const googleModel = roleModelForProvider('vision', 'google');
        if (googleKey && googleModel) {
            return { model: googleModel, provider: 'google', client: null };
        }

        throw new Error('No vision-capable LLM provider configured');
    }
}
