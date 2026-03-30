import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

export type AuditAction =
    | 'lead.created' | 'lead.updated' | 'lead.stage_changed' | 'lead.score_changed'
    | 'lead.assigned' | 'lead.opted_out'
    | 'opportunity.created' | 'opportunity.won' | 'opportunity.lost'
    | 'conversation.handoff_requested' | 'conversation.resolved' | 'conversation.assigned'
    | 'whatsapp.channel_connected' | 'whatsapp.template_synced'
    | 'campaign.created' | 'campaign.activated' | 'campaign.paused'
    | 'user.login' | 'user.settings_changed'
    | 'compliance.opt_out_registered';

@Injectable()
export class AuditService {
    private readonly logger = new Logger(AuditService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
    ) {}

    /**
     * Log an audit event to the public.audit_logs table (non-tenant specific)
     * or tenant analytics_events if tenant-scoped.
     */
    async log(params: {
        tenantId: string;
        action: AuditAction;
        actorId?: string;
        actorType?: 'user' | 'system' | 'ai';
        resourceType?: string;
        resourceId?: string;
        metadata?: Record<string, any>;
        ip?: string;
    }) {
        const { tenantId, action, actorId, actorType, resourceType, resourceId, metadata, ip } = params;
        try {
            const resource = [resourceType, resourceId].filter(Boolean).join(':') || action;
            await this.prisma.$executeRaw`
                INSERT INTO audit_logs (tenant_id, user_id, action, resource, details, ip, created_at)
                VALUES (
                    ${tenantId}::uuid,
                    ${actorId || null}::uuid,
                    ${action},
                    ${resource},
                    ${JSON.stringify({ actorType, ...metadata })}::jsonb,
                    ${ip || null},
                    NOW()
                )
            `;
        } catch (err) {
            this.logger.warn(`Audit log failed (non-critical): ${err}`);
        }
    }

    /**
     * Retrieve audit trail for a tenant
     */
    async getLogs(tenantId: string, params: {
        action?: string;
        resourceType?: string;
        resourceId?: string;
        actorId?: string;
        page?: number;
        limit?: number;
    }) {
        const { action, resourceType, resourceId, actorId, page = 1, limit = 50 } = params;
        const offset = (page - 1) * limit;

        let query = `
            SELECT al.*, u.name as actor_name
            FROM audit_logs al
            LEFT JOIN users u ON u.id = al.actor_id::uuid
            WHERE al.tenant_id = $1
        `;
        const p: any[] = [tenantId];
        let n = 2;

        if (action) { query += ` AND al.action = $${n++}`; p.push(action); }
        if (resourceType) { query += ` AND al.resource_type = $${n++}`; p.push(resourceType); }
        if (resourceId) { query += ` AND al.resource_id = $${n++}`; p.push(resourceId); }
        if (actorId) { query += ` AND al.actor_id = $${n++}`; p.push(actorId); }

        query += ` ORDER BY al.created_at DESC LIMIT $${n++} OFFSET $${n++}`;
        p.push(limit, offset);

        return this.prisma.$queryRawUnsafe(query, ...p) as Promise<any[]>;
    }
}
