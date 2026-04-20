import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import OpenAI from 'openai';

/** Approximate max characters per chunk (~500 tokens at ~4 chars/token) */
const CHUNK_MAX_CHARS = 2000;
/** Overlap in characters (~50 tokens) */
const CHUNK_OVERLAP_CHARS = 200;
/** Redis TTL for "tenant has knowledge" flag */
const HAS_KNOWLEDGE_TTL = 300; // 5 minutes

@Injectable()
export class KnowledgeService {
    private readonly logger = new Logger(KnowledgeService.name);
    private readonly openai: OpenAI;

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly configService: ConfigService,
    ) {
        this.openai = new OpenAI({
            apiKey: this.configService.get<string>('OPENAI_API_KEY') || '',
        });
    }

    // ─── Document Ingestion ──────────────────────────────────────────────────

    async ingestDocument(
        tenantId: string,
        file: { name: string; content: string; mimeType?: string },
    ) {
        const schema = await this.tenantSchema(tenantId);
        this.logger.log(`Ingesting document "${file.name}" for tenant ${tenantId}`);

        // 1. Create document record
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `INSERT INTO knowledge_documents (title, file_name, file_type, content_text, status)
             VALUES ($1, $2, $3, $4, 'processing') RETURNING *`,
            [file.name, file.name, file.mimeType || 'text/plain', file.content],
        );
        const document = rows[0];

        try {
            // 2. Chunk the content
            const chunks = this.chunkText(file.content);

            // 3. Generate embeddings and store
            for (let i = 0; i < chunks.length; i++) {
                const embedding = await this.generateEmbedding(chunks[i]);
                const embeddingStr = `[${embedding.join(',')}]`;

                await this.prisma.executeInTenantSchema(
                    schema,
                    `INSERT INTO knowledge_embeddings (document_id, chunk_index, chunk_text, embedding, metadata)
                     VALUES ($1, $2, $3, $4::vector, $5::jsonb)`,
                    [
                        document.id,
                        i,
                        chunks[i],
                        embeddingStr,
                        JSON.stringify({ char_offset: i * (CHUNK_MAX_CHARS - CHUNK_OVERLAP_CHARS) }),
                    ],
                );
            }

            // 4. Update document status
            await this.prisma.executeInTenantSchema(
                schema,
                `UPDATE knowledge_documents SET status = 'ready', chunk_count = $2, updated_at = NOW() WHERE id = $1`,
                [document.id, chunks.length],
            );

            // 5. Invalidate Redis cache
            await this.invalidateHasKnowledgeCache(tenantId);

            this.logger.log(`Document "${file.name}" ingested: ${chunks.length} chunks`);
            return { ...document, status: 'ready', chunk_count: chunks.length };
        } catch (error: any) {
            this.logger.error(`Failed to ingest document ${document.id}: ${error.message}`);
            await this.prisma.executeInTenantSchema(
                schema,
                `UPDATE knowledge_documents SET status = 'error', error_message = $2, updated_at = NOW() WHERE id = $1`,
                [document.id, error.message],
            );
            throw error;
        }
    }

    // ─── Vector Search ───────────────────────────────────────────────────────

    /**
     * Hybrid retrieval: vector similarity + keyword ILIKE, merged and scored.
     *
     * - Vector: pgvector cosine distance → similarity = 1 - distance
     * - Keyword: ILIKE boost on the chunk text (flat +0.15 per hit, capped)
     * - Final score = normalized sum, filtered by similarityThreshold
     *
     * Options `topK` and `similarityThreshold` come from the agent's
     * `rag` config — values are respected for the first time here.
     */
    async searchRelevant(
        tenantId: string,
        query: string,
        topK = 5,
        options?: { similarityThreshold?: number; poolSize?: number },
    ): Promise<any[]> {
        const schema = await this.tenantSchema(tenantId);
        const poolSize = Math.max(topK, options?.poolSize ?? topK * 4);
        const similarityThreshold = options?.similarityThreshold ?? 0;

        const queryEmbedding = await this.generateEmbedding(query);
        const embeddingStr = `[${queryEmbedding.join(',')}]`;
        const keywordPattern = `%${query}%`;

        // Pull a larger pool so we can rerank before truncating to topK.
        const results = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT ke.id AS chunk_id, ke.chunk_text, ke.chunk_index, ke.metadata,
                    kd.title AS title, kd.id AS document_id,
                    (ke.embedding <=> $1::vector) AS distance,
                    CASE WHEN ke.chunk_text ILIKE $2 THEN 1 ELSE 0 END AS keyword_hit
             FROM knowledge_embeddings ke
             JOIN knowledge_documents kd ON kd.id = ke.document_id
             WHERE kd.status = 'ready'
             ORDER BY ke.embedding <=> $1::vector
             LIMIT $3`,
            [embeddingStr, keywordPattern, poolSize],
        );

        const KEYWORD_BOOST = 0.15;
        const enriched = results
            .map((r: any) => {
                const vectorScore = 1 - Number(r.distance ?? 0);
                const keywordBoost = r.keyword_hit ? KEYWORD_BOOST : 0;
                const score = Math.min(1, Math.max(0, vectorScore + keywordBoost));
                return {
                    id: r.chunk_id,
                    document_id: r.document_id,
                    title: r.title,
                    chunk_text: r.chunk_text,
                    chunk_index: r.chunk_index,
                    metadata: r.metadata,
                    similarity: vectorScore,
                    keywordHit: !!r.keyword_hit,
                    score,
                };
            })
            .filter(r => r.score >= similarityThreshold)
            .sort((a, b) => b.score - a.score)
            .slice(0, topK);

        return enriched;
    }

    // ─── Document Management ─────────────────────────────────────────────────

    async listDocuments(tenantId: string) {
        const schema = await this.tenantSchema(tenantId);
        return this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT id, title, file_name, file_type, file_size, chunk_count, status, error_message, created_at, updated_at
             FROM knowledge_documents
             ORDER BY created_at DESC`,
        );
    }

    async deleteDocument(tenantId: string, documentId: string) {
        const schema = await this.tenantSchema(tenantId);

        // Embeddings are deleted via ON DELETE CASCADE
        await this.prisma.executeInTenantSchema(
            schema,
            `DELETE FROM knowledge_documents WHERE id = $1`,
            [documentId],
        );

        await this.invalidateHasKnowledgeCache(tenantId);
        this.logger.log(`Deleted document ${documentId} for tenant ${tenantId}`);
    }

    // ─── Tenant Knowledge Check (cached) ─────────────────────────────────────

    async tenantHasKnowledge(tenantId: string): Promise<boolean> {
        const cacheKey = this.redis.tenantKey(tenantId, 'has_knowledge');
        const cached = await this.redis.get(cacheKey);
        if (cached !== null) {
            return cached === '1';
        }

        const schema = await this.tenantSchema(tenantId);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT COUNT(*)::int AS cnt FROM knowledge_embeddings LIMIT 1`,
        );
        const hasKnowledge = rows[0]?.cnt > 0;

        await this.redis.set(cacheKey, hasKnowledge ? '1' : '0', HAS_KNOWLEDGE_TTL);
        return hasKnowledge;
    }

    private async invalidateHasKnowledgeCache(tenantId: string) {
        const cacheKey = this.redis.tenantKey(tenantId, 'has_knowledge');
        await this.redis.del(cacheKey);
    }

    // ─── Chunking ────────────────────────────────────────────────────────────

    private chunkText(text: string): string[] {
        const chunks: string[] = [];

        // Step 1: Split by paragraphs (double newline)
        const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);

        let currentChunk = '';

        for (const paragraph of paragraphs) {
            const trimmed = paragraph.trim();

            // If adding this paragraph exceeds the limit, flush current chunk
            if (currentChunk.length + trimmed.length + 1 > CHUNK_MAX_CHARS && currentChunk.length > 0) {
                chunks.push(currentChunk.trim());
                // Keep overlap from the end of the current chunk
                currentChunk = currentChunk.slice(-CHUNK_OVERLAP_CHARS);
            }

            // If a single paragraph exceeds the limit, split by sentences
            if (trimmed.length > CHUNK_MAX_CHARS) {
                if (currentChunk.length > 0) {
                    chunks.push(currentChunk.trim());
                    currentChunk = currentChunk.slice(-CHUNK_OVERLAP_CHARS);
                }
                const sentenceChunks = this.splitBySentences(trimmed);
                chunks.push(...sentenceChunks);
                currentChunk = sentenceChunks.length > 0
                    ? sentenceChunks[sentenceChunks.length - 1].slice(-CHUNK_OVERLAP_CHARS)
                    : '';
            } else {
                currentChunk += (currentChunk.length > 0 ? '\n\n' : '') + trimmed;
            }
        }

        // Flush remaining
        if (currentChunk.trim().length > 0) {
            chunks.push(currentChunk.trim());
        }

        return chunks;
    }

    private splitBySentences(text: string): string[] {
        const sentences = text.match(/[^.!?]+[.!?]+\s*/g) || [text];
        const chunks: string[] = [];
        let current = '';

        for (const sentence of sentences) {
            if (current.length + sentence.length > CHUNK_MAX_CHARS && current.length > 0) {
                chunks.push(current.trim());
                current = current.slice(-CHUNK_OVERLAP_CHARS);
            }
            current += sentence;
        }

        if (current.trim().length > 0) {
            chunks.push(current.trim());
        }

        return chunks;
    }

    // ─── Embedding ───────────────────────────────────────────────────────────

    private async generateEmbedding(text: string): Promise<number[]> {
        const response = await this.openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: text,
        });
        return response.data[0].embedding;
    }

    // ─── Public Knowledge Base ────────────────────────────────────────────────

    async getPublicArticles(tenantSlug: string): Promise<any[]> {
        const schemaName = await this.resolveSchemaFromSlug(tenantSlug);
        if (!schemaName) return [];

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, title, slug, category, excerpt, content, published_at, updated_at
             FROM knowledge_resources
             WHERE is_public = true AND status = 'ready'
             ORDER BY category, published_at DESC`,
        );

        return rows || [];
    }

    async getPublicArticle(tenantSlug: string, slug: string): Promise<any | null> {
        const schemaName = await this.resolveSchemaFromSlug(tenantSlug);
        if (!schemaName) return null;

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, title, slug, category, excerpt, content, published_at, updated_at
             FROM knowledge_resources
             WHERE is_public = true AND status = 'ready' AND slug = $1
             LIMIT 1`,
            [slug],
        );

        return rows?.[0] || null;
    }

    private async resolveSchemaFromSlug(tenantSlug: string): Promise<string | null> {
        const cacheKey = `tenant:slug:${tenantSlug}:schema`;
        const cached = await this.redis.get(cacheKey);
        if (cached) return cached;

        const tenant = await this.prisma.$queryRaw<any[]>`
            SELECT schema_name FROM tenants WHERE slug = ${tenantSlug} LIMIT 1
        `;
        if (tenant?.[0]) {
            await this.redis.set(cacheKey, tenant[0].schema_name, 3600);
            return tenant[0].schema_name;
        }
        return null;
    }

    // ─── Legacy Resource Methods (backward compat) ───────────────────────────

    async getResources(schemaName: string, status?: string) {
        if (status) {
            return this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT * FROM knowledge_resources WHERE status = $1 ORDER BY created_at DESC`,
                [status],
            );
        }
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM knowledge_resources ORDER BY created_at DESC`,
        );
    }

    async searchChunks(schemaName: string, query: string, limit = 5) {
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT kc.*, kr.title as resource_title, kr.type as resource_type
             FROM knowledge_chunks kc
             JOIN knowledge_resources kr ON kr.id = kc.resource_id
             WHERE kr.status = 'approved' AND kc.content ILIKE $1
             ORDER BY kc.created_at DESC LIMIT $2`,
            [`%${query}%`, limit],
        );
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private async tenantSchema(tenantId: string): Promise<string> {
        return this.prisma.getTenantSchemaName(tenantId);
    }
}
