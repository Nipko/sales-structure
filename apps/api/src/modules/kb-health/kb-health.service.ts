import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { LLMRouterService } from '../ai/router/llm-router.service';
import { CronLockService } from '../redis/cron-lock.service';

/**
 * KB auto-healing (T2.14) — Maven-style.
 *
 * The existing gap-report already covers stale docs, unanswered queries, low
 * satisfaction and false positives. The missing piece is CONTRADICTION
 * detection: pairs of highly-similar chunks from DIFFERENT documents that
 * state opposing facts (e.g. two prices, two policies). We find candidate
 * pairs with pgvector and confirm contradictions with an LLM judge.
 */
@Injectable()
export class KbHealthService {
    private readonly logger = new Logger(KbHealthService.name);

    // Bounds to keep cost predictable
    private readonly MAX_SOURCE_CHUNKS = 300;
    private readonly MAX_CANDIDATE_PAIRS = 40;
    private readonly MAX_JUDGED_PAIRS = 12;
    private readonly SIMILARITY_DISTANCE_MAX = 0.18; // cosine distance (<=>) — smaller = more similar

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        private llmRouter: LLMRouterService,
        private readonly cronLock: CronLockService,
    ) {}

    async ensureTables(schemaName: string): Promise<void> {
        const cacheKey = `kbhealth_cols:${schemaName}`;
        if (await this.redis.get(cacheKey)) return;

        await this.prisma.executeInTenantSchema(
            schemaName,
            `CREATE TABLE IF NOT EXISTS kb_health_issues (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                type VARCHAR(30) NOT NULL,
                document_id UUID,
                related_document_id UUID,
                detail TEXT,
                suggestion TEXT,
                status VARCHAR(20) NOT NULL DEFAULT 'open',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )`,
            [],
        );
        await this.prisma.executeInTenantSchema(
            schemaName,
            `CREATE INDEX IF NOT EXISTS idx_kbhealth_status ON kb_health_issues(status, created_at)`,
            [],
        );
        await this.redis.set(cacheKey, '1', 86400);
    }

    /** Scan one tenant for contradictions. Returns number of new issues found. */
    async scanContradictions(tenantId: string): Promise<number> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        if (!schemaName) return 0;
        await this.ensureTables(schemaName);

        // Candidate pairs: for each (recent) chunk, its nearest neighbour in a
        // DIFFERENT document, keeping only very-similar pairs.
        let candidates: any[];
        try {
            candidates = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT a_doc, b_doc, a_text, b_text, distance FROM (
                    SELECT a.document_id AS a_doc, b.document_id AS b_doc,
                           a.chunk_text AS a_text, b.chunk_text AS b_text,
                           (a.embedding <=> b.embedding) AS distance
                    FROM (
                        SELECT id, document_id, chunk_text, embedding
                        FROM knowledge_embeddings
                        ORDER BY created_at DESC
                        LIMIT $1
                    ) a
                    JOIN LATERAL (
                        SELECT b2.document_id, b2.chunk_text, b2.embedding
                        FROM knowledge_embeddings b2
                        JOIN knowledge_documents kd ON kd.id = b2.document_id
                        WHERE b2.document_id <> a.document_id AND kd.status = 'ready'
                        ORDER BY b2.embedding <=> a.embedding
                        LIMIT 1
                    ) b ON true
                ) pairs
                WHERE distance < $2
                ORDER BY distance ASC
                LIMIT $3`,
                [this.MAX_SOURCE_CHUNKS, this.SIMILARITY_DISTANCE_MAX, this.MAX_CANDIDATE_PAIRS],
            );
        } catch (err: any) {
            this.logger.warn(`[KBHealth] candidate query failed for ${schemaName}: ${err.message}`);
            return 0;
        }

        if (!candidates?.length) return 0;

        // Dedupe by canonical document pair (min,max) so a↔b is one pair.
        const seen = new Set<string>();
        const deduped: { docA: string; docB: string; textA: string; textB: string }[] = [];
        for (const c of candidates) {
            const [docA, docB] = [c.a_doc, c.b_doc].sort();
            const key = `${docA}|${docB}`;
            if (seen.has(key)) continue;
            seen.add(key);
            // keep original text association with canonical order
            const aIsFirst = c.a_doc === docA;
            deduped.push({
                docA,
                docB,
                textA: aIsFirst ? c.a_text : c.b_text,
                textB: aIsFirst ? c.b_text : c.a_text,
            });
            if (deduped.length >= this.MAX_JUDGED_PAIRS) break;
        }

        let found = 0;
        for (const pair of deduped) {
            // Skip if an open contradiction already exists for this doc pair.
            const existing = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT 1 FROM kb_health_issues
                 WHERE type = 'contradiction' AND status = 'open'
                   AND document_id = $1::uuid AND related_document_id = $2::uuid
                 LIMIT 1`,
                [pair.docA, pair.docB],
            );
            if (existing?.length) continue;

            const verdict = await this.judgeContradiction(pair.textA, pair.textB, tenantId);
            if (!verdict.contradicts) continue;

            await this.prisma.executeInTenantSchema(
                schemaName,
                `INSERT INTO kb_health_issues (type, document_id, related_document_id, detail, suggestion, status)
                 VALUES ('contradiction', $1::uuid, $2::uuid, $3, $4, 'open')`,
                [pair.docA, pair.docB, verdict.detail.slice(0, 1000), verdict.suggestion.slice(0, 1000)],
            );
            found++;
        }

        if (found > 0) this.logger.log(`[KBHealth] ${schemaName}: ${found} new contradiction(s) flagged`);
        return found;
    }

    private async judgeContradiction(
        textA: string,
        textB: string,
        tenantId: string,
    ): Promise<{ contradicts: boolean; detail: string; suggestion: string }> {
        const fallback = { contradicts: false, detail: '', suggestion: '' };
        try {
            const response = await this.llmRouter.execute({
                model: 'gpt-4o-mini',
                temperature: 0.1,
                maxTokens: 300,
                tenantId,
                messages: [
                    {
                        role: 'user',
                        content: `Fragmento A:\n"""${textA.slice(0, 1200)}"""\n\nFragmento B:\n"""${textB.slice(0, 1200)}"""`,
                    },
                ],
                systemPrompt: `Eres un auditor de bases de conocimiento. Te doy dos fragmentos del KB de un negocio.
Determina si se CONTRADICEN de forma factual (ej: precios distintos para lo mismo, políticas opuestas, horarios incompatibles, datos en conflicto).
NO marques contradicción si solo hablan de temas similares, se complementan, o difieren en redacción sin conflicto factual.

Responde ÚNICAMENTE con JSON:
{
  "contradicts": true,
  "detail": "qué dato concreto entra en conflicto, citando ambos lados",
  "suggestion": "qué corregir o unificar, en una frase"
}
Si no hay contradicción factual real, devuelve {"contradicts": false, "detail": "", "suggestion": ""}. Usa español.`,
            });
            const match = (response.content || '').match(/\{[\s\S]*\}/);
            const parsed = JSON.parse(match ? match[0] : (response.content || '{}'));
            return {
                contradicts: !!parsed.contradicts,
                detail: String(parsed.detail || ''),
                suggestion: String(parsed.suggestion || ''),
            };
        } catch {
            return fallback;
        }
    }

    async getIssues(tenantId: string, status = 'open') {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        if (!schemaName) return [];
        await this.ensureTables(schemaName);

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT h.id, h.type, h.document_id, h.related_document_id, h.detail, h.suggestion,
                    h.status, h.created_at,
                    da.title AS document_title, db.title AS related_document_title
             FROM kb_health_issues h
             LEFT JOIN knowledge_documents da ON da.id = h.document_id
             LEFT JOIN knowledge_documents db ON db.id = h.related_document_id
             WHERE h.status = $1
             ORDER BY h.created_at DESC
             LIMIT 100`,
            [status],
        );

        return (rows || []).map((r: any) => ({
            id: r.id,
            type: r.type,
            documentId: r.document_id,
            documentTitle: r.document_title,
            relatedDocumentId: r.related_document_id,
            relatedDocumentTitle: r.related_document_title,
            detail: r.detail,
            suggestion: r.suggestion,
            status: r.status,
            createdAt: r.created_at,
        }));
    }

    async updateIssue(tenantId: string, id: string, status: string): Promise<void> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        if (!schemaName) return;
        const allowed = ['open', 'resolved', 'dismissed'];
        if (!allowed.includes(status)) return;
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE kb_health_issues SET status = $2 WHERE id = $1::uuid`,
            [id, status],
        );
    }

    /** Weekly scan across all active tenants (Sundays 05:00 UTC, after recrawl @04:00). */
    // Corre en UNA sola instancia: la API y el worker cargan el mismo
    // AppModule con ScheduleModule, asi que sin esto el cuerpo se
    // ejecuta dos veces. Ver CronLockService.
    @Cron('0 5 * * 0')
    async weeklyScanCron() {
        await this.cronLock.runExclusive('kb-health.weeklyScan', 3600, () => this.weeklyScan());
    }

    async weeklyScan(): Promise<void> {
        let tenants: any[];
        try {
            tenants = await this.prisma.$queryRawUnsafe<any[]>(
                `SELECT id FROM tenants WHERE is_active = true`,
            );
        } catch (err: any) {
            this.logger.warn(`[KBHealth] weekly scan: failed to list tenants: ${err.message}`);
            return;
        }
        this.logger.log(`[KBHealth] Weekly contradiction scan for ${tenants?.length || 0} tenants`);
        for (const t of tenants || []) {
            try {
                await this.scanContradictions(t.id);
            } catch (err: any) {
                this.logger.warn(`[KBHealth] scan failed for tenant ${t.id}: ${err.message}`);
            }
        }
    }
}
