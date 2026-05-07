import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ComplianceService {
    private readonly logger = new Logger(ComplianceService.name);

    constructor(private readonly prisma: PrismaService) {}

    // ─── Legal Text Versions ──────────────────────────────────────────────────

    async getLegalTexts(schemaName: string) {
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM legal_text_versions ORDER BY created_at DESC`
        );
    }

    async createLegalText(schemaName: string, data: any) {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO legal_text_versions (tenant_id, channel, version, text, active)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [data.tenant_id, data.channel || 'web', data.version || 1, data.text, data.active ?? true]
        );
        return rows[0];
    }

    // ─── Consent Records ──────────────────────────────────────────────────────

    async getConsents(schemaName: string, leadId?: string) {
        if (leadId) {
            return this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT * FROM consent_records WHERE lead_id = $1::uuid ORDER BY created_at DESC`,
                [leadId]
            );
        }
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM consent_records ORDER BY created_at DESC LIMIT 100`
        );
    }

    async createConsent(schemaName: string, data: any) {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO consent_records (lead_id, channel, legal_version, legal_text_hash, ip_address, user_agent, origin_url)
             VALUES ($1::uuid, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [data.lead_id, data.channel || 'web', data.legal_version || 'v1.0', data.legal_text_hash || null, data.ip_address, data.user_agent, data.origin_url]
        );
        return rows[0];
    }

    // ─── Opt-Out Records ──────────────────────────────────────────────────────

    async getOptOuts(schemaName: string) {
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM opt_out_records ORDER BY created_at DESC LIMIT 100`
        );
    }

    async createOptOut(schemaName: string, data: any) {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO opt_out_records (tenant_id, lead_id, channel, scope, reason, detected_from)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [data.tenant_id, data.lead_id, data.channel, data.scope || 'marketing', data.reason, data.detected_from]
        );
        return rows[0];
    }

    async isOptedOut(schemaName: string, leadId: string, channel: string): Promise<boolean> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id FROM opt_out_records WHERE lead_id = $1 AND channel = $2 LIMIT 1`,
            [leadId, channel]
        );
        return rows.length > 0;
    }

    // ─── Deletion Requests ────────────────────────────────────────────────────

    async getDeletionRequests(schemaName: string) {
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM deletion_requests ORDER BY requested_at DESC`
        );
    }

    async createDeletionRequest(schemaName: string, data: any) {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO deletion_requests (tenant_id, lead_id, requested_by, status)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [data.tenant_id, data.lead_id, data.requested_by, 'pending']
        );
        return rows[0];
    }

    async processDeletionRequest(schemaName: string, id: string) {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE deletion_requests SET status = 'processed', processed_at = NOW() WHERE id = $1 RETURNING *`,
            [id]
        );
        return rows[0];
    }

    // ─── Cross-tenant overview (super_admin) ──────────────────────────

    /**
     * Aggregate pending deletion requests + recent opt-outs across every
     * active tenant. Used by the super_admin compliance center to surface
     * GDPR/LGPD obligations that need attention.
     */
    async getAdminOverview(): Promise<{
        pendingDeletions: Array<any>;
        recentOptOuts: Array<any>;
        totalsByStatus: Record<string, number>;
    }> {
        const tenants = await this.prisma.tenant.findMany({
            where: { isActive: true },
            select: { id: true, name: true, slug: true, schemaName: true },
        });

        const pending: any[] = [];
        const optOuts: any[] = [];
        const totals: Record<string, number> = { pending: 0, processed: 0, optOuts: 0 };

        for (const t of tenants) {
            if (!t.schemaName) continue;
            try {
                const dr = await this.prisma.executeInTenantSchema<any[]>(
                    t.schemaName,
                    `SELECT id, lead_id, requested_by, status, created_at, processed_at
                     FROM deletion_requests
                     WHERE status IN ('pending','processing')
                     ORDER BY created_at DESC LIMIT 50`,
                );
                for (const r of dr) {
                    pending.push({ ...r, tenantId: t.id, tenantName: t.name, tenantSlug: t.slug });
                }
                totals.pending += dr.length;
            } catch { /* schema missing → skip */ }

            try {
                const oo = await this.prisma.executeInTenantSchema<any[]>(
                    t.schemaName,
                    `SELECT id, lead_id, channel, scope, reason, status, created_at
                     FROM opt_out_records
                     ORDER BY created_at DESC LIMIT 25`,
                );
                for (const r of oo) {
                    optOuts.push({ ...r, tenantId: t.id, tenantName: t.name, tenantSlug: t.slug });
                }
                totals.optOuts += oo.length;
            } catch { /* skip */ }
        }

        // Sort merged arrays by date
        pending.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        optOuts.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        return {
            pendingDeletions: pending.slice(0, 50),
            recentOptOuts: optOuts.slice(0, 50),
            totalsByStatus: totals,
        };
    }

    /**
     * GDPR / LGPD Article 15 — full data export for one contact / lead.
     * Returns a JSON bundle with all PII and activity for the subject.
     * Used by /admin/compliance to fulfill data subject access requests.
     */
    async exportContactData(schemaName: string, contactId: string): Promise<any> {
        const safe = async <T>(query: () => Promise<T>, fallback: T): Promise<T> => {
            try { return await query(); } catch { return fallback; }
        };

        const [contact, leads, conversations, appointments, consents, optOuts] = await Promise.all([
            safe(() => this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT * FROM contacts WHERE id = $1::uuid`,
                [contactId],
            ), [] as any[]),
            safe(() => this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT * FROM leads WHERE contact_id = $1::uuid`,
                [contactId],
            ), [] as any[]),
            safe(() => this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT c.id, c.channel_type, c.status, c.created_at,
                        json_agg(json_build_object('id', m.id, 'direction', m.direction, 'content', m.content_text, 'created_at', m.created_at)
                                 ORDER BY m.created_at) as messages
                 FROM conversations c
                 LEFT JOIN messages m ON m.conversation_id = c.id
                 WHERE c.contact_id = $1::uuid
                 GROUP BY c.id`,
                [contactId],
            ), [] as any[]),
            safe(() => this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT * FROM appointments WHERE contact_id = $1::uuid`,
                [contactId],
            ), [] as any[]),
            safe(() => this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT * FROM consent_records WHERE lead_id IN (SELECT id FROM leads WHERE contact_id = $1::uuid)`,
                [contactId],
            ), [] as any[]),
            safe(() => this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT * FROM opt_out_records WHERE lead_id IN (SELECT id FROM leads WHERE contact_id = $1::uuid)`,
                [contactId],
            ), [] as any[]),
        ]);

        return {
            generatedAt: new Date().toISOString(),
            schema: 'parallext-data-subject-export-v1',
            subject: contact[0] || null,
            leads,
            conversations,
            appointments,
            consents,
            optOuts,
            messageCount: conversations.reduce((sum: number, c: any) => sum + (c.messages?.length || 0), 0),
        };
    }
}
