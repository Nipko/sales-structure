import { registerAs } from '@nestjs/config';

export default registerAs('llm', () => ({
    openai: {
        apiKey: process.env.OPENAI_API_KEY || '',
        models: {
            premium: 'gpt-4o',
            standard: 'gpt-4o-mini',
        },
    },
    anthropic: {
        apiKey: process.env.ANTHROPIC_API_KEY || '',
        models: {
            premium: 'claude-sonnet-4-20250514',
        },
    },
    google: {
        apiKey: process.env.GOOGLE_AI_API_KEY || '',
        models: {
            standard: 'gemini-2.0-pro',
            efficient: 'gemini-2.0-flash',
        },
    },
    xai: {
        apiKey: process.env.XAI_API_KEY || '',
        models: {
            efficient: 'grok-2',
        },
    },
    deepseek: {
        apiKey: process.env.DEEPSEEK_API_KEY || '',
        models: {
            budget: 'deepseek-chat',
        },
    },
    embeddings: {
        model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
        dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || '1536', 10),
    },
}));
