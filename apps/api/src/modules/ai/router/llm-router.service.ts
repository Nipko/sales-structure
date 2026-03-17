import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModelTier, RoutingFactors, RoutingDecision, RoutingWeights, ChatMessage, ToolDefinition, ToolCall } from '@parallext/shared';
import { ILLMProvider, LLMRequestOptions, LLMResponse } from '../interfaces/illm-provider.interface';

interface ModelConfig {
    id: string;
    provider: string;
    tier: ModelTier;
    costPer1kTokens: number;
    maxContextTokens: number;
}

const MODEL_REGISTRY: ModelConfig[] = [
    // Tier 1 - Premium
    { id: 'gpt-4o', provider: 'openai', tier: 'tier_1_premium', costPer1kTokens: 0.015, maxContextTokens: 128000 },
    { id: 'claude-3-5-sonnet-20241022', provider: 'anthropic', tier: 'tier_1_premium', costPer1kTokens: 0.015, maxContextTokens: 200000 },
    // Tier 2 - Standard
    { id: 'gpt-4o-mini', provider: 'openai', tier: 'tier_2_standard', costPer1kTokens: 0.003, maxContextTokens: 128000 },
    { id: 'gemini-2.5-pro', provider: 'google', tier: 'tier_2_standard', costPer1kTokens: 0.003, maxContextTokens: 1000000 },
    // Tier 3 - Efficient
    { id: 'gemini-2.5-flash', provider: 'google', tier: 'tier_3_efficient', costPer1kTokens: 0.0005, maxContextTokens: 1000000 },
    // Tier 4 - Budget
    { id: 'deepseek-chat', provider: 'deepseek', tier: 'tier_4_budget', costPer1kTokens: 0.0001, maxContextTokens: 64000 },
];

const DEFAULT_WEIGHTS: RoutingWeights = {
    ticketValue: 0.30,
    complexity: 0.30,
    conversationStage: 0.20,
    sentiment: 0.10,
    intentType: 0.10,
};

@Injectable()
export class LLMRouterService {
    private readonly logger = new Logger(LLMRouterService.name);

    constructor(
        private configService: ConfigService,
        @Inject('LLM_PROVIDERS') private providers: ILLMProvider[]
    ) { }

    /**
     * Get a registered provider by name
     */
    getProvider(name: string): ILLMProvider {
        const provider = this.providers.find(p => p.providerName === name);
        if (!provider) {
            throw new Error(`Provider \${name} not found`);
        }
        return provider;
    }

    /**
     * Execute completion against the dynamically selected model
     */
    async execute(options: LLMRequestOptions & { routingFactors?: RoutingFactors, allowedTiers?: ModelTier[] }): Promise<LLMResponse & { routingDecision?: RoutingDecision }> {
        let modelConfig: ModelConfig | undefined;
        let routingDecision: RoutingDecision | undefined;

        if (options.routingFactors) {
            routingDecision = this.selectModel(options.routingFactors, undefined, options.allowedTiers);
            modelConfig = MODEL_REGISTRY.find(m => m.id === routingDecision!.selectedModel.id);
        } else {
            modelConfig = MODEL_REGISTRY.find(m => m.id === options.model);
        }

        if (!modelConfig) {
            // Fallback
            modelConfig = MODEL_REGISTRY[0];
            this.logger.warn(`Model config not found, falling back to ${modelConfig.id}`);
        }

        options.model = modelConfig.id;
        const provider = this.getProvider(modelConfig.provider);
        
        const startTime = Date.now();
        const response = await provider.generate(options);
        const durationMs = Date.now() - startTime;
        
        this.logger.log(`[LLM] Generated via ${provider.providerName} (${modelConfig.id}) in ${durationMs}ms`);

        return { ...response, routingDecision };
    }

    /**
     * Execute streamed completion
     */
    async *executeStream(options: LLMRequestOptions & { routingFactors?: RoutingFactors, allowedTiers?: ModelTier[] }): AsyncGenerator<string, void, unknown> {
        let modelConfig: ModelConfig | undefined;

        if (options.routingFactors) {
            const decision = this.selectModel(options.routingFactors, undefined, options.allowedTiers);
            modelConfig = MODEL_REGISTRY.find(m => m.id === decision.selectedModel.id);
        } else {
            modelConfig = MODEL_REGISTRY.find(m => m.id === options.model);
        }

        if (!modelConfig) {
            modelConfig = MODEL_REGISTRY[0];
        }

        options.model = modelConfig.id;
        const provider = this.getProvider(modelConfig.provider);
        
        yield* provider.generateStream(options);
    }

    /**
     * Select the optimal model based on multi-factor analysis
     */
    selectModel(factors: RoutingFactors, weights?: RoutingWeights, allowedTiers?: ModelTier[]): RoutingDecision {
        const w = weights || DEFAULT_WEIGHTS;

        // Calculate composite score (0-100)
        const compositeScore = Math.round(
            factors.ticketValue * w.ticketValue +
            factors.complexity * w.complexity +
            factors.conversationStage * w.conversationStage +
            factors.sentiment * w.sentiment +
            factors.intentType * w.intentType
        );

        // Map score to tier
        let selectedTier: ModelTier;
        if (compositeScore >= 80) {
            selectedTier = 'tier_1_premium';
        } else if (compositeScore >= 50) {
            selectedTier = 'tier_2_standard';
        } else if (compositeScore >= 25) {
            selectedTier = 'tier_3_efficient';
        } else {
            selectedTier = 'tier_4_budget';
        }

        // Filter by allowed tiers if specified
        if (allowedTiers && !allowedTiers.includes(selectedTier)) {
            selectedTier = allowedTiers[0]; // Default to first allowed tier
        }

        // Select model from tier
        const availableModels = MODEL_REGISTRY.filter(m => m.tier === selectedTier);
        const selectedModel = availableModels[0]; // Primary model in tier

        const decision: RoutingDecision = {
            selectedTier,
            selectedModel: {
                id: selectedModel.id,
                provider: selectedModel.provider as any,
                name: selectedModel.id,
                tier: selectedTier,
                costPer1kTokens: selectedModel.costPer1kTokens,
                maxContextTokens: selectedModel.maxContextTokens,
                supportsTools: true,
                supportsVision: selectedModel.tier === 'tier_1_premium',
            },
            compositeScore,
            factors,
            reasoning: `Score ${compositeScore}/100 → ${selectedTier} → ${selectedModel.id}`,
        };

        this.logger.debug(`Routing decision: ${decision.reasoning}`);
        return decision;
    }

    /**
     * Get fallback model (one tier higher)
     */
    getUpgradedModel(currentTier: ModelTier): ModelConfig | null {
        const tierOrder: ModelTier[] = ['tier_4_budget', 'tier_3_efficient', 'tier_2_standard', 'tier_1_premium'];
        const currentIndex = tierOrder.indexOf(currentTier);

        if (currentIndex >= tierOrder.length - 1) return null;

        const upgradedTier = tierOrder[currentIndex + 1];
        return MODEL_REGISTRY.find(m => m.tier === upgradedTier) || null;
    }

    /**
     * Analyze message complexity
     */
    analyzeComplexity(message: string): number {
        let score = 0;

        // Length factor
        if (message.length > 500) score += 30;
        else if (message.length > 200) score += 20;
        else if (message.length > 50) score += 10;

        // Question marks (multiple questions)
        const questionCount = (message.match(/\?/g) || []).length;
        if (questionCount > 2) score += 25;
        else if (questionCount > 0) score += 10;

        // Technical/specific terms
        const technicalPatterns = /\b(cotiaz|reserv|dispon|precio|factur|pago|devoluci|garant|especific|compar)/gi;
        const technicalMatches = (message.match(technicalPatterns) || []).length;
        score += Math.min(technicalMatches * 10, 30);

        // Multiple topics/intenciones
        const sentences = message.split(/[.!?]+/).filter(s => s.trim().length > 0);
        if (sentences.length > 3) score += 15;

        return Math.min(score, 100);
    }

    /**
     * Analyze sentiment
     */
    analyzeSentiment(message: string): number {
        const lowerMessage = message.toLowerCase();
        let score = 50; // Neutral baseline

        // Frustration indicators → higher score = needs better model
        const frustrationWords = ['molest', 'queja', 'problema', 'mal', 'terrible', 'inaceptable', 'demand', 'urgen'];
        const positiveWords = ['gracias', 'excelente', 'perfecto', 'genial', 'bien', 'bueno'];

        for (const word of frustrationWords) {
            if (lowerMessage.includes(word)) score += 15;
        }
        for (const word of positiveWords) {
            if (lowerMessage.includes(word)) score -= 10;
        }

        return Math.max(0, Math.min(100, score));
    }

    /**
     * Map conversation stage to score
     */
    stageToScore(stage: string): number {
        const stageScores: Record<string, number> = {
            greeting: 10,
            discovery: 40,
            negotiation: 80,
            closing: 90,
            support: 50,
            complaint: 85,
        };
        return stageScores[stage] || 50;
    }

    /**
     * Get all available models
     */
    getModels(): ModelConfig[] {
        return MODEL_REGISTRY;
    }
}
