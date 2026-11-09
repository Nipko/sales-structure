import { LlmSpendGuardService } from './router/llm-spend-guard.service';
import { Module } from '@nestjs/common';
import { LLMRouterService } from './router/llm-router.service';
import { OpenAIProvider } from './providers/openai.provider';
import { AnthropicProvider } from './providers/anthropic.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { DeepSeekProvider } from './providers/deepseek.provider';
import { XAIProvider } from './providers/xai.provider';
import { SettingsModule } from '../settings/settings.module';
import { LlmProviderHealthService } from './health/llm-provider-health.service';
import { LlmProviderProbeService } from './health/llm-provider-probe.service';

@Module({
    imports: [SettingsModule],
    providers: [
        OpenAIProvider,
        AnthropicProvider,
        GeminiProvider,
        DeepSeekProvider,
        XAIProvider,
        LLMRouterService,
        LlmSpendGuardService,
        LlmProviderHealthService,
        LlmProviderProbeService,
        {
            provide: 'LLM_PROVIDERS',
            useFactory: (openai: OpenAIProvider, anthropic: AnthropicProvider, gemini: GeminiProvider, deepseek: DeepSeekProvider, xai: XAIProvider) => [openai, anthropic, gemini, deepseek, xai],
            inject: [OpenAIProvider, AnthropicProvider, GeminiProvider, DeepSeekProvider, XAIProvider]
        }
    ],
    exports: [LLMRouterService, LlmProviderHealthService, LlmProviderProbeService],
})
export class AIModule { }
