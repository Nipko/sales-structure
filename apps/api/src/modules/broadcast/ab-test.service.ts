import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

export interface VariantInput {
    name: string;
    content: Record<string, any>;
    percentage: number;
}

export interface VariantStats {
    sent: number;
    delivered: number;
    read: number;
    responded: number;
    failed: number;
}

export interface VariantRow {
    id: string;
    campaign_id: string;
    name: string;
    content: Record<string, any>;
    percentage: number;
    is_winner: boolean;
    stats: VariantStats;
    created_at: string;
}

export interface SignificanceResult {
    zScore: number;
    pValue: number;
    significant: boolean;
}

@Injectable()
export class AbTestService {
    private readonly logger = new Logger(AbTestService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
    ) {}

    // ================================================================
    // ENSURE A/B TEST TABLES — lazy creation with Redis cache
    // ================================================================
    async ensureAbTestTables(schema: string): Promise<void> {
        const cacheKey = `ab_tables:${schema}`;
        const cached = await this.redis.get(cacheKey);
        if (cached) return;

        try {
            await this.prisma.$queryRawUnsafe(
                `CREATE TABLE IF NOT EXISTS "${schema}".campaign_variants (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    campaign_id UUID NOT NULL,
                    name TEXT NOT NULL,
                    content JSONB NOT NULL,
                    percentage INTEGER NOT NULL DEFAULT 50,
                    is_winner BOOLEAN DEFAULT false,
                    stats JSONB DEFAULT '{"sent":0,"delivered":0,"read":0,"responded":0,"failed":0}',
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )`,
            );
        } catch { /* already exists */ }

        try {
            await this.prisma.$queryRawUnsafe(
                `CREATE INDEX IF NOT EXISTS idx_campaign_variants_campaign ON "${schema}".campaign_variants(campaign_id)`,
            );
        } catch { /* ok */ }

        try {
            await this.prisma.$queryRawUnsafe(
                `ALTER TABLE "${schema}".campaign_recipients ADD COLUMN IF NOT EXISTS variant_id UUID`,
            );
        } catch { /* ok */ }

        try {
            await this.prisma.$queryRawUnsafe(
                `ALTER TABLE "${schema}".campaigns ADD COLUMN IF NOT EXISTS is_ab_test BOOLEAN DEFAULT false`,
            );
        } catch { /* ok */ }

        try {
            await this.prisma.$queryRawUnsafe(
                `ALTER TABLE "${schema}".campaigns ADD COLUMN IF NOT EXISTS ab_test_config JSONB DEFAULT '{}'`,
            );
        } catch { /* ok */ }

        await this.redis.set(cacheKey, 'true', 86400);
    }

    // ================================================================
    // CREATE VARIANTS
    // ================================================================
    async createVariants(
        schema: string,
        campaignId: string,
        variants: VariantInput[],
    ): Promise<VariantRow[]> {
        if (!variants.length || variants.length < 2) {
            throw new BadRequestException('A/B test requires at least 2 variants');
        }

        const totalPercentage = variants.reduce((sum, v) => sum + v.percentage, 0);
        if (totalPercentage !== 100) {
            throw new BadRequestException(
                `Variant percentages must sum to 100, got ${totalPercentage}`,
            );
        }

        const results: VariantRow[] = [];

        for (const variant of variants) {
            const rows = await this.prisma.executeInTenantSchema<any[]>(
                schema,
                `INSERT INTO campaign_variants (id, campaign_id, name, content, percentage, is_winner, stats, created_at)
                 VALUES (gen_random_uuid(), $1::uuid, $2, $3::jsonb, $4, false, '{"sent":0,"delivered":0,"read":0,"responded":0,"failed":0}'::jsonb, NOW())
                 RETURNING *`,
                [campaignId, variant.name, JSON.stringify(variant.content), variant.percentage],
            );
            if (rows?.[0]) {
                results.push(this.parseVariantRow(rows[0]));
            }
        }

        return results;
    }

    // ================================================================
    // ASSIGN RECIPIENTS TO VARIANTS
    // ================================================================
    async assignRecipientsToVariants(
        schema: string,
        campaignId: string,
    ): Promise<void> {
        const variants = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT id, percentage FROM campaign_variants
             WHERE campaign_id = $1::uuid ORDER BY created_at ASC`,
            [campaignId],
        );

        if (!variants?.length) {
            throw new BadRequestException('No variants found for this campaign');
        }

        const recipients = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT id FROM campaign_recipients
             WHERE campaign_id = $1::uuid AND status = 'pending'
             ORDER BY id ASC`,
            [campaignId],
        );

        if (!recipients?.length) return;

        // Seeded random shuffle based on campaignId for reproducibility
        const seed = this.hashString(campaignId);
        const shuffled = this.seededShuffle([...recipients], seed);

        // Build variant assignment ranges
        const totalRecipients = shuffled.length;
        const assignments: Array<{ variantId: string; start: number; end: number }> = [];
        let cursor = 0;
        for (let i = 0; i < variants.length; i++) {
            const count = i === variants.length - 1
                ? totalRecipients - cursor
                : Math.round((variants[i].percentage / 100) * totalRecipients);
            assignments.push({
                variantId: variants[i].id,
                start: cursor,
                end: cursor + count,
            });
            cursor += count;
        }

        // Batch update recipients with variant_id
        for (const assignment of assignments) {
            const batch = shuffled.slice(assignment.start, assignment.end);
            if (!batch.length) continue;

            const ids = batch.map((r: any) => r.id);
            const batchSize = 200;
            for (let i = 0; i < ids.length; i += batchSize) {
                const chunk = ids.slice(i, i + batchSize);
                const placeholders = chunk.map((_: string, j: number) => `$${j + 2}::uuid`).join(', ');
                await this.prisma.executeInTenantSchema(
                    schema,
                    `UPDATE campaign_recipients SET variant_id = $1::uuid
                     WHERE id IN (${placeholders})`,
                    [assignment.variantId, ...chunk],
                );
            }
        }

        this.logger.log(
            `Assigned ${totalRecipients} recipients to ${variants.length} variants for campaign ${campaignId}`,
        );
    }

    // ================================================================
    // GET VARIANT STATS
    // ================================================================
    async getVariantStats(
        schema: string,
        campaignId: string,
    ): Promise<Array<VariantRow & { recipientCount: number; significance?: SignificanceResult }>> {
        await this.ensureAbTestTables(schema);

        const variants = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT cv.*,
                    (SELECT COUNT(*)::int FROM campaign_recipients cr
                     WHERE cr.campaign_id = cv.campaign_id AND cr.variant_id = cv.id) AS recipient_count
             FROM campaign_variants cv
             WHERE cv.campaign_id = $1::uuid
             ORDER BY cv.created_at ASC`,
            [campaignId],
        );

        if (!variants?.length) return [];

        const parsed = variants.map((v: any) => ({
            ...this.parseVariantRow(v),
            recipientCount: parseInt(v.recipient_count || '0'),
        }));

        // Calculate significance if we have exactly 2 variants
        if (parsed.length === 2) {
            const sig = this.calculateSignificance(parsed[0].stats, parsed[1].stats);
            return parsed.map((v, i) => ({
                ...v,
                significance: i === 0 ? sig : sig,
            }));
        }

        return parsed;
    }

    // ================================================================
    // UPDATE VARIANT STATS — increment a JSONB field
    // ================================================================
    async updateVariantStats(
        schema: string,
        variantId: string,
        field: 'sent' | 'delivered' | 'read' | 'responded' | 'failed',
    ): Promise<void> {
        await this.prisma.executeInTenantSchema(
            schema,
            `UPDATE campaign_variants
             SET stats = jsonb_set(
                 stats,
                 $2::text[],
                 to_jsonb(COALESCE((stats->>$3)::int, 0) + 1)
             )
             WHERE id = $1::uuid`,
            [variantId, `{${field}}`, field],
        );
    }

    // ================================================================
    // SELECT WINNER — manually
    // ================================================================
    async selectWinner(
        schema: string,
        campaignId: string,
        variantId: string,
    ): Promise<void> {
        // Verify variant belongs to this campaign
        const variants = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT id FROM campaign_variants
             WHERE campaign_id = $1::uuid AND id = $2::uuid`,
            [campaignId, variantId],
        );

        if (!variants?.length) {
            throw new NotFoundException('Variant not found for this campaign');
        }

        // Reset all winners for this campaign
        await this.prisma.executeInTenantSchema(
            schema,
            `UPDATE campaign_variants SET is_winner = false
             WHERE campaign_id = $1::uuid`,
            [campaignId],
        );

        // Mark the winner
        await this.prisma.executeInTenantSchema(
            schema,
            `UPDATE campaign_variants SET is_winner = true
             WHERE id = $1::uuid`,
            [variantId],
        );

        this.logger.log(`Variant ${variantId} selected as winner for campaign ${campaignId}`);
    }

    // ================================================================
    // CALCULATE STATISTICAL SIGNIFICANCE — Z-test for proportions
    // ================================================================
    calculateSignificance(
        variantA: VariantStats,
        variantB: VariantStats,
    ): SignificanceResult {
        const nA = variantA.sent || 0;
        const nB = variantB.sent || 0;

        // Need minimum sample size for meaningful results
        if (nA < 30 || nB < 30) {
            return { zScore: 0, pValue: 1, significant: false };
        }

        // Compare response rates (responded / sent)
        const pA = nA > 0 ? variantA.responded / nA : 0;
        const pB = nB > 0 ? variantB.responded / nB : 0;

        // Pooled proportion
        const pPool = (variantA.responded + variantB.responded) / (nA + nB);
        const se = Math.sqrt(pPool * (1 - pPool) * (1 / nA + 1 / nB));

        if (se === 0) {
            return { zScore: 0, pValue: 1, significant: false };
        }

        const zScore = (pA - pB) / se;
        // Two-tailed p-value approximation using the error function
        const pValue = 2 * (1 - this.normalCDF(Math.abs(zScore)));

        return {
            zScore: Math.round(zScore * 1000) / 1000,
            pValue: Math.round(pValue * 10000) / 10000,
            significant: pValue < 0.05,
        };
    }

    // ================================================================
    // AUTO-SELECT WINNER — called after test_percentage jobs complete
    // ================================================================
    async autoSelectWinner(schema: string, campaignId: string): Promise<boolean> {
        const variants = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT * FROM campaign_variants
             WHERE campaign_id = $1::uuid ORDER BY created_at ASC`,
            [campaignId],
        );

        if (!variants || variants.length < 2) return false;

        // Check if a winner is already selected
        const hasWinner = variants.some((v: any) => v.is_winner === true);
        if (hasWinner) return false;

        const parsed = variants.map((v: any) => this.parseVariantRow(v));

        // Only auto-select if we have exactly 2 variants for the z-test
        if (parsed.length === 2) {
            const sig = this.calculateSignificance(parsed[0].stats, parsed[1].stats);

            if (sig.significant) {
                // Select the variant with the higher response rate
                const rateA = parsed[0].stats.sent > 0
                    ? parsed[0].stats.responded / parsed[0].stats.sent
                    : 0;
                const rateB = parsed[1].stats.sent > 0
                    ? parsed[1].stats.responded / parsed[1].stats.sent
                    : 0;

                const winnerId = rateA >= rateB ? parsed[0].id : parsed[1].id;
                await this.selectWinner(schema, campaignId, winnerId);

                this.logger.log(
                    `Auto-selected winner ${winnerId} for campaign ${campaignId} (p=${sig.pValue})`,
                );
                return true;
            }
        }

        return false;
    }

    // ================================================================
    // GET VARIANT CONTENT FOR A RECIPIENT
    // ================================================================
    async getVariantContent(
        schema: string,
        variantId: string,
    ): Promise<Record<string, any> | null> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT content FROM campaign_variants WHERE id = $1::uuid LIMIT 1`,
            [variantId],
        );

        if (!rows?.length) return null;

        const content = rows[0].content;
        return typeof content === 'string' ? JSON.parse(content) : content;
    }

    // ================================================================
    // PRIVATE HELPERS
    // ================================================================

    private parseVariantRow(row: any): VariantRow {
        const stats = typeof row.stats === 'string'
            ? JSON.parse(row.stats)
            : (row.stats || { sent: 0, delivered: 0, read: 0, responded: 0, failed: 0 });

        const content = typeof row.content === 'string'
            ? JSON.parse(row.content)
            : (row.content || {});

        return {
            id: row.id,
            campaign_id: row.campaign_id,
            name: row.name,
            content,
            percentage: parseInt(row.percentage || '0'),
            is_winner: row.is_winner === true,
            stats,
            created_at: row.created_at?.toISOString?.() || row.created_at,
        };
    }

    /**
     * Seeded pseudo-random shuffle (Fisher-Yates with seeded PRNG)
     */
    private seededShuffle<T>(array: T[], seed: number): T[] {
        let s = seed;
        const random = () => {
            s = (s * 1664525 + 1013904223) % 4294967296;
            return s / 4294967296;
        };

        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    /**
     * Simple string hash for seeding
     */
    private hashString(str: string): number {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash);
    }

    /**
     * Approximation of the normal CDF using the error function
     */
    private normalCDF(x: number): number {
        const a1 = 0.254829592;
        const a2 = -0.284496736;
        const a3 = 1.421413741;
        const a4 = -1.453152027;
        const a5 = 1.061405429;
        const p = 0.3275911;

        const sign = x < 0 ? -1 : 1;
        x = Math.abs(x) / Math.SQRT2;

        const t = 1.0 / (1.0 + p * x);
        const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

        return 0.5 * (1.0 + sign * y);
    }
}
