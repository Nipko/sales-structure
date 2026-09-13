import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { WsRelayService } from '../redis/ws-relay.service';
// Opt-out detection patterns live in a single place (multi-language: es/en/pt/fr).
// This service runs in the live pipeline (all channels, every inbound message);
// the intake forms reuse the very same compiled list, so a customer can opt out
// in any supported language without us having to detect their language first.
import { isOptOutMessage } from '../intake/intake-i18n';

@Injectable()
export class ComplianceService {
    private readonly logger = new Logger(ComplianceService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        private wsRelay: WsRelayService,
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
     * Detect if a message contains an opt-out intent, in any supported language.
     * Delegates to the shared multi-language matcher (intake-i18n): single words
     * use word boundaries to avoid false positives ("baja" ≠ "trabajan") and
     * ambiguous bare verbs (cancelar/sair/arreter) are excluded in favour of the
     * qualified phrases, so an appointment cancellation isn't flagged as opt-out.
     */
    detectOptOut(messageText: string): boolean {
        return isOptOutMessage(messageText);
    }

    /**
     * Register an opt-out for human review and suppress future sends at once.
     * A reviewer can reverse a false positive, but waiting for that review is
     * never permission to keep contacting somebody who asked us to stop.
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

        const rows = await this.prisma.transactionInTenantSchema<any>(schema, async (query) => {
            const inserted = await query<any[]>(`
            INSERT INTO opt_out_records (lead_id, phone, channel, trigger_msg, detected_from, status, created_at)
            VALUES ($1, $2, $3, $4, $5, 'pending', NOW())
            ON CONFLICT DO NOTHING
            RETURNING *
            `, [leadId || null, phone || null, channel, triggerMessage, detectedFrom]);

            const active = inserted[0] || (await query<any[]>(`
                SELECT * FROM opt_out_records
                 WHERE channel = $3
                   AND status IN ('pending', 'confirmed')
                   AND (($1::text IS NOT NULL AND phone = $1)
                     OR ($2::uuid IS NOT NULL AND lead_id = $2::uuid))
                 ORDER BY created_at DESC
                 LIMIT 1
            `, [phone || null, leadId || null, channel]))[0];

            if (leadId) {
                await query(`UPDATE leads
                    SET opted_out = true, opted_out_at = COALESCE(opted_out_at, NOW()), updated_at = NOW()
                    WHERE id = $1::uuid`, [leadId]);
            }
            return active ? [active] : [];
        });

        for (const identity of [phone, leadId].filter(Boolean) as string[]) {
            await this.redis.set(`optout:${tenantId}:${identity}`, '1', 30 * 86400);
        }

        this.wsRelay.publish('inbox', {
            room: tenantId,
            event: 'optout.detected',
            payload: { tenantId, phone: phone || null, leadId: leadId || null, channel, triggerMessage },
        });

        this.logger.warn(`OptOut PENDING review: tenant=${tenantId} phone=${phone} from=${detectedFrom} msg="${triggerMessage}"`);
        return rows[0] || null;
    }

    /**
     * Admin confirms opt-out: block the lead
     */
    async confirmOptOut(tenantId: string, recordId: string, reviewedBy: string, notes?: string) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return;

        const rows = await this.prisma.transactionInTenantSchema<any[]>(schema, async (query) => {
            const updated = await query<any[]>(
                `UPDATE opt_out_records SET status = 'confirmed', reviewed_by = $2::uuid, reviewed_at = NOW(), review_notes = $3
                 WHERE id = $1::uuid RETURNING lead_id, phone`,
                [recordId, reviewedBy, notes || null],
            );
            if (updated[0]?.lead_id) {
                await query(`UPDATE leads SET opted_out = true,
                    opted_out_at = COALESCE(opted_out_at, NOW()), updated_at = NOW()
                    WHERE id = $1::uuid`, [updated[0].lead_id]);
            }
            return updated;
        });

        const record = rows[0];
        if (!record) return;

        for (const identity of [record.phone, record.lead_id].filter(Boolean)) {
            await this.redis.set(`optout:${tenantId}:${identity}`, '1', 30 * 86400);
        }

        this.logger.log(`OptOut CONFIRMED: record=${recordId} by=${reviewedBy}`);
    }

    /**
     * Admin rejects opt-out (false positive): unblock and resume normal flow
     */
    async rejectOptOut(tenantId: string, recordId: string, reviewedBy: string, notes?: string) {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return;

        const record = await this.prisma.transactionInTenantSchema<any>(schema, async (query) => {
            const updated = await query<any[]>(
                `UPDATE opt_out_records SET status = 'rejected', reviewed_by = $2::uuid, reviewed_at = NOW(), review_notes = $3
                 WHERE id = $1::uuid RETURNING lead_id, phone`,
                [recordId, reviewedBy, notes || null],
            );
            const row = updated[0];
            if (row?.lead_id) {
                const remaining = await query<any[]>(`
                    SELECT 1 FROM opt_out_records
                     WHERE id <> $1::uuid AND lead_id = $2::uuid
                       AND status IN ('pending', 'confirmed')
                     LIMIT 1`, [recordId, row.lead_id]);
                if (!remaining.length) {
                    await query(`UPDATE leads SET opted_out = false, opted_out_at = NULL, updated_at = NOW()
                        WHERE id = $1::uuid`, [row.lead_id]);
                }
            }
            return row || null;
        });

        for (const identity of [record?.phone, record?.lead_id].filter(Boolean)) {
            await this.redis.del(`optout:${tenantId}:${identity}`);
        }

        this.logger.log(`OptOut REJECTED (false positive): record=${recordId} by=${reviewedBy}`);
    }

    /**
     * Check if a phone/lead is suppressed. Pending requests remain suppressed
     * until a reviewer explicitly rejects them as false positives.
     */
    async isBlocked(tenantId: string, phoneOrLeadId: string): Promise<boolean> {
        const blockKey = `optout:${tenantId}:${phoneOrLeadId}`;
        const cached = await this.redis.get(blockKey);
        if (cached) return true;

        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return false;

        const result = await this.prisma.executeInTenantSchema<any[]>(schema,
            `SELECT 1 FROM opt_out_records
              WHERE (phone = $1 OR lead_id::text = $1)
                AND status IN ('pending', 'confirmed') LIMIT 1`,
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
