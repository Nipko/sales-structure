import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

// Single words: matched with word boundaries (\b) to avoid false positives
// e.g. "baja" should NOT match "trabajan", "salir" should NOT match "resalir"
const OPT_OUT_WORDS = ['stop', 'baja', 'parar', 'salir', 'quitar', 'unsubscribe'];

// Phrases: matched as substring (they're specific enough to avoid false positives)
const OPT_OUT_PHRASES = [
    'no quiero', 'no me contactes', 'no contactar', 'no me escribas', 'no me escriban',
    'darme de baja', 'cancelar suscripcion', 'quiero salir',
    'eliminar mis datos', 'borrar mis datos', 'desuscribir', 'desuscribirme',
    'remove me', 'do not contact', 'opt out',
];

// Build regex patterns once (word-boundary for single words)
const OPT_OUT_PATTERNS = [
    ...OPT_OUT_WORDS.map(w => new RegExp(`\\b${w}\\b`, 'i')),
    ...OPT_OUT_PHRASES.map(p => new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')),
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
     * Detect if a message contains an opt-out intent.
     * Uses word-boundary regex for single words to avoid false positives
     * like "trabajan" matching "baja" or "resaltar" matching "salir".
     */
    detectOptOut(messageText: string): boolean {
        if (!messageText) return false;
        const text = messageText.trim();
        return OPT_OUT_PATTERNS.some(pattern => pattern.test(text));
    }

    /**
     * Process an opt-out: register as PENDING for admin review.
     * Does NOT block the lead immediately — admin must confirm.
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

        // Save as pending — admin reviews before blocking
        await this.prisma.executeInTenantSchema(schema, `
            INSERT INTO opt_out_records (lead_id, phone, channel, trigger_msg, detected_from, status, created_at)
            VALUES ($1, $2, $3, $4, $5, 'pending', NOW())
        `, [leadId || null, phone || null, channel, triggerMessage, detectedFrom]);

        this.logger.warn(`OptOut PENDING review: tenant=${tenantId} phone=${phone} from=${detectedFrom} msg="${triggerMessage}"`);
    }

    /**
     * Admin confirms opt-out: block the lead
     */
    async confirmOptOut(tenantId: string, recordId: string, reviewedBy: string, notes?: string) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return;

        const rows = await this.prisma.executeInTenantSchema<any[]>(schema,
            `UPDATE opt_out_records SET status = 'confirmed', reviewed_by = $2::uuid, reviewed_at = NOW(), review_notes = $3
             WHERE id = $1::uuid RETURNING lead_id, phone`,
            [recordId, reviewedBy, notes || null],
        );

        const record = rows[0];
        if (!record) return;

        // Now block the lead
        if (record.lead_id) {
            await this.prisma.executeInTenantSchema(schema, `
                UPDATE leads SET opted_out = true, opted_out_at = NOW(), updated_at = NOW()
                WHERE id = $1::uuid
            `, [record.lead_id]);
        }

        // Cache block in Redis
        const blockKey = `optout:${tenantId}:${record.phone || record.lead_id}`;
        await this.redis.set(blockKey, '1', 30 * 86400);

        this.logger.log(`OptOut CONFIRMED: record=${recordId} by=${reviewedBy}`);
    }

    /**
     * Admin rejects opt-out (false positive): unblock and resume normal flow
     */
    async rejectOptOut(tenantId: string, recordId: string, reviewedBy: string, notes?: string) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return;

        await this.prisma.executeInTenantSchema(schema,
            `UPDATE opt_out_records SET status = 'rejected', reviewed_by = $2::uuid, reviewed_at = NOW(), review_notes = $3
             WHERE id = $1::uuid`,
            [recordId, reviewedBy, notes || null],
        );

        this.logger.log(`OptOut REJECTED (false positive): record=${recordId} by=${reviewedBy}`);
    }

    /**
     * Check if a phone/lead is blocked (only confirmed opt-outs)
     */
    async isBlocked(tenantId: string, phoneOrLeadId: string): Promise<boolean> {
        const blockKey = `optout:${tenantId}:${phoneOrLeadId}`;
        const cached = await this.redis.get(blockKey);
        if (cached) return true;

        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return false;

        const result = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT 1 FROM opt_out_records WHERE (phone = $1 OR lead_id::text = $1) AND status = 'confirmed' LIMIT 1`,
            [phoneOrLeadId],
        );

        if (result && result.length > 0) {
            await this.redis.set(blockKey, '1', 30 * 86400);
            return true;
        }
        return false;
    }

    /**
     * List opt-out records with filters
     */
    async getOptOuts(tenantId: string, status?: string, page = 1, limit = 50) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return { data: [], total: 0 };

        let where = 'WHERE 1=1';
        const params: any[] = [];
        let idx = 1;

        if (status) { where += ` AND o.status = $${idx++}`; params.push(status); }

        const countParams = [...params];
        params.push(limit, (page - 1) * limit);

        const [rows, countRows] = await Promise.all([
            this.prisma.executeInTenantSchema<any[]>(schema, `
                SELECT o.id, o.lead_id, o.phone, o.channel, o.trigger_msg, o.detected_from,
                       o.status, o.reviewed_at, o.review_notes, o.created_at,
                       l.first_name, l.last_name, l.phone as lead_phone, l.email as lead_email,
                       u.first_name as reviewer_first, u.last_name as reviewer_last
                FROM opt_out_records o
                LEFT JOIN leads l ON l.id = o.lead_id
                LEFT JOIN public.users u ON u.id = o.reviewed_by
                ${where}
                ORDER BY o.created_at DESC
                LIMIT $${idx++} OFFSET $${idx++}
            `, params),
            this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*) as total FROM opt_out_records o ${where}`, countParams,
            ),
        ]);

        return {
            data: rows,
            total: parseInt(countRows[0]?.total || '0'),
        };
    }

    /**
     * Get compliance summary stats
     */
    async getStats(tenantId: string) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return null;

        const [totals, consents] = await Promise.all([
            this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT status, COUNT(*) as count FROM opt_out_records GROUP BY status`,
                [],
            ),
            this.prisma.executeInTenantSchema<any[]>(schema,
                `SELECT COUNT(*) as total FROM consent_records`, [],
            ),
        ]);

        const stats: Record<string, number> = { pending: 0, confirmed: 0, rejected: 0 };
        for (const row of (totals || [])) stats[row.status] = parseInt(row.count);

        return {
            optOuts: stats,
            totalConsents: parseInt(consents[0]?.total || '0'),
        };
    }
}
