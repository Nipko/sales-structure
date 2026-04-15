import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { EmailService } from '../email/email.service';
import { DashboardAnalyticsService } from './dashboard-analytics.service';

interface AlertRule {
    id: string;
    tenant_id: string;
    name: string;
    metric: string;
    operator: string;
    threshold: number;
    channel: string;
    notify_emails: string[];
    is_active: boolean;
    last_triggered_at: string | null;
    cooldown_minutes: number;
}

@Injectable()
export class AlertsService {
    private readonly logger = new Logger(AlertsService.name);

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        private email: EmailService,
        private dashboardAnalytics: DashboardAnalyticsService,
    ) { }

    // ── CRUD ──────────────────────────────────────────────────────

    async getRules(schemaName: string, tenantId: string): Promise<any[]> {
        const rules: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT ar.*,
                    (SELECT COUNT(*)::int FROM "${schemaName}".alert_history ah WHERE ah.rule_id = ar.id) as trigger_count,
                    (SELECT MAX(created_at) FROM "${schemaName}".alert_history ah WHERE ah.rule_id = ar.id) as last_alert_at
             FROM "${schemaName}".alert_rules ar
             WHERE ar.tenant_id = $1
             ORDER BY ar.created_at DESC`,
            tenantId,
        );
        return rules;
    }

    async createRule(schemaName: string, tenantId: string, data: {
        name: string; metric: string; operator: string; threshold: number;
        channel?: string; notifyEmails?: string[]; cooldownMinutes?: number;
    }): Promise<any> {
        const rows: any[] = await this.prisma.$queryRawUnsafe(
            `INSERT INTO "${schemaName}".alert_rules
             (tenant_id, name, metric, operator, threshold, channel, notify_emails, cooldown_minutes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            tenantId, data.name, data.metric, data.operator, data.threshold,
            data.channel || 'in_app',
            data.notifyEmails || [],
            data.cooldownMinutes || 60,
        );
        return rows[0];
    }

    async updateRule(schemaName: string, ruleId: string, data: {
        name?: string; metric?: string; operator?: string; threshold?: number;
        channel?: string; notifyEmails?: string[]; isActive?: boolean; cooldownMinutes?: number;
    }): Promise<any> {
        const sets: string[] = [];
        const params: any[] = [];
        let idx = 1;

        if (data.name !== undefined) { sets.push(`name = $${idx++}`); params.push(data.name); }
        if (data.metric !== undefined) { sets.push(`metric = $${idx++}`); params.push(data.metric); }
        if (data.operator !== undefined) { sets.push(`operator = $${idx++}`); params.push(data.operator); }
        if (data.threshold !== undefined) { sets.push(`threshold = $${idx++}`); params.push(data.threshold); }
        if (data.channel !== undefined) { sets.push(`channel = $${idx++}`); params.push(data.channel); }
        if (data.notifyEmails !== undefined) { sets.push(`notify_emails = $${idx++}`); params.push(data.notifyEmails); }
        if (data.isActive !== undefined) { sets.push(`is_active = $${idx++}`); params.push(data.isActive); }
        if (data.cooldownMinutes !== undefined) { sets.push(`cooldown_minutes = $${idx++}`); params.push(data.cooldownMinutes); }

        sets.push(`updated_at = NOW()`);
        params.push(ruleId);

        const rows: any[] = await this.prisma.$queryRawUnsafe(
            `UPDATE "${schemaName}".alert_rules SET ${sets.join(', ')} WHERE id = $${idx}::uuid RETURNING *`,
            ...params,
        );
        return rows[0];
    }

    async deleteRule(schemaName: string, ruleId: string): Promise<void> {
        await this.prisma.$queryRawUnsafe(
            `DELETE FROM "${schemaName}".alert_rules WHERE id = $1::uuid`,
            ruleId,
        );
    }

    async getHistory(schemaName: string, ruleId: string): Promise<any[]> {
        const rows: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT * FROM "${schemaName}".alert_history
             WHERE rule_id = $1::uuid ORDER BY created_at DESC LIMIT 50`,
            ruleId,
        );
        return rows;
    }

    // ── Evaluation Cron ──────────────────────────────────────────

    /**
     * Check all active alert rules every 15 minutes.
     */
    @Cron('*/15 * * * *')
    async evaluateAlerts(): Promise<void> {
        const tenants = await this.prisma.tenant.findMany({
            where: { isActive: true },
            select: { id: true, schemaName: true },
        });

        for (const tenant of tenants) {
            try {
                await this.evaluateTenantAlerts(tenant.id, tenant.schemaName);
            } catch (error) {
                this.logger.error(`Alert eval failed for tenant ${tenant.id}: ${error}`);
            }
        }
    }

    private async evaluateTenantAlerts(tenantId: string, schemaName: string): Promise<void> {
        const rules: AlertRule[] = await this.prisma.$queryRawUnsafe(
            `SELECT * FROM "${schemaName}".alert_rules WHERE tenant_id = $1 AND is_active = true`,
            tenantId,
        );

        if (rules.length === 0) return;

        // Fetch current metrics
        const today = new Date().toISOString().split('T')[0];
        const realtime = await this.dashboardAnalytics.getRealtime(tenantId);

        // Build metric values map
        const metricValues: Record<string, number> = {
            'active_conversations': realtime.activeConversations,
            'queue_depth': realtime.queueDepth,
            'agents_online': realtime.agentsOnline,
            'messages_today': realtime.messagesToday,
        };

        // Also get Redis counters for more metrics
        const handoffKey = `analytics:${tenantId}:${today}:handoff_triggered`;
        const costKey = `analytics:${tenantId}:${today}:cost`;
        metricValues['handoffs_today'] = Number(await this.redis.get(handoffKey) || 0);
        metricValues['llm_cost_today'] = Number(await this.redis.get(costKey) || 0);

        for (const rule of rules) {
            const currentValue = metricValues[rule.metric];
            if (currentValue === undefined) continue;

            // Check cooldown
            if (rule.last_triggered_at) {
                const lastTriggered = new Date(rule.last_triggered_at).getTime();
                const cooldownMs = rule.cooldown_minutes * 60 * 1000;
                if (Date.now() - lastTriggered < cooldownMs) continue;
            }

            // Evaluate condition
            const triggered = this.evaluateCondition(currentValue, rule.operator, Number(rule.threshold));
            if (!triggered) continue;

            // Fire alert
            await this.fireAlert(schemaName, tenantId, rule, currentValue);
        }
    }

    private evaluateCondition(value: number, operator: string, threshold: number): boolean {
        switch (operator) {
            case 'gt': case '>': return value > threshold;
            case 'gte': case '>=': return value >= threshold;
            case 'lt': case '<': return value < threshold;
            case 'lte': case '<=': return value <= threshold;
            case 'eq': case '=': return value === threshold;
            default: return false;
        }
    }

    private async fireAlert(schemaName: string, tenantId: string, rule: AlertRule, currentValue: number): Promise<void> {
        this.logger.log(`Alert triggered: ${rule.name} (${rule.metric} ${rule.operator} ${rule.threshold}, current: ${currentValue})`);

        // Record in history
        await this.prisma.$queryRawUnsafe(
            `INSERT INTO "${schemaName}".alert_history (rule_id, metric_value, threshold, notified_via)
             VALUES ($1::uuid, $2, $3, $4)`,
            rule.id, currentValue, rule.threshold, rule.channel,
        );

        // Update last_triggered_at
        await this.prisma.$queryRawUnsafe(
            `UPDATE "${schemaName}".alert_rules SET last_triggered_at = NOW() WHERE id = $1::uuid`,
            rule.id,
        );

        // Send email if configured
        if (rule.notify_emails?.length > 0) {
            for (const emailAddr of rule.notify_emails) {
                await this.email.send({
                    to: emailAddr,
                    subject: `[Parallly Alert] ${rule.name}`,
                    html: `
                        <div style="font-family:sans-serif;max-width:500px;margin:auto;padding:20px;">
                            <h2 style="color:#6c5ce7;">Alert: ${rule.name}</h2>
                            <p>The metric <strong>${rule.metric}</strong> has reached <strong>${currentValue}</strong>,
                            which is ${rule.operator} your threshold of <strong>${rule.threshold}</strong>.</p>
                            <p style="color:#666;font-size:13px;">This alert was triggered at ${new Date().toISOString()}.</p>
                            <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
                            <p style="color:#999;font-size:12px;">Parallly Analytics — Manage alerts in your dashboard settings.</p>
                        </div>
                    `,
                });
            }
        }
    }
}
