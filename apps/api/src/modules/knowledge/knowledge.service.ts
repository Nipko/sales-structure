import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { LlmKeyService } from '../settings/llm-key.service';
import { LLMRouterService } from '../ai/router/llm-router.service';
import type { ExternalSourceAuthority } from '../ai/interfaces/external-source-authority';
import { LLMSourceAuthorityUnavailable } from '../ai/interfaces/llm-source-authority';
import { kbmsg } from './knowledge-i18n';
import type { KnowledgeHit, KnowledgeSearchOptions, KnowledgeSourceMetadata } from './knowledge-contracts';
import { knowledgeSourceAvailable } from './knowledge-contracts';
import { KnowledgeConflictService } from '../kb-health/knowledge-conflict.service';
import { knowledgeReplicaSchema } from '../evaluation-revision/evaluation-knowledge-replica';
import type { KnowledgeGapReport, RetrievedKnowledgeItem } from '@parallext/shared';
import { attributeKnowledgeResponse, knowledgeDocumentReadiness } from './knowledge-attribution';
import { KNOWLEDGE_ATTRIBUTION_SCHEMA } from './knowledge-attribution-schema';
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
import { AGENT_QUALITY_DEPENDENCIES_UPDATED } from '../quality/agent-quality-events';
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
// Retrieval relevance is not evidence that the generated reply used a source.
const KB_RELEVANCE_THRESHOLD = 0.35;
const CRAWL_TIMEOUT_MS = 15_000;
const CRAWL_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

@Injectable()
export class KnowledgeService {
    private readonly logger = new Logger(KnowledgeService.name);
    private openai: OpenAI | null = null;
    private currentKey = '';
    private attributionSchemas?: Map<string, Promise<void>>;

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly configService: ConfigService,
        private readonly throttle: TenantThrottleService,
        private readonly llmKeys: LlmKeyService,
        private readonly llmRouter: LLMRouterService,
        @Optional() private readonly events?: EventEmitter2,
        @Optional() private readonly conflicts?: KnowledgeConflictService,
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
        file: KnowledgeSourceMetadata & {
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
        const source = this.validateSourceMetadata(file);
        await this.validateSourceAgents(schema, source.agentIds);

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `INSERT INTO knowledge_documents (title, file_name, file_type, content_text, status, source_type, source_url, crawl_hash, category, is_public, slug, excerpt, language,
                is_regulated, jurisdiction, authority, valid_from, valid_to, audience, agent_ids)
             VALUES ($1, $2, $3, $4, 'processing', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::date, $17::date, $18, $19::uuid[]) RETURNING *`,
            [file.name, file.name, file.mimeType || 'text/plain', textContent,
             file.sourceType || 'upload', file.sourceUrl || null, contentHash,
             file.category || null, file.isPublic ?? false, slug, excerpt, detectedLang,
             source.isRegulated ?? false, source.jurisdiction ?? null, source.authority ?? null,
             source.validFrom ?? null, source.validTo ?? null, source.audience ?? 'customer', source.agentIds ?? []],
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
            this.emitQualityDependency(tenantId);

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
        update: KnowledgeSourceMetadata & {
            name?: string; content?: string; fileBase64?: string; mimeType?: string; crawlHash?: string;
            category?: string; isPublic?: boolean; autoRecrawl?: boolean;
            changedBy?: string; changeSummary?: string;
        },
    ) {
        const schema = await this.tenantSchema(tenantId);

        const existing = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT id, title, file_type, version, updated_at, updated_at::text AS revision, is_regulated, jurisdiction, authority, valid_from, valid_to, audience, agent_ids, is_public
             FROM knowledge_documents WHERE id = $1::uuid`, [documentId]);
        if (!existing?.[0]) throw new BadRequestException({ error: 'document_not_found' });
        const source = this.validateSourceMetadata({
            isRegulated: existing[0].is_regulated,
            jurisdiction: existing[0].jurisdiction,
            authority: existing[0].authority,
            audience: existing[0].audience,
            agentIds: existing[0].agent_ids,
            isPublic: existing[0].is_public,
            validFrom: existing[0].valid_from ? new Date(existing[0].valid_from).toISOString().slice(0, 10) : null,
            validTo: existing[0].valid_to ? new Date(existing[0].valid_to).toISOString().slice(0, 10) : null,
            ...update,
        });
        await this.validateSourceAgents(schema, source.agentIds);

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

        // Build the replacement completely before touching the live source. Neither a
        // provider failure nor a partial embedding insert may unpublish the last version.
        const currentVersion = existing[0].version || 1;
        const newVersion = currentVersion + 1;
        try {
            const prepared = await this.prepareEmbeddedChunks(schema, textContent, tenantId);

            const slug = (update.name || existing[0].title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 200);
            const excerpt = textContent.substring(0, 300).replace(/\s+/g, ' ').trim();
            const detectedLang = this.detectLanguage(textContent);

            await this.prisma.transactionInTenantSchema(schema, async (query) => {
                const locked = await query<any[]>(
                    `SELECT version, updated_at, updated_at::text AS revision FROM knowledge_documents WHERE id = $1::uuid FOR UPDATE`, [documentId]);
                if (!locked[0] || typeof existing[0].revision !== 'string' || typeof locked[0].revision !== 'string' || (locked[0].version || 1) !== currentVersion ||
                    locked[0].revision !== existing[0].revision) {
                    throw new ConflictException({ error: 'document_changed_during_indexing' });
                }
                await query(
                    `INSERT INTO knowledge_document_versions (document_id, version, title, content_text, chunk_count, changed_by, change_summary)
                     SELECT id, COALESCE(version, 1), title, content_text, chunk_count, $2, $3
                     FROM knowledge_documents WHERE id = $1::uuid`,
                    [documentId, update.changedBy || null, update.changeSummary || null]);
                await query(`DELETE FROM knowledge_embeddings WHERE document_id = $1::uuid`, [documentId]);
                await this.storePreparedChunks(query, documentId, prepared);
                await query(
                `UPDATE knowledge_documents
                 SET title = COALESCE($2, title), content_text = $3, chunk_count = $4,
                     status = 'ready', error_message = NULL, crawl_hash = $5,
                     last_crawled_at = CASE WHEN source_type = 'url' THEN NOW() ELSE last_crawled_at END,
                     category = COALESCE($6, category),
                     is_public = COALESCE($7, is_public),
                     auto_recrawl = COALESCE($8, auto_recrawl),
                     slug = $9, excerpt = $10,
                     version = $11, language = $12,
                     is_regulated = $13, jurisdiction = $14, authority = $15, valid_from = $16::date, valid_to = $17::date,
                     audience = $18, agent_ids = $19::uuid[],
                     updated_at = NOW()
                 WHERE id = $1::uuid`,
                [documentId, update.name || null, textContent, prepared.length, contentHash,
                 update.category !== undefined ? update.category : null,
                 update.isPublic !== undefined ? update.isPublic : null,
                 update.autoRecrawl !== undefined ? update.autoRecrawl : null,
                 slug, excerpt, newVersion, detectedLang, source.isRegulated ?? false,
                 source.jurisdiction ?? null, source.authority ?? null, source.validFrom ?? null, source.validTo ?? null,
                 source.audience ?? 'customer', source.agentIds ?? []]);
            });

            await this.invalidateHasKnowledgeCache(tenantId);
            this.emitQualityDependency(tenantId);
            this.logger.log(`Document ${documentId} updated to v${newVersion}: ${prepared.length} chunks re-embedded`);
            return { documentId, chunkCount: prepared.length, status: 'ready', version: newVersion };
        } catch (error: any) {
            // The transaction restored content, chunks and version. Keep the source
            // readable; expose the failed attempt without overwriting a newer edit.
            if (!(error instanceof ConflictException)) {
                await this.prisma.executeInTenantSchema(schema,
                    `UPDATE knowledge_documents SET error_message = $2
                     WHERE id = $1::uuid AND COALESCE(version, 1) = $3 AND updated_at = $4::timestamptz`,
                    [documentId, String(error.message).slice(0, 1000), currentVersion, existing[0].revision]).catch(() => {});
            }
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

    // ─── Content readiness (not a factual-correctness score) ──────────────────

    async getDocumentQualityScores(tenantId: string) {
        const schema = await this.tenantSchema(tenantId);
        await this.ensureAttributionSchema(schema);
        await this.ensureKbFeedbackTable(schema);
        const docs = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT kd.id, kd.title, kd.chunk_count, kd.status,
                    LENGTH(kd.content_text) AS content_length,
                    kd.category, kd.source_type, kd.version, kd.error_message,
                    kd.is_regulated, kd.authority, kd.jurisdiction, kd.valid_from, kd.valid_to,
                    kd.satisfaction_score, kd.feedback_count,
                    (SELECT COUNT(*)::int FROM kb_feedback f WHERE f.document_id=kd.id AND f.is_false_positive=true) AS false_positive_count,
                    COALESCE(stats.retrieval_count, 0)::int AS retrieval_count,
                    COALESCE(stats.avg_score, 0) AS avg_score,
                    COALESCE(stats.used_count, 0)::int AS used_count
             FROM knowledge_documents kd
             LEFT JOIN LATERAL (
                 SELECT COUNT(DISTINCT retrieval_batch_id)::int AS retrieval_count,
                        ROUND(AVG(score)::numeric, 3) AS avg_score,
                        COUNT(DISTINCT response_id) FILTER (WHERE attribution_version=1 AND was_used)::int AS used_count
                 FROM kb_retrieval_log
                 WHERE document_id = kd.id
                   AND created_at >= NOW() - INTERVAL '30 days'
             ) stats ON true
             WHERE kd.status != 'deleted'
             ORDER BY kd.created_at DESC`);

        return (docs || []).map((d: any) => ({
                id: d.id,
                title: d.title,
                version: Number(d.version || 1),
                ...knowledgeDocumentReadiness(d),
                stats: {
                    contentLength: d.content_length || 0,
                    chunkCount: d.chunk_count || 0,
                    retrievalCount: d.retrieval_count,
                    avgScore: Number(d.avg_score) || 0,
                    usedCount: d.used_count,
                    hasCategoryFlag: !!d.category,
                    falsePositiveCount: Number(d.false_positive_count || 0),
                    feedbackCount: Number(d.feedback_count || 0),
                    satisfactionScore: d.feedback_count ? Number(d.satisfaction_score) : null,
                },
        }));
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
        options?: KnowledgeSearchOptions,
    ): Promise<KnowledgeHit[]> {
        const schema = options?.evaluationKnowledge
            ? await knowledgeReplicaSchema(this.prisma, options.evaluationKnowledge, tenantId, options.executionContext)
            : await this.tenantSchema(tenantId);
        const poolSize = Math.max(topK, options?.poolSize ?? topK * 4);
        const similarityThreshold = options?.similarityThreshold ?? 0;

        if (!persistenceDisabled(options?.executionContext)) {
            await this.ensureKbSearchVector(schema);
        }
        const queryEmbedding = await this.embedQueryCached(query, tenantId, options?.executionContext,options?.withDataSourceAuthority);
        const embeddingStr = `[${queryEmbedding.join(',')}]`;
        const regconfig = this.pgRegconfig(options?.language);

        // Hybrid retrieval: a vector pool (semantic) + a BM25/tsvector pool
        // (exact-keyword recall the vector misses), fused with Reciprocal Rank
        // Fusion for ordering. The BM25 pool is best-effort — empty if search_tsv
        // isn't backfilled yet or the query has no matching lexemes; then RRF
        // degrades gracefully to vector-only.
        // The jurisdiction gate. Non-regulated documents are unaffected — most
        // of a tenant's knowledge base is its own copy, which applies wherever
        // it operates. A regulated one must match the operating country AND be
        // in force today: an expired norm cited as current is its own kind of
        // wrong answer.
        const jurisdiction = (options?.jurisdiction || '').trim().toUpperCase() || null;
        const agentId = options?.agentId || null;
        const audience = options?.audience ?? 'customer';
        const SCOPE_GATE = `AND COALESCE(kd.audience, 'customer') = $AUDIENCE$::text
            AND (COALESCE(cardinality(kd.agent_ids), 0) = 0
                OR ($AGENT$::uuid IS NOT NULL AND $AGENT$::uuid = ANY(kd.agent_ids)))`;
        const REGULATED_GATE = `
                   AND (
                       COALESCE(kd.is_regulated, false) = false
                       OR (
                           $JURISDICTION$::text IS NOT NULL
                           AND kd.jurisdiction = $JURISDICTION$::text
                       )
                   )
                   AND (kd.valid_from IS NULL OR kd.valid_from <= CURRENT_DATE)
                   AND (kd.valid_to IS NULL OR kd.valid_to >= CURRENT_DATE)`;
        const DOC_COLUMNS = `kd.title::text AS title, kd.id AS document_id, kd.language::text AS doc_language,
                        kd.jurisdiction::text AS doc_jurisdiction, kd.authority::text AS doc_authority,
                        kd.valid_from AS doc_valid_from, kd.valid_to AS doc_valid_to,
                        COALESCE(kd.is_regulated, false) AS doc_is_regulated,
                        COALESCE(kd.version, 1) AS doc_version, kd.source_url::text AS doc_source_url,
                        COALESCE(kd.audience, 'customer')::text AS doc_audience, kd.agent_ids AS doc_agent_ids`;

        const [vectorPool, tsPool] = await Promise.all([
            this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT ke.id AS chunk_id, ke.chunk_text, ke.chunk_index, ke.metadata,
                        ${DOC_COLUMNS},
                        (ke.embedding <=> $1::vector) AS distance
                 FROM knowledge_embeddings ke
                 JOIN knowledge_documents kd ON kd.id = ke.document_id
                 WHERE kd.status = 'ready'
                 ${REGULATED_GATE.replace(/\$JURISDICTION\$/g, '$3')}
                 ${SCOPE_GATE.replace(/\$AUDIENCE\$/g, '$4').replace(/\$AGENT\$/g, '$5')}
                 ORDER BY ke.embedding <=> $1::vector, ke.id
                 LIMIT $2`,
                [embeddingStr, poolSize, jurisdiction, audience, agentId]),
            this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT ke.id AS chunk_id, ke.chunk_text, ke.chunk_index, ke.metadata,
                        ${DOC_COLUMNS}
                 FROM knowledge_embeddings ke
                 JOIN knowledge_documents kd ON kd.id = ke.document_id
                 WHERE kd.status = 'ready' AND ke.search_tsv @@ plainto_tsquery($1::regconfig, $2)
                 ${REGULATED_GATE.replace(/\$JURISDICTION\$/g, '$4')}
                 ${SCOPE_GATE.replace(/\$AUDIENCE\$/g, '$5').replace(/\$AGENT\$/g, '$6')}
                 ORDER BY ts_rank(ke.search_tsv, plainto_tsquery($1::regconfig, $2)) DESC, ke.id
                 LIMIT $3`,
                [regconfig, query, poolSize, jurisdiction, audience, agentId]).catch(() => [] as any[]),
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
            .filter(({ row }) => knowledgeSourceAvailable(row, options))
            .map(({ row, rrf, vecSim, inTs }) => {
                let keywordBoost = inTs ? KEYWORD_BOOST : 0;
                if (queryTokens.length) {
                    const chunkNorm = norm(row.chunk_text || '');
                    const hits = queryTokens.filter(t => chunkNorm.includes(t)).length;
                    if (hits > 0) keywordBoost = Math.max(keywordBoost, KEYWORD_BOOST * (hits / queryTokens.length));
                }
                const langBoost = wantLang && (row.doc_language || '').slice(0, 2).toLowerCase() === wantLang ? LANG_BOOST : 0;
                // `score` stays the vector-similarity-based scale for analytics
                // continuity (trackRetrieval compares it to KB_RELEVANCE_THRESHOLD);
                // ordering is by RRF.
                const score = Math.min(1, Math.max(0, vecSim + keywordBoost + langBoost));
                return {
                    id: row.chunk_id,
                    document_id: row.document_id,
                    title: row.title,
                    chunk_text: row.chunk_text,
                    chunk_index: row.chunk_index,
                    metadata: row.metadata,
                    doc_language: row.doc_language ?? null,
                    doc_jurisdiction: row.doc_jurisdiction ?? null,
                    doc_authority: row.doc_authority ?? null,
                    doc_valid_from: row.doc_valid_from ?? null,
                    doc_valid_to: row.doc_valid_to ?? null,
                    doc_is_regulated: row.doc_is_regulated === true,
                    doc_version: Number(row.doc_version ?? 1),
                    doc_source_url: row.doc_source_url ?? null,
                    doc_audience: row.doc_audience ?? 'customer',
                    doc_agent_ids: row.doc_agent_ids ?? [],
                    similarity: vecSim,
                    keywordHit: inTs || keywordBoost > 0,
                    score,
                    _rrf: rrf,
                    _bm25: inTs,
                };
            })
            // Keep a chunk if it clears the relevance bar OR it is a real BM25
            // match — the win the pure-vector path would have dropped on
            // threshold, which is what this exception was written for.
            //
            // `_bm25` and NOT `keywordHit`, and the difference is the whole
            // point. `keywordHit` is graded and generous by design: it turns
            // true when ANY single query token longer than three characters
            // appears as a substring of the chunk, because that makes a useful
            // nudge to the SCORE. Used as an admission ticket it made
            // `similarityThreshold` stop being a threshold — one shared common
            // word ("habitaciones", "appointment") let a chunk through at any
            // cut, so a caller asking for 0.35 got whatever shared a word with
            // the question. The measured cost was abstention: the corpus could
            // not answer, retrieval returned something anyway, and the agent
            // built a confident reply on it.
            //
            // `_bm25` is the tsvector match, and `plainto_tsquery` ANDs every
            // lexeme of the question — so it means the chunk contains all of
            // them. That is the exact-term recall the exception exists to
            // protect, and nothing wider.
            .filter(r => r.score >= similarityThreshold || r._bm25)
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
                options.withDataSourceAuthority,
            )
            : ranked;

        const retrievalBatchId = crypto.randomUUID();
        const conflictEvidence = this.conflicts ? await this.conflicts.annotations(schema,
            [...new Set(reranked.slice(0,topK).map(row => row.document_id))],
            {audience,agentId,jurisdiction}, options?.executionContext) : null;
        const enriched = reranked.slice(0, topK).map(({ _rrf, _bm25, ...rest }) => ({
            ...rest, retrievalId: crypto.randomUUID(), retrievalBatchId,
            ...(conflictEvidence ? {conflictReviewStatus: conflictEvidence.available ? 'available' as const : 'unavailable' as const,
                conflicts: (conflictEvidence.annotations[rest.document_id] || []).filter(note => rest.chunk_text.includes(note.quote))} : {}),
        }));

        // Await the best-effort insert so final-response attribution cannot race
        // a detached retrieval insert. A metrics failure never breaks retrieval.
        if (!persistenceDisabled(options?.executionContext)) {
            await this.trackRetrieval(schema, tenantId, query, enriched, similarityThreshold, options?.conversationId, retrievalBatchId);
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
        sourceAuthority?:ExternalSourceAuthority,
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
                withSourceAuthority:sourceAuthority?invoke=>sourceAuthority(invoke,response=>response.usage):undefined,
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
            if(e instanceof LLMSourceAuthorityUnavailable)throw e;
            this.logger.warn(`[KB rerank] failed (non-fatal): ${e.message}`);
            return candidates;
        }
    }

    // ─── KB Analytics ────────────────────────────────────────────────────────

    private async ensureAttributionSchema(schema: string): Promise<void> {
        this.attributionSchemas ??= new Map();
        let pending = this.attributionSchemas.get(schema);
        if (!pending) {
            pending = (async () => {
                for (const sql of KNOWLEDGE_ATTRIBUTION_SCHEMA) await this.prisma.executeInTenantSchema(schema, sql);
            })().catch(error => { this.attributionSchemas!.delete(schema); throw error; });
            this.attributionSchemas.set(schema, pending);
        }
        await pending;
    }

    private async analyticsTransaction<T>(schema: string, conversationId: string | undefined,
        action: (query: <R = any[]>(sql: string, params?: any[]) => Promise<R>) => Promise<T>,
    ): Promise<{ blocked: boolean; value?: T }> {
        return this.prisma.transactionInTenantSchema(schema, async query => {
            // Erasure takes the exclusive form of this same lock before redaction.
            await query(`SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))`, [`agent-privacy:${schema}`]);
            if (conversationId) {
                const contact = await query<any[]>(`SELECT c.id FROM conversations c
                    WHERE c.id=$1::uuid AND NOT EXISTS
                    (SELECT 1 FROM customer_memory_erasure e WHERE e.contact_id=c.contact_id)`, [conversationId]);
                if (!contact.length) return { blocked: true };
            }
            return { blocked: false, value: await action(query) };
        });
    }

    private async trackRetrieval(
        schema: string, tenantId: string, query: string,
        results: any[], threshold: number, conversationId?: string, batchId = crypto.randomUUID(),
    ) {
        try {
            await this.ensureAttributionSchema(schema);
            const relevanceThreshold = Math.max(threshold, KB_RELEVANCE_THRESHOLD);
            const hasRelevantResult = results.some(result => Number(result?.score) >= relevanceThreshold);
            const records: Array<{ id: string; document_id: string | null; chunk_id: string | null; score: number | null;
                relevance_passed: boolean; source_version: number | null; source_title: string | null }> = results.map(result => ({
                id: result.retrievalId || crypto.randomUUID(), document_id: result.document_id,
                chunk_id: result.id, score: result.score, relevance_passed: result.score >= relevanceThreshold,
                source_version: result.doc_version || 1, source_title: String(result.title || '').slice(0, 500),
            }));
            if (!hasRelevantResult) records.push({ id: crypto.randomUUID(), document_id: null, chunk_id: null,
                score: null, relevance_passed: false, source_version: null, source_title: null });
            await this.analyticsTransaction(schema, conversationId, async execute => {
                if (!hasRelevantResult) {
                    const queryHash = crypto.createHash('sha256').update(query.toLowerCase().trim()).digest('hex').substring(0, 16);
                    await execute(`INSERT INTO kb_unanswered_queries (query, query_hash, occurrences, last_seen_at)
                        VALUES ($1, $2, 1, NOW()) ON CONFLICT (query_hash) WHERE resolved = false
                        DO UPDATE SET occurrences = kb_unanswered_queries.occurrences + 1, last_seen_at = NOW()`,
                    [query.substring(0, 500), queryHash]);
                }
                // A null-document row preserves the conversation-scoped relevance gap.
                // Every new row starts with was_used=false, regardless of its score.
                await execute(`INSERT INTO kb_retrieval_log
                    (id,document_id,chunk_id,query,score,was_used,conversation_id,retrieval_batch_id,
                     relevance_passed,attribution_version,source_version,source_title)
                    SELECT r.id,r.document_id,r.chunk_id,$2,r.score,false,$3::uuid,$4::uuid,
                        r.relevance_passed,1,r.source_version,r.source_title
                    FROM jsonb_to_recordset($1::jsonb) AS r(id UUID,document_id UUID,chunk_id UUID,score NUMERIC,
                        relevance_passed BOOLEAN,source_version INTEGER,source_title TEXT)`,
                [JSON.stringify(records), query.substring(0, 500), conversationId || null, batchId]);
            });
        } catch (e: any) {
            this.logger.warn(`[KB Analytics] tracking failed (non-fatal): ${e.message}`);
        }
    }

    /** Call only after the final response has passed all guards and rewrites. This
     * measures generated replies, not delivery or factual/semantic correctness. */
    async recordResponseAttribution(tenantId: string, conversationId: string, reply: string,
        items: RetrievedKnowledgeItem[], executionContext?: ServiceExecutionContext) {
        const report = attributeKnowledgeResponse(reply, items);
        if (persistenceDisabled(executionContext)) return { ...report, persistence: 'disabled' as const };
        if (!report.evidence.length) return { ...report, persistence: 'not_needed' as const };
        try {
            const schema = await this.tenantSchema(tenantId);
            await this.ensureAttributionSchema(schema);
            const result = await this.analyticsTransaction(schema, conversationId, async query => query<any[]>(
                `UPDATE kb_retrieval_log l SET presented=true,was_used=e.signal<>'unobserved',
                    response_signal=e.signal,attribution_granularity=e.granularity,evidence_hash=e."evidenceHash",
                    response_id=$4::uuid,response_hash=$3,attributed_at=NOW()
                 FROM jsonb_to_recordset($1::jsonb) AS e("retrievalId" UUID,"documentId" UUID,signal TEXT,granularity TEXT,"evidenceHash" TEXT)
                 WHERE l.id=e."retrievalId" AND l.document_id=e."documentId" AND l.conversation_id=$2::uuid
                    AND l.attribution_version=1 AND l.attributed_at IS NULL RETURNING l.id`,
                [JSON.stringify(report.evidence), conversationId, report.responseHash, crypto.randomUUID()]));
            return { ...report, persistence: result.blocked ? 'contact_erased' as const :
                result.value?.length === report.evidence.length ? 'recorded' as const : 'incomplete' as const };
        } catch (error: any) {
            this.logger.warn(`[KB Analytics] response attribution failed (non-fatal): ${error.message}`);
            return { ...report, persistence: 'unavailable' as const };
        }
    }

    async getAnalytics(tenantId: string, days = 30) {
        const schema = await this.tenantSchema(tenantId);
        await this.ensureAttributionSchema(schema);
        days = Math.max(1, Math.min(365, Number.isFinite(days) ? Math.floor(days) : 30));
        const since = new Date(Date.now() - days * 86_400_000).toISOString();

        const [topDocs, totalQueries, unanswered, avgScore, dailyVolume] = await Promise.all([
            this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT kd.id AS document_id, kd.title AS document_name, kd.source_type,
                        COUNT(DISTINCT krl.retrieval_batch_id)::int AS retrieval_count,
                        COUNT(DISTINCT krl.response_id) FILTER (WHERE krl.attribution_version=1 AND krl.was_used)::int AS used_count,
                        ROUND(AVG(krl.score)::numeric, 3) AS avg_score
                 FROM kb_retrieval_log krl
                 JOIN knowledge_documents kd ON kd.id = krl.document_id
                 WHERE krl.created_at >= $1::timestamp AND krl.attribution_version=1
                 GROUP BY kd.id, kd.title, kd.source_type
                 ORDER BY retrieval_count DESC LIMIT 20`,
                [since]),

            this.prisma.executeInTenantSchema<any[]>(schema,
                `WITH searches AS (SELECT retrieval_batch_id, BOOL_OR(relevance_passed) AS relevant,
                        BOOL_OR(document_id IS NOT NULL) AS has_candidates,
                        BOOL_OR(attributed_at IS NOT NULL) AS assessed, BOOL_OR(was_used) AS observed
                    FROM kb_retrieval_log WHERE created_at >= $1::timestamp AND attribution_version=1
                    GROUP BY retrieval_batch_id)
                 SELECT (SELECT COUNT(DISTINCT query)::int FROM kb_retrieval_log WHERE created_at >= $1::timestamp AND attribution_version=1) AS total,
                    COUNT(*)::int AS total_retrievals, COUNT(*) FILTER (WHERE relevant)::int AS hits,
                    COUNT(*) FILTER (WHERE has_candidates)::int AS candidate_searches,
                    COUNT(*) FILTER (WHERE assessed)::int AS assessed_searches,
                    COUNT(*) FILTER (WHERE observed)::int AS observed_searches,
                    (SELECT COUNT(*)::int FROM kb_retrieval_log WHERE created_at >= $1::timestamp AND attribution_version=0) AS legacy_rows
                 FROM searches`,
                [since]),

            this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT id, query, occurrences, last_seen_at, resolved
                 FROM kb_unanswered_queries
                 WHERE resolved = false AND last_seen_at >= $1::timestamp
                 ORDER BY occurrences DESC LIMIT 20`,
                [since]),

            this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT ROUND(AVG(score)::numeric, 3) AS avg,
                        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY score)::numeric, 3) AS median
                 FROM kb_retrieval_log WHERE created_at >= $1::timestamp AND document_id IS NOT NULL AND attribution_version=1`,
                [since]),

            this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT TO_CHAR(created_at, 'YYYY-MM-DD') AS date,
                        COUNT(DISTINCT retrieval_batch_id)::int AS queries,
                        COUNT(DISTINCT retrieval_batch_id) FILTER (WHERE relevance_passed)::int AS hits,
                        COUNT(DISTINCT response_id) FILTER (WHERE was_used)::int AS observed_responses
                 FROM kb_retrieval_log
                 WHERE created_at >= $1::timestamp AND attribution_version=1
                 GROUP BY TO_CHAR(created_at, 'YYYY-MM-DD')
                 ORDER BY date DESC LIMIT 365`,
                [since]),
        ]);

        const counts = totalQueries?.[0] || {};
        const total = Number(counts.total || 0);
        const searches = Number(counts.total_retrievals || 0);
        const assessed = Number(counts.assessed_searches || 0);
        const candidates = Number(counts.candidate_searches || 0);

        return {
            period: { days, since },
            overview: {
                uniqueQueries: total,
                totalRetrievals: searches,
                // All rates are fractions [0,1]. Legacy heuristic rows never enter
                // response attribution or the per-search denominators.
                hitRate: searches ? Number(counts.hits || 0) / searches : null,
                observedRate: assessed ? Number(counts.observed_searches || 0) / assessed : null,
                attributionCoverage: candidates ? assessed / candidates : null,
                assessedSearches: assessed,
                candidateSearches: candidates,
                observedSearches: Number(counts.observed_searches || 0),
                legacyRows: Number(counts.legacy_rows || 0),
                avgScore: avgScore?.[0]?.avg == null ? null : Number(avgScore[0].avg),
                medianScore: avgScore?.[0]?.median == null ? null : Number(avgScore[0].median),
                semanticSupport: 'not_evaluated',
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
                    auto_recrawl, language, version, created_at, updated_at, content_text,
                    is_regulated, jurisdiction, authority, valid_from, valid_to, audience, agent_ids
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
        this.emitQualityDependency(tenantId);
        this.logger.log(`Deleted document ${documentId} for tenant ${tenantId}`);
    }

    async updateDocumentMeta(
        tenantId: string,
        documentId: string,
        meta: KnowledgeSourceMetadata & { category?: string; isPublic?: boolean; autoRecrawl?: boolean; name?: string },
    ) {
        const schema = await this.tenantSchema(tenantId);
        const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT is_regulated, jurisdiction, authority, valid_from, valid_to, audience, agent_ids, is_public,
                    updated_at::text AS revision FROM knowledge_documents WHERE id = $1::uuid`, [documentId]);
        if (!rows?.[0]) throw new BadRequestException({ error: 'document_not_found' });
        const previous = rows[0];
        const source = this.validateSourceMetadata({
            isRegulated: previous.is_regulated,
            jurisdiction: previous.jurisdiction,
            authority: previous.authority,
            audience: previous.audience,
            agentIds: previous.agent_ids,
            isPublic: previous.is_public,
            validFrom: previous.valid_from ? new Date(previous.valid_from).toISOString().slice(0, 10) : null,
            validTo: previous.valid_to ? new Date(previous.valid_to).toISOString().slice(0, 10) : null,
            ...meta,
        });
        await this.validateSourceAgents(schema, source.agentIds);
        const sets: string[] = ['updated_at = NOW()'];
        const params: any[] = [documentId];
        let idx = 2;

        if (meta.name !== undefined) { sets.push(`title = $${idx}`); params.push(meta.name); idx++; }
        if (meta.category !== undefined) { sets.push(`category = $${idx}`); params.push(meta.category || null); idx++; }
        if (meta.isPublic !== undefined) { sets.push(`is_public = $${idx}`); params.push(meta.isPublic); idx++; }
        if (meta.autoRecrawl !== undefined) { sets.push(`auto_recrawl = $${idx}`); params.push(meta.autoRecrawl); idx++; }
        for (const [key, column, cast] of [
            ['isRegulated', 'is_regulated', ''], ['jurisdiction', 'jurisdiction', ''],
            ['authority', 'authority', ''], ['validFrom', 'valid_from', '::date'], ['validTo', 'valid_to', '::date'],
            ['audience', 'audience', ''], ['agentIds', 'agent_ids', '::uuid[]'],
        ] as const) {
            if (meta[key] !== undefined) { sets.push(`${column} = $${idx}${cast}`); params.push(source[key]); idx++; }
        }

        if (meta.name !== undefined) {
            const slug = meta.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 200);
            sets.push(`slug = $${idx}`);
            params.push(slug);
            idx++;
        }

        params.push(previous.revision);
        const updated = await this.prisma.executeInTenantSchema<any[]>(schema,
            `UPDATE knowledge_documents SET ${sets.join(', ')} WHERE id = $1::uuid AND updated_at = $${idx}::timestamptz RETURNING id`, params);
        if (!updated.length) throw new ConflictException({ error: 'document_changed_during_metadata_update' });

        this.emitQualityDependency(tenantId);
        return { success: true };
    }

    private validateSourceMetadata(source: KnowledgeSourceMetadata & { isPublic?: boolean }): KnowledgeSourceMetadata {
        if (source.isRegulated !== undefined && typeof source.isRegulated !== 'boolean') {
            throw new BadRequestException({ error: 'invalid_source_regulation' });
        }
        const normalized = { ...source };
        if (source.audience !== undefined && !['customer', 'internal'].includes(source.audience)) {
            throw new BadRequestException({ error: 'invalid_source_audience' });
        }
        if (source.audience === 'internal' && source.isPublic) {
            throw new BadRequestException({ error: 'internal_source_cannot_be_public' });
        }
        if (source.agentIds !== undefined) {
            if (!Array.isArray(source.agentIds) || source.agentIds.length > 100 ||
                source.agentIds.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))) {
                throw new BadRequestException({ error: 'invalid_source_agents' });
            }
            normalized.agentIds = [...new Set(source.agentIds)];
        }
        if (source.jurisdiction != null) {
            if (typeof source.jurisdiction !== 'string' || !/^[a-z]{2}$/i.test(source.jurisdiction.trim())) {
                throw new BadRequestException({ error: 'invalid_source_jurisdiction' });
            }
            normalized.jurisdiction = source.jurisdiction.trim().toUpperCase();
        }
        if (source.authority != null) {
            if (typeof source.authority !== 'string' || source.authority.length > 300) {
                throw new BadRequestException({ error: 'invalid_source_authority' });
            }
            normalized.authority = source.authority.trim() || null;
        }
        for (const key of ['validFrom', 'validTo'] as const) {
            const value = source[key];
            if (value != null && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
                Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) {
                throw new BadRequestException({ error: 'invalid_source_validity' });
            }
        }
        if (source.validFrom && source.validTo && source.validFrom > source.validTo) {
            throw new BadRequestException({ error: 'invalid_source_validity_range' });
        }
        if (source.isRegulated && (!normalized.jurisdiction || !normalized.authority)) {
            throw new BadRequestException({ error: 'regulated_source_requires_jurisdiction_and_authority' });
        }
        return normalized;
    }

    private async validateSourceAgents(schema: string, agentIds?: string[]) {
        if (!agentIds?.length) return;
        const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT id FROM agent_personas WHERE id = ANY($1::uuid[])`, [agentIds]);
        if (rows.length !== agentIds.length) throw new BadRequestException({ error: 'source_agent_not_found' });
    }

    // ─── Tenant Knowledge Check (cached) ─────────────────────────────────────

    async tenantHasKnowledge(
        tenantId: string,
        executionContext?: ServiceExecutionContext,
        scope?: Pick<KnowledgeSearchOptions, 'agentId' | 'audience' | 'jurisdiction' | 'evaluationKnowledge'>,
    ): Promise<boolean> {
        if (persistenceDisabled(executionContext) || scope) {
            const schema = scope?.evaluationKnowledge
                ? await knowledgeReplicaSchema(this.prisma, scope.evaluationKnowledge, tenantId, executionContext)
                : await this.tenantSchema(tenantId);
            const rows = await this.prisma.executeInTenantSchema<any[]>(
                schema,
                `SELECT COUNT(*)::int AS cnt FROM knowledge_embeddings ke
                 JOIN knowledge_documents kd ON kd.id = ke.document_id
                 WHERE kd.status = 'ready'
                    AND COALESCE(kd.audience, 'customer') = $1
                    AND (COALESCE(cardinality(kd.agent_ids), 0) = 0 OR $2::uuid = ANY(kd.agent_ids))
                    AND (kd.valid_from IS NULL OR kd.valid_from <= CURRENT_DATE)
                    AND (kd.valid_to IS NULL OR kd.valid_to >= CURRENT_DATE)
                    AND (COALESCE(kd.is_regulated, false) = false OR kd.jurisdiction = $3)`,
                [scope?.audience ?? 'customer', scope?.agentId || null, scope?.jurisdiction?.toUpperCase() || null],
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
             WHERE kd.status = 'ready' AND COALESCE(kd.audience, 'customer') = 'customer'
                AND COALESCE(cardinality(kd.agent_ids), 0) = 0
                AND (kd.valid_from IS NULL OR kd.valid_from <= CURRENT_DATE)
                AND (kd.valid_to IS NULL OR kd.valid_to >= CURRENT_DATE)
                AND COALESCE(kd.is_regulated, false) = false`,
        );
        const hasKnowledge = rows[0]?.cnt > 0;
        await this.redis.set(cacheKey, hasKnowledge ? '1' : '0', HAS_KNOWLEDGE_TTL);
        return hasKnowledge;
    }

    private async invalidateHasKnowledgeCache(tenantId: string) {
        await this.redis.del(this.redis.tenantKey(tenantId, 'has_knowledge'));
    }

    private emitQualityDependency(tenantId: string): void {
        this.events?.emit(AGENT_QUALITY_DEPENDENCIES_UPDATED, {
            tenantId,
            source: 'knowledge',
        });
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
        const prepared = await this.prepareEmbeddedChunks(schema, text, tenantId);
        await this.prisma.transactionInTenantSchema(schema, async (query) => {
            await this.storePreparedChunks(query, documentId, prepared);
        });
        return prepared.length;
    }

    private async prepareEmbeddedChunks(schema: string, text: string, tenantId?: string) {
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
        const prepared: Array<{ text: string; embedding: string; regconfig: string }> = [];
        for (let i = 0; i < chunks.length; i++) {
            const embedding = await this.generateEmbedding(chunks[i], tenantId);
            prepared.push({ text: chunks[i], embedding: `[${embedding.join(',')}]`, regconfig: docRegconfig });
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

        return prepared;
    }

    private async storePreparedChunks(
        query: (sql: string, params: any[]) => Promise<unknown>,
        documentId: string,
        prepared: Array<{ text: string; embedding: string; regconfig: string }>,
    ) {
        for (let i = 0; i < prepared.length; i++) {
            const chunk = prepared[i];
            await query(
                `INSERT INTO knowledge_embeddings (document_id, chunk_index, chunk_text, embedding, metadata, search_tsv)
                 VALUES ($1::uuid, $2, $3, $4::vector, $5::jsonb, to_tsvector($6::regconfig, $3))`,
                [documentId, i, chunk.text, chunk.embedding,
                 JSON.stringify({ char_offset: i * (CHUNK_MAX_CHARS - CHUNK_OVERLAP_CHARS) }), chunk.regconfig]);
        }
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
        sourceAuthority?:ExternalSourceAuthority,
    ): Promise<number[]> {
        // Embeddings currently require OpenAI specifically. Fail with a clear,
        // actionable message instead of an opaque 401 from the SDK when the key
        // is missing (the platform contract only guarantees ≥1 provider of any kind).
        const openai = await this.ensureOpenAI(tenantId);
        const input={model:'text-embedding-3-small',input:text};
        const request=async()=>{
            if(!sourceAuthority)return openai.embeddings.create(input);
            for(let attempt=0;;attempt++){
                try{
                    // Retries live outside the SDK, with fresh authority before
                    // each outgoing attempt and a bounded request duration.
                    return await sourceAuthority(()=>openai.embeddings.create(input,{maxRetries:0,timeout:45000}),response=>({
                        promptTokens:response.usage?.prompt_tokens||0,completionTokens:0,totalTokens:response.usage?.total_tokens||0,
                    }));
                }catch(error:any){
                    if(error instanceof LLMSourceAuthorityUnavailable||attempt>=2
                        ||!(error instanceof OpenAI.APIConnectionError||[408,409,429].includes(error?.status)||error?.status>=500))throw error;
                    await new Promise(resolve=>setTimeout(resolve,200*2**attempt));
                }
            }
        };
        const response = await request();
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
        sourceAuthority?:ExternalSourceAuthority,
    ): Promise<number[]> {
        if (persistenceDisabled(executionContext)||sourceAuthority) {
            return this.generateEmbedding(query, tenantId, executionContext,sourceAuthority);
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
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!Number.isInteger(data.rating) || data.rating < 1 || data.rating > 5 ||
            [data.conversationId, data.messageId, data.documentId].some(id => id != null && !uuid.test(id)) ||
            (data.query != null && (typeof data.query !== 'string' || data.query.length > 2000)) ||
            (data.comment != null && (typeof data.comment !== 'string' || data.comment.length > 5000))) {
            throw new BadRequestException('invalid_knowledge_feedback');
        }
        const schema = await this.tenantSchema(tenantId);
        await this.ensureKbFeedbackTable(schema);
        await this.ensureAttributionSchema(schema);
        // Resolve a message-only reference to its conversation so it receives the
        // same erasure protection. Repeat the relationship check inside the lock.
        let conversationId = data.conversationId;
        if (data.messageId && !conversationId) {
            const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT conversation_id FROM messages WHERE id=$1::uuid`, [data.messageId]);
            if (!rows[0]) throw new BadRequestException('knowledge_feedback_message_unavailable');
            conversationId = rows[0].conversation_id;
        }
        const result = await this.analyticsTransaction(schema, conversationId, async query => {
            if (data.messageId) {
                const messages = await query<any[]>(`SELECT id FROM messages WHERE id=$1::uuid AND conversation_id=$2::uuid`,
                    [data.messageId, conversationId]);
                if (!messages.length) throw new BadRequestException('knowledge_feedback_message_mismatch');
            }
            if (data.documentId) {
                const documents = await query<any[]>(`SELECT id FROM knowledge_documents WHERE id=$1::uuid AND status<>'deleted' FOR UPDATE`,
                    [data.documentId]);
                if (!documents.length) throw new BadRequestException('knowledge_feedback_document_unavailable');
            }
            const rows = await query<any[]>(`INSERT INTO kb_feedback (conversation_id,message_id,document_id,query,rating,comment,created_by)
                VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7) RETURNING *`,
            [conversationId || null, data.messageId || null, data.documentId || null, data.query || null,
                data.rating, data.comment || null, data.createdBy || null]);
            if (data.documentId) await query(`UPDATE knowledge_documents d SET satisfaction_score=s.avg_rating,feedback_count=s.cnt
                FROM (SELECT ROUND(AVG(rating)::numeric,2) AS avg_rating,COUNT(*)::int AS cnt FROM kb_feedback WHERE document_id=$1::uuid) s
                WHERE d.id=$1::uuid`, [data.documentId]);
            // Feedback is an opinion/correction signal, not new source content:
            // do not refresh document.updated_at or its factual currency.
            return rows[0] || { success: true };
        });
        if (result.blocked) throw new BadRequestException('knowledge_feedback_conversation_unavailable');
        return result.value;
    }

    async markFalsePositive(tenantId: string, feedbackId: string) {
        const schema = await this.tenantSchema(tenantId);
        await this.ensureKbFeedbackTable(schema);

        await this.prisma.executeInTenantSchema(schema,
            `UPDATE kb_feedback SET is_false_positive = true WHERE id = $1::uuid`,
            [feedbackId]);

        return { success: true };
    }

    async getGapReport(tenantId: string, days: number): Promise<KnowledgeGapReport> {
        const schema = await this.tenantSchema(tenantId);
        await this.ensureKbFeedbackTable(schema);
        const since = new Date(Date.now() - days * 86_400_000).toISOString();
        const unavailableSections: KnowledgeGapReport['unavailableSections'] = [];

        const unansweredQueries = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT id, query, occurrences, last_seen_at
             FROM kb_unanswered_queries
             WHERE resolved = false
             ORDER BY occurrences DESC
             LIMIT 20`).catch(() => { unavailableSections.push('unansweredQueries'); return []; });

        const lowSatisfactionDocs = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT id, title, satisfaction_score, feedback_count
             FROM knowledge_documents
             WHERE satisfaction_score < 3 AND feedback_count > 0 AND status != 'deleted'
             ORDER BY satisfaction_score ASC`).catch(() => { unavailableSections.push('lowSatisfactionDocs'); return []; });

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
            unavailableSections.push('staleDocuments');
        }

        const falsePositiveCounts = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT fb.document_id, kd.title, COUNT(*)::int AS false_positive_count
             FROM kb_feedback fb
             LEFT JOIN knowledge_documents kd ON kd.id = fb.document_id
             WHERE fb.is_false_positive = true AND fb.created_at >= $1::timestamp
             GROUP BY fb.document_id, kd.title
             ORDER BY false_positive_count DESC`,
            [since]).catch(() => { unavailableSections.push('falsePositiveCounts'); return []; });

        return {
            unavailableSections,
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
