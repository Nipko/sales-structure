import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const OPEN_STAGES_FILTER = `stage NOT IN ('ganado', 'perdido', 'no_interesado')`;

/**
 * B2B Organizations (T3.21). Organizations map to the existing `companies`
 * table (non-primary rows — the primary company is the tenant's own business
 * identity). The canonical org↔contact link is the existing `leads.company_id`
 * FK, so we don't introduce a parallel system. Adds a few B2B profile columns.
 */
@Injectable()
export class OrganizationsService {
    private readonly logger = new Logger(OrganizationsService.name);

    constructor(private readonly prisma: PrismaService, private readonly redis: RedisService) {}

    private async schema(tenantId: string): Promise<string> {
        const s = await this.prisma.getTenantSchemaName(tenantId);
        if (!s) throw new NotFoundException('Tenant not found');
        return s;
    }

    async ensureColumns(schemaName: string): Promise<void> {
        const cacheKey = `org_cols:${schemaName}`;
        if (await this.redis.get(cacheKey)) return;
        const alters = [
            `ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT false`,
            `ALTER TABLE companies ADD COLUMN IF NOT EXISTS size VARCHAR(50)`,
            `ALTER TABLE companies ADD COLUMN IF NOT EXISTS domain VARCHAR(255)`,
            `ALTER TABLE companies ADD COLUMN IF NOT EXISTS notes TEXT`,
        ];
        for (const sql of alters) {
            try { await this.prisma.executeInTenantSchema(schemaName, sql, []); }
            catch (e: any) { if (!/already exists|42701|42P07/.test(e.message || '')) this.logger.warn(`[Org] alter skipped: ${e.message}`); }
        }
        await this.redis.set(cacheKey, '1', 86400);
    }

    async list(tenantId: string, search?: string): Promise<any[]> {
        const schemaName = await this.schema(tenantId);
        await this.ensureColumns(schemaName);
        const params: any[] = [];
        let where = `c.is_primary IS NOT TRUE`;
        if (search) { params.push(`%${search}%`); where += ` AND c.name ILIKE $${params.length}`; }

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT c.id, c.name, c.industry, c.city, c.country, c.website, c.domain, c.size, c.phone, c.email, c.notes, c.created_at,
                (SELECT COUNT(DISTINCT l.contact_id) FROM leads l WHERE l.company_id = c.id AND l.archived_at IS NULL) AS contact_count,
                (SELECT COUNT(*) FROM opportunities o JOIN leads l ON l.id = o.lead_id
                    WHERE l.company_id = c.id AND o.${OPEN_STAGES_FILTER}) AS open_opportunities,
                (SELECT COALESCE(SUM(o.estimated_value), 0) FROM opportunities o JOIN leads l ON l.id = o.lead_id
                    WHERE l.company_id = c.id AND o.${OPEN_STAGES_FILTER}) AS pipeline_value,
                (SELECT COALESCE(SUM(o.estimated_value * COALESCE(ps.default_probability, 0) / 100.0), 0)
                    FROM opportunities o JOIN leads l ON l.id = o.lead_id
                    LEFT JOIN pipeline_stages ps ON ps.slug = o.stage
                    WHERE l.company_id = c.id AND o.${OPEN_STAGES_FILTER}) AS weighted_value
             FROM companies c
             WHERE ${where}
             ORDER BY weighted_value DESC, c.name ASC
             LIMIT 200`,
            params,
        );
        return (rows || []).map((r) => this.mapOrg(r));
    }

    async get(tenantId: string, id: string): Promise<any | null> {
        const schemaName = await this.schema(tenantId);
        await this.ensureColumns(schemaName);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, name, industry, city, country, website, domain, size, phone, email, notes, created_at
             FROM companies WHERE id = $1::uuid AND is_primary IS NOT TRUE`,
            [id],
        );
        if (!rows?.length) return null;
        const org = this.mapOrg(rows[0]);

        const [members, opps] = await Promise.all([
            this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT DISTINCT co.id AS contact_id, co.name, co.email, co.phone, l.id AS lead_id, l.stage, l.score
                 FROM leads l JOIN contacts co ON co.id = l.contact_id
                 WHERE l.company_id = $1::uuid AND l.archived_at IS NULL
                 ORDER BY l.score DESC NULLS LAST LIMIT 200`,
                [id],
            ),
            this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT o.id, o.stage, o.estimated_value, o.currency, o.updated_at,
                        COALESCE(ps.default_probability, 0) AS probability,
                        (o.estimated_value * COALESCE(ps.default_probability, 0) / 100.0) AS weighted_value
                 FROM opportunities o JOIN leads l ON l.id = o.lead_id
                 LEFT JOIN pipeline_stages ps ON ps.slug = o.stage
                 WHERE l.company_id = $1::uuid AND o.${OPEN_STAGES_FILTER}
                 ORDER BY weighted_value DESC LIMIT 100`,
                [id],
            ),
        ]);

        return {
            ...org,
            members: (members || []).map((m) => ({
                contactId: m.contact_id, leadId: m.lead_id, name: m.name, email: m.email, phone: m.phone, stage: m.stage, score: Number(m.score) || 0,
            })),
            opportunities: (opps || []).map((o) => ({
                id: o.id, stage: o.stage, value: Number(o.estimated_value) || 0, currency: o.currency,
                probability: Number(o.probability) || 0, weightedValue: Math.round((Number(o.weighted_value) || 0) * 100) / 100,
                updatedAt: o.updated_at,
            })),
        };
    }

    async create(tenantId: string, dto: any): Promise<any> {
        const schemaName = await this.schema(tenantId);
        await this.ensureColumns(schemaName);
        if (!dto?.name?.trim()) throw new BadRequestException('El nombre es obligatorio');
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO companies (name, industry, city, country, website, domain, size, phone, email, notes, is_primary)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false)
             RETURNING id, name, industry, city, country, website, domain, size, phone, email, notes, created_at`,
            [dto.name.trim(), dto.industry || null, dto.city || null, dto.country || null, dto.website || null,
             dto.domain || null, dto.size || null, dto.phone || null, dto.email || null, dto.notes || null],
        );
        return this.mapOrg(rows[0]);
    }

    async update(tenantId: string, id: string, dto: any): Promise<any> {
        const schemaName = await this.schema(tenantId);
        await this.ensureColumns(schemaName);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE companies SET
                name = COALESCE($2, name), industry = $3, city = $4, country = $5, website = $6,
                domain = $7, size = $8, phone = $9, email = $10, notes = $11, updated_at = NOW()
             WHERE id = $1::uuid AND is_primary IS NOT TRUE
             RETURNING id, name, industry, city, country, website, domain, size, phone, email, notes, created_at`,
            [id, dto.name?.trim() || null, dto.industry || null, dto.city || null, dto.country || null, dto.website || null,
             dto.domain || null, dto.size || null, dto.phone || null, dto.email || null, dto.notes || null],
        );
        if (!rows?.length) throw new NotFoundException('Organización no encontrada');
        return this.mapOrg(rows[0]);
    }

    async remove(tenantId: string, id: string): Promise<void> {
        const schemaName = await this.schema(tenantId);
        // Detach leads then delete (FK is ON DELETE SET NULL, but be explicit).
        await this.prisma.executeInTenantSchema(schemaName, `UPDATE leads SET company_id = NULL WHERE company_id = $1::uuid`, [id]);
        await this.prisma.executeInTenantSchema(schemaName, `DELETE FROM companies WHERE id = $1::uuid AND is_primary IS NOT TRUE`, [id]);
    }

    /** Assign a lead (and thus its contact) to an organization. */
    async assignLead(tenantId: string, leadId: string, organizationId: string | null): Promise<void> {
        const schemaName = await this.schema(tenantId);
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE leads SET company_id = $2, updated_at = NOW() WHERE id = $1::uuid`,
            [leadId, organizationId],
        );
    }

    private mapOrg(r: any) {
        return {
            id: r.id, name: r.name, industry: r.industry, city: r.city, country: r.country,
            website: r.website, domain: r.domain, size: r.size, phone: r.phone, email: r.email, notes: r.notes,
            contactCount: r.contact_count != null ? Number(r.contact_count) : undefined,
            openOpportunities: r.open_opportunities != null ? Number(r.open_opportunities) : undefined,
            pipelineValue: r.pipeline_value != null ? Number(r.pipeline_value) : undefined,
            weightedValue: r.weighted_value != null ? Math.round(Number(r.weighted_value) * 100) / 100 : undefined,
            createdAt: r.created_at,
        };
    }
}
