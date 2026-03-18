import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class KnowledgeService {
    private readonly logger = new Logger(KnowledgeService.name);

    constructor(private readonly prisma: PrismaService) {}

    // ─── Resources ────────────────────────────────────────────────────────────

    async getResources(schemaName: string, status?: string) {
        if (status) {
            return this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT * FROM knowledge_resources WHERE status = $1 ORDER BY created_at DESC`,
                [status]
            );
        }
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM knowledge_resources ORDER BY created_at DESC`
        );
    }

    async createResource(schemaName: string, data: any) {
        const contentHash = data.content ? crypto.createHash('sha256').update(data.content).digest('hex').substring(0, 64) : null;
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `INSERT INTO knowledge_resources (tenant_id, type, title, source, source_url, content, content_hash, course_id, campaign_id, version, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
            [
                data.tenant_id, data.type || 'manual', data.title,
                data.source || null, data.source_url || null,
                data.content || null, contentHash,
                data.course_id || null, data.campaign_id || null,
                data.version || 1, 'draft'
            ]
        );

        const resource = rows[0];
        if (resource && data.content) {
            await this.chunkResource(schemaName, resource.id, data.content);
        }

        return resource;
    }

    async updateResourceStatus(schemaName: string, id: string, status: string) {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `UPDATE knowledge_resources SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
            [id, status]
        );
        return rows[0];
    }

    // ─── Chunking ─────────────────────────────────────────────────────────────

    private async chunkResource(schemaName: string, resourceId: string, content: string) {
        const chunkSize = 500;
        const overlap = 50;
        const chunks: string[] = [];

        for (let i = 0; i < content.length; i += chunkSize - overlap) {
            chunks.push(content.substring(i, i + chunkSize));
        }

        for (let idx = 0; idx < chunks.length; idx++) {
            await this.prisma.executeInTenantSchema(
                schemaName,
                `INSERT INTO knowledge_chunks (resource_id, chunk_index, content, metadata_json)
                 VALUES ($1, $2, $3, $4)`,
                [resourceId, idx, chunks[idx], JSON.stringify({ char_start: idx * (chunkSize - overlap), char_end: Math.min(idx * (chunkSize - overlap) + chunkSize, content.length) })]
            );
        }

        this.logger.log(`Chunked resource ${resourceId} into ${chunks.length} chunks`);
    }

    async getChunks(schemaName: string, resourceId: string) {
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM knowledge_chunks WHERE resource_id = $1 ORDER BY chunk_index ASC`,
            [resourceId]
        );
    }

    // ─── Approvals ────────────────────────────────────────────────────────────

    async approveResource(schemaName: string, resourceId: string, approvedBy: string, notes?: string) {
        await this.prisma.executeInTenantSchema(
            schemaName,
            `INSERT INTO knowledge_approvals (resource_id, approved_by, notes) VALUES ($1, $2, $3)`,
            [resourceId, approvedBy, notes || null]
        );
        return this.updateResourceStatus(schemaName, resourceId, 'approved');
    }

    async getApprovals(schemaName: string, resourceId: string) {
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT * FROM knowledge_approvals WHERE resource_id = $1 ORDER BY approved_at DESC`,
            [resourceId]
        );
    }

    // ─── Retrieval (for Carla) ────────────────────────────────────────────────

    async searchChunks(schemaName: string, query: string, limit = 5) {
        return this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT kc.*, kr.title as resource_title, kr.type as resource_type
             FROM knowledge_chunks kc
             JOIN knowledge_resources kr ON kr.id = kc.resource_id
             WHERE kr.status = 'approved' AND kc.content ILIKE $1
             ORDER BY kc.created_at DESC LIMIT $2`,
            [`%${query}%`, limit]
        );
    }
}
