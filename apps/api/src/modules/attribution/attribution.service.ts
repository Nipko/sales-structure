import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

interface WaReferral {
    source_id?: string;
    source_type?: string;
    source_url?: string;
    headline?: string;
    body?: string;
    media_type?: string;
    ctwa_clid?: string;
}

/**
 * Attribution (T3.22) — Click-to-WhatsApp ads + revenue attribution.
 *
 * Captures the WhatsApp `referral` object (Free Entry Point / CTWA ads) on the
 * first ad-originated message, then DERIVES the ads→WhatsApp→sale funnel and
 * revenue at query time by joining attributions → leads → won opportunities
 * (robust, no fragile event wiring). Also attributes broadcast revenue.
 */
@Injectable()
export class AttributionService {
    private readonly logger = new Logger(AttributionService.name);

    constructor(private readonly prisma: PrismaService, private readonly redis: RedisService) {}

    private async schema(tenantId: string): Promise<string> {
        const s = await this.prisma.getTenantSchemaName(tenantId);
        if (!s) throw new NotFoundException('Tenant not found');
        return s;
    }

    async ensureTables(schemaName: string): Promise<void> {
        const cacheKey = `ctwa_cols:${schemaName}`;
        if (await this.redis.get(cacheKey)) return;
        try {
            await this.prisma.executeInTenantSchema(
                schemaName,
                `CREATE TABLE IF NOT EXISTS ctwa_attributions (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    contact_id UUID NOT NULL,
                    conversation_id UUID,
                    source_id TEXT NOT NULL,
                    source_type TEXT,
                    source_url TEXT,
                    headline TEXT,
                    body TEXT,
                    media_type TEXT,
                    ctwa_clid TEXT,
                    captured_at TIMESTAMPTZ DEFAULT NOW(),
                    UNIQUE(contact_id, source_id)
                )`,
                [],
            );
            await this.prisma.executeInTenantSchema(
                schemaName,
                `CREATE INDEX IF NOT EXISTS idx_ctwa_captured ON ctwa_attributions(captured_at)`,
                [],
            );
        } catch (e: any) {
            if (!/already exists|42P07|23505/.test(e.message || '')) throw e;
        }
        await this.redis.set(cacheKey, '1', 86400);
    }

    /** Capture an ad referral on first contact. Idempotent (keeps the first click per ad). */
    async captureReferral(tenantId: string, input: { contactId: string; conversationId?: string; referral: WaReferral }): Promise<void> {
        const ref = input.referral;
        if (!ref || (!ref.source_id && !ref.ctwa_clid)) return;
        try {
            const schemaName = await this.schema(tenantId);
            await this.ensureTables(schemaName);
            const sourceId = ref.source_id || ref.ctwa_clid || 'organic';
            await this.prisma.executeInTenantSchema(
                schemaName,
                `INSERT INTO ctwa_attributions
                    (contact_id, conversation_id, source_id, source_type, source_url, headline, body, media_type, ctwa_clid)
                 VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9)
                 ON CONFLICT (contact_id, source_id) DO NOTHING`,
                [
                    input.contactId, input.conversationId || null, sourceId,
                    ref.source_type || null, ref.source_url || null, ref.headline || null,
                    ref.body ? String(ref.body).slice(0, 500) : null, ref.media_type || null, ref.ctwa_clid || null,
                ],
            );
            this.logger.log(`[CTWA] Captured ad referral source=${sourceId} for contact ${input.contactId}`);
        } catch (e: any) {
            this.logger.warn(`[CTWA] captureReferral failed: ${e.message}`);
        }
    }

    private range(start?: string, end?: string): { start: string; end: string } {
        const e = end ? new Date(end) : new Date();
        const s = start ? new Date(start) : new Date(e.getTime() - 90 * 24 * 60 * 60 * 1000);
        return { start: s.toISOString(), end: e.toISOString() };
    }

    /** Overall CTWA funnel + revenue. */
    async getCtwaSummary(tenantId: string, start?: string, end?: string): Promise<any> {
        const schemaName = await this.schema(tenantId);
        await this.ensureTables(schemaName);
        const { start: s, end: e } = this.range(start, end);

        const clicksRow = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT COUNT(*)::int AS clicks, COUNT(DISTINCT source_id)::int AS ads
             FROM ctwa_attributions WHERE captured_at >= $1::timestamptz AND captured_at <= $2::timestamptz`,
            [s, e],
        );

        const funnel = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT
                COUNT(DISTINCT ca.contact_id)::int AS contacts,
                COUNT(DISTINCT l.id)::int AS leads,
                COUNT(DISTINCT CASE WHEN o.stage = 'ganado' THEN o.id END)::int AS won,
                COALESCE(SUM(CASE WHEN o.stage = 'ganado' THEN o.estimated_value ELSE 0 END), 0) AS revenue
             FROM ctwa_attributions ca
             LEFT JOIN leads l ON l.contact_id = ca.contact_id
             LEFT JOIN opportunities o ON o.lead_id = l.id
             WHERE ca.captured_at >= $1::timestamptz AND ca.captured_at <= $2::timestamptz`,
            [s, e],
        );

        const c = clicksRow?.[0] || {};
        const f = funnel?.[0] || {};
        const clicks = Number(c.clicks) || 0;
        const won = Number(f.won) || 0;
        return {
            clicks,
            ads: Number(c.ads) || 0,
            contacts: Number(f.contacts) || 0,
            leads: Number(f.leads) || 0,
            won,
            revenue: Math.round((Number(f.revenue) || 0) * 100) / 100,
            conversionRate: clicks > 0 ? Math.round((won / clicks) * 10000) / 100 : 0,
        };
    }

    /** Per-ad funnel + revenue. */
    async getCtwaByAd(tenantId: string, start?: string, end?: string): Promise<any[]> {
        const schemaName = await this.schema(tenantId);
        await this.ensureTables(schemaName);
        const { start: s, end: e } = this.range(start, end);

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT ca.source_id,
                    MAX(ca.headline) AS headline,
                    MAX(ca.source_url) AS source_url,
                    COUNT(DISTINCT ca.contact_id)::int AS clicks,
                    COUNT(DISTINCT l.id)::int AS leads,
                    COUNT(DISTINCT CASE WHEN o.stage = 'ganado' THEN o.id END)::int AS won,
                    COALESCE(SUM(CASE WHEN o.stage = 'ganado' THEN o.estimated_value ELSE 0 END), 0) AS revenue
             FROM ctwa_attributions ca
             LEFT JOIN leads l ON l.contact_id = ca.contact_id
             LEFT JOIN opportunities o ON o.lead_id = l.id
             WHERE ca.captured_at >= $1::timestamptz AND ca.captured_at <= $2::timestamptz
             GROUP BY ca.source_id
             ORDER BY revenue DESC, clicks DESC
             LIMIT 100`,
            [s, e],
        );
        return (rows || []).map((r) => {
            const clicks = Number(r.clicks) || 0;
            const won = Number(r.won) || 0;
            return {
                sourceId: r.source_id,
                headline: r.headline,
                sourceUrl: r.source_url,
                clicks,
                leads: Number(r.leads) || 0,
                won,
                revenue: Math.round((Number(r.revenue) || 0) * 100) / 100,
                conversionRate: clicks > 0 ? Math.round((won / clicks) * 10000) / 100 : 0,
            };
        });
    }

    /** Revenue attributed to broadcast campaigns (recipient → won opp within 30 days). */
    async getBroadcastRevenue(tenantId: string, start?: string, end?: string): Promise<any[]> {
        const schemaName = await this.schema(tenantId);
        const { start: s, end: e } = this.range(start, end);
        try {
            const rows = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT cr.campaign_id,
                        MAX(cam.name) AS campaign_name,
                        COUNT(DISTINCT cr.contact_id)::int AS recipients,
                        COUNT(DISTINCT CASE WHEN o.stage = 'ganado' THEN o.id END)::int AS won,
                        COALESCE(SUM(CASE WHEN o.stage = 'ganado' THEN o.estimated_value ELSE 0 END), 0) AS revenue
                 FROM campaign_recipients cr
                 LEFT JOIN campaigns cam ON cam.id = cr.campaign_id
                 LEFT JOIN leads l ON l.contact_id = cr.contact_id
                 LEFT JOIN opportunities o ON o.lead_id = l.id
                     AND o.won_at IS NOT NULL
                     AND o.won_at >= cr.created_at
                     AND o.won_at <= cr.created_at + INTERVAL '30 days'
                 WHERE cr.created_at >= $1::timestamptz AND cr.created_at <= $2::timestamptz
                 GROUP BY cr.campaign_id
                 ORDER BY revenue DESC
                 LIMIT 100`,
                [s, e],
            );
            return (rows || []).map((r) => ({
                campaignId: r.campaign_id,
                campaignName: r.campaign_name || '—',
                recipients: Number(r.recipients) || 0,
                won: Number(r.won) || 0,
                revenue: Math.round((Number(r.revenue) || 0) * 100) / 100,
            }));
        } catch (e: any) {
            this.logger.debug(`[Attribution] broadcast revenue skipped: ${e.message}`);
            return [];
        }
    }
}
