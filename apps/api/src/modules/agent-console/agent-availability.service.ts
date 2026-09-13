import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { CronLockService } from '../redis/cron-lock.service';
import { ensureOperationalNoticeOutbox, enqueueOperationalNoticesForTenantRoles } from '../operational-notices/operational-notice-outbox';

type AvailabilityStatus = 'online' | 'busy' | 'offline';

@Injectable()
export class AgentAvailabilityService {
    private readonly logger = new Logger(AgentAvailabilityService.name);

    constructor(
        private prisma: PrismaService,
        private eventEmitter: EventEmitter2,
        private readonly cronLock: CronLockService,
    ) {}

    async updateStatus(tenantId: string, userId: string, status: AvailabilityStatus): Promise<void> {
        if (!['online', 'busy', 'offline'].includes(status)) {
            throw new BadRequestException('Invalid availability status');
        }
        const result = await this.prisma.user.updateMany({
            where: {
                id: userId,
                tenantId,
                isActive: true,
                role: { in: ['tenant_admin', 'tenant_supervisor', 'tenant_agent'] },
            },
            data: {
                availabilityStatus: status,
                lastActiveAt: new Date(),
            },
        });
        if (result.count !== 1) throw new NotFoundException('Active tenant agent not found');
        this.logger.log(`Agent ${userId} status → ${status}`);
    }

    async heartbeat(userId: string): Promise<void> {
        await this.prisma.user.update({
            where: { id: userId },
            data: { lastActiveAt: new Date() },
        });
    }

    async getAvailableAgents(tenantId: string): Promise<any[]> {
        // SECURITY: Must scope conversations query to tenant schema
        // to prevent cross-tenant data leakage
        const schemaName = await this.getTenantSchema(tenantId);
        if (!schemaName) return [];

        const agents = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT u.id, u.first_name, u.last_name, u.email, u.role,
                    u.availability_status, u.max_capacity,
                    COALESCE(active.count, 0)::int as active_conversations
             FROM public.users u
             LEFT JOIN (
                 SELECT assigned_to, COUNT(*)::int as count
                 FROM conversations
                 WHERE status IN ('with_human', 'waiting_human')
                   AND assigned_to IS NOT NULL
                 GROUP BY assigned_to
             ) active ON active.assigned_to = u.id::text
             WHERE u.tenant_id = $1::uuid
               AND u.is_active = true
               AND u.availability_status = 'online'
               AND COALESCE(active.count, 0) < u.max_capacity
             ORDER BY COALESCE(active.count, 0) ASC`,
            [tenantId],
        );
        return agents;
    }

    private async getTenantSchema(tenantId: string): Promise<string | null> {
        try {
            return await this.prisma.getTenantSchemaName(tenantId);
        } catch {
            return null;
        }
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
    // Corre en UNA sola instancia: la API y el worker cargan el mismo
    // AppModule con ScheduleModule, asi que sin esto el cuerpo se
    // ejecuta dos veces. Ver CronLockService.
    @Cron('*/2 * * * *')
    async escalateStaleHandoffsCron() {
        await this.cronLock.runExclusive('agent-availability.escalateStaleHandoffs', 90, () => this.escalateStaleHandoffs(), { prefer: 'api' });
    }

    async escalateStaleHandoffs(): Promise<void> {
        try {
            const tenants = await this.prisma.tenant.findMany({
                where: { isActive: true },
                select: { id: true, schemaName: true, language: true },
            });

            for (const tenant of tenants) {
                await this.processEscalations(tenant.id, tenant.schemaName, tenant.language ?? undefined);
            }
        } catch (e: any) {
            this.logger.warn(`Escalation check failed: ${e.message}`);
        }
    }

    private async processEscalations(tenantId: string, schemaName: string, tenantLanguage?: string): Promise<void> {
        try {
            await ensureOperationalNoticeOutbox(this.prisma,schemaName);
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

            for (const conv of stale) {
                const handoff = conv.metadata?.handoff || {};
                const reason = handoff.reason || 'unknown';
                const contactName = conv.contact_name || 'Unknown';
                const waitMinutes = Math.round((Date.now() - new Date(handoff.startedAt).getTime()) / 60000);

                // The flag and one delivery intent per current supervisor are a
                // single fact. A crash cannot leave the flag without the email.
                const committed=await this.prisma.transactionInTenantSchema(schemaName,async query=>{
                    const updated=await query<any[]>(`UPDATE conversations SET metadata=jsonb_set(metadata,'{handoff,escalated}','true'::jsonb)
                        WHERE id=$1::uuid AND status IN ('waiting_human','with_human')
                          AND COALESCE(metadata->'handoff'->>'escalated','false')!='true'
                          AND (metadata->'handoff'->>'startedAt')::timestamptz<NOW()-INTERVAL '5 minutes'
                          AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.conversation_id=conversations.id
                            AND m.direction='outbound' AND m.metadata->>'source'='agent'
                            AND m.created_at>(conversations.metadata->'handoff'->>'startedAt')::timestamptz)
                        RETURNING id,contact_id`,[conv.id]);
                    if(!updated[0])return null;
                    await enqueueOperationalNoticesForTenantRoles(query,schemaName,{kind:'handoff.sla_escalated',
                        entityId:conv.id,contactId:updated[0].contact_id,conversationId:conv.id,
                        roles:['tenant_admin','tenant_supervisor']});
                    return updated[0].contact_id as string;
                });
                if(!committed)continue;

                // Emit WebSocket event for dashboard alert
                this.eventEmitter.emit('handoff.escalated_supervisor', {
                    tenantId,
                    conversationId: conv.id,
                    contactId: committed,
                    contactName,
                    reason,
                    waitMinutes,
                });
            }
        } catch (e: any) {
            this.logger.warn(`Escalation processing failed for ${tenantId}: ${e.message}`);
        }
    }
}
