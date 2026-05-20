import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { LlmKeyService } from '../settings/llm-key.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';

export interface VisionResult {
    description: string;
    model: string;
    provider: string;
    costCentsUsd: number;
}

// Vision costs per image (approximate, varies by resolution)
const VISION_COSTS: Record<string, number> = {
    'gemini-2.5-flash': 0.034,     // ~$0.00034/img → 0.034 cents
    'gpt-4o-mini': 0.011,          // ~$0.00011/img → 0.011 cents
    'gpt-4o': 0.19,                // ~$0.0019/img → 0.19 cents
    'grok-4-1-fast-non-reasoning': 0.05, // estimated
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
            max_tokens: 300,
            temperature: 0.3,
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
            if (googleKey) {
                return { model: 'gemini-2.5-flash', provider: 'google', client: null };
            }
        }

        // Higher-tier plans or Google not configured → try xAI (primary)
        const xaiKey = await this.llmKeys.getKey('xai');
        if (xaiKey) {
            if (!this.xaiClient || xaiKey !== this.xaiKey) {
                this.xaiClient = new OpenAI({ apiKey: xaiKey, baseURL: 'https://api.x.ai/v1' });
                this.xaiKey = xaiKey;
            }
            return { model: 'grok-4-1-fast-non-reasoning', provider: 'xai', client: this.xaiClient };
        }

        // Fallback to OpenAI
        const openaiKey = await this.llmKeys.getKey('openai');
        if (openaiKey) {
            if (!this.openaiClient || openaiKey !== this.openaiKey) {
                this.openaiClient = new OpenAI({ apiKey: openaiKey });
                this.openaiKey = openaiKey;
            }
            return { model: 'gpt-4o-mini', provider: 'openai', client: this.openaiClient };
        }

        // Last resort: Google
        const googleKey = await this.llmKeys.getKey('google');
        if (googleKey) {
            return { model: 'gemini-2.5-flash', provider: 'google', client: null };
        }

        throw new Error('No vision-capable LLM provider configured');
    }
}
