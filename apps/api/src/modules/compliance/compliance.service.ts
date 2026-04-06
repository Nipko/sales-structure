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
            `INSERT INTO consent_records (tenant_id, lead_id, channel, legal_text_version, legal_text_snapshot, ip_address, user_agent, source_url)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [data.tenant_id, data.lead_id, data.channel || 'web', data.legal_text_version, data.legal_text_snapshot, data.ip_address, data.user_agent, data.source_url]
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
}
