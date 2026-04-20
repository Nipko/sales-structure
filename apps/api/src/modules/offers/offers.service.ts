import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantsService } from '../tenants/tenants.service';

export type OfferType = 'discount' | 'promo' | 'bundle';

export interface Offer {
    id: string;
    courseId?: string;
    campaignId?: string;
    offerType: OfferType;
    title: string;
    conditions: Record<string, unknown>;
    validFrom?: Date;
    validTo?: Date;
    active: boolean;
    createdAt: Date;
}

export interface UpsertOfferInput {
    offerType: OfferType;
    title: string;
    conditions?: Record<string, unknown>;
    courseId?: string;
    campaignId?: string;
    validFrom?: string;
    validTo?: string;
    active?: boolean;
}

/**
 * Offers service — CRUD over the existing `commercial_offers` table.
 *
 * The table pre-existed; this module exposes it to the dashboard and to the
 * agent (via the list_active_offers tool). Nothing is computed here — the
 * agent always gets live data straight from the DB so tenants can rotate
 * promotions without touching code.
 */
@Injectable()
export class OffersService {
    private readonly logger = new Logger(OffersService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantsService: TenantsService,
    ) {}

    async list(tenantId: string): Promise<Offer[]> {
        const schemaName = await this.tenantsService.getSchemaName(tenantId);
        const rows = await this.prisma.$queryRawUnsafe(
            `SELECT o.id, o.course_id, o.campaign_id, o.offer_type, o.title, o.conditions_json,
                    o.valid_from, o.valid_to, o.active, o.created_at,
                    c.name AS course_name
             FROM "${schemaName}"."commercial_offers" o
             LEFT JOIN "${schemaName}"."courses" c ON c.id = o.course_id
             ORDER BY o.created_at DESC`,
        ) as any[];
        return rows.map(r => this.rowToOffer(r));
    }

    async listActive(tenantId: string, limit = 20): Promise<Offer[]> {
        const schemaName = await this.tenantsService.getSchemaName(tenantId);
        const rows = await this.prisma.$queryRawUnsafe(
            `SELECT id, course_id, campaign_id, offer_type, title, conditions_json,
                    valid_from, valid_to, active, created_at
             FROM "${schemaName}"."commercial_offers"
             WHERE active = true
               AND (valid_from IS NULL OR valid_from <= NOW())
               AND (valid_to   IS NULL OR valid_to   >= NOW())
             ORDER BY valid_from DESC NULLS LAST
             LIMIT $1`,
            limit,
        ) as any[];
        return rows.map(r => this.rowToOffer(r));
    }

    async create(tenantId: string, input: UpsertOfferInput): Promise<Offer> {
        const schemaName = await this.tenantsService.getSchemaName(tenantId);
        const rows = await this.prisma.$queryRawUnsafe(
            `INSERT INTO "${schemaName}"."commercial_offers"
                (tenant_id, course_id, campaign_id, offer_type, title, conditions_json, valid_from, valid_to, active)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamp, $8::timestamp, $9)
             RETURNING id, course_id, campaign_id, offer_type, title, conditions_json, valid_from, valid_to, active, created_at`,
            tenantId,
            input.courseId ?? null,
            input.campaignId ?? null,
            input.offerType,
            input.title,
            JSON.stringify(input.conditions ?? {}),
            input.validFrom ?? null,
            input.validTo ?? null,
            input.active !== false,
        ) as any[];
        return this.rowToOffer(rows[0]);
    }

    async update(tenantId: string, id: string, input: Partial<UpsertOfferInput>): Promise<Offer> {
        const schemaName = await this.tenantsService.getSchemaName(tenantId);
        const sets: string[] = [];
        const params: any[] = [];
        let idx = 1;
        if (input.offerType !== undefined) { sets.push(`offer_type = $${idx++}`); params.push(input.offerType); }
        if (input.title !== undefined) { sets.push(`title = $${idx++}`); params.push(input.title); }
        if (input.conditions !== undefined) { sets.push(`conditions_json = $${idx++}::jsonb`); params.push(JSON.stringify(input.conditions)); }
        if (input.courseId !== undefined) { sets.push(`course_id = $${idx++}`); params.push(input.courseId || null); }
        if (input.campaignId !== undefined) { sets.push(`campaign_id = $${idx++}`); params.push(input.campaignId || null); }
        if (input.validFrom !== undefined) { sets.push(`valid_from = $${idx++}::timestamp`); params.push(input.validFrom || null); }
        if (input.validTo !== undefined) { sets.push(`valid_to = $${idx++}::timestamp`); params.push(input.validTo || null); }
        if (input.active !== undefined) { sets.push(`active = $${idx++}`); params.push(input.active); }
        if (sets.length === 0) return this.get(tenantId, id);
        params.push(id);
        const rows = await this.prisma.$queryRawUnsafe(
            `UPDATE "${schemaName}"."commercial_offers" SET ${sets.join(', ')}
             WHERE id = $${idx}::uuid
             RETURNING id, course_id, campaign_id, offer_type, title, conditions_json, valid_from, valid_to, active, created_at`,
            ...params,
        ) as any[];
        if (rows.length === 0) throw new NotFoundException('Offer not found');
        return this.rowToOffer(rows[0]);
    }

    async get(tenantId: string, id: string): Promise<Offer> {
        const schemaName = await this.tenantsService.getSchemaName(tenantId);
        const rows = await this.prisma.$queryRawUnsafe(
            `SELECT id, course_id, campaign_id, offer_type, title, conditions_json, valid_from, valid_to, active, created_at
             FROM "${schemaName}"."commercial_offers" WHERE id = $1::uuid`,
            id,
        ) as any[];
        if (rows.length === 0) throw new NotFoundException('Offer not found');
        return this.rowToOffer(rows[0]);
    }

    async delete(tenantId: string, id: string): Promise<void> {
        const schemaName = await this.tenantsService.getSchemaName(tenantId);
        await this.prisma.$executeRawUnsafe(
            `DELETE FROM "${schemaName}"."commercial_offers" WHERE id = $1::uuid`,
            id,
        );
    }

    private rowToOffer(r: any): Offer {
        return {
            id: r.id,
            courseId: r.course_id ?? undefined,
            campaignId: r.campaign_id ?? undefined,
            offerType: r.offer_type,
            title: r.title,
            conditions: r.conditions_json ?? {},
            validFrom: r.valid_from ?? undefined,
            validTo: r.valid_to ?? undefined,
            active: !!r.active,
            createdAt: r.created_at,
        };
    }
}
