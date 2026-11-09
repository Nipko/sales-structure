import { registerAs } from '@nestjs/config';

export default registerAs('llm', () => ({
    openai: {
        apiKey: process.env.OPENAI_API_KEY || '',
        models: {
            premium: 'gpt-6-sol',
            standard: 'gpt-6-luna',
        },
    },
    anthropic: {
        apiKey: process.env.ANTHROPIC_API_KEY || '',
        models: {
            premium: 'claude-sonnet-5-5',
            standard: 'claude-haiku-5-5',
        },
    },
    google: {
        apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || '',
        models: {
            efficient: 'gemini-3.5-flash-lite',
        },
    },
    xai: {
        apiKey: process.env.XAI_API_KEY || '',
        models: {
            premium: 'grok-4.3',
        },
    },
    deepseek: {
        apiKey: process.env.DEEPSEEK_API_KEY || '',
        models: {
            budget: 'deepseek-flash',
        },
    },
    embeddings: {
        model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
        dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || '1536', 10),
    },
}));
