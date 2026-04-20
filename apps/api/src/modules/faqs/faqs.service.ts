import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { TenantsService } from '../tenants/tenants.service';
import type { FAQ } from '@parallext/shared';

/**
 * FAQs service — first-class structured Q&A pairs.
 *
 * Kept separate from the knowledge base (unstructured documents) because
 * FAQs have canonical answers that must match exactly. The agent queries
 * these via the `search_faqs` tool for high-precision responses.
 */
@Injectable()
export class FaqsService {
    private readonly logger = new Logger(FaqsService.name);
    private readonly initialized = new Set<string>();

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly tenantsService: TenantsService,
    ) {}

    private async ensureSchema(tenantId: string): Promise<string> {
        const schemaName = await this.tenantsService.getSchemaName(tenantId);
        if (this.initialized.has(tenantId)) return schemaName;
        const stmts = [
            `CREATE TABLE IF NOT EXISTS "${schemaName}"."faqs" (
                "id" UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
                "question" TEXT NOT NULL,
                "answer" TEXT NOT NULL,
                "category" VARCHAR(100),
                "tags" TEXT[] DEFAULT '{}',
                "order_index" INTEGER DEFAULT 0,
                "is_published" BOOLEAN DEFAULT true,
                "views" INTEGER DEFAULT 0,
                "search_tsv" TSVECTOR,
                "created_at" TIMESTAMP DEFAULT NOW(),
                "updated_at" TIMESTAMP DEFAULT NOW()
            )`,
            `CREATE INDEX IF NOT EXISTS "idx_faqs_published_${schemaName}" ON "${schemaName}"."faqs" ("is_published")`,
            `CREATE INDEX IF NOT EXISTS "idx_faqs_category_${schemaName}" ON "${schemaName}"."faqs" ("category")`,
            `CREATE INDEX IF NOT EXISTS "idx_faqs_order_${schemaName}" ON "${schemaName}"."faqs" ("order_index")`,
            `CREATE INDEX IF NOT EXISTS "idx_faqs_tsv_${schemaName}" ON "${schemaName}"."faqs" USING GIN ("search_tsv")`,
            `CREATE INDEX IF NOT EXISTS "idx_faqs_tags_${schemaName}" ON "${schemaName}"."faqs" USING GIN ("tags")`,
        ];
        for (const sql of stmts) {
            try { await this.prisma.$executeRawUnsafe(sql); }
            catch (e: any) { this.logger.warn(`faqs ensureSchema failed: ${e.message}`); }
        }
        this.initialized.add(tenantId);
        return schemaName;
    }

    async list(tenantId: string, filters?: { publishedOnly?: boolean; category?: string }): Promise<FAQ[]> {
        const schemaName = await this.ensureSchema(tenantId);
        const conds: string[] = [];
        const params: any[] = [];
        if (filters?.publishedOnly) conds.push(`is_published = true`);
        if (filters?.category) { conds.push(`category = $${params.length + 1}`); params.push(filters.category); }
        const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
        const rows = await this.prisma.$queryRawUnsafe(
            `SELECT id, question, answer, category, tags, order_index, is_published, views, created_at, updated_at
             FROM "${schemaName}"."faqs"
             ${where}
             ORDER BY order_index ASC, created_at DESC`,
            ...params,
        ) as any[];
        return rows.map(this.rowToFaq);
    }

    async get(tenantId: string, id: string): Promise<FAQ> {
        const schemaName = await this.ensureSchema(tenantId);
        const rows = await this.prisma.$queryRawUnsafe(
            `SELECT id, question, answer, category, tags, order_index, is_published, views, created_at, updated_at
             FROM "${schemaName}"."faqs" WHERE id = $1::uuid`,
            id,
        ) as any[];
        if (rows.length === 0) throw new NotFoundException('FAQ not found');
        return this.rowToFaq(rows[0]);
    }

    async create(tenantId: string, input: UpsertFaqInput): Promise<FAQ> {
        const schemaName = await this.ensureSchema(tenantId);
        const rows = await this.prisma.$queryRawUnsafe(
            `INSERT INTO "${schemaName}"."faqs" (question, answer, category, tags, order_index, is_published, search_tsv)
             VALUES ($1, $2, $3, $4::text[], $5, $6, to_tsvector('simple', $1 || ' ' || $2))
             RETURNING id, question, answer, category, tags, order_index, is_published, views, created_at, updated_at`,
            input.question, input.answer,
            input.category ?? null,
            input.tags ?? [],
            input.orderIndex ?? 0,
            input.isPublished ?? true,
        ) as any[];
        await this.invalidateCache(tenantId);
        return this.rowToFaq(rows[0]);
    }

    async update(tenantId: string, id: string, input: Partial<UpsertFaqInput>): Promise<FAQ> {
        const schemaName = await this.ensureSchema(tenantId);
        const sets: string[] = ['updated_at = NOW()'];
        const params: any[] = [];
        let idx = 1;
        if (input.question !== undefined) { sets.push(`question = $${idx++}`); params.push(input.question); }
        if (input.answer !== undefined) { sets.push(`answer = $${idx++}`); params.push(input.answer); }
        if (input.category !== undefined) { sets.push(`category = $${idx++}`); params.push(input.category); }
        if (input.tags !== undefined) { sets.push(`tags = $${idx++}::text[]`); params.push(input.tags); }
        if (input.orderIndex !== undefined) { sets.push(`order_index = $${idx++}`); params.push(input.orderIndex); }
        if (input.isPublished !== undefined) { sets.push(`is_published = $${idx++}`); params.push(input.isPublished); }
        if (input.question !== undefined || input.answer !== undefined) {
            // Re-index search vector when text changed
            sets.push(`search_tsv = to_tsvector('simple', question || ' ' || answer)`);
        }
        params.push(id);
        const rows = await this.prisma.$queryRawUnsafe(
            `UPDATE "${schemaName}"."faqs" SET ${sets.join(', ')} WHERE id = $${idx}::uuid
             RETURNING id, question, answer, category, tags, order_index, is_published, views, created_at, updated_at`,
            ...params,
        ) as any[];
        if (rows.length === 0) throw new NotFoundException('FAQ not found');
        await this.invalidateCache(tenantId);
        return this.rowToFaq(rows[0]);
    }

    async delete(tenantId: string, id: string): Promise<void> {
        const schemaName = await this.ensureSchema(tenantId);
        await this.prisma.$executeRawUnsafe(
            `DELETE FROM "${schemaName}"."faqs" WHERE id = $1::uuid`,
            id,
        );
        await this.invalidateCache(tenantId);
    }

    /**
     * Search FAQs by natural-language query. Uses PostgreSQL full-text search
     * over `question` + `answer`. Returns top N ranked matches. Only published
     * FAQs are returned. Falls back to ILIKE if tsvector is empty.
     */
    async search(tenantId: string, query: string, limit = 5): Promise<FAQ[]> {
        const schemaName = await this.ensureSchema(tenantId);
        const rows = await this.prisma.$queryRawUnsafe(
            `SELECT id, question, answer, category, tags, order_index, is_published, views, created_at, updated_at,
                    ts_rank(search_tsv, plainto_tsquery('simple', $1)) AS rank
             FROM "${schemaName}"."faqs"
             WHERE is_published = true
               AND (search_tsv @@ plainto_tsquery('simple', $1)
                    OR question ILIKE '%' || $1 || '%'
                    OR answer ILIKE '%' || $1 || '%')
             ORDER BY rank DESC, order_index ASC
             LIMIT $2`,
            query, limit,
        ) as any[];
        return rows.map(this.rowToFaq);
    }

    /** Increment view count (fire-and-forget from tools). */
    async incrementViews(tenantId: string, id: string): Promise<void> {
        try {
            const schemaName = await this.tenantsService.getSchemaName(tenantId);
            await this.prisma.$executeRawUnsafe(
                `UPDATE "${schemaName}"."faqs" SET views = views + 1 WHERE id = $1::uuid`,
                id,
            );
        } catch {}
    }

    async listPublicBySlug(slug: string): Promise<FAQ[]> {
        const tenant = await this.prisma.tenant.findUnique({ where: { slug }, select: { id: true } });
        if (!tenant) throw new NotFoundException('Tenant not found');
        return this.list(tenant.id, { publishedOnly: true });
    }

    private async invalidateCache(tenantId: string): Promise<void> {
        await this.redis.del(`faqs:${tenantId}:list`);
    }

    private rowToFaq(r: any): FAQ {
        return {
            id: r.id,
            question: r.question,
            answer: r.answer,
            category: r.category ?? undefined,
            orderIndex: r.order_index ?? 0,
            isPublished: !!r.is_published,
            tags: Array.isArray(r.tags) ? r.tags : [],
            views: r.views ?? 0,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
        };
    }
}

export interface UpsertFaqInput {
    question: string;
    answer: string;
    category?: string;
    tags?: string[];
    orderIndex?: number;
    isPublished?: boolean;
}
