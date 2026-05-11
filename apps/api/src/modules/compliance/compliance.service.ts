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

    /**
     * GDPR Article 17 — Right to Erasure.
     * Anonymizes all PII for a contact across every tenant table.
     * Preserves structural records (IDs, timestamps, foreign keys) for
     * analytics integrity but removes all personally identifiable content.
     */
    async eraseContactData(
        schemaName: string,
        tenantId: string,
        contactId: string,
        requestedBy: string,
    ): Promise<{ erasedTables: string[]; totalRecordsAffected: number }> {
        const erasedTables: string[] = [];
        let totalRecords = 0;
        const anon = `[ERASED-${contactId.slice(0, 8)}]`;

        const run = async (label: string, sql: string, params: any[]) => {
            try {
                const result = await this.prisma.executeInTenantSchema<any[]>(schemaName, sql, params);
                const count = result?.[0]?.count ?? result?.length ?? 1;
                if (count > 0) {
                    erasedTables.push(label);
                    totalRecords += typeof count === 'number' ? count : 1;
                }
            } catch (err: any) {
                this.logger.warn(`[GDPR Erase] Skipped ${label}: ${err.message}`);
            }
        };

        // 1. Contacts — anonymize name, phone, email
        await run('contacts',
            `UPDATE contacts SET name = $2, phone = $2, email = NULL, updated_at = NOW()
             WHERE id = $1::uuid RETURNING id`,
            [contactId, anon],
        );

        // 2. Leads — anonymize PII fields
        await run('leads',
            `UPDATE leads SET phone = $2, email = NULL, notes = NULL, updated_at = NOW()
             WHERE contact_id = $1::uuid RETURNING id`,
            [contactId, anon],
        );

        // 3. Messages — redact content
        await run('messages',
            `WITH conv_ids AS (
                SELECT id FROM conversations WHERE contact_id = $1::uuid
             )
             UPDATE messages SET content_text = '[REDACTED]', metadata = '{}'::jsonb
             WHERE conversation_id IN (SELECT id FROM conv_ids)
             RETURNING (SELECT COUNT(*)::int FROM conv_ids) AS count`,
            [contactId],
        );

        // 4. Conversations — clear any PII metadata
        await run('conversations',
            `UPDATE conversations SET metadata = '{}'::jsonb, updated_at = NOW()
             WHERE contact_id = $1::uuid RETURNING id`,
            [contactId],
        );

        // 5. Appointments — anonymize customer info
        await run('appointments',
            `UPDATE appointments SET customer_name = $2, customer_phone = $2, customer_email = NULL, notes = NULL
             WHERE contact_id = $1::uuid RETURNING id`,
            [contactId, anon],
        );

        // 6. Campaign recipients — anonymize phone
        await run('campaign_recipients',
            `UPDATE campaign_recipients SET phone = $2
             WHERE phone IN (SELECT phone FROM contacts WHERE id = $1::uuid)
             RETURNING id`,
            [contactId, anon],
        );

        // 7. Customer profiles — anonymize if exists
        await run('customer_profiles',
            `UPDATE customer_profiles SET primary_phone = $2, primary_email = NULL, display_name = $2
             WHERE id IN (SELECT customer_profile_id FROM contacts WHERE id = $1::uuid AND customer_profile_id IS NOT NULL)
             RETURNING id`,
            [contactId, anon],
        );

        // 8. Custom attribute values — delete
        await run('custom_attribute_values',
            `DELETE FROM custom_attribute_values
             WHERE lead_id IN (SELECT id FROM leads WHERE contact_id = $1::uuid)
             RETURNING id`,
            [contactId],
        );

        // 9. Consent records — keep for legal compliance but mark as erased
        await run('consent_records',
            `UPDATE consent_records SET ip_address = NULL, user_agent = NULL
             WHERE lead_id IN (SELECT id FROM leads WHERE contact_id = $1::uuid)
             RETURNING id`,
            [contactId],
        );

        // 10. Mark all pending deletion requests for this contact as completed
        await run('deletion_requests',
            `UPDATE deletion_requests SET status = 'completed', processed_at = NOW()
             WHERE lead_id IN (SELECT id FROM leads WHERE contact_id = $1::uuid) AND status = 'pending'
             RETURNING id`,
            [contactId],
        );

        // 11. Audit log
        try {
            await this.prisma.auditLog.create({
                data: {
                    tenantId,
                    action: 'gdpr.contact_erased',
                    resource: 'contact',
                    details: { contactId, erasedTables, totalRecordsAffected: totalRecords, requestedBy },
                },
            });
        } catch (e: any) {
            this.logger.warn(`[GDPR Erase] Audit log failed: ${e.message}`);
        }

        this.logger.log(`[GDPR Erase] Contact ${contactId} erased in tenant ${tenantId}: ${erasedTables.join(', ')} (${totalRecords} records)`);
        return { erasedTables, totalRecordsAffected: totalRecords };
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
