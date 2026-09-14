import { withRuntimeSchemaLock } from '../../common/utils/runtime-schema-lock';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { EmailService } from '../email/email.service';
import { DashboardAnalyticsService } from './dashboard-analytics.service';
import { CronLockService } from '../redis/cron-lock.service';
import { resolveTenantSubscriptionAccess } from '../../common/utils/subscription-entitlement.util';
import { createHash } from 'crypto';
import { OperationalNoticeService } from '../operational-notices/operational-notice.service';
import { enqueueOperationalNotice, ensureOperationalNoticeOutbox } from '../operational-notices/operational-notice-outbox';

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
    private readonly TABLE_CACHE_PREFIX = 'alert_tables:';

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        private _email: EmailService,
        private dashboardAnalytics: DashboardAnalyticsService,
        private readonly cronLock: CronLockService,
        @Optional() private readonly notices?: OperationalNoticeService,
    ) { }

    private async ensureAlertTables(schemaName: string): Promise<void> {
        const cacheKey = `${this.TABLE_CACHE_PREFIX}${schemaName}`;
        const cached = await this.redis.get(cacheKey);
        if (cached) return;

        await withRuntimeSchemaLock(this.prisma, schemaName, async (tx) => {
            await tx.$queryRawUnsafe(
                `CREATE TABLE IF NOT EXISTS "${schemaName}".alert_rules (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    tenant_id UUID NOT NULL,
                    name TEXT NOT NULL,
                    metric TEXT NOT NULL,
                    operator TEXT NOT NULL DEFAULT 'gt',
                    threshold NUMERIC NOT NULL DEFAULT 0,
                    channel TEXT DEFAULT 'in_app',
                    notify_emails TEXT[] DEFAULT '{}',
                    is_active BOOLEAN DEFAULT true,
                    last_triggered_at TIMESTAMPTZ,
                    cooldown_minutes INTEGER DEFAULT 60,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )`,
            );

            await tx.$queryRawUnsafe(
                `CREATE TABLE IF NOT EXISTS "${schemaName}".alert_history (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    rule_id UUID NOT NULL,
                    metric_value NUMERIC,
                    threshold NUMERIC,
                    notified_via TEXT,
                    created_at TIMESTAMPTZ DEFAULT NOW()
                )`,
            );

            // Migrate existing schemas where tenant_id is text → uuid

        });

        // Historical text rows remain readable via tenant_id::text. This optional
        // conversion must not make an otherwise usable table unavailable.
        try {
            await withRuntimeSchemaLock(this.prisma, schemaName, tx => tx.$queryRawUnsafe(
                `ALTER TABLE "${schemaName}".alert_rules ALTER COLUMN tenant_id TYPE UUID USING tenant_id::uuid`,
            ));
        } catch {
            this.logger.debug('Optional tenant_id UUID conversion deferred');
        }

        await this.redis.set(cacheKey, '1', 86400);
    }

    // ── CRUD ──────────────────────────────────────────────────────

    async getRules(schemaName: string, tenantId: string): Promise<any[]> {
        await this.ensureAlertTables(schemaName);
        const rules: any[] = await this.prisma.$queryRawUnsafe(
            `SELECT ar.*,
                    (SELECT COUNT(*)::int FROM "${schemaName}".alert_history ah WHERE ah.rule_id = ar.id) as trigger_count,
                    (SELECT MAX(created_at) FROM "${schemaName}".alert_history ah WHERE ah.rule_id = ar.id) as last_alert_at
             FROM "${schemaName}".alert_rules ar
             -- El tipo de alert_rules.tenant_id DEPENDE DEL TENANT: el schema
             -- canónico la crea VARCHAR(255) y ensureAlertTables la crea UUID,
             -- ambos con IF NOT EXISTS, y encima el ALTER de más arriba la pasa
             -- a UUID cuando puede (dentro de un catch que se traga el fallo).
             -- Comparar la COLUMNA como texto es lo único que funciona en los
             -- dos casos: fijar un cast en el parámetro rompe la mitad de la
             -- flota con 42883, que es exactamente lo que pasó.
             WHERE ar.tenant_id::text = $1
             ORDER BY ar.created_at DESC`,
            tenantId,
        );
        return rules;
    }

    async createRule(schemaName: string, tenantId: string, data: {
        name: string; metric: string; operator: string; threshold: number;
        channel?: string; notifyEmails?: string[]; cooldownMinutes?: number;
    }): Promise<any> {
        await this.ensureAlertTables(schemaName);
        const rows: any[] = await this.prisma.$queryRawUnsafe(
            `INSERT INTO "${schemaName}".alert_rules
             (tenant_id, name, metric, operator, threshold, channel, notify_emails, cooldown_minutes)
             VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8)
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
        await this.ensureAlertTables(schemaName);
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
        await this.ensureAlertTables(schemaName);
        await this.prisma.$queryRawUnsafe(
            `DELETE FROM "${schemaName}".alert_rules WHERE id = $1::uuid`,
            ruleId,
        );
    }

    async getHistory(schemaName: string, ruleId: string): Promise<any[]> {
        await this.ensureAlertTables(schemaName);
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
    // Corre en UNA sola instancia: la API y el worker cargan el mismo
    // AppModule con ScheduleModule, asi que sin esto el cuerpo se
    // ejecuta dos veces. Ver CronLockService.
    @Cron('*/15 * * * *')
    async evaluateAlertsCron() {
        await this.cronLock.runExclusive('alerts.evaluateAlerts', 300, () => this.evaluateAlerts());
    }

    async evaluateAlerts(): Promise<void> {
        const tenants = await this.prisma.tenant.findMany({
            where: { isActive: true },
            select: { id: true, schemaName: true },
        });

        for (const tenant of tenants) {
            try {
                if (!await this.canDeliverCustomerOutput(tenant.id)) continue;
                await this.evaluateTenantAlerts(tenant.id, tenant.schemaName);
            } catch (error) {
                this.logger.error(`Alert eval failed for tenant ${tenant.id}: ${error}`);
            }
        }
    }

    private async evaluateTenantAlerts(tenantId: string, schemaName: string): Promise<void> {
        await this.ensureAlertTables(schemaName);
        const rules: AlertRule[] = await this.prisma.$queryRawUnsafe(
            // La columna se compara como texto porque su tipo varía entre
            // tenants (ver getRules). Este cron recorre TODA la flota, así que
            // un cast fijo acá deja sin evaluar las alertas de medio mundo.
            `SELECT * FROM "${schemaName}".alert_rules WHERE tenant_id::text = $1 AND is_active = true`,
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
        // Close the TOCTOU window between metric evaluation and the external
        // email/history side effect.
        if (!await this.canDeliverCustomerOutput(tenantId)) return;
        if (!this.notices) throw new Error('alert_notice_lane_unavailable');
        await ensureOperationalNoticeOutbox(this.prisma,schemaName);
        const admitted=await this.prisma.transactionInTenantSchema(schemaName,async query=>{
            const [current]=await query<AlertRule[]>(`SELECT * FROM alert_rules WHERE id=$1::uuid AND tenant_id::text=$2 FOR UPDATE`,[rule.id,tenantId]);
            if (!current?.is_active || !this.evaluateCondition(currentValue,current.operator,Number(current.threshold))) return 0;
            if (current.last_triggered_at
                && Date.now()-new Date(current.last_triggered_at).getTime()<Number(current.cooldown_minutes)*60_000) return 0;
            const [history]=await query<any[]>(`INSERT INTO alert_history(rule_id,metric_value,threshold,notified_via)
                VALUES($1::uuid,$2,$3,$4) RETURNING id,created_at`,[current.id,currentValue,current.threshold,current.channel]);
            const recipients=[...new Set((current.notify_emails || []).map(value=>String(value).trim().toLowerCase())
                .filter(value=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)))];
            const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,char=>({
                '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
            })[char]!);
            const subject=`[Parallly Alert] ${String(current.name).replace(/[\r\n]+/g,' ').slice(0,200)}`;
            const html=`<div style="font-family:sans-serif;max-width:500px;margin:auto;padding:20px;">
                <h2 style="color:#6c5ce7;">Alert: ${esc(current.name)}</h2>
                <p>The metric <strong>${esc(current.metric)}</strong> has reached <strong>${esc(currentValue)}</strong>,
                which is ${esc(current.operator)} your threshold of <strong>${esc(current.threshold)}</strong>.</p>
                <p style="color:#666;font-size:13px;">This alert was triggered at ${new Date(history.created_at).toISOString()}.</p>
                <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
                <p style="color:#999;font-size:12px;">Parallly Analytics — Manage alerts in your dashboard settings.</p>
            </div>`;
            for(const recipientEmail of recipients){
                const revision=createHash('sha256').update(recipientEmail).digest('hex').slice(0,24);
                await enqueueOperationalNotice(query,schemaName,{kind:'analytics.threshold_alert',entityId:history.id,
                    revision,recipientEmail,payload:{subject,html}});
            }
            await query('UPDATE alert_rules SET last_triggered_at=clock_timestamp() WHERE id=$1::uuid',[current.id]);
            return recipients.length;
        });
        this.logger.log(`Alert triggered: ${rule.name} (${rule.metric} ${rule.operator} ${rule.threshold}, current: ${currentValue}); ${admitted} email notice(s) admitted`);
        if(admitted)await this.notices.recoverTenant(tenantId).catch(error=>{
            this.logger.warn(`Alert notice enqueue deferred for tenant ${tenantId}: ${error?.message || error}`);
        });
    }

    private async canDeliverCustomerOutput(tenantId: string): Promise<boolean> {
        const access = await resolveTenantSubscriptionAccess(this.prisma, tenantId, 'write');
        if (access.allowed) return true;
        this.logger.warn(
            `[Alerts] Skipping tenant=${tenantId}: `
            + `${access.error ?? 'subscription_restricted'}`,
        );
        return false;
    }
}
