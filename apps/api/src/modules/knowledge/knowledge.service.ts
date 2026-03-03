import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { TenantsService } from '../tenants/tenants.service';
import { RAGConfig } from '@parallext/shared';
// Optional: import OpenAI from 'openai';

@Injectable()
export class KnowledgeService {
    private readonly logger = new Logger(KnowledgeService.name);

    constructor(
        private prisma: PrismaService,
        private configService: ConfigService,
        private tenantsService: TenantsService,
    ) { }

    /**
     * Split text into chunks
     */
    chunkText(text: string, chunkSize = 512, chunkOverlap = 50): string[] {
        const chunks: string[] = [];
        let i = 0;
        while (i < text.length) {
            chunks.push(text.slice(i, i + chunkSize));
            i += chunkSize - chunkOverlap;
        }
        return chunks;
    }

    /**
     * Mock getting embeddings from OpenAI.
     * In a real implementation, you would use new OpenAI().embeddings.create(...)
     */
    async getEmbeddings(texts: string[]): Promise<number[][]> {
        // Generate mock 1536-dimensional vectors
        return texts.map(() => Array.from({ length: 1536 }, () => Math.random() - 0.5));
    }

    /**
     * Get single embedding for search query
     */
    async getEmbedding(text: string): Promise<number[]> {
        const result = await this.getEmbeddings([text]);
        return result[0];
    }

    /**
     * Ingest a document, chunk it, generate embeddings, and store in pgvector
     */
    async ingestDocument(tenantId: string, title: string, text: string, metadata: any = {}) {
        const schemaName = await this.tenantsService.getSchemaName(tenantId);

        // 1. Create document entry
        const document = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO knowledge_documents (id, title, metadata) VALUES (gen_random_uuid(), $1, $2::jsonb) RETURNING *`,
            [title, JSON.stringify(metadata)],
        ).then(res => res[0]);

        if (!document) {
            throw new BadRequestException('Failed to create document');
        }

        // 2. Chunk text
        const chunks = this.chunkText(text);

        // 3. Get embeddings
        const embeddings = await this.getEmbeddings(chunks);

        // 4. Store chunks and embeddings
        for (let i = 0; i < chunks.length; i++) {
            const vectorLiteral = `[${embeddings[i].join(',')}]`;
            await this.prisma.executeInTenantSchema(
                schemaName,
                `INSERT INTO knowledge_embeddings (id, document_id, content, embedding, metadata)
         VALUES (gen_random_uuid(), $1, $2, $3::vector, $4::jsonb)`,
                [document.id, chunks[i], vectorLiteral, JSON.stringify({ chunkIndex: i })],
            );
        }

        this.logger.log(`Ingested document "${title}" for tenant ${tenantId} into ${chunks.length} chunks`);
        return { documentId: document.id, chunksProcessed: chunks.length };
    }

    /**
     * Perform a semantic search across the tenant's knowledge base
     */
    async searchRelevantKnowledge(tenantId: string, query: string, config: RAGConfig): Promise<string[]> {
        if (!config.enabled) return [];

        const schemaName = await this.tenantsService.getSchemaName(tenantId);

        // 1. Embed query
        const queryEmbedding = await this.getEmbedding(query);
        const vectorLiteral = `[${queryEmbedding.join(',')}]`;

        // 2. Perform Cosine Similarity Search via pgvector
        // Using <=> operator for cosine distance (1 - cosine similarity).
        // We order by distance ascending.
        const results = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT content, 1 - (embedding <=> $1::vector) as similarity
       FROM knowledge_embeddings
       WHERE 1 - (embedding <=> $1::vector) > $2
       ORDER BY embedding <=> $1::vector ASC
       LIMIT $3`,
            [vectorLiteral, config.similarityThreshold, config.topK]
        );

        this.logger.debug(`Found ${results.length} relevant chunks for query: "${query}"`);

        return results.map(r => r.content);
    }
}
