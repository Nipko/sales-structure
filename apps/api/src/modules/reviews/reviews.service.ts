import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { google } from 'googleapis';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { LLMRouterService } from '../ai/router/llm-router.service';
import { rmsg } from './reviews-i18n';
import { mutateTenantSettingsBranchAtomic } from '../../common/utils/tenant-settings-branch.util';

const STAR_MAP: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
const GBP_BASE = 'https://mybusiness.googleapis.com/v4';

interface GbpConfig {
    encryptedRefreshToken?: string;
    accountId?: string;
    locationId?: string;
    locationName?: string;
    connectedEmail?: string;
    autoReply?: boolean;
}

/**
 * Reviews & reputation (T3.23) — connect Google Business Profile, sync reviews,
 * and reply with AI in the tenant's configured language (Podium/Birdeye-style). GBP tokens are stored
 * encrypted in tenant.settings.googleBusiness; reviews cached in `gbp_reviews`.
 */
@Injectable()
export class ReviewsService {
    private readonly logger = new Logger(ReviewsService.name);
    private readonly encryptionKey: Buffer;
    private readonly clientId: string;
    private readonly clientSecret: string;
    private readonly redirectUri: string;

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly llmRouter: LLMRouterService,
        private readonly http: HttpService,
        config: ConfigService,
    ) {
        const key = config.get<string>('ENCRYPTION_KEY', '');
        this.encryptionKey = Buffer.from(key.padEnd(64, '0').slice(0, 64), 'hex');
        this.clientId = config.get('GOOGLE_OAUTH_CLIENT_ID', '');
        this.clientSecret = config.get('GOOGLE_OAUTH_CLIENT_SECRET', '');
        this.redirectUri = config.get('GOOGLE_BUSINESS_REDIRECT_URI',
            `${config.get('API_URL', 'https://api.parallly-chat.cloud')}/api/v1/reviews/google/callback`);
    }

    // ── OAuth ────────────────────────────────────────────────
    async getAuthUrl(tenantId: string): Promise<string> {
        const oauth2 = new google.auth.OAuth2(this.clientId, this.clientSecret, this.redirectUri);
        // CSRF / cross-tenant protection: bind a single-use random nonce to the
        // authenticated tenant and use it as the OAuth `state`. Sending the raw
        // tenantId would let the public callback connect a Google account to any
        // tenant an attacker names in `state`.
        const nonce = crypto.randomBytes(32).toString('hex');
        await this.redis.set(`gbp:oauth:${nonce}`, tenantId, 600); // 10 min TTL
        return oauth2.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            scope: ['https://www.googleapis.com/auth/business.manage'],
            state: nonce,
        });
    }

    async handleCallback(code: string, state: string): Promise<void> {
        // Resolve the tenant from the single-use nonce — never trust `state` as a
        // raw tenantId.
        const nonceKey = `gbp:oauth:${state}`;
        const tenantId = await this.redis.get(nonceKey);
        if (!tenantId) throw new BadRequestException(rmsg(null, 'oauth.invalidState'));
        await this.redis.del(nonceKey); // single use
        const oauth2 = new google.auth.OAuth2(this.clientId, this.clientSecret, this.redirectUri);
        const { tokens } = await oauth2.getToken(code);
        if (!tokens.refresh_token) throw new BadRequestException(rmsg(null, 'oauth.noRefreshToken'));
        const encryptedRefreshToken = this.encrypt(tokens.refresh_token);
        await mutateTenantSettingsBranchAtomic(
            this.prisma,
            tenantId,
            'googleBusiness',
            (value): GbpConfig => ({
                ...((value && typeof value === 'object' ? value : {}) as GbpConfig),
                encryptedRefreshToken,
            }),
        );
    }

    private async getAccessToken(tenantId: string, lang?: string): Promise<string> {
        const cfg = await this.getConfigRaw(tenantId);
        if (!cfg.encryptedRefreshToken) throw new BadRequestException(rmsg(lang, 'oauth.notConnected'));
        const oauth2 = new google.auth.OAuth2(this.clientId, this.clientSecret, this.redirectUri);
        oauth2.setCredentials({ refresh_token: this.decrypt(cfg.encryptedRefreshToken) });
        const { token } = await oauth2.getAccessToken();
        if (!token) throw new BadRequestException(rmsg(lang, 'oauth.accessTokenFailed'));
        return token;
    }

    // ── Config (tenant.settings.googleBusiness) ──────────────
    private async getConfigRaw(tenantId: string): Promise<GbpConfig> {
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
        return ((tenant?.settings as any)?.googleBusiness as GbpConfig) || {};
    }
    private async saveConfigRaw(tenantId: string, cfg: GbpConfig): Promise<void> {
        await mutateTenantSettingsBranchAtomic(
            this.prisma,
            tenantId,
            'googleBusiness',
            () => ({ ...cfg }),
        );
    }

    async getConfig(tenantId: string): Promise<any> {
        const cfg = await this.getConfigRaw(tenantId);
        return {
            connected: !!cfg.encryptedRefreshToken,
            accountId: cfg.accountId || null,
            locationId: cfg.locationId || null,
            locationName: cfg.locationName || null,
            connectedEmail: cfg.connectedEmail || null,
            autoReply: !!cfg.autoReply,
        };
    }

    async updateConfig(tenantId: string, patch: { accountId?: string; locationId?: string; locationName?: string; autoReply?: boolean }): Promise<any> {
        await mutateTenantSettingsBranchAtomic(
            this.prisma,
            tenantId,
            'googleBusiness',
            (value): GbpConfig => ({
                ...((value && typeof value === 'object' ? value : {}) as GbpConfig),
                ...(patch.accountId !== undefined ? { accountId: patch.accountId } : {}),
                ...(patch.locationId !== undefined ? { locationId: patch.locationId } : {}),
                ...(patch.locationName !== undefined ? { locationName: patch.locationName } : {}),
                ...(patch.autoReply !== undefined ? { autoReply: patch.autoReply } : {}),
            }),
        );
        return this.getConfig(tenantId);
    }

    async disconnect(tenantId: string): Promise<void> {
        await this.saveConfigRaw(tenantId, {});
    }

    // ── Tables ───────────────────────────────────────────────
    async ensureTables(schemaName: string): Promise<void> {
        const cacheKey = `gbp_cols:${schemaName}`;
        if (await this.redis.get(cacheKey)) return;
        try {
            await this.prisma.executeInTenantSchema(
                schemaName,
                `CREATE TABLE IF NOT EXISTS gbp_reviews (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    review_name TEXT UNIQUE NOT NULL,
                    reviewer_name TEXT,
                    reviewer_photo TEXT,
                    rating INTEGER,
                    comment TEXT,
                    create_time TIMESTAMPTZ,
                    reply_comment TEXT,
                    reply_status VARCHAR(20) DEFAULT 'none',
                    ai_suggestion TEXT,
                    synced_at TIMESTAMPTZ DEFAULT NOW()
                )`,
                [],
            );
            await this.prisma.executeInTenantSchema(schemaName, `CREATE INDEX IF NOT EXISTS idx_gbp_created ON gbp_reviews(create_time)`, []);
        } catch (e: any) {
            if (!/already exists|42P07|23505/.test(e.message || '')) throw e;
        }
        await this.redis.set(cacheKey, '1', 86400);
    }

    private reviewParent(cfg: GbpConfig): string {
        return `accounts/${cfg.accountId}/locations/${cfg.locationId}`;
    }

    // ── Sync reviews from GBP ────────────────────────────────
    async syncReviews(tenantId: string): Promise<{ synced: number }> {
        const cfg = await this.getConfigRaw(tenantId);
        const lang = await this.getTenantLanguage(tenantId);
        if (!cfg.accountId || !cfg.locationId) throw new BadRequestException(rmsg(lang, 'sync.missingAccountLocation'));
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.ensureTables(schemaName);
        const token = await this.getAccessToken(tenantId, lang);

        const res = await this.http.axiosRef.get(`${GBP_BASE}/${this.reviewParent(cfg)}/reviews`, {
            headers: { Authorization: `Bearer ${token}` },
            params: { pageSize: 50, orderBy: 'updateTime desc' },
            timeout: 30000,
        });
        const reviews = res.data?.reviews || [];
        let synced = 0;
        for (const r of reviews) {
            const rating = STAR_MAP[r.starRating] || null;
            const replyComment = r.reviewReply?.comment || null;
            await this.prisma.executeInTenantSchema(
                schemaName,
                `INSERT INTO gbp_reviews (review_name, reviewer_name, reviewer_photo, rating, comment, create_time, reply_comment, reply_status, synced_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                 ON CONFLICT (review_name) DO UPDATE SET
                    rating = EXCLUDED.rating, comment = EXCLUDED.comment,
                    reply_comment = EXCLUDED.reply_comment,
                    reply_status = CASE WHEN EXCLUDED.reply_comment IS NOT NULL THEN 'posted' ELSE gbp_reviews.reply_status END,
                    synced_at = NOW()`,
                [
                    r.name, r.reviewer?.displayName || rmsg(lang, 'review.anonymousReviewer'), r.reviewer?.profilePhotoUrl || null,
                    rating, r.comment || null, r.createTime || null, replyComment,
                    replyComment ? 'posted' : 'none',
                ],
            );
            synced++;
        }
        this.logger.log(`[Reviews] Synced ${synced} reviews for tenant ${tenantId}`);
        return { synced };
    }

    async listReviews(tenantId: string, filter?: { unreplied?: boolean }): Promise<any[]> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.ensureTables(schemaName);
        const where = filter?.unreplied ? `WHERE reply_status != 'posted'` : '';
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, review_name, reviewer_name, reviewer_photo, rating, comment, create_time,
                    reply_comment, reply_status, ai_suggestion
             FROM gbp_reviews ${where}
             ORDER BY create_time DESC NULLS LAST LIMIT 200`,
            [],
        );
        return (rows || []).map((r) => ({
            id: r.id, reviewName: r.review_name, reviewer: r.reviewer_name, photo: r.reviewer_photo,
            rating: r.rating, comment: r.comment, createdAt: r.create_time,
            replyComment: r.reply_comment, replyStatus: r.reply_status, aiSuggestion: r.ai_suggestion,
        }));
    }

    async getStats(tenantId: string): Promise<any> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        await this.ensureTables(schemaName);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT COUNT(*)::int AS total,
                    COALESCE(ROUND(AVG(rating)::numeric, 2), 0) AS avg_rating,
                    COUNT(*) FILTER (WHERE reply_status != 'posted' AND reply_comment IS NULL)::int AS unreplied,
                    COUNT(*) FILTER (WHERE rating <= 2)::int AS negative,
                    COUNT(*) FILTER (WHERE rating >= 4)::int AS positive
             FROM gbp_reviews`,
            [],
        );
        const r = rows?.[0] || {};
        return {
            total: Number(r.total) || 0,
            avgRating: Number(r.avg_rating) || 0,
            unreplied: Number(r.unreplied) || 0,
            negative: Number(r.negative) || 0,
            positive: Number(r.positive) || 0,
        };
    }

    // ── AI reply (tenant language) ───────────────────────────
    async generateReply(tenantId: string, reviewId: string): Promise<{ suggestion: string }> {
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName, `SELECT reviewer_name, rating, comment FROM gbp_reviews WHERE id = $1::uuid`, [reviewId],
        );
        const review = rows?.[0];
        const lang = await this.getTenantLanguage(tenantId);
        if (!review) throw new NotFoundException(rmsg(lang, 'review.notFound'));

        const businessName = await this.businessName(tenantId, lang);
        const langInstruction = rmsg(lang, 'prompt.langInstruction');
        const systemPrompt = `You are the reputation manager of "${businessName}". Write a public reply to a Google review, ${langInstruction}.
Rules:
- Warm, professional and human tone. Always thank the reviewer.
- If the review is negative (1-2 stars): apologize with empathy, do not over-justify, offer to resolve privately and invite them to contact you.
- If positive (4-5 stars): thank warmly and reinforce the relationship.
- Maximum 60 words. No excessive emojis (maximum 1). Do not invent data or make concrete promises.
- Personalise with the customer's name if available.
Return ONLY the reply text.`;

        const labelClient = rmsg(lang, 'prompt.labelClient');
        const labelStars = rmsg(lang, 'prompt.labelStars');
        const labelReview = rmsg(lang, 'prompt.labelReview');
        const noText = rmsg(lang, 'review.noText');
        const userPrompt = `${labelClient}: ${review.reviewer_name || labelClient}\n${labelStars}: ${review.rating || '?'}/5\n${labelReview}: "${review.comment || noText}"`;

        const res = await this.llmRouter.execute({
            task: 'conversation',
            allowedTiers: ['tier_2_standard', 'tier_3_efficient'],
            messages: [{ role: 'user', content: userPrompt }],
            systemPrompt,
            temperature: 0.6,
            maxTokens: 200,
            tenantId,
        });
        const suggestion = (res.content || '').trim().slice(0, 800);
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE gbp_reviews SET ai_suggestion = $2, reply_status = CASE WHEN reply_status = 'posted' THEN 'posted' ELSE 'suggested' END WHERE id = $1::uuid`,
            [reviewId, suggestion],
        );
        return { suggestion };
    }

    async postReply(tenantId: string, reviewId: string, comment: string): Promise<void> {
        const lang = await this.getTenantLanguage(tenantId);
        if (!comment?.trim()) throw new BadRequestException(rmsg(lang, 'reply.empty'));
        const cfg = await this.getConfigRaw(tenantId);
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName, `SELECT review_name FROM gbp_reviews WHERE id = $1::uuid`, [reviewId],
        );
        const reviewName = rows?.[0]?.review_name;
        if (!reviewName) throw new NotFoundException(rmsg(lang, 'review.notFound'));

        const token = await this.getAccessToken(tenantId, lang);
        await this.http.axiosRef.put(`${GBP_BASE}/${reviewName}/reply`, { comment: comment.trim() }, {
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 20000,
        });
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE gbp_reviews SET reply_comment = $2, reply_status = 'posted' WHERE id = $1::uuid`,
            [reviewId, comment.trim()],
        );
        this.logger.log(`[Reviews] Posted reply to ${reviewName}`);
    }

    /** Used by the auto-reply cron: generate + post for unreplied reviews. */
    async autoReplyUnreplied(tenantId: string): Promise<number> {
        const reviews = await this.listReviews(tenantId, { unreplied: true });
        let count = 0;
        for (const r of reviews.slice(0, 20)) {
            try {
                const { suggestion } = await this.generateReply(tenantId, r.id);
                await this.postReply(tenantId, r.id, suggestion);
                count++;
            } catch (e: any) {
                this.logger.debug(`[Reviews] auto-reply ${r.id} failed: ${e.message}`);
            }
        }
        return count;
    }

    async isAutoReplyEnabled(tenantId: string): Promise<boolean> {
        const cfg = await this.getConfigRaw(tenantId);
        return !!(cfg.autoReply && cfg.encryptedRefreshToken && cfg.accountId && cfg.locationId);
    }

    private async businessName(tenantId: string, lang?: string): Promise<string> {
        const fallback = rmsg(lang, 'prompt.fallbackBusiness');
        try {
            const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
            return tenant?.name || fallback;
        } catch { return fallback; }
    }

    /**
     * Resolves tenant's configured language as a 2-char code (es/en/pt/fr),
     * falling back to 'es'. tenant.language is stored as a full locale (e.g. 'es-CO').
     */
    private async getTenantLanguage(tenantId: string): Promise<string> {
        try {
            const tenant = await this.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { language: true },
            });
            return (tenant?.language || 'es').slice(0, 2).toLowerCase();
        } catch {
            return 'es';
        }
    }

    private encrypt(text: string): string {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
        let enc = cipher.update(text, 'utf8', 'hex');
        enc += cipher.final('hex');
        return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc}`;
    }
    private decrypt(encryptedText: string): string {
        const [ivHex, tagHex, enc] = encryptedText.split(':');
        const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, Buffer.from(ivHex, 'hex'));
        decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
        let dec = decipher.update(enc, 'hex', 'utf8');
        dec += decipher.final('utf8');
        return dec;
    }
}
