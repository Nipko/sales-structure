import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import OpenAI from 'openai';
import axios from 'axios';
import * as crypto from 'crypto';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mammoth = require('mammoth');

const CHUNK_MAX_CHARS = 2000;
const CHUNK_OVERLAP_CHARS = 200;
const HAS_KNOWLEDGE_TTL = 300;
const CRAWL_TIMEOUT_MS = 15_000;
const CRAWL_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

@Injectable()
export class KnowledgeService {
    private readonly logger = new Logger(KnowledgeService.name);
    private readonly openai: OpenAI;

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly configService: ConfigService,
        private readonly throttle: TenantThrottleService,
    ) {
        this.openai = new OpenAI({
            apiKey: this.configService.get<string>('OPENAI_API_KEY') || '',
        });
    }

    // ─── Document Ingestion ──────────────────────────────────────────────────

    async ingestDocument(
        tenantId: string,
        file: {
            name: string;
            content?: string;
            fileBase64?: string;
            mimeType?: string;
            sourceType?: 'upload' | 'url';
            sourceUrl?: string;
            category?: string;
            isPublic?: boolean;
        },
    ) {
        const schema = await this.tenantSchema(tenantId);

        let textContent = file.content || '';
        if (!textContent && file.fileBase64) {
            textContent = await this.parseFileContent(file.fileBase64, file.mimeType || 'application/octet-stream', file.name);
        }
        if (!textContent.trim()) {
            throw new Error('No extractable text found in document. Ensure the file contains readable text (not scanned images).');
        }

        const cnt = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT COUNT(*)::int AS c FROM knowledge_documents WHERE status != 'deleted'`);
        await this.throttle.enforcePlanLimit(tenantId, 'knowledgeArticles', cnt?.[0]?.c || 0, 'documentos de conocimiento');

        this.logger.log(`Ingesting document "${file.name}" for tenant ${tenantId} (${textContent.length} chars)`);

        const contentHash = crypto.createHash('sha256').update(textContent).digest('hex').substring(0, 16);

        const slug = file.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 200);
        const excerpt = textContent.substring(0, 300).replace(/\s+/g, ' ').trim();

        const detectedLang = this.detectLanguage(textContent);

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `INSERT INTO knowledge_documents (title, file_name, file_type, content_text, status, source_type, source_url, crawl_hash, category, is_public, slug, excerpt, language)
             VALUES ($1, $2, $3, $4, 'processing', $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
            [file.name, file.name, file.mimeType || 'text/plain', textContent,
             file.sourceType || 'upload', file.sourceUrl || null, contentHash,
             file.category || null, file.isPublic ?? false, slug, excerpt, detectedLang],
        );
        const document = rows[0];

        try {
            await this.embedAndStoreChunks(schema, document.id, textContent);

            const chunks = this.chunkText(textContent);
            await this.prisma.executeInTenantSchema(
                schema,
                `UPDATE knowledge_documents SET status = 'ready', chunk_count = $2, updated_at = NOW() WHERE id = $1::uuid`,
                [document.id, chunks.length],
            );

            await this.invalidateHasKnowledgeCache(tenantId);

            this.logger.log(`Document "${file.name}" ingested: ${chunks.length} chunks`);
            return { ...document, status: 'ready', chunk_count: chunks.length };
        } catch (error: any) {
            this.logger.error(`Failed to ingest document ${document.id}: ${error.message}`);
            await this.prisma.executeInTenantSchema(
                schema,
                `UPDATE knowledge_documents SET status = 'error', error_message = $2, updated_at = NOW() WHERE id = $1::uuid`,
                [document.id, error.message],
            );
            throw error;
        }
    }

    // ─── URL Crawling ────────────────────────────────────────────────────────

    async crawlUrl(tenantId: string, url: string, title?: string, category?: string) {
        const features = await this.throttle.getPlanFeatures(tenantId);
        const crawlLimit = features.knowledgeCrawlPages ?? 0;

        if (crawlLimit === 0) {
            throw new ForbiddenException({
                error: 'plan_upgrade_required',
                message: 'Tu plan no incluye la importación de URLs. Actualizá a Starter o superior.',
            });
        }

        const schema = await this.tenantSchema(tenantId);
        if (crawlLimit !== -1) {
            const crawled = await this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS c FROM knowledge_documents WHERE source_type = 'url' AND status != 'deleted'`);
            if ((crawled?.[0]?.c || 0) >= crawlLimit) {
                throw new ForbiddenException({
                    error: 'crawl_limit_reached',
                    message: `Tu plan permite hasta ${crawlLimit} páginas importadas. Actualizá tu plan para agregar más.`,
                });
            }
        }

        let parsedUrl: URL;
        try {
            parsedUrl = new URL(url);
            if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('Invalid protocol');
        } catch {
            throw new BadRequestException({ error: 'invalid_url', message: 'La URL proporcionada no es válida.' });
        }

        this.logger.log(`[Crawl] Fetching ${url} for tenant ${tenantId}`);

        const response = await axios.get(url, {
            timeout: CRAWL_TIMEOUT_MS,
            maxContentLength: CRAWL_MAX_BYTES,
            headers: {
                'User-Agent': 'ParallextBot/1.0 (+https://parallly-chat.cloud)',
                Accept: 'text/html,application/xhtml+xml,text/plain',
            },
            responseType: 'text',
        });

        const contentType = (response.headers['content-type'] || '').toLowerCase();
        let textContent: string;

        if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
            textContent = this.extractTextFromHtml(response.data);
        } else {
            textContent = typeof response.data === 'string' ? response.data : String(response.data);
        }

        if (!textContent.trim() || textContent.trim().length < 50) {
            throw new BadRequestException({ error: 'no_content', message: 'No se pudo extraer contenido útil de la URL.' });
        }

        const docTitle = title || this.extractTitleFromHtml(response.data) || parsedUrl.hostname + parsedUrl.pathname;

        return this.ingestDocument(tenantId, {
            name: docTitle,
            content: textContent,
            mimeType: 'text/html',
            sourceType: 'url',
            sourceUrl: url,
            category,
        });
    }

    async recrawlUrl(tenantId: string, documentId: string) {
        const schema = await this.tenantSchema(tenantId);
        const docs = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT id, source_url, title, crawl_hash FROM knowledge_documents WHERE id = $1::uuid AND source_type = 'url'`,
            [documentId]);
        if (!docs?.[0]) throw new BadRequestException({ error: 'not_url_doc', message: 'Este documento no fue importado desde una URL.' });

        const doc = docs[0];
        const response = await axios.get(doc.source_url, {
            timeout: CRAWL_TIMEOUT_MS,
            maxContentLength: CRAWL_MAX_BYTES,
            headers: { 'User-Agent': 'ParallextBot/1.0 (+https://parallly-chat.cloud)', Accept: 'text/html,application/xhtml+xml,text/plain' },
            responseType: 'text',
        });

        const contentType = (response.headers['content-type'] || '').toLowerCase();
        const textContent = contentType.includes('text/html') || contentType.includes('application/xhtml')
            ? this.extractTextFromHtml(response.data) : response.data;

        const newHash = crypto.createHash('sha256').update(textContent).digest('hex').substring(0, 16);
        if (newHash === doc.crawl_hash) {
            await this.prisma.executeInTenantSchema(schema,
                `UPDATE knowledge_documents SET last_crawled_at = NOW() WHERE id = $1::uuid`, [documentId]);
            return { changed: false, documentId };
        }

        return this.updateDocument(tenantId, documentId, { content: textContent, crawlHash: newHash });
    }

    // ─── Document Update (in-place re-chunk) ─────────────────────────────────

    async updateDocument(
        tenantId: string,
        documentId: string,
        update: {
            name?: string; content?: string; fileBase64?: string; mimeType?: string; crawlHash?: string;
            category?: string; isPublic?: boolean; autoRecrawl?: boolean;
            changedBy?: string; changeSummary?: string;
        },
    ) {
        const schema = await this.tenantSchema(tenantId);

        const existing = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT id, title, file_type FROM knowledge_documents WHERE id = $1::uuid`, [documentId]);
        if (!existing?.[0]) throw new BadRequestException({ error: 'document_not_found' });

        let textContent = update.content || '';
        if (!textContent && update.fileBase64) {
            textContent = await this.parseFileContent(
                update.fileBase64, update.mimeType || existing[0].file_type || 'application/octet-stream', update.name || existing[0].title,
            );
        }
        if (!textContent.trim()) {
            throw new BadRequestException({ error: 'empty_content', message: 'El contenido del documento está vacío.' });
        }

        const contentHash = update.crawlHash || crypto.createHash('sha256').update(textContent).digest('hex').substring(0, 16);

        // Save current version before overwriting
        const currentVersion = existing[0].version || 1;
        await this.prisma.executeInTenantSchema(schema,
            `INSERT INTO knowledge_document_versions (document_id, version, title, content_text, chunk_count, changed_by, change_summary)
             SELECT id, COALESCE(version, 1), title, content_text, chunk_count, $2, $3
             FROM knowledge_documents WHERE id = $1::uuid`,
            [documentId, update.changedBy || null, update.changeSummary || null]);

        const newVersion = currentVersion + 1;

        await this.prisma.executeInTenantSchema(schema,
            `UPDATE knowledge_documents SET status = 'processing', updated_at = NOW() WHERE id = $1::uuid`, [documentId]);

        try {
            await this.prisma.executeInTenantSchema(schema,
                `DELETE FROM knowledge_embeddings WHERE document_id = $1::uuid`, [documentId]);

            await this.embedAndStoreChunks(schema, documentId, textContent);
            const chunks = this.chunkText(textContent);

            const slug = (update.name || existing[0].title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 200);
            const excerpt = textContent.substring(0, 300).replace(/\s+/g, ' ').trim();
            const detectedLang = this.detectLanguage(textContent);

            await this.prisma.executeInTenantSchema(schema,
                `UPDATE knowledge_documents
                 SET title = COALESCE($2, title), content_text = $3, chunk_count = $4,
                     status = 'ready', crawl_hash = $5,
                     last_crawled_at = CASE WHEN source_type = 'url' THEN NOW() ELSE last_crawled_at END,
                     category = COALESCE($6, category),
                     is_public = COALESCE($7, is_public),
                     auto_recrawl = COALESCE($8, auto_recrawl),
                     slug = $9, excerpt = $10,
                     version = $11, language = $12,
                     updated_at = NOW()
                 WHERE id = $1::uuid`,
                [documentId, update.name || null, textContent, chunks.length, contentHash,
                 update.category !== undefined ? update.category : null,
                 update.isPublic !== undefined ? update.isPublic : null,
                 update.autoRecrawl !== undefined ? update.autoRecrawl : null,
                 slug, excerpt, newVersion, detectedLang]);

            await this.invalidateHasKnowledgeCache(tenantId);
            this.logger.log(`Document ${documentId} updated to v${newVersion}: ${chunks.length} chunks re-embedded`);
            return { documentId, chunkCount: chunks.length, status: 'ready', version: newVersion };
        } catch (error: any) {
            await this.prisma.executeInTenantSchema(schema,
                `UPDATE knowledge_documents SET status = 'error', error_message = $2, updated_at = NOW() WHERE id = $1::uuid`,
                [documentId, error.message]);
            throw error;
        }
    }

    // ─── Bulk Import ─────────────────────────────────────────────────────────

    async bulkIngest(
        tenantId: string,
        files: Array<{
            name: string;
            content?: string;
            fileBase64?: string;
            mimeType?: string;
            category?: string;
            isPublic?: boolean;
        }>,
    ) {
        const results: Array<{ name: string; status: 'ok' | 'error'; error?: string; documentId?: string; chunkCount?: number }> = [];

        for (const file of files) {
            try {
                const doc = await this.ingestDocument(tenantId, file);
                results.push({ name: file.name, status: 'ok', documentId: doc.id, chunkCount: doc.chunk_count });
            } catch (e: any) {
                this.logger.warn(`[BulkIngest] Failed "${file.name}": ${e.message}`);
                results.push({ name: file.name, status: 'error', error: e.message });
            }
        }

        return {
            total: files.length,
            succeeded: results.filter(r => r.status === 'ok').length,
            failed: results.filter(r => r.status === 'error').length,
            results,
        };
    }

    // ─── Content Quality Scoring ─────────────────────────────────────────────

    async getDocumentQualityScores(tenantId: string) {
        const schema = await this.tenantSchema(tenantId);

        const docs = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT kd.id, kd.title, kd.chunk_count, kd.status,
                    LENGTH(kd.content_text) AS content_length,
                    kd.category, kd.source_type,
                    COALESCE(stats.retrieval_count, 0)::int AS retrieval_count,
                    COALESCE(stats.avg_score, 0) AS avg_score,
                    COALESCE(stats.used_count, 0)::int AS used_count
             FROM knowledge_documents kd
             LEFT JOIN LATERAL (
                 SELECT COUNT(*)::int AS retrieval_count,
                        ROUND(AVG(score)::numeric, 3) AS avg_score,
                        COUNT(CASE WHEN was_used THEN 1 END)::int AS used_count
                 FROM kb_retrieval_log
                 WHERE document_id = kd.id
                   AND created_at >= NOW() - INTERVAL '30 days'
             ) stats ON true
             WHERE kd.status != 'deleted'
             ORDER BY kd.created_at DESC`);

        return (docs || []).map((d: any) => {
            let score = 0;
            const factors: Record<string, number> = {};

            // Content length (0-25 pts): 500+ chars = full marks
            const lenPts = Math.min(25, Math.round((d.content_length || 0) / 500 * 25));
            factors.contentLength = lenPts;
            score += lenPts;

            // Chunk count (0-20 pts): 3+ chunks = full marks
            const chunkPts = Math.min(20, (d.chunk_count || 0) * 7);
            factors.chunkCount = chunkPts;
            score += chunkPts;

            // Category assigned (0-10 pts)
            const catPts = d.category ? 10 : 0;
            factors.categorized = catPts;
            score += catPts;

            // Retrieval performance (0-25 pts)
            const retPts = Math.min(25, d.retrieval_count * 5);
            factors.retrievals = retPts;
            score += retPts;

            // Avg relevance score (0-20 pts)
            const relPts = Math.round((Number(d.avg_score) || 0) * 20);
            factors.relevance = relPts;
            score += relPts;

            return {
                id: d.id,
                title: d.title,
                qualityScore: Math.min(100, score),
                factors,
                stats: {
                    contentLength: d.content_length || 0,
                    chunkCount: d.chunk_count || 0,
                    retrievalCount: d.retrieval_count,
                    avgScore: Number(d.avg_score) || 0,
                    usedCount: d.used_count,
                    hasCategoryFlag: !!d.category,
                },
            };
        });
    }

    // ─── AI Article Suggestions ──────────────────────────────────────────────

    async generateArticleSuggestions(tenantId: string, maxSuggestions = 5) {
        const schema = await this.tenantSchema(tenantId);

        const unanswered = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT query, occurrences FROM kb_unanswered_queries
             WHERE resolved = false
             ORDER BY occurrences DESC, last_seen_at DESC
             LIMIT 20`);

        if (!unanswered?.length) return { suggestions: [], message: 'No hay queries sin respuesta para analizar.' };

        const existingDocs = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT title, category FROM knowledge_documents WHERE status = 'ready' ORDER BY created_at DESC LIMIT 30`);

        const queryList = unanswered.map((q: any) => `- "${q.query}" (${q.occurrences}x)`).join('\n');
        const docList = (existingDocs || []).map((d: any) => `- ${d.title}${d.category ? ` [${d.category}]` : ''}`).join('\n');

        try {
            const completion = await this.openai.chat.completions.create({
                model: 'gpt-4o-mini',
                temperature: 0.4,
                max_tokens: 1500,
                messages: [
                    {
                        role: 'system',
                        content: `You are a knowledge base content strategist. Analyze unanswered customer queries and suggest new articles to write. Output valid JSON only, no markdown.`,
                    },
                    {
                        role: 'user',
                        content: `Unanswered queries (sorted by frequency):\n${queryList}\n\nExisting articles:\n${docList || '(none)'}\n\nSuggest up to ${maxSuggestions} new articles. For each, provide:\n- title: article title (in Spanish)\n- category: suggested category\n- outline: 2-3 bullet points of what to cover\n- queriesCovered: which queries this would answer\n- priority: "high" | "medium" | "low"\n\nReturn JSON array: [{"title","category","outline":[],"queriesCovered":[],"priority"}]`,
                    },
                ],
            });

            const text = completion.choices[0]?.message?.content?.trim() || '[]';
            const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            const suggestions = JSON.parse(cleaned);
            return { suggestions: Array.isArray(suggestions) ? suggestions.slice(0, maxSuggestions) : [], queriesAnalyzed: unanswered.length };
        } catch (e: any) {
            this.logger.error(`[AI Suggestions] LLM call failed: ${e.message}`);
            return { suggestions: [], error: e.message };
        }
    }

    // ─── Document Versioning ────────────────────────────────────────────────

    async getDocumentVersions(tenantId: string, documentId: string) {
        const schema = await this.tenantSchema(tenantId);
        return this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT id, version, title, chunk_count, changed_by, change_summary, created_at
             FROM knowledge_document_versions
             WHERE document_id = $1::uuid
             ORDER BY version DESC`,
            [documentId]);
    }

    async restoreDocumentVersion(tenantId: string, documentId: string, versionId: string, userId?: string) {
        const schema = await this.tenantSchema(tenantId);

        const versions = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT id, version, title, content_text, chunk_count FROM knowledge_document_versions WHERE id = $1::uuid AND document_id = $2::uuid`,
            [versionId, documentId]);
        if (!versions?.[0]) throw new BadRequestException({ error: 'version_not_found' });

        const v = versions[0];
        return this.updateDocument(tenantId, documentId, {
            name: v.title,
            content: v.content_text,
            changedBy: userId || undefined,
            changeSummary: `Restored to v${v.version}`,
        });
    }

    // ─── Language Detection ─────────────────────────────────────────────────

    private detectLanguage(text: string): string {
        const sample = text.substring(0, 1000).toLowerCase();

        const patterns: Record<string, RegExp[]> = {
            es: [/\b(el|la|los|las|de|en|que|por|con|para|como|está|tiene|puede|muy|también|más|pero|este|esta|son)\b/g],
            en: [/\b(the|is|are|was|were|have|has|had|will|would|can|could|with|from|this|that|which|been|their|about)\b/g],
            pt: [/\b(o|a|os|as|de|em|que|por|com|para|como|está|tem|pode|muito|também|mais|mas|este|esta|são)\b/g],
            fr: [/\b(le|la|les|de|en|que|pour|avec|dans|est|sont|qui|pas|une|des|plus|mais|cette|nous|vous)\b/g],
        };

        let bestLang = 'es';
        let bestCount = 0;

        for (const [lang, regexps] of Object.entries(patterns)) {
            let count = 0;
            for (const re of regexps) {
                const matches = sample.match(re);
                count += matches?.length || 0;
            }
            if (count > bestCount) {
                bestCount = count;
                bestLang = lang;
            }
        }

        return bestCount >= 3 ? bestLang : 'auto';
    }

    // ─── Advanced Search (filtered) ─────────────────────────────────────────

    async searchFiltered(
        tenantId: string,
        query: string,
        filters: { category?: string; sourceType?: string; language?: string; dateFrom?: string; dateTo?: string; topK?: number },
    ) {
        const schema = await this.tenantSchema(tenantId);
        const topK = filters.topK || 10;

        const queryEmbedding = await this.generateEmbedding(query);
        const embeddingStr = `[${queryEmbedding.join(',')}]`;

        const conditions: string[] = [`kd.status = 'ready'`];
        const params: any[] = [embeddingStr];
        let idx = 2;

        if (filters.category) {
            conditions.push(`kd.category = $${idx}`);
            params.push(filters.category);
            idx++;
        }
        if (filters.sourceType) {
            conditions.push(`kd.source_type = $${idx}`);
            params.push(filters.sourceType);
            idx++;
        }
        if (filters.language && filters.language !== 'all') {
            conditions.push(`kd.language = $${idx}`);
            params.push(filters.language);
            idx++;
        }
        if (filters.dateFrom) {
            conditions.push(`kd.created_at >= $${idx}::timestamp`);
            params.push(filters.dateFrom);
            idx++;
        }
        if (filters.dateTo) {
            conditions.push(`kd.created_at <= $${idx}::timestamp`);
            params.push(filters.dateTo);
            idx++;
        }

        params.push(topK);

        const results = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT ke.id AS chunk_id, ke.chunk_text, ke.chunk_index,
                    kd.title, kd.id AS document_id, kd.category, kd.source_type, kd.language, kd.created_at,
                    (ke.embedding <=> $1::vector) AS distance
             FROM knowledge_embeddings ke
             JOIN knowledge_documents kd ON kd.id = ke.document_id
             WHERE ${conditions.join(' AND ')}
             ORDER BY ke.embedding <=> $1::vector
             LIMIT $${idx}`,
            params,
        );

        return (results || []).map((r: any) => ({
            id: r.chunk_id,
            document_id: r.document_id,
            title: r.title,
            chunk_text: r.chunk_text,
            chunk_index: r.chunk_index,
            category: r.category,
            sourceType: r.source_type,
            language: r.language,
            createdAt: r.created_at,
            score: Math.max(0, 1 - Number(r.distance ?? 0)),
        }));
    }

    // ─── Vector Search ───────────────────────────────────────────────────────

    async searchRelevant(
        tenantId: string,
        query: string,
        topK = 5,
        options?: { similarityThreshold?: number; poolSize?: number; conversationId?: string },
    ): Promise<any[]> {
        const schema = await this.tenantSchema(tenantId);
        const poolSize = Math.max(topK, options?.poolSize ?? topK * 4);
        const similarityThreshold = options?.similarityThreshold ?? 0;

        const queryEmbedding = await this.generateEmbedding(query);
        const embeddingStr = `[${queryEmbedding.join(',')}]`;
        const keywordPattern = `%${query}%`;

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

        // Fire-and-forget analytics tracking
        this.trackRetrieval(schema, tenantId, query, enriched, similarityThreshold, options?.conversationId).catch(() => {});

        return enriched;
    }

    // ─── KB Analytics ────────────────────────────────────────────────────────

    private async trackRetrieval(
        schema: string, tenantId: string, query: string,
        results: any[], threshold: number, conversationId?: string,
    ) {
        try {
            if (results.length === 0) {
                const queryHash = crypto.createHash('sha256').update(query.toLowerCase().trim()).digest('hex').substring(0, 16);
                await this.prisma.executeInTenantSchema(schema,
                    `INSERT INTO kb_unanswered_queries (query, query_hash, occurrences, last_seen_at)
                     VALUES ($1, $2, 1, NOW())
                     ON CONFLICT (query_hash) WHERE resolved = false
                     DO UPDATE SET occurrences = kb_unanswered_queries.occurrences + 1, last_seen_at = NOW()`,
                    [query.substring(0, 500), queryHash]);
            }

            for (const r of results.slice(0, 10)) {
                await this.prisma.executeInTenantSchema(schema,
                    `INSERT INTO kb_retrieval_log (document_id, chunk_id, query, score, was_used, conversation_id)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [r.document_id, r.id, query.substring(0, 500), r.score,
                     r.score >= threshold, conversationId || null]);
            }
        } catch (e: any) {
            this.logger.warn(`[KB Analytics] tracking failed (non-fatal): ${e.message}`);
        }
    }

    async getAnalytics(tenantId: string, days = 30) {
        const schema = await this.tenantSchema(tenantId);
        const since = new Date(Date.now() - days * 86_400_000).toISOString();

        const [topDocs, totalQueries, unanswered, avgScore, dailyVolume] = await Promise.all([
            this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT kd.id, kd.title, kd.source_type,
                        COUNT(krl.id)::int AS retrieval_count,
                        COUNT(CASE WHEN krl.was_used THEN 1 END)::int AS used_count,
                        ROUND(AVG(krl.score)::numeric, 3) AS avg_score
                 FROM kb_retrieval_log krl
                 JOIN knowledge_documents kd ON kd.id = krl.document_id
                 WHERE krl.created_at >= $1::timestamp
                 GROUP BY kd.id, kd.title, kd.source_type
                 ORDER BY retrieval_count DESC LIMIT 20`,
                [since]),

            this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(DISTINCT query)::int AS total,
                        COUNT(CASE WHEN was_used THEN 1 END)::int AS hits,
                        COUNT(*)::int AS total_retrievals
                 FROM kb_retrieval_log WHERE created_at >= $1::timestamp`,
                [since]),

            this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT id, query, occurrences, last_seen_at
                 FROM kb_unanswered_queries
                 WHERE resolved = false AND last_seen_at >= $1::timestamp
                 ORDER BY occurrences DESC LIMIT 20`,
                [since]),

            this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT ROUND(AVG(score)::numeric, 3) AS avg,
                        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY score)::numeric, 3) AS median
                 FROM kb_retrieval_log WHERE created_at >= $1::timestamp AND was_used = true`,
                [since]),

            this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT DATE(created_at) AS day,
                        COUNT(*)::int AS queries,
                        COUNT(CASE WHEN was_used THEN 1 END)::int AS hits
                 FROM kb_retrieval_log
                 WHERE created_at >= $1::timestamp
                 GROUP BY DATE(created_at)
                 ORDER BY day DESC LIMIT 30`,
                [since]),
        ]);

        const total = totalQueries?.[0]?.total || 0;
        const hits = totalQueries?.[0]?.hits || 0;
        const hitRate = total > 0 ? Math.round((hits / (totalQueries?.[0]?.total_retrievals || 1)) * 100) : 0;

        return {
            period: { days, since },
            overview: {
                uniqueQueries: total,
                totalRetrievals: totalQueries?.[0]?.total_retrievals || 0,
                hitRate,
                avgScore: avgScore?.[0]?.avg ?? 0,
                medianScore: avgScore?.[0]?.median ?? 0,
            },
            topDocuments: topDocs || [],
            unansweredQueries: unanswered || [],
            dailyVolume: dailyVolume || [],
        };
    }

    async resolveUnansweredQuery(tenantId: string, queryId: string) {
        const schema = await this.tenantSchema(tenantId);
        await this.prisma.executeInTenantSchema(schema,
            `UPDATE kb_unanswered_queries SET resolved = true WHERE id = $1::uuid`, [queryId]);
    }

    // ─── Document Management ─────────────────────────────────────────────────

    async listDocuments(tenantId: string, category?: string, language?: string) {
        const schema = await this.tenantSchema(tenantId);
        const conditions: string[] = [];
        const params: any[] = [];
        let idx = 1;

        if (category) {
            conditions.push(`category = $${idx}`);
            params.push(category);
            idx++;
        }
        if (language && language !== 'all') {
            conditions.push(`language = $${idx}`);
            params.push(language);
            idx++;
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        return this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT id, title, file_name, file_type, file_size, chunk_count, status, error_message,
                    source_type, source_url, last_crawled_at, category, is_public, slug, excerpt,
                    auto_recrawl, language, version, created_at, updated_at, content_text
             FROM knowledge_documents
             ${where}
             ORDER BY created_at DESC`,
            params);
    }

    async getDocumentCategories(tenantId: string): Promise<string[]> {
        const schema = await this.tenantSchema(tenantId);
        const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT DISTINCT category FROM knowledge_documents WHERE category IS NOT NULL AND status = 'ready' ORDER BY category`);
        return (rows || []).map(r => r.category);
    }

    async deleteDocument(tenantId: string, documentId: string) {
        const schema = await this.tenantSchema(tenantId);
        await this.prisma.executeInTenantSchema(
            schema,
            `DELETE FROM knowledge_documents WHERE id = $1::uuid`,
            [documentId],
        );
        await this.invalidateHasKnowledgeCache(tenantId);
        this.logger.log(`Deleted document ${documentId} for tenant ${tenantId}`);
    }

    async updateDocumentMeta(
        tenantId: string,
        documentId: string,
        meta: { category?: string; isPublic?: boolean; autoRecrawl?: boolean; name?: string },
    ) {
        const schema = await this.tenantSchema(tenantId);
        const sets: string[] = ['updated_at = NOW()'];
        const params: any[] = [documentId];
        let idx = 2;

        if (meta.name !== undefined) { sets.push(`title = $${idx}`); params.push(meta.name); idx++; }
        if (meta.category !== undefined) { sets.push(`category = $${idx}`); params.push(meta.category || null); idx++; }
        if (meta.isPublic !== undefined) { sets.push(`is_public = $${idx}`); params.push(meta.isPublic); idx++; }
        if (meta.autoRecrawl !== undefined) { sets.push(`auto_recrawl = $${idx}`); params.push(meta.autoRecrawl); idx++; }

        if (meta.name !== undefined) {
            const slug = meta.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 200);
            sets.push(`slug = $${idx}`);
            params.push(slug);
            idx++;
        }

        await this.prisma.executeInTenantSchema(schema,
            `UPDATE knowledge_documents SET ${sets.join(', ')} WHERE id = $1::uuid`, params);

        return { success: true };
    }

    // ─── Tenant Knowledge Check (cached) ─────────────────────────────────────

    async tenantHasKnowledge(tenantId: string): Promise<boolean> {
        const cacheKey = this.redis.tenantKey(tenantId, 'has_knowledge');
        const cached = await this.redis.get(cacheKey);
        if (cached !== null) return cached === '1';

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
        await this.redis.del(this.redis.tenantKey(tenantId, 'has_knowledge'));
    }

    // ─── Chunking & Embedding ────────────────────────────────────────────────

    private async embedAndStoreChunks(schema: string, documentId: string, text: string) {
        const chunks = this.chunkText(text);
        for (let i = 0; i < chunks.length; i++) {
            const embedding = await this.generateEmbedding(chunks[i]);
            const embeddingStr = `[${embedding.join(',')}]`;
            await this.prisma.executeInTenantSchema(
                schema,
                `INSERT INTO knowledge_embeddings (document_id, chunk_index, chunk_text, embedding, metadata)
                 VALUES ($1, $2, $3, $4::vector, $5::jsonb)`,
                [documentId, i, chunks[i], embeddingStr,
                 JSON.stringify({ char_offset: i * (CHUNK_MAX_CHARS - CHUNK_OVERLAP_CHARS) })],
            );
        }
        return chunks.length;
    }

    private chunkText(text: string): string[] {
        const chunks: string[] = [];
        const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
        let currentChunk = '';

        for (const paragraph of paragraphs) {
            const trimmed = paragraph.trim();

            if (currentChunk.length + trimmed.length + 1 > CHUNK_MAX_CHARS && currentChunk.length > 0) {
                chunks.push(currentChunk.trim());
                currentChunk = currentChunk.slice(-CHUNK_OVERLAP_CHARS);
            }

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

        if (currentChunk.trim().length > 0) chunks.push(currentChunk.trim());
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
        if (current.trim().length > 0) chunks.push(current.trim());
        return chunks;
    }

    // ─── File Parsing ────────────────────────────────────────────────────────

    async parseFileContent(base64: string, mimeType: string, fileName = ''): Promise<string> {
        const buffer = Buffer.from(base64, 'base64');
        const mime = mimeType.toLowerCase();
        const ext = fileName.split('.').pop()?.toLowerCase() || '';

        if (mime === 'application/pdf' || ext === 'pdf') {
            try {
                const data = await pdfParse(buffer);
                const text = (data.text || '').replace(/\x00/g, ' ').trim();
                if (!text) throw new Error('pdf-parse returned empty text — file may be image-based (scanned)');
                this.logger.log(`[Parse] PDF parsed: ${data.numpages} pages, ${text.length} chars`);
                return text;
            } catch (e: any) {
                throw new Error(`PDF parsing failed: ${e.message}`);
            }
        }

        if (
            mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            mime === 'application/msword' ||
            ext === 'docx' || ext === 'doc'
        ) {
            try {
                const result = await mammoth.extractRawText({ buffer });
                const text = (result.value || '').trim();
                if (!text) throw new Error('mammoth returned empty text');
                this.logger.log(`[Parse] DOCX parsed: ${text.length} chars`);
                return text;
            } catch (e: any) {
                throw new Error(`DOCX parsing failed: ${e.message}`);
            }
        }

        if (mime.startsWith('text/') || ext === 'txt' || ext === 'md' || ext === 'csv') {
            return buffer.toString('utf-8');
        }

        this.logger.warn(`[Parse] Unknown mimeType "${mimeType}" for "${fileName}" — attempting UTF-8 decode`);
        return buffer.toString('utf-8');
    }

    // ─── HTML Extraction ─────────────────────────────────────────────────────

    private extractTextFromHtml(html: string): string {
        let text = html;
        text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
        text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
        text = text.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '');
        text = text.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');
        text = text.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '');
        text = text.replace(/<!--[\s\S]*?-->/g, '');
        text = text.replace(/<(h[1-6]|p|br|div|li|tr|blockquote)[^>]*>/gi, '\n');
        text = text.replace(/<[^>]+>/g, ' ');
        text = text.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
                   .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
        text = text.replace(/[ \t]+/g, ' ');
        text = text.replace(/\n\s*\n\s*\n/g, '\n\n');
        return text.trim();
    }

    private extractTitleFromHtml(html: string): string | null {
        const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        if (match?.[1]) return match[1].replace(/<[^>]+>/g, '').trim().substring(0, 200);

        const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
        if (h1?.[1]) return h1[1].replace(/<[^>]+>/g, '').trim().substring(0, 200);

        return null;
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

        const [legacy, docs] = await Promise.all([
            this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT id, title, slug, category, excerpt, content, published_at, updated_at, 'resource' AS _source
                 FROM knowledge_resources
                 WHERE is_public = true AND status = 'ready'
                 ORDER BY category, published_at DESC`).catch(() => []),
            this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT id, title, slug, category, excerpt, content_text AS content, created_at AS published_at, updated_at, 'document' AS _source
                 FROM knowledge_documents
                 WHERE is_public = true AND status = 'ready'
                 ORDER BY category, created_at DESC`).catch(() => []),
        ]);

        return [...(legacy || []), ...(docs || [])];
    }

    async getPublicArticle(tenantSlug: string, slug: string): Promise<any | null> {
        const schemaName = await this.resolveSchemaFromSlug(tenantSlug);
        if (!schemaName) return null;

        const legacy = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT id, title, slug, category, excerpt, content, published_at, updated_at
             FROM knowledge_resources WHERE is_public = true AND status = 'ready' AND slug = $1 LIMIT 1`,
            [slug]).catch(() => []);
        if (legacy?.[0]) return legacy[0];

        const docs = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `SELECT id, title, slug, category, excerpt, content_text AS content, created_at AS published_at, updated_at
             FROM knowledge_documents WHERE is_public = true AND status = 'ready' AND slug = $1 LIMIT 1`,
            [slug]).catch(() => []);
        return docs?.[0] || null;
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

    async createResource(schemaName: string, tenantId: string, data: { title: string; type?: string; content?: string; source_url?: string }) {
        const contentHash = data.content
            ? crypto.createHash('sha256').update(data.content).digest('hex').substring(0, 16)
            : null;

        const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `INSERT INTO knowledge_resources (tenant_id, title, type, content, source_url, content_hash)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [tenantId, data.title, data.type || 'manual', data.content || '', data.source_url || null, contentHash]);

        await this.invalidateHasKnowledgeCache(tenantId);

        if (data.content) {
            try {
                await this.ingestDocument(tenantId, {
                    name: data.title,
                    content: data.content,
                    mimeType: 'text/plain',
                });
            } catch (e: any) {
                this.logger.warn(`Auto-ingest failed for resource ${rows[0]?.id}: ${e.message}`);
            }
        }

        return rows[0];
    }

    async deleteResource(schemaName: string, resourceId: string) {
        await this.prisma.executeInTenantSchema(schemaName,
            `DELETE FROM knowledge_resources WHERE id = $1::uuid`,
            [resourceId]);
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
