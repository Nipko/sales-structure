import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
    optionalPositiveIntegerUnit,
} from '../../common/utils/commercial-units.util';
import { resolveWriteCurrency, type OperatingCurrencySource } from '../../common/utils/write-currency.util';
import { RegionalProfileService } from '../tenants/regional-profile.service';

@Injectable()
export class CatalogService {
    private readonly logger = new Logger(CatalogService.name);

    constructor(
        private readonly prisma: PrismaService,
        /**
         * Opcional en la FIRMA únicamente, para que los fixtures que construyen
         * este servicio a mano sigan compilando. Sin `@Optional()`, Nest exige
         * el proveedor: `RegionalProfileModule` es global y si un día dejara de
         * estarlo, el arranque falla en vez de escribir NULL para todos y
         * parecer que ningún negocio declaró su país.
         */
        private readonly regional?: RegionalProfileService,
    ) {}

    /** D17: explícito → moneda operativa del negocio → NULL. */
    private writeCurrency(requested: unknown, tenantId?: string): Promise<string | null> {
        return resolveWriteCurrency(requested, tenantId, this.regional as OperatingCurrencySource | undefined);
    }

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
            `SELECT * FROM courses WHERE id = $1::uuid`,
            [id]
        );
        return rows[0] || null;
    }

    async createCourse(schemaName: string, data: any, tenantId?: string) {
        const durationHours = optionalPositiveIntegerUnit(
            data.duration_hours ?? data.durationHours,
            'durationHours',
        );
        const currency = await this.writeCurrency(data.currency, tenantId);
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
                currency,
                durationHours,
                data.modality || 'presencial',
                data.brochure_url || null,
                data.is_active ?? true
            ]
        );
        return rows[0];
    }

    async updateCourse(schemaName: string, id: string, data: any, tenantId?: string) {
        const durationInput = data.duration_hours ?? data.durationHours;
        const durationHours = durationInput === undefined
            ? undefined
            : optionalPositiveIntegerUnit(durationInput, 'durationHours');
        // El UPDATE es por `COALESCE`, así que un NULL acá significa "dejá lo
        // que había" y no "vaciá la celda". Es la única lectura posible con esa
        // forma de SQL, y sigue siendo lo correcto: no se sabe la moneda, así
        // que no se escribe ninguna — mucho menos COP.
        const currency = data.currency === undefined
            ? undefined
            : await this.writeCurrency(data.currency, tenantId);
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE courses
             SET name = COALESCE($2, name),
                 description = COALESCE($3, description),
                 price = COALESCE($4, price),
                 modality = COALESCE($5, modality),
                 brochure_url = COALESCE($6, brochure_url),
                 is_active = COALESCE($7, is_active),
                 currency = COALESCE($8, currency),
                 duration_hours = COALESCE($9, duration_hours),
                 updated_at = NOW()
             WHERE id = $1::uuid RETURNING *`,
            [
                id, data.name, data.description, data.price, data.modality,
                data.brochure_url, data.is_active, currency, durationHours,
            ]
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
             WHERE c.id = $1::uuid`,
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
             WHERE id = $1::uuid RETURNING *`,
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
             VALUES ($1, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9) RETURNING *`,
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
