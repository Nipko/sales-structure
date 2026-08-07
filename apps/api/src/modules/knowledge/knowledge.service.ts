import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { LlmKeyService } from '../settings/llm-key.service';
import { LLMRouterService } from '../ai/router/llm-router.service';
import { kbmsg } from './knowledge-i18n';
import OpenAI from 'openai';
import axios from 'axios';
import * as crypto from 'crypto';
import {
    type PinnedHttpsTarget,
    prepareSafeHttpsTarget,
    safeAxiosOptions,
} from '../../common/utils/safe-outbound-url.util';
import type { ServiceExecutionContext } from '../../common/types/execution-context';
import { persistenceDisabled } from '../../common/types/execution-context';
// pdf-parse y mammoth son CommonJS sin tipos ESM utilizables: se cargan con
// require a propósito. El disable apunta a `no-require-imports` porque
// typescript-eslint 8 fusionó ahí la vieja `no-var-requires`.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mammoth = require('mammoth');

const CHUNK_MAX_CHARS = 2000;
const CHUNK_OVERLAP_CHARS = 200;
const HAS_KNOWLEDGE_TTL = 300;
// Effective relevance bar for "was this chunk actually used" analytics — distinct
// from the (often 0) recall threshold used to build the candidate pool.
const KB_USE_THRESHOLD = 0.35;
const CRAWL_TIMEOUT_MS = 15_000;
const CRAWL_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

@Injectable()
export class KnowledgeService {
    private readonly logger = new Logger(KnowledgeService.name);
    private openai: OpenAI | null = null;
    private currentKey = '';

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly configService: ConfigService,
        private readonly throttle: TenantThrottleService,
        private readonly llmKeys: LlmKeyService,
        private readonly llmRouter: LLMRouterService,
    ) {}

    /**
     * Lazily build the OpenAI client from the platform-configured key (LlmKeyService
     * resolves platform_settings first, then falls back to the OPENAI_API_KEY env),
     * rebuilding when the key rotates. Throws a clear error when no key is available.
     */
    private async ensureOpenAI(tenantId?: string): Promise<OpenAI> {
        const key = await this.llmKeys.getKey('openai');
        if (!key) {
            const lang = tenantId ? await this.getTenantLanguage(tenantId) : 'es';
            throw new BadRequestException({
                error: 'embeddings_unavailable',
                message: kbmsg(lang, 'embeddings.noKey'),
            });
        }
        if (this.openai && key === this.currentKey) return this.openai;
        this.openai = new OpenAI({ apiKey: key });
        this.currentKey = key;
        return this.openai;
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

        const maxChars = await this.throttle.getPlanLimit(tenantId, 'knowledgeMaxCharsPerDoc');
        if (textContent.length > maxChars) {
            const lang = await this.getTenantLanguage(tenantId);
            throw new ForbiddenException({
                error: 'document_too_large',
                currentChars: textContent.length,
                maxAllowed: maxChars,
                message: kbmsg(lang, 'document.tooLarge', {
                    limit: maxChars.toLocaleString(),
                    pages: String(Math.round(maxChars / 2500)),
                }),
            });
        }

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
            await this.embedAndStoreChunks(schema, document.id, textContent, tenantId);

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
            const lang = await this.getTenantLanguage(tenantId);
            throw new ForbiddenException({
                error: 'plan_upgrade_required',
                message: kbmsg(lang, 'crawl.planRequired'),
            });
        }

        const schema = await this.tenantSchema(tenantId);
        if (crawlLimit !== -1) {
            const crawled = await this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS c FROM knowledge_documents WHERE source_type = 'url' AND status != 'deleted'`);
            if ((crawled?.[0]?.c || 0) >= crawlLimit) {
                const lang = await this.getTenantLanguage(tenantId);
                throw new ForbiddenException({
                    error: 'crawl_limit_reached',
                    message: kbmsg(lang, 'crawl.limitReached', { limit: String(crawlLimit) }),
                });
            }
        }

        let target: PinnedHttpsTarget;
        try {
            target = await prepareSafeHttpsTarget(url, 'fuente de conocimiento');
        } catch {
            const lang = await this.getTenantLanguage(tenantId);
            throw new BadRequestException({ error: 'invalid_url', message: kbmsg(lang, 'crawl.invalidUrl') });
        }
        const parsedUrl = target.url;

        this.logger.log(`[Crawl] Fetching ${parsedUrl.toString()} for tenant ${tenantId}`);

        const response = await axios.get(parsedUrl.toString(), {
            ...safeAxiosOptions(target, CRAWL_TIMEOUT_MS),
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
            const lang = await this.getTenantLanguage(tenantId);
            throw new BadRequestException({ error: 'no_content', message: kbmsg(lang, 'crawl.noContent') });
        }

        const docTitle = title || this.extractTitleFromHtml(response.data) || parsedUrl.hostname + parsedUrl.pathname;

        return this.ingestDocument(tenantId, {
            name: docTitle,
            content: textContent,
            mimeType: 'text/html',
            sourceType: 'url',
            sourceUrl: parsedUrl.toString(),
            category,
        });
    }

    async recrawlUrl(tenantId: string, documentId: string) {
        const schema = await this.tenantSchema(tenantId);
        const docs = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT id, source_url, title, crawl_hash FROM knowledge_documents WHERE id = $1::uuid AND source_type = 'url'`,
            [documentId]);
        if (!docs?.[0]) {
            const lang = await this.getTenantLanguage(tenantId);
            throw new BadRequestException({ error: 'not_url_doc', message: kbmsg(lang, 'doc.notUrlSource') });
        }

        const doc = docs[0];
        const target = await prepareSafeHttpsTarget(doc.source_url, 'fuente de conocimiento');
        const response = await axios.get(target.url.toString(), {
            ...safeAxiosOptions(target, CRAWL_TIMEOUT_MS),
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
            `SELECT id, title, file_type, version FROM knowledge_documents WHERE id = $1::uuid`, [documentId]);
        if (!existing?.[0]) throw new BadRequestException({ error: 'document_not_found' });

        let textContent = update.content || '';
        if (!textContent && update.fileBase64) {
            textContent = await this.parseFileContent(
                update.fileBase64, update.mimeType || existing[0].file_type || 'application/octet-stream', update.name || existing[0].title,
            );
        }
        if (!textContent.trim()) {
            const lang = await this.getTenantLanguage(tenantId);
            throw new BadRequestException({ error: 'empty_content', message: kbmsg(lang, 'doc.emptyContent') });
        }

        const maxChars = await this.throttle.getPlanLimit(tenantId, 'knowledgeMaxCharsPerDoc');
        if (textContent.length > maxChars) {
            const lang = await this.getTenantLanguage(tenantId);
            throw new ForbiddenException({
                error: 'document_too_large',
                currentChars: textContent.length,
                maxAllowed: maxChars,
                message: kbmsg(lang, 'document.tooLarge', {
                    limit: maxChars.toLocaleString(),
                    pages: String(Math.round(maxChars / 2500)),
                }),
            });
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

            await this.embedAndStoreChunks(schema, documentId, textContent, tenantId);
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

        if (!unanswered?.length) {
            const lang = await this.getTenantLanguage(tenantId);
            return { suggestions: [], message: kbmsg(lang, 'suggestions.noUnanswered') };
        }

        const existingDocs = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT title, category FROM knowledge_documents WHERE status = 'ready' ORDER BY created_at DESC LIMIT 30`);

        const queryList = unanswered.map((q: any) => `- "${q.query}" (${q.occurrences}x)`).join('\n');
        const docList = (existingDocs || []).map((d: any) => `- ${d.title}${d.category ? ` [${d.category}]` : ''}`).join('\n');

        try {
            const completion = await (await this.ensureOpenAI(tenantId)).chat.completions.create({
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

        const queryEmbedding = await this.generateEmbedding(query, tenantId);
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
        options?: {
            similarityThreshold?: number;
            poolSize?: number;
            conversationId?: string;
            language?: string;
            rerank?: boolean;
            rerankTopN?: number;
            executionContext?: ServiceExecutionContext;
        },
    ): Promise<any[]> {
        const schema = await this.tenantSchema(tenantId);
        const poolSize = Math.max(topK, options?.poolSize ?? topK * 4);
        const similarityThreshold = options?.similarityThreshold ?? 0;

        if (!persistenceDisabled(options?.executionContext)) {
            await this.ensureKbSearchVector(schema);
        }
        const queryEmbedding = await this.embedQueryCached(query, tenantId, options?.executionContext);
        const embeddingStr = `[${queryEmbedding.join(',')}]`;
        const regconfig = this.pgRegconfig(options?.language);

        // Hybrid retrieval: a vector pool (semantic) + a BM25/tsvector pool
        // (exact-keyword recall the vector misses), fused with Reciprocal Rank
        // Fusion for ordering. The BM25 pool is best-effort — empty if search_tsv
        // isn't backfilled yet or the query has no matching lexemes; then RRF
        // degrades gracefully to vector-only.
        const [vectorPool, tsPool] = await Promise.all([
            this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT ke.id AS chunk_id, ke.chunk_text, ke.chunk_index, ke.metadata,
                        kd.title AS title, kd.id AS document_id, kd.language AS doc_language,
                        (ke.embedding <=> $1::vector) AS distance
                 FROM knowledge_embeddings ke
                 JOIN knowledge_documents kd ON kd.id = ke.document_id
                 WHERE kd.status = 'ready'
                 ORDER BY ke.embedding <=> $1::vector
                 LIMIT $2`,
                [embeddingStr, poolSize]),
            this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT ke.id AS chunk_id, ke.chunk_text, ke.chunk_index, ke.metadata,
                        kd.title AS title, kd.id AS document_id, kd.language AS doc_language
                 FROM knowledge_embeddings ke
                 JOIN knowledge_documents kd ON kd.id = ke.document_id
                 WHERE kd.status = 'ready' AND ke.search_tsv @@ plainto_tsquery($1::regconfig, $2)
                 ORDER BY ts_rank(ke.search_tsv, plainto_tsquery($1::regconfig, $2)) DESC
                 LIMIT $3`,
                [regconfig, query, poolSize]).catch(() => [] as any[]),
        ]);

        const RRF_K = 60;
        const KEYWORD_BOOST = 0.15;
        const LANG_BOOST = 0.1;
        const wantLang = (options?.language || '').slice(0, 2).toLowerCase();
        // Accent-insensitive query tokens for the graded keyword signal (kept so the
        // analytics `score` scale and partial-keyword recall don't regress).
        const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        const queryTokens = [...new Set(norm(query).split(/\s+/).filter(w => w.length > 3))];

        // RRF fuse by chunk_id (rank is 0-based position within each pool).
        const fused = new Map<string, { row: any; rrf: number; vecSim: number; inTs: boolean }>();
        vectorPool.forEach((r: any, i: number) => {
            const c = fused.get(r.chunk_id) || { row: r, rrf: 0, vecSim: 0, inTs: false };
            c.rrf += 1 / (RRF_K + i);
            c.vecSim = 1 - Number(r.distance ?? 0);
            c.row = { ...r, ...c.row };
            fused.set(r.chunk_id, c);
        });
        tsPool.forEach((r: any, i: number) => {
            const c = fused.get(r.chunk_id) || { row: r, rrf: 0, vecSim: 0, inTs: false };
            c.rrf += 1 / (RRF_K + i);
            c.inTs = true;
            c.row = { ...c.row, ...r };
            fused.set(r.chunk_id, c);
        });

        const ranked = [...fused.values()]
            .map(({ row, rrf, vecSim, inTs }) => {
                let keywordBoost = inTs ? KEYWORD_BOOST : 0;
                if (queryTokens.length) {
                    const chunkNorm = norm(row.chunk_text || '');
                    const hits = queryTokens.filter(t => chunkNorm.includes(t)).length;
                    if (hits > 0) keywordBoost = Math.max(keywordBoost, KEYWORD_BOOST * (hits / queryTokens.length));
                }
                const langBoost = wantLang && (row.doc_language || '').slice(0, 2).toLowerCase() === wantLang ? LANG_BOOST : 0;
                // `score` stays the vector-similarity-based scale for analytics
                // continuity (trackRetrieval compares it to KB_USE_THRESHOLD);
                // ordering is by RRF.
                const score = Math.min(1, Math.max(0, vecSim + keywordBoost + langBoost));
                return {
                    id: row.chunk_id,
                    document_id: row.document_id,
                    title: row.title,
                    chunk_text: row.chunk_text,
                    chunk_index: row.chunk_index,
                    metadata: row.metadata,
                    similarity: vecSim,
                    keywordHit: inTs || keywordBoost > 0,
                    score,
                    _rrf: rrf,
                };
            })
            // Keep a chunk if it clears the relevance bar OR it's a keyword match
            // (the BM25 win the pure-vector path would have dropped on threshold).
            .filter(r => r.score >= similarityThreshold || r.keywordHit)
            .sort((a, b) => b._rrf - a._rrf || b.score - a.score);

        // Optional LLM reranker over the top-N of the fused pool — best-effort, gated by
        // the caller (cost + latency). Reorders before the final topK cut.
        const reranked = (options?.rerank && ranked.length > 1)
            ? await this.rerankChunks(
                query,
                ranked,
                options.rerankTopN ?? 12,
                tenantId,
                options.executionContext,
            )
            : ranked;

        const enriched = reranked.slice(0, topK).map(({ _rrf, ...rest }) => rest);

        // Fire-and-forget analytics tracking
        if (!persistenceDisabled(options?.executionContext)) {
            this.trackRetrieval(schema, tenantId, query, enriched, similarityThreshold, options?.conversationId).catch(() => {});
        }

        return enriched;
    }

    /**
     * Best-effort LLM reranker over the top-N fused candidates. Asks a cheap tier to
     * return indices ordered by relevance, reorders the top-N and appends the rest.
     * Any failure (parse/timeout/no key) returns the input unchanged — never blocks search.
     */
    private async rerankChunks(
        query: string,
        candidates: any[],
        topN: number,
        tenantId?: string,
        executionContext?: ServiceExecutionContext,
    ): Promise<any[]> {
        const pool = candidates.slice(0, Math.min(topN, candidates.length));
        if (pool.length <= 1) return candidates;
        try {
            const list = pool
                .map((c, i) => `[${i}] ${(c.title || '').slice(0, 80)} — ${(c.chunk_text || '').slice(0, 400)}`)
                .join('\n');
            const resp = await this.llmRouter.execute({
                // 'conversation' not 'tool_calling': the reranker emits a free-text JSON
                // array, not native tool calls — using tool_calling would wrongly exclude
                // tool-incapable cheap models (e.g. gemini-flash) from the budget tiers.
                task: 'conversation',
                allowedTiers: ['tier_4_budget', 'tier_3_efficient'],
                temperature: 0,
                maxTokens: 200,
                tenantId,
                executionContext,
                systemPrompt: 'Sos un reranker. Devolvé SOLO un JSON array de índices (enteros) ordenados por relevancia a la consulta, el más relevante primero. Sin texto extra.',
                messages: [{ role: 'user', content: `Consulta: ${query}\n\nFragmentos:\n${list}` }],
            });
            const order: any = JSON.parse((resp.content || '[]').replace(/```json?/gi, '').replace(/```/g, '').trim());
            if (!Array.isArray(order)) return candidates;
            const seen = new Set<number>();
            const reordered: any[] = [];
            for (const idx of order) {
                if (Number.isInteger(idx) && idx >= 0 && idx < pool.length && !seen.has(idx)) {
                    seen.add(idx);
                    reordered.push(pool[idx]);
                }
            }
            pool.forEach((c, i) => { if (!seen.has(i)) reordered.push(c); }); // append omitted
            return [...reordered, ...candidates.slice(pool.length)];
        } catch (e: any) {
            this.logger.warn(`[KB rerank] failed (non-fatal): ${e.message}`);
            return candidates;
        }
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

            // was_used must reflect the EFFECTIVE use bar (a chunk that actually
            // grounds the answer), not the recall threshold (often 0 to return a
            // wide pool to the LLM) — otherwise the hit-rate reports ~100%.
            const useThreshold = Math.max(threshold, KB_USE_THRESHOLD);
            for (const r of results.slice(0, 10)) {
                await this.prisma.executeInTenantSchema(schema,
                    `INSERT INTO kb_retrieval_log (document_id, chunk_id, query, score, was_used, conversation_id)
                     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid)`,
                    [r.document_id, r.id, query.substring(0, 500), r.score,
                     r.score >= useThreshold, conversationId || null]);
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

    async tenantHasKnowledge(
        tenantId: string,
        executionContext?: ServiceExecutionContext,
    ): Promise<boolean> {
        if (persistenceDisabled(executionContext)) {
            const schema = await this.tenantSchema(tenantId);
            const rows = await this.prisma.executeInTenantSchema<any[]>(
                schema,
                `SELECT COUNT(*)::int AS cnt FROM knowledge_embeddings ke
                 JOIN knowledge_documents kd ON kd.id = ke.document_id
                 WHERE kd.status = 'ready'`,
            );
            return rows[0]?.cnt > 0;
        }

        const cacheKey = this.redis.tenantKey(tenantId, 'has_knowledge');
        const cached = await this.redis.get(cacheKey);
        if (cached !== null) return cached === '1';

        const schema = await this.tenantSchema(tenantId);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            // JOIN to ready documents so orphan embeddings from a failed ingest
            // don't make us report knowledge that can never be retrieved
            // (searchRelevant only returns chunks of status='ready' docs).
            `SELECT COUNT(*)::int AS cnt FROM knowledge_embeddings ke
             JOIN knowledge_documents kd ON kd.id = ke.document_id
             WHERE kd.status = 'ready'`,
        );
        const hasKnowledge = rows[0]?.cnt > 0;
        await this.redis.set(cacheKey, hasKnowledge ? '1' : '0', HAS_KNOWLEDGE_TTL);
        return hasKnowledge;
    }

    private async invalidateHasKnowledgeCache(tenantId: string) {
        await this.redis.del(this.redis.tenantKey(tenantId, 'has_knowledge'));
    }

    // ─── Usage Stats ──────────────────────────────────────────────────────────

    async getUsageStats(tenantId: string) {
        const schema = await this.tenantSchema(tenantId);
        const monthKey = new Date().toISOString().slice(0, 7);

        const [embedUsedStr, embedCostStr, docCountRows] = await Promise.all([
            this.redis.get(`kb:embed:${tenantId}:${monthKey}`),
            this.redis.get(`kb:embed_cost:${tenantId}:${monthKey}`),
            this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*)::int AS c FROM knowledge_documents WHERE status != 'deleted'`),
        ]);

        const embedUsed = parseInt(embedUsedStr || '0', 10);
        const embedLimit = await this.throttle.getPlanLimit(tenantId, 'knowledgeEmbeddingsPerMonth');
        const docUsed = docCountRows?.[0]?.c || 0;
        const docLimit = await this.throttle.getPlanLimit(tenantId, 'knowledgeArticles');
        const maxCharsPerDoc = await this.throttle.getPlanLimit(tenantId, 'knowledgeMaxCharsPerDoc');
        const costCentiCents = parseInt(embedCostStr || '0', 10);

        return {
            embeddings: {
                used: embedUsed,
                limit: embedLimit === Infinity ? null : embedLimit,
                percent: embedLimit === Infinity ? 0 : Math.round((embedUsed / embedLimit) * 100),
            },
            documents: {
                used: docUsed,
                limit: docLimit === Infinity ? null : docLimit,
                percent: docLimit === Infinity ? 0 : Math.round((docUsed / docLimit) * 100),
            },
            maxCharsPerDoc: maxCharsPerDoc === Infinity ? null : maxCharsPerDoc,
            monthlyCostCentsUsd: Math.round(costCentiCents / 100 * 100) / 100,
            monthKey,
        };
    }

    // ─── Chunking & Embedding ────────────────────────────────────────────────

    private async embedAndStoreChunks(schema: string, documentId: string, text: string, tenantId?: string) {
        const chunks = this.chunkText(text);

        if (tenantId) {
            const monthKey = new Date().toISOString().slice(0, 7);
            const redisKey = `kb:embed:${tenantId}:${monthKey}`;
            const used = parseInt(await this.redis.get(redisKey) || '0', 10);
            const limit = await this.throttle.getPlanLimit(tenantId, 'knowledgeEmbeddingsPerMonth');
            if (used + chunks.length > limit) {
                const lang = await this.getTenantLanguage(tenantId);
                throw new ForbiddenException({
                    error: 'plan_limit_reached',
                    limitKey: 'knowledgeEmbeddingsPerMonth',
                    currentCount: used,
                    chunksNeeded: chunks.length,
                    maxAllowed: limit,
                    message: kbmsg(lang, 'embed.limitReached', {
                        limit: limit.toLocaleString(),
                        used: String(used),
                        needed: String(chunks.length),
                    }),
                });
            }
        }

        await this.ensureKbSearchVector(schema);
        // Index BM25 with the document's OWN language so stemming matches the query-side
        // regconfig (instead of always Spanish). Default Spanish for unknown/auto.
        const docRegconfig = this.pgRegconfig(this.detectLanguage(text));
        for (let i = 0; i < chunks.length; i++) {
            const embedding = await this.generateEmbedding(chunks[i], tenantId);
            const embeddingStr = `[${embedding.join(',')}]`;
            await this.prisma.executeInTenantSchema(
                schema,
                `INSERT INTO knowledge_embeddings (document_id, chunk_index, chunk_text, embedding, metadata, search_tsv)
                 VALUES ($1::uuid, $2, $3, $4::vector, $5::jsonb, to_tsvector($6::regconfig, $3))`,
                [documentId, i, chunks[i], embeddingStr,
                 JSON.stringify({ char_offset: i * (CHUNK_MAX_CHARS - CHUNK_OVERLAP_CHARS) }), docRegconfig],
            );
        }

        if (tenantId) {
            const monthKey = new Date().toISOString().slice(0, 7);
            const embedKey = `kb:embed:${tenantId}:${monthKey}`;
            const costKey = `kb:embed_cost:${tenantId}:${monthKey}`;
            const ttl = 35 * 86400;
            await this.redis.incrBy(embedKey, chunks.length);
            await this.redis.expire(embedKey, ttl);
            const costCentiCents = Math.ceil(chunks.length * 0.001);
            await this.redis.incrBy(costKey, costCentiCents);
            await this.redis.expire(costKey, ttl);
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
                // Don't carry the tail of the last sentence-chunk forward: at loop
                // end it would be pushed as a standalone ~200-char mid-word fragment.
                // splitBySentences already applied overlap internally.
                currentChunk = '';
            } else {
                currentChunk += (currentChunk.length > 0 ? '\n\n' : '') + trimmed;
            }
        }

        if (currentChunk.trim().length > 0) chunks.push(currentChunk.trim());
        return chunks;
    }

    private splitBySentences(text: string): string[] {
        const sentences: string[] = text.match(/[^.!?]+[.!?]+\s*/g) || [];
        // The regex drops any trailing text WITHOUT terminal punctuation (e.g. a
        // price list with no final period) — recover it as a final sentence.
        const matchedLen = sentences.reduce((n, s) => n + s.length, 0);
        if (matchedLen < text.length) {
            const rest = text.slice(matchedLen);
            if (rest.trim().length > 0) sentences.push(rest);
        }
        if (sentences.length === 0) sentences.push(text);

        const chunks: string[] = [];
        let current = '';

        for (const sentence of sentences) {
            // A single "sentence" longer than the max (no punctuation at all)
            // would otherwise produce one unbounded chunk — hard-split it.
            if (sentence.length > CHUNK_MAX_CHARS) {
                if (current.trim().length > 0) { chunks.push(current.trim()); current = ''; }
                for (let i = 0; i < sentence.length; i += CHUNK_MAX_CHARS) {
                    chunks.push(sentence.slice(i, i + CHUNK_MAX_CHARS).trim());
                }
                continue;
            }
            if (current.length + sentence.length > CHUNK_MAX_CHARS && current.length > 0) {
                chunks.push(current.trim());
                current = current.slice(-CHUNK_OVERLAP_CHARS);
            }
            current += sentence;
        }
        if (current.trim().length > 0) chunks.push(current.trim());
        return chunks.filter(c => c.length > 0);
    }

    // ─── File Parsing ────────────────────────────────────────────────────────

    async parseFileContent(base64: string, mimeType: string, fileName = ''): Promise<string> {
        const buffer = Buffer.from(base64, 'base64');
        const mime = mimeType.toLowerCase();
        const ext = fileName.split('.').pop()?.toLowerCase() || '';

        if (mime === 'application/pdf' || ext === 'pdf') {
            try {
                const data = await pdfParse(buffer);
                // El \x00 es a propósito: los PDF traen bytes nulos y PostgreSQL
                // rechaza el texto que los contenga ("invalid byte sequence").
                // eslint-disable-next-line no-control-regex
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

    // Public so other services (e.g. CustomerMemoryService) can reuse the same
    // embedding pipeline + usage tracking instead of building a second OpenAI client.
    async generateEmbedding(
        text: string,
        tenantId?: string,
        executionContext?: ServiceExecutionContext,
    ): Promise<number[]> {
        // Embeddings currently require OpenAI specifically. Fail with a clear,
        // actionable message instead of an opaque 401 from the SDK when the key
        // is missing (the platform contract only guarantees ≥1 provider of any kind).
        const openai = await this.ensureOpenAI(tenantId);
        const response = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: text,
        });
        if (tenantId && !persistenceDisabled(executionContext)) {
            const date = new Date().toISOString().slice(0, 10);
            const baseKey = `ai:stats:${tenantId}:${date}:embeddings`;
            const tokens = response.usage?.total_tokens || Math.ceil(text.length / 4);
            const costCentiUsd = Math.round((tokens / 1000) * 0.00002 * 10000);
            const ttl = 90 * 86400;
            Promise.allSettled([
                this.redis.incrBy(`${baseKey}:calls`, 1),
                this.redis.incrBy(`${baseKey}:tokens`, tokens),
                this.redis.incrBy(`${baseKey}:cost_centi_usd`, costCentiUsd),
                this.redis.sadd(`ai:stats:dates`, date),
                this.redis.sadd(`ai:stats:tenants:${date}`, tenantId),
            ]).then(results => {
                for (const r of results) if (r.status === 'rejected') this.logger.warn(`Embedding stat write failed`);
                return Promise.allSettled([
                    this.redis.expire(`${baseKey}:calls`, ttl),
                    this.redis.expire(`${baseKey}:tokens`, ttl),
                    this.redis.expire(`${baseKey}:cost_centi_usd`, ttl),
                ]);
            }).catch(() => {});
        }
        return response.data[0].embedding;
    }

    /** Query-embedding cache (Redis) — the same question shouldn't re-hit OpenAI. */
    private async embedQueryCached(
        query: string,
        tenantId?: string,
        executionContext?: ServiceExecutionContext,
    ): Promise<number[]> {
        if (persistenceDisabled(executionContext)) {
            return this.generateEmbedding(query, tenantId, executionContext);
        }
        const h = crypto.createHash('sha256').update(query.trim().toLowerCase()).digest('hex').slice(0, 32);
        const key = `kb:qemb:${tenantId || 'g'}:${h}`;
        try {
            const cached = await this.redis.getJson<number[]>(key);
            if (cached && cached.length) return cached;
        } catch { /* fall through and compute */ }
        const emb = await this.generateEmbedding(query, tenantId, executionContext);
        this.redis.setJson(key, emb, 3600).catch(() => {});
        return emb;
    }

    /** Postgres text-search config for a language (default Spanish — LatAm market). */
    private pgRegconfig(lang?: string): 'spanish' | 'english' | 'portuguese' | 'french' {
        switch ((lang || '').slice(0, 2).toLowerCase()) {
            case 'en': return 'english';
            case 'pt': return 'portuguese';
            case 'fr': return 'french';
            default: return 'spanish';
        }
    }

    /**
     * Lazily add the tsvector column + GIN index for BM25 search and backfill it.
     * Cached per-schema in Redis like the other ensure* helpers. The one-time
     * backfill is best-effort: on big KBs it may hit the tx timeout — that's fine,
     * un-backfilled rows just don't match the BM25 pool (the vector pool still
     * returns them) until they're re-ingested.
     */
    private async ensureKbSearchVector(schema: string): Promise<void> {
        const cacheKey = `kb_search_tsv:${schema}`;
        try { if (await this.redis.get(cacheKey)) return; } catch { /* check fresh */ }
        try {
            await this.prisma.executeInTenantSchema(schema,
                `ALTER TABLE knowledge_embeddings ADD COLUMN IF NOT EXISTS search_tsv tsvector`);
            await this.prisma.executeInTenantSchema(schema,
                `CREATE INDEX IF NOT EXISTS idx_ke_tsv ON knowledge_embeddings USING gin (search_tsv)`);
            await this.prisma.executeInTenantSchema(schema,
                `UPDATE knowledge_embeddings SET search_tsv = to_tsvector('spanish'::regconfig, chunk_text) WHERE search_tsv IS NULL`)
                .catch(() => {});
            // Column + index are in place → cache so we skip this next time.
            this.redis.set(cacheKey, '1', 86400).catch(() => {});
        } catch (e: any) {
            // Cache only on a benign "already exists" (column/index present). On any other
            // error do NOT cache — else a transient DDL failure silently disables BM25 for
            // this tenant for 24h (search degrades to vector-only via the tsPool .catch).
            if (/already exists|duplicate|23505|42P07/i.test(e?.message || '')) {
                this.redis.set(cacheKey, '1', 86400).catch(() => {});
            } else {
                this.logger.warn(`[KB tsv] ensure failed: ${e.message}`);
            }
        }
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
        await this.prisma.executeInTenantSchema(schemaName,
            `UPDATE knowledge_resources SET status = 'approved' WHERE status = 'draft'`);
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
        if (data.content) {
            const maxChars = await this.throttle.getPlanLimit(tenantId, 'knowledgeMaxCharsPerDoc');
            if (data.content.length > maxChars) {
                const lang = await this.getTenantLanguage(tenantId);
                throw new ForbiddenException({
                    error: 'document_too_large',
                    currentChars: data.content.length,
                    maxAllowed: maxChars,
                    message: kbmsg(lang, 'document.tooLarge', {
                        limit: maxChars.toLocaleString(),
                        pages: String(Math.round(maxChars / 2500)),
                    }),
                });
            }
        }

        const contentHash = data.content
            ? crypto.createHash('sha256').update(data.content).digest('hex').substring(0, 16)
            : null;

        const rows = await this.prisma.executeInTenantSchema<any[]>(schemaName,
            `INSERT INTO knowledge_resources (tenant_id, title, type, content, source_url, content_hash, status)
             VALUES ($1::uuid, $2, $3, $4, $5, $6, 'approved') RETURNING *`,
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

    // ─── KB Feedback & Gap Analysis ─────────────────────────────────────────

    private async ensureKbFeedbackTable(schemaName: string): Promise<void> {
        const cacheKey = `kb_feedback_tables:${schemaName}`;
        const cached = await this.redis.get(cacheKey);
        if (cached) return;

        await this.prisma.executeInTenantSchema(schemaName,
            `CREATE TABLE IF NOT EXISTS kb_feedback (
                id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                conversation_id UUID,
                message_id UUID,
                document_id UUID,
                query TEXT,
                rating SMALLINT NOT NULL,
                is_false_positive BOOLEAN DEFAULT false,
                comment TEXT,
                created_by VARCHAR(255),
                created_at TIMESTAMPTZ DEFAULT NOW()
            )`);

        await this.prisma.executeInTenantSchema(schemaName,
            `CREATE INDEX IF NOT EXISTS idx_kb_feedback_document ON kb_feedback(document_id)`);

        await this.prisma.executeInTenantSchema(schemaName,
            `CREATE INDEX IF NOT EXISTS idx_kb_feedback_rating ON kb_feedback(rating)`);

        await this.prisma.executeInTenantSchema(schemaName,
            `ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS satisfaction_score DECIMAL(3,2)`);

        await this.prisma.executeInTenantSchema(schemaName,
            `ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS feedback_count INTEGER DEFAULT 0`);

        await this.redis.set(cacheKey, '1', 86400);
    }

    async submitFeedback(
        tenantId: string,
        data: { conversationId?: string; messageId?: string; documentId?: string; query?: string; rating: number; comment?: string; createdBy?: string },
    ) {
        const schema = await this.tenantSchema(tenantId);
        await this.ensureKbFeedbackTable(schema);

        const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
            `INSERT INTO kb_feedback (conversation_id, message_id, document_id, query, rating, comment, created_by)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7) RETURNING *`,
            [
                data.conversationId || null,
                data.messageId || null,
                data.documentId || null,
                data.query || null,
                data.rating,
                data.comment || null,
                data.createdBy || null,
            ]);

        if (data.documentId) {
            const stats = await this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT ROUND(AVG(rating)::numeric, 2) AS avg_rating, COUNT(*)::int AS cnt
                 FROM kb_feedback WHERE document_id = $1::uuid`,
                [data.documentId]);

            if (stats?.[0]) {
                await this.prisma.executeInTenantSchema(schema,
                    `UPDATE knowledge_documents SET satisfaction_score = $2, feedback_count = $3, updated_at = NOW()
                     WHERE id = $1::uuid`,
                    [data.documentId, stats[0].avg_rating, stats[0].cnt]);
            }
        }

        return rows?.[0] || { success: true };
    }

    async markFalsePositive(tenantId: string, feedbackId: string) {
        const schema = await this.tenantSchema(tenantId);
        await this.ensureKbFeedbackTable(schema);

        await this.prisma.executeInTenantSchema(schema,
            `UPDATE kb_feedback SET is_false_positive = true WHERE id = $1::uuid`,
            [feedbackId]);

        return { success: true };
    }

    async getGapReport(tenantId: string, days: number) {
        const schema = await this.tenantSchema(tenantId);
        await this.ensureKbFeedbackTable(schema);
        const since = new Date(Date.now() - days * 86_400_000).toISOString();

        const unansweredQueries = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT id, query, occurrences, last_seen_at
             FROM kb_unanswered_queries
             WHERE resolved = false
             ORDER BY occurrences DESC
             LIMIT 20`).catch(() => []);

        const lowSatisfactionDocs = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT id, title, satisfaction_score, feedback_count
             FROM knowledge_documents
             WHERE satisfaction_score < 3 AND feedback_count > 0 AND status != 'deleted'
             ORDER BY satisfaction_score ASC`).catch(() => []);

        let staleDocuments: any[] = [];
        try {
            staleDocuments = await this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT kd.id, kd.title, kd.updated_at,
                        COALESCE(rl.retrieval_count, 0)::int AS query_frequency
                 FROM knowledge_documents kd
                 LEFT JOIN LATERAL (
                     SELECT COUNT(*)::int AS retrieval_count
                     FROM kb_retrieval_log
                     WHERE document_id = kd.id AND created_at >= $1::timestamp
                 ) rl ON true
                 WHERE kd.status = 'ready'
                   AND kd.updated_at < NOW() - INTERVAL '30 days'
                   AND COALESCE(rl.retrieval_count, 0) > 0
                 ORDER BY kd.updated_at ASC
                 LIMIT 20`,
                [since]) || [];
        } catch {
            staleDocuments = [];
        }

        const falsePositiveCounts = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT fb.document_id, kd.title, COUNT(*)::int AS false_positive_count
             FROM kb_feedback fb
             LEFT JOIN knowledge_documents kd ON kd.id = fb.document_id
             WHERE fb.is_false_positive = true AND fb.created_at >= $1::timestamp
             GROUP BY fb.document_id, kd.title
             ORDER BY false_positive_count DESC`,
            [since]).catch(() => []);

        return {
            unansweredQueries: unansweredQueries || [],
            lowSatisfactionDocs: lowSatisfactionDocs || [],
            staleDocuments: staleDocuments || [],
            falsePositiveCounts: falsePositiveCounts || [],
        };
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    /**
     * Tenant's configured language as a short code (es/en/pt/fr), falling back
     * to 'es'. `tenant.language` is stored as a full locale (e.g. 'es-CO'), so
     * we strip the region — matching the convention in handoff.service and email-i18n.
     */
    private async getTenantLanguage(tenantId: string): Promise<string> {
        try {
            const tenant = await this.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { language: true },
            });
            return (tenant?.language || 'es-CO').substring(0, 2).toLowerCase();
        } catch {
            return 'es';
        }
    }

    private async tenantSchema(tenantId: string): Promise<string> {
        return this.prisma.getTenantSchemaName(tenantId);
    }
}
