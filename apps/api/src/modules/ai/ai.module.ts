import { Module } from '@nestjs/common';
import { LLMRouterService } from './router/llm-router.service';
import { OpenAIProvider } from './providers/openai.provider';
import { AnthropicProvider } from './providers/anthropic.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { DeepSeekProvider } from './providers/deepseek.provider';
import { XAIProvider } from './providers/xai.provider';

@Module({
    providers: [
        OpenAIProvider,
        AnthropicProvider,
        GeminiProvider,
        DeepSeekProvider,
        XAIProvider,
        LLMRouterService,
        {
            provide: 'LLM_PROVIDERS',
            useFactory: (openai, anthropic, gemini, deepseek, xai) => [openai, anthropic, gemini, deepseek, xai],
            inject: [OpenAIProvider, AnthropicProvider, GeminiProvider, DeepSeekProvider, XAIProvider]
        }
    ],
    exports: [LLMRouterService],
})
export class AIModule { }
