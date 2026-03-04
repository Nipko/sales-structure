import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

// ============================================
// Types
// ============================================

export interface AutomationRule {
    id: string;
    name: string;
    type: 'auto_assign' | 'auto_tag' | 'sla_alert' | 'auto_reply' | 'follow_up';
    trigger: string;
    conditions: Record<string, any>;
    actions: Record<string, any>;
    isActive: boolean;
    executionCount: number;
    lastExecutedAt: string | null;
}

// ============================================
// Service
// ============================================

@Injectable()
export class AutomationService {
    private readonly logger = new Logger(AutomationService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
    ) { }

    /** Get all automation rules for a tenant */
    async getRules(tenantId: string): Promise<AutomationRule[]> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return [];

        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT * FROM automation_rules ORDER BY created_at DESC`,
        );

        return (rows || []).map((r: any) => ({
            id: r.id,
            name: r.name,
            type: r.type,
            trigger: r.trigger_event,
            conditions: r.conditions || {},
            actions: r.actions || {},
            isActive: r.is_active,
            executionCount: parseInt(r.execution_count) || 0,
            lastExecutedAt: r.last_executed_at,
        }));
    }

    /** Create a new automation rule */
    async createRule(tenantId: string, data: {
        name: string; type: string; trigger: string;
        conditions: Record<string, any>; actions: Record<string, any>;
    }): Promise<AutomationRule> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) throw new Error('Tenant not found');

        const result = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `INSERT INTO automation_rules (tenant_id, name, type, trigger_event, conditions, actions, is_active, execution_count, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, true, 0, NOW())
       RETURNING *`,
            [tenantId, data.name, data.type, data.trigger,
                JSON.stringify(data.conditions), JSON.stringify(data.actions)],
        );

        return {
            id: result[0].id,
            name: result[0].name,
            type: result[0].type,
            trigger: result[0].trigger_event,
            conditions: result[0].conditions,
            actions: result[0].actions,
            isActive: true,
            executionCount: 0,
            lastExecutedAt: null,
        };
    }

    /** Toggle a rule on/off */
    async toggleRule(tenantId: string, ruleId: string, isActive: boolean): Promise<void> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return;

        await this.prisma.executeInTenantSchema(
            schema,
            `UPDATE automation_rules SET is_active = $1 WHERE id = $2`,
            [isActive, ruleId],
        );
    }

    /** Delete a rule */
    async deleteRule(tenantId: string, ruleId: string): Promise<void> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return;

        await this.prisma.executeInTenantSchema(
            schema,
            `DELETE FROM automation_rules WHERE id = $1`,
            [ruleId],
        );
    }

    // ============================================
    // Rule execution engine
    // ============================================

    /** Auto-assign via round robin */
    async executeAutoAssign(tenantId: string, conversationId: string): Promise<string | null> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return null;

        // Get active auto_assign rules
        const rules = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT * FROM automation_rules WHERE type = 'auto_assign' AND is_active = true LIMIT 1`,
        );
        if (!rules || rules.length === 0) return null;

        const rule = rules[0];
        const agentPool: string[] = rule.actions?.agent_pool || [];
        if (agentPool.length === 0) return null;

        // Round robin: get last assigned agent index from Redis
        const rrKey = `tenant:${tenantId}:auto_assign:rr_index`;
        const currentIndex = await this.redis.incr(rrKey);
        const agentId = agentPool[(currentIndex - 1) % agentPool.length];

        // Track execution
        await this.prisma.executeInTenantSchema(
            schema,
            `UPDATE automation_rules SET execution_count = execution_count + 1, last_executed_at = NOW() WHERE id = $1`,
            [rule.id],
        );

        this.logger.log(`Auto-assigned conversation ${conversationId} to agent ${agentId}`);
        return agentId;
    }

    /** Auto-tag based on message content */
    async executeAutoTag(tenantId: string, contactId: string, messageContent: string): Promise<string[]> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return [];

        const rules = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT * FROM automation_rules WHERE type = 'auto_tag' AND is_active = true`,
        );
        if (!rules || rules.length === 0) return [];

        const appliedTags: string[] = [];
        const lowerContent = messageContent.toLowerCase();

        for (const rule of rules) {
            const keywords: string[] = rule.conditions?.keywords || [];
            const tag: string = rule.actions?.tag || '';

            if (!tag) continue;

            const matches = keywords.some((kw: string) => lowerContent.includes(kw.toLowerCase()));
            if (matches) {
                await this.prisma.executeInTenantSchema(
                    schema,
                    `UPDATE contacts SET tags = array_append(
            CASE WHEN $1 = ANY(tags) THEN tags ELSE tags END, $1
          ) WHERE id = $2 AND NOT ($1 = ANY(tags))`,
                    [tag, contactId],
                );
                appliedTags.push(tag);

                await this.prisma.executeInTenantSchema(
                    schema,
                    `UPDATE automation_rules SET execution_count = execution_count + 1, last_executed_at = NOW() WHERE id = $1`,
                    [rule.id],
                );
            }
        }

        return appliedTags;
    }

    /** Check SLA violations */
    async checkSLAViolations(tenantId: string): Promise<Array<{ conversationId: string; agentId: string; minutesOverdue: number }>> {
        const schema = await this.getTenantSchema(tenantId);
        if (!schema) return [];

        const violations = await this.prisma.executeInTenantSchema<any[]>(
            schema,
            `SELECT ca.conversation_id, ca.agent_id, ca.sla_deadline,
              EXTRACT(EPOCH FROM (NOW() - ca.sla_deadline)) / 60 as minutes_overdue
       FROM conversation_assignments ca
       WHERE ca.resolved_at IS NULL
         AND ca.sla_deadline IS NOT NULL
         AND ca.sla_deadline < NOW()
       ORDER BY minutes_overdue DESC`,
        );

        return (violations || []).map((v: any) => ({
            conversationId: v.conversation_id,
            agentId: v.agent_id,
            minutesOverdue: Math.floor(parseFloat(v.minutes_overdue) || 0),
        }));
    }

    private async getTenantSchema(tenantId: string): Promise<string | null> {
        const cached = await this.redis.get(`tenant:${tenantId}:schema`);
        if (cached) return cached;
        const tenant = await this.prisma.$queryRaw<any[]>`
      SELECT schema_name FROM tenants WHERE id = ${tenantId}::uuid LIMIT 1
    `;
        if (tenant?.[0]) {
            await this.redis.set(`tenant:${tenantId}:schema`, tenant[0].schema_name, 3600);
            return tenant[0].schema_name;
        }
        return null;
    }
}
