import { Module } from '@nestjs/common';

@Module({
    // TODO: KnowledgeService
    // - Document upload (PDF, DOCX, TXT, CSV)
    // - Text extraction with pdf-parse
    // - Text chunking (configurable chunk_size and overlap)
    // - Embedding generation via OpenAI text-embedding-3-small
    // - Storage in knowledge_embeddings table with pgvector
    // - Semantic search: query → embed → cosine similarity search
    // - Document management CRUD
})
export class KnowledgeModule { }
