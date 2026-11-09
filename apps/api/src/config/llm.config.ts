import { registerAs } from '@nestjs/config';

export default registerAs('llm', () => ({
    openai: {
        apiKey: process.env.OPENAI_API_KEY || '',
    },
    anthropic: {
        apiKey: process.env.ANTHROPIC_API_KEY || '',
    },
    google: {
        apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || '',
    },
    xai: {
        apiKey: process.env.XAI_API_KEY || '',
    },
    deepseek: {
        apiKey: process.env.DEEPSEEK_API_KEY || '',
    },
    embeddings: {
        model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
        dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || '1536', 10),
    },
}));
