import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

type AvailabilityStatus = 'online' | 'busy' | 'offline';

@Injectable()
export class AgentAvailabilityService {
    private readonly logger = new Logger(AgentAvailabilityService.name);

    constructor(private prisma: PrismaService) {}

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
}
