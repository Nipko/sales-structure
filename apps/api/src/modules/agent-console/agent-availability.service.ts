import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';

type AvailabilityStatus = 'online' | 'busy' | 'offline';

@Injectable()
export class AgentAvailabilityService {
    private readonly logger = new Logger(AgentAvailabilityService.name);

    constructor(
        private prisma: PrismaService,
        private eventEmitter: EventEmitter2,
        private emailService: EmailService,
    ) {}

    async updateStatus(userId: string, status: AvailabilityStatus): Promise<void> {
        await this.prisma.user.update({
            where: { id: userId },
            data: {
                availabilityStatus: status,
                lastActiveAt: new Date(),
            },
        });
        this.logger.log(`Agent ${userId} status → ${status}`);
    }

    async heartbeat(userId: string): Promise<void> {
        await this.prisma.user.update({
            where: { id: userId },
            data: { lastActiveAt: new Date() },
        });
    }

    async getAvailableAgents(tenantId: string): Promise<any[]> {
        const agents = await this.prisma.$queryRaw<any[]>`
            SELECT u.id, u.first_name, u.last_name, u.email, u.role,
                   u.availability_status, u.max_capacity,
                   COALESCE(active.count, 0)::int as active_conversations
            FROM public.users u
            LEFT JOIN (
                SELECT assigned_to, COUNT(*)::int as count
                FROM (
                    SELECT DISTINCT c.assigned_to
                    FROM public.users pu
                    CROSS JOIN LATERAL (
                        SELECT assigned_to FROM conversations
                        WHERE status IN ('with_human', 'waiting_human')
                        AND assigned_to IS NOT NULL
                    ) c
                    WHERE c.assigned_to = pu.id::text
                ) sub
                GROUP BY assigned_to
            ) active ON active.assigned_to = u.id::text
            WHERE u.tenant_id = ${tenantId}::uuid
              AND u.is_active = true
              AND u.availability_status = 'online'
              AND COALESCE(active.count, 0) < u.max_capacity
            ORDER BY COALESCE(active.count, 0) ASC
        `;
        return agents;
    }

    async getAgentsWithStatus(tenantId: string): Promise<any[]> {
        return this.prisma.user.findMany({
            where: { tenantId, isActive: true },
            select: {
                id: true, firstName: true, lastName: true, email: true, role: true,
                availabilityStatus: true, maxCapacity: true, lastActiveAt: true,
            },
            orderBy: { firstName: 'asc' },
        });
    }

    /**
     * Auto-set agents to offline if no heartbeat in 15 minutes.
     */
    @Cron('*/5 * * * *')
    async checkInactivity(): Promise<void> {
        try {
            const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000);
            const result = await this.prisma.user.updateMany({
                where: {
                    availabilityStatus: { not: 'offline' },
                    lastActiveAt: { lt: fifteenMinAgo },
                },
                data: { availabilityStatus: 'offline' },
            });
            if (result.count > 0) {
                this.logger.log(`Auto-offline: ${result.count} agents set to offline (inactive >15min)`);
            }
        } catch (e: any) {
            this.logger.warn(`Inactivity check failed: ${e.message}`);
        }
    }

    /**
     * Every 2 minutes: escalate conversations waiting >5 min without agent response.
     * Notifies supervisor via email + WebSocket event.
     */
    @Cron('*/2 * * * *')
    async escalateStaleHandoffs(): Promise<void> {
        try {
            const tenants = await this.prisma.tenant.findMany({
                where: { isActive: true },
                select: { id: true, schemaName: true },
            });

            for (const tenant of tenants) {
                await this.processEscalations(tenant.id, tenant.schemaName);
            }
        } catch (e: any) {
            this.logger.warn(`Escalation check failed: ${e.message}`);
        }
    }

    private async processEscalations(tenantId: string, schemaName: string): Promise<void> {
        try {
            // Find conversations waiting >5 min with no agent response
            const stale = await this.prisma.executeInTenantSchema<any[]>(schemaName,
                `SELECT c.id, c.metadata, c.assigned_to,
                        ct.name as contact_name, ct.phone as contact_phone
                 FROM conversations c
                 LEFT JOIN contacts ct ON ct.id = c.contact_id
                 WHERE c.status IN ('waiting_human', 'with_human')
                   AND c.metadata->>'handoff' IS NOT NULL
                   AND (c.metadata->'handoff'->>'startedAt')::timestamp < NOW() - interval '5 minutes'
                   AND NOT EXISTS (
                       SELECT 1 FROM messages m
                       WHERE m.conversation_id = c.id
                         AND m.direction = 'outbound'
                         AND m.metadata->>'source' = 'agent'
                         AND m.created_at > (c.metadata->'handoff'->>'startedAt')::timestamp
                   )
                   AND COALESCE(c.metadata->'handoff'->>'escalated', 'false') != 'true'`,
                [],
            );

            if (!stale?.length) return;

            this.logger.warn(`[Escalation] ${stale.length} conversation(s) waiting >5min in tenant ${tenantId}`);

            // Find supervisors/admins to notify
            const supervisors = await this.prisma.user.findMany({
                where: {
                    tenantId,
                    isActive: true,
                    role: { in: ['tenant_admin', 'tenant_supervisor'] },
                },
                select: { id: true, email: true, firstName: true },
            });

            for (const conv of stale) {
                const handoff = conv.metadata?.handoff || {};
                const reason = handoff.reason || 'unknown';
                const contactName = conv.contact_name || 'Unknown';
                const waitMinutes = Math.round((Date.now() - new Date(handoff.startedAt).getTime()) / 60000);

                // Mark as escalated to avoid re-processing
                await this.prisma.executeInTenantSchema(schemaName,
                    `UPDATE conversations SET metadata = jsonb_set(metadata, '{handoff,escalated}', '"true"') WHERE id = $1::uuid`,
                    [conv.id],
                );

                // Emit WebSocket event for dashboard alert
                this.eventEmitter.emit('handoff.escalated_supervisor', {
                    tenantId,
                    conversationId: conv.id,
                    contactName,
                    reason,
                    waitMinutes,
                });

                // Email all supervisors
                for (const sup of supervisors) {
                    this.emailService.send({
                        to: sup.email,
                        subject: `⚠️ Escalación: ${contactName} esperando ${waitMinutes} min sin respuesta`,
                        html: `
                            <div style="font-family: sans-serif; max-width: 500px;">
                                <h2 style="color: #e67e22;">⚠️ Conversación sin atender</h2>
                                <p><strong>Cliente:</strong> ${contactName}</p>
                                <p><strong>Teléfono:</strong> ${conv.contact_phone || 'N/A'}</p>
                                <p><strong>Razón:</strong> ${reason}</p>
                                <p><strong>Tiempo de espera:</strong> ${waitMinutes} minutos</p>
                                <p><strong>Agente asignado:</strong> ${conv.assigned_to ? 'Sí (sin respuesta)' : 'Ninguno'}</p>
                                <p style="margin-top: 20px;">
                                    <a href="https://admin.parallly-chat.cloud/admin/inbox" style="background: #e67e22; color: white; padding: 10px 20px; text-decoration: none; border-radius: 8px;">
                                        Abrir Inbox
                                    </a>
                                </p>
                            </div>
                        `,
                    }).catch(e => this.logger.warn(`Escalation email failed: ${e.message}`));
                }
            }
        } catch (e: any) {
            // Non-critical — tables might not exist yet
        }
    }
}
