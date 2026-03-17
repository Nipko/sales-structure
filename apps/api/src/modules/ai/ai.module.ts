import { Module } from '@nestjs/common';
import { LLMRouterService } from './router/llm-router.service';
import { OpenAIProvider } from './providers/openai.provider';
import { AnthropicProvider } from './providers/anthropic.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { DeepSeekProvider } from './providers/deepseek.provider';

@Module({
    providers: [
        OpenAIProvider,
        AnthropicProvider,
        GeminiProvider,
        DeepSeekProvider,
        LLMRouterService,
        {
            provide: 'LLM_PROVIDERS',
            useFactory: (openai, anthropic, gemini, deepseek) => [openai, anthropic, gemini, deepseek],
            inject: [OpenAIProvider, AnthropicProvider, GeminiProvider, DeepSeekProvider]
        }
    ],
    exports: [LLMRouterService],
})
export class AIModule { }
