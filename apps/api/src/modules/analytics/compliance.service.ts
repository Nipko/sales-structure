import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const OPT_OUT_KEYWORDS = [
    'stop', 'baja', 'detener', 'cancelar', 'no quiero', 'no me contactes',
    'eliminar', 'borrar', 'desuscribir', 'no contactar', 'quitar', 'salir',
    'unsubscribe', 'remove me', 'do not contact',
];

@Injectable()
export class ComplianceService {
    private readonly logger = new Logger(ComplianceService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
    ) {}

    private async getTenantSchema(tenantId: string): Promise<string | null> {
        const cached = await this.redis.get(`tenant:${tenantId}:schema`);
        if (cached) return cached;
        const tenant = await this.prisma.$queryRaw<any[]>`
            SELECT schema_name FROM tenants WHERE id = ${tenantId}::uuid LIMIT 1
        `;
        if (tenant && tenant.length > 0) {
            const schema = tenant[0].schema_name;
            await this.redis.set(`tenant:${tenantId}:schema`, schema, 3600);
            return schema;
        }
        return null;
    }

    /**
     * Detect if a message contains an opt-out intent
     */
    detectOptOut(messageText: string): boolean {
        if (!messageText) return false;
        const lower = messageText.toLowerCase().trim();
        return OPT_OUT_KEYWORDS.some(kw => lower.includes(kw));
    }

    /**
     * Process an opt-out: register it, mark lead as opted_out=true
     */
    async processOptOut(tenantId: string, params: {
        leadId?: string;
        phone?: string;
        channel: string;
        triggerMessage: string;
        detectedFrom: 'ai' | 'keyword' | 'manual';
    }) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return;

        const { leadId, phone, channel, triggerMessage, detectedFrom } = params;

        // 1. Save opt-out record
        await this.prisma.executeInTenantSchema(schema, `
            INSERT INTO opt_out_records (lead_id, phone, channel, trigger_msg, created_at)
            VALUES ($1, $2, $3, $4, NOW())
        `, [leadId || null, phone || null, channel, triggerMessage]);

        // 2. Mark lead as opted_out
        if (leadId) {
            await this.prisma.executeInTenantSchema(schema, `
                UPDATE leads SET opted_out = true, opted_out_at = NOW(), updated_at = NOW()
                WHERE id = $1::uuid
            `, [leadId]);
        }

        // 3. Block further marketing via Redis cache (fast check)
        const blockKey = `optout:${tenantId}:${phone || leadId}`;
        await this.redis.set(blockKey, '1', 30 * 86400); // 30 days

        this.logger.warn(`OptOut processed for tenant=${tenantId} lead=${leadId} phone=${phone} from=${detectedFrom}`);
    }

    /**
     * Check if a phone/lead is blocked from marketing
     */
    async isBlocked(tenantId: string, phoneOrLeadId: string): Promise<boolean> {
        const blockKey = `optout:${tenantId}:${phoneOrLeadId}`;
        const cached = await this.redis.get(blockKey);
        if (cached) return true;

        // Fallback to DB
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return false;

        const result = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT 1 FROM opt_out_records WHERE (phone = $1 OR lead_id::text = $1) LIMIT 1`,
            [phoneOrLeadId]
        );

        if (result && result.length > 0) {
            await this.redis.set(blockKey, '1', 30 * 86400);
            return true;
        }
        return false;
    }

    /**
     * List opt-out records for a tenant
     */
    async getOptOuts(tenantId: string, page = 1, limit = 50) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return [];

        return this.prisma.executeInTenantSchema<any[]>(schema, `
            SELECT o.*, l.first_name, l.last_name, l.phone as lead_phone
            FROM opt_out_records o
            LEFT JOIN leads l ON l.id = o.lead_id
            ORDER BY o.created_at DESC
            LIMIT $1 OFFSET $2
        `, [limit, (page - 1) * limit]);
    }

    /**
     * Get compliance summary stats
     */
    async getStats(tenantId: string) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return null;

        const [optOuts, consents] = await Promise.all([
            this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*) as total, channel, COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as last_7d
                 FROM opt_out_records GROUP BY channel`,
                []
            ),
            this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*) as total FROM consent_records`,
                []
            ),
        ]);

        return { optOuts, totalConsents: parseInt(consents[0]?.total || '0') };
    }
}
