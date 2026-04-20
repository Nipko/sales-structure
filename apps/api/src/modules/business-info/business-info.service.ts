import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { TenantsService } from '../tenants/tenants.service';
import type { BusinessIdentity, SocialLinks } from '@parallext/shared';

/**
 * Business Identity service — owns the "who the business is" data that the
 * agent surfaces to customers: company name, about, phone, email, address,
 * website, socials, logo.
 *
 * Stored as one primary row in the per-tenant `companies` table. The column
 * set was extended by the Apr 2026 refactor (phone/email/about/address/
 * logo_url/social_links/is_primary).
 */
@Injectable()
export class BusinessInfoService {
    private readonly logger = new Logger(BusinessInfoService.name);
    private readonly initialized = new Set<string>();

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly tenantsService: TenantsService,
    ) {}

    /** Idempotent: ensure the companies extensions exist for older tenants. */
    private async ensureSchema(tenantId: string): Promise<string> {
        const schemaName = await this.tenantsService.getSchemaName(tenantId);
        if (this.initialized.has(tenantId)) return schemaName;

        const stmts = [
            `ALTER TABLE "${schemaName}"."companies" ADD COLUMN IF NOT EXISTS "phone"        VARCHAR(50)`,
            `ALTER TABLE "${schemaName}"."companies" ADD COLUMN IF NOT EXISTS "email"        VARCHAR(255)`,
            `ALTER TABLE "${schemaName}"."companies" ADD COLUMN IF NOT EXISTS "about"        TEXT`,
            `ALTER TABLE "${schemaName}"."companies" ADD COLUMN IF NOT EXISTS "address"      TEXT`,
            `ALTER TABLE "${schemaName}"."companies" ADD COLUMN IF NOT EXISTS "logo_url"     VARCHAR(500)`,
            `ALTER TABLE "${schemaName}"."companies" ADD COLUMN IF NOT EXISTS "social_links" JSONB DEFAULT '{}'`,
            `ALTER TABLE "${schemaName}"."companies" ADD COLUMN IF NOT EXISTS "is_primary"   BOOLEAN DEFAULT false`,
            `CREATE UNIQUE INDEX IF NOT EXISTS "idx_companies_primary_${schemaName}" ON "${schemaName}"."companies" ("is_primary") WHERE "is_primary" = true`,
        ];
        for (const sql of stmts) {
            try { await this.prisma.$executeRawUnsafe(sql); }
            catch (e: any) { this.logger.warn(`ensureSchema stmt failed (non-fatal): ${e.message}`); }
        }
        this.initialized.add(tenantId);
        return schemaName;
    }

    /**
     * Get the primary business identity for a tenant. Returns null if none
     * is configured yet (new tenants must set it up in Settings → Business Info).
     * Cached in Redis for 10 min.
     */
    async getPrimary(tenantId: string): Promise<BusinessIdentity | null> {
        const cacheKey = `business-info:${tenantId}:primary`;
        const cached = await this.redis.getJson<BusinessIdentity>(cacheKey);
        if (cached) return cached;

        const schemaName = await this.ensureSchema(tenantId);
        const rows = await this.prisma.$queryRawUnsafe(
            `SELECT id, name, industry, city, country, website, phone, email, about, address, logo_url, social_links, is_primary, created_at, updated_at
             FROM "${schemaName}"."companies"
             WHERE is_primary = true
             LIMIT 1`,
        ) as any[];

        if (rows.length === 0) {
            // Fallback: pick the most recently updated row if no explicit primary
            const fallback = await this.prisma.$queryRawUnsafe(
                `SELECT id, name, industry, city, country, website, phone, email, about, address, logo_url, social_links, is_primary, created_at, updated_at
                 FROM "${schemaName}"."companies"
                 ORDER BY updated_at DESC
                 LIMIT 1`,
            ) as any[];
            if (fallback.length === 0) return null;
            const identity = this.rowToIdentity(tenantId, fallback[0]);
            await this.redis.setJson(cacheKey, identity, 600);
            return identity;
        }

        const identity = this.rowToIdentity(tenantId, rows[0]);
        await this.redis.setJson(cacheKey, identity, 600);
        return identity;
    }

    /**
     * Create or update the primary business identity. If a primary row exists,
     * it is updated; otherwise a new one is created and marked primary.
     */
    async upsertPrimary(tenantId: string, input: UpsertBusinessIdentityInput): Promise<BusinessIdentity> {
        const schemaName = await this.ensureSchema(tenantId);

        const existing = await this.prisma.$queryRawUnsafe(
            `SELECT id FROM "${schemaName}"."companies" WHERE is_primary = true LIMIT 1`,
        ) as any[];

        const social = input.socialLinks ? JSON.stringify(input.socialLinks) : null;

        if (existing.length === 0) {
            // Demote any existing non-primary to keep the invariant clean, then insert
            const rows = await this.prisma.$queryRawUnsafe(
                `INSERT INTO "${schemaName}"."companies"
                   (name, industry, city, country, website, phone, email, about, address, logo_url, social_links, is_primary, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11::jsonb, '{}'::jsonb), true, NOW())
                 RETURNING id, name, industry, city, country, website, phone, email, about, address, logo_url, social_links, is_primary, created_at, updated_at`,
                input.companyName,
                input.industry ?? null,
                input.city ?? null,
                input.country ?? null,
                input.website ?? null,
                input.phone ?? null,
                input.email ?? null,
                input.about ?? null,
                input.address ?? null,
                input.logoUrl ?? null,
                social,
            ) as any[];
            await this.invalidateCache(tenantId);
            return this.rowToIdentity(tenantId, rows[0]);
        }

        const rows = await this.prisma.$queryRawUnsafe(
            `UPDATE "${schemaName}"."companies"
                SET name = $1,
                    industry = $2,
                    city = $3,
                    country = $4,
                    website = $5,
                    phone = $6,
                    email = $7,
                    about = $8,
                    address = $9,
                    logo_url = $10,
                    social_links = COALESCE($11::jsonb, social_links),
                    updated_at = NOW()
              WHERE id = $12::uuid
              RETURNING id, name, industry, city, country, website, phone, email, about, address, logo_url, social_links, is_primary, created_at, updated_at`,
            input.companyName,
            input.industry ?? null,
            input.city ?? null,
            input.country ?? null,
            input.website ?? null,
            input.phone ?? null,
            input.email ?? null,
            input.about ?? null,
            input.address ?? null,
            input.logoUrl ?? null,
            social,
            existing[0].id,
        ) as any[];

        await this.invalidateCache(tenantId);
        return this.rowToIdentity(tenantId, rows[0]);
    }

    /** Public endpoint lookup by tenant slug (no auth). */
    async getPublicBySlug(slug: string): Promise<BusinessIdentity | null> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { slug },
            select: { id: true },
        });
        if (!tenant) throw new NotFoundException('Tenant not found');
        return this.getPrimary(tenant.id);
    }

    private async invalidateCache(tenantId: string): Promise<void> {
        await this.redis.del(`business-info:${tenantId}:primary`);
    }

    private rowToIdentity(tenantId: string, row: any): BusinessIdentity {
        const social = row.social_links;
        const socialLinks: SocialLinks | undefined = social && typeof social === 'object' && Object.keys(social).length > 0
            ? social
            : undefined;
        return {
            id: row.id,
            tenantId,
            companyName: row.name,
            industry: row.industry ?? undefined,
            about: row.about ?? undefined,
            phone: row.phone ?? undefined,
            email: row.email ?? undefined,
            website: row.website ?? undefined,
            address: row.address ?? undefined,
            city: row.city ?? undefined,
            country: row.country ?? undefined,
            logoUrl: row.logo_url ?? undefined,
            socialLinks,
            isPrimary: !!row.is_primary,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}

export interface UpsertBusinessIdentityInput {
    companyName: string;
    industry?: string;
    about?: string;
    phone?: string;
    email?: string;
    website?: string;
    address?: string;
    city?: string;
    country?: string;
    logoUrl?: string;
    socialLinks?: SocialLinks;
}
