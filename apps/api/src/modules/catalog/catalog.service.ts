import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CatalogService {
    private readonly logger = new Logger(CatalogService.name);

    constructor(private readonly prisma: PrismaService) {}

    // ─── Courses ──────────────────────────────────────────────────────────────

    async getCourses(schemaName: string) {
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM courses ORDER BY created_at DESC`
        );
    }

    async getCourseById(schemaName: string, id: string) {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM courses WHERE id = $1`,
            [id]
        );
        return rows[0] || null;
    }

    async createCourse(schemaName: string, data: any) {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO courses (code, name, slug, description, price, currency, duration_hours, modality, brochure_url, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
            [
                data.code || null,
                data.name,
                data.slug || data.name.toLowerCase().replace(/\s+/g, '-'),
                data.description || '',
                data.price || 0,
                data.currency || 'COP',
                data.duration_hours || null,
                data.modality || 'presencial',
                data.brochure_url || null,
                data.is_active ?? true
            ]
        );
        return rows[0];
    }

    async updateCourse(schemaName: string, id: string, data: any) {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE courses
             SET name = COALESCE($2, name),
                 description = COALESCE($3, description),
                 price = COALESCE($4, price),
                 modality = COALESCE($5, modality),
                 brochure_url = COALESCE($6, brochure_url),
                 is_active = COALESCE($7, is_active),
                 updated_at = NOW()
             WHERE id = $1 RETURNING *`,
            [id, data.name, data.description, data.price, data.modality, data.brochure_url, data.is_active]
        );
        return rows[0];
    }

    // ─── Campaigns ────────────────────────────────────────────────────────────

    async getCampaigns(schemaName: string) {
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT c.*, co.name AS course_name
             FROM campaigns c
             LEFT JOIN courses co ON co.id = c.course_id
             ORDER BY c.created_at DESC`
        );
    }

    async getCampaignById(schemaName: string, id: string) {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT c.*, co.name AS course_name
             FROM campaigns c
             LEFT JOIN courses co ON co.id = c.course_id
             WHERE c.id = $1`,
            [id]
        );
        return rows[0] || null;
    }

    async createCampaign(schemaName: string, data: any) {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO campaigns (code, name, course_id, source_type, channel, wa_template_name, status, schedule_json, default_owner_rule, fallback_email)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
            [
                data.code || null,
                data.name,
                data.course_id || null,
                data.source_type || 'landing',
                data.channel || 'whatsapp',
                data.wa_template_name || null,
                data.status || 'draft',
                JSON.stringify(data.schedule_json || {}),
                data.default_owner_rule || null,
                data.fallback_email ?? false
            ]
        );
        return rows[0];
    }

    async updateCampaign(schemaName: string, id: string, data: any) {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE campaigns
             SET name = COALESCE($2, name),
                 status = COALESCE($3, status),
                 wa_template_name = COALESCE($4, wa_template_name),
                 fallback_email = COALESCE($5, fallback_email),
                 updated_at = NOW()
             WHERE id = $1 RETURNING *`,
            [id, data.name, data.status, data.wa_template_name, data.fallback_email]
        );
        return rows[0];
    }

    // ─── Commercial Offers ────────────────────────────────────────────────────

    async getOffers(schemaName: string) {
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT o.*, co.name AS course_name
             FROM commercial_offers o
             LEFT JOIN courses co ON co.id = o.course_id
             ORDER BY o.created_at DESC`
        );
    }

    async createOffer(schemaName: string, data: any) {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO commercial_offers (tenant_id, course_id, campaign_id, offer_type, title, conditions_json, valid_from, valid_to, active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [
                data.tenant_id,
                data.course_id || null,
                data.campaign_id || null,
                data.offer_type,
                data.title,
                JSON.stringify(data.conditions_json || {}),
                data.valid_from || null,
                data.valid_to || null,
                data.active ?? true
            ]
        );
        return rows[0];
    }
}
