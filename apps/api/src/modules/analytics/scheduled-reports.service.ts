import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { EmailService } from '../email/email.service';
import { DashboardAnalyticsService } from './dashboard-analytics.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { CronLockService } from '../redis/cron-lock.service';
import { resolveTenantSubscriptionAccess } from '../../common/utils/subscription-entitlement.util';

@Injectable()
export class ScheduledReportsService {
    private readonly logger = new Logger(ScheduledReportsService.name);
    private readonly TABLE_CACHE_PREFIX = 'sched_report_tables:';

    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        private email: EmailService,
        private dashboardAnalytics: DashboardAnalyticsService,
        private throttle: TenantThrottleService,
        private readonly cronLock: CronLockService,
    ) { }

    private async ensureTable(schemaName: string): Promise<void> {
        const cacheKey = `${this.TABLE_CACHE_PREFIX}${schemaName}`;
        const cached = await this.redis.get(cacheKey);
        if (cached) return;

        await this.prisma.$queryRawUnsafe(
            `CREATE TABLE IF NOT EXISTS "${schemaName}".scheduled_reports (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                tenant_id UUID NOT NULL,
                frequency TEXT NOT NULL DEFAULT 'weekly',
                recipients TEXT[] DEFAULT '{}',
                is_active BOOLEAN DEFAULT true,
                last_sent_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )`,
        );

        try {
            await this.prisma.$queryRawUnsafe(
                `ALTER TABLE "${schemaName}".scheduled_reports
                 ALTER COLUMN tenant_id TYPE UUID USING tenant_id::uuid`,
            );
        } catch {
            // Already UUID or empty table — ignore
        }

        await this.redis.set(cacheKey, '1', 86400);
    }

    // ── CRUD ──────────────────────────────────────────────────────

    async getConfig(schemaName: string, tenantId: string): Promise<any> {
        await this.ensureTable(schemaName);
        const rows: any[] = await this.prisma.$queryRawUnsafe(
            // El tipo de esta columna DEPENDE DEL TENANT: el schema canónico la
            // crea VARCHAR(255) y ensureTable la crea UUID, ambos con IF NOT
            // EXISTS, y el ALTER de más arriba convierte a unos schemas y a
            // otros no (su fallo se descarta en silencio). Comparar la COLUMNA
            // como texto es lo único que funciona con los dos tipos; fijar el
            // cast en el parámetro rompe la mitad de la flota con 42883.
            `SELECT * FROM "${schemaName}".scheduled_reports WHERE tenant_id::text = $1 LIMIT 1`,
            tenantId,
        );
        return rows[0] || null;
    }

    async upsertConfig(schemaName: string, tenantId: string, data: {
        frequency: string; recipients: string[]; isActive: boolean;
    }): Promise<any> {
        await this.ensureTable(schemaName);
        const existing = await this.getConfig(schemaName, tenantId);

        if (existing) {
            const rows: any[] = await this.prisma.$queryRawUnsafe(
                `UPDATE "${schemaName}".scheduled_reports
                 SET frequency = $1, recipients = $2, is_active = $3, updated_at = NOW()
                 WHERE id = $4::uuid RETURNING *`,
                data.frequency, data.recipients, data.isActive, existing.id,
            );
            return rows[0];
        }

        const rows: any[] = await this.prisma.$queryRawUnsafe(
            `INSERT INTO "${schemaName}".scheduled_reports (tenant_id, frequency, recipients, is_active)
             VALUES ($1::uuid, $2, $3, $4) RETURNING *`,
            tenantId, data.frequency, data.recipients, data.isActive,
        );
        return rows[0];
    }

    // ── Weekly Report Cron (Monday 8 AM) ─────────────────────────

    // Corre en UNA sola instancia: la API y el worker cargan el mismo
    // AppModule con ScheduleModule, asi que sin esto el cuerpo se
    // ejecuta dos veces. Ver CronLockService.
    @Cron('0 8 * * 1')
    async sendWeeklyReportsCron() {
        await this.cronLock.runExclusive('scheduled-reports.sendWeeklyReports', 3600, () => this.sendWeeklyReports());
    }

    async sendWeeklyReports(): Promise<void> {
        this.logger.log('Starting weekly report delivery');
        await this.sendReportsForFrequency('weekly');
    }

    // ── Monthly Report Cron (1st of month 8 AM) ──────────────────

    // Corre en UNA sola instancia: la API y el worker cargan el mismo
    // AppModule con ScheduleModule, asi que sin esto el cuerpo se
    // ejecuta dos veces. Ver CronLockService.
    @Cron('0 8 1 * *')
    async sendMonthlyReportsCron() {
        await this.cronLock.runExclusive('scheduled-reports.sendMonthlyReports', 3600, () => this.sendMonthlyReports());
    }

    async sendMonthlyReports(): Promise<void> {
        this.logger.log('Starting monthly report delivery');
        await this.sendReportsForFrequency('monthly');
    }

    private async sendReportsForFrequency(frequency: string): Promise<void> {
        const tenants = await this.prisma.tenant.findMany({
            where: { isActive: true },
            select: { id: true, name: true, schemaName: true },
        });

        for (const tenant of tenants) {
            try {
                if (!await this.canDeliverCustomerOutput(tenant.id)) continue;
                const hasFeature = await this.throttle.isFeatureEnabled(tenant.id, 'scheduledReports');
                if (!hasFeature) continue;

                const config = await this.getConfig(tenant.schemaName, tenant.id);
                if (!config || !config.is_active || config.frequency !== frequency) continue;
                if (!config.recipients?.length) continue;

                await this.generateAndSendReport(tenant, config);
            } catch (error) {
                this.logger.error(`Report failed for tenant ${tenant.id}: ${error}`);
            }
        }
    }

    private async generateAndSendReport(
        tenant: { id: string; name: string; schemaName: string },
        config: any,
    ): Promise<void> {
        const days = config.frequency === 'weekly' ? 7 : 30;
        const end = new Date().toISOString().split('T')[0];
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const start = startDate.toISOString().split('T')[0];

        const periodLabel = config.frequency === 'weekly' ? 'Semanal' : 'Mensual';

        // Fetch all metrics
        const [kpiData, aiData] = await Promise.all([
            this.dashboardAnalytics.getOverviewKPIs(tenant.id, start, end),
            this.dashboardAnalytics.getAIMetrics(tenant.id, start, end),
        ]);

        const kpis = kpiData.kpis;
        const getKPI = (key: string) => kpis.find((k: any) => k.key === key) || { value: 0, changePercent: 0 };

        const conv = getKPI('conversations');
        const msg = getKPI('messages');
        const aiRate = getKPI('aiResolutionRate');
        const rt = getKPI('avgResponseTime');
        const csat = getKPI('csatAvg');
        const cost = getKPI('llmCost');

        const formatTime = (s: number) => s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
        const trendIcon = (pct: number) => pct > 0 ? '↑' : pct < 0 ? '↓' : '→';
        const trendColor = (pct: number, invert = false) => {
            const positive = invert ? pct < 0 : pct > 0;
            return positive ? '#00b894' : pct === 0 ? '#636e72' : '#d63031';
        };

        const kpiRow = (label: string, value: string, pct: number, invert = false) => `
            <tr>
                <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333;">${label}</td>
                <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;font-size:18px;font-weight:700;color:#333;">${value}</td>
                <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;font-size:13px;font-weight:600;color:${trendColor(pct, invert)};">
                    ${trendIcon(pct)} ${Math.abs(pct)}%
                </td>
            </tr>`;

        const html = `
        <div style="font-family:'Segoe UI',Roboto,sans-serif;max-width:600px;margin:auto;background:#ffffff;">
            <!-- Header -->
            <div style="background:linear-gradient(135deg,#6c5ce7,#3897f0);padding:32px;text-align:center;">
                <h1 style="color:#fff;margin:0;font-size:24px;">Parallly Analytics</h1>
                <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:14px;">
                    Reporte ${periodLabel} — ${tenant.name}
                </p>
                <p style="color:rgba(255,255,255,0.7);margin:4px 0 0;font-size:12px;">
                    ${start} → ${end}
                </p>
            </div>

            <!-- KPIs -->
            <div style="padding:24px;">
                <h2 style="font-size:16px;color:#333;margin:0 0 16px;">Resumen de KPIs</h2>
                <table style="width:100%;border-collapse:collapse;background:#fafafa;border-radius:8px;overflow:hidden;">
                    <thead>
                        <tr style="background:#f5f5f5;">
                            <th style="padding:10px 16px;text-align:left;font-size:12px;color:#888;font-weight:600;">Métrica</th>
                            <th style="padding:10px 16px;text-align:left;font-size:12px;color:#888;font-weight:600;">Valor</th>
                            <th style="padding:10px 16px;text-align:left;font-size:12px;color:#888;font-weight:600;">vs Anterior</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${kpiRow('Conversaciones', String(conv.value), conv.changePercent)}
                        ${kpiRow('Mensajes', String(msg.value), msg.changePercent)}
                        ${kpiRow('Resolución IA', `${aiRate.value}%`, aiRate.changePercent)}
                        ${kpiRow('Tiempo Respuesta', formatTime(rt.value), rt.changePercent, true)}
                        ${kpiRow('CSAT', `${csat.value}/5`, csat.changePercent)}
                        ${kpiRow('Costo LLM', `$${cost.value}`, cost.changePercent, true)}
                    </tbody>
                </table>
            </div>

            <!-- AI Stats -->
            <div style="padding:0 24px 24px;">
                <h2 style="font-size:16px;color:#333;margin:0 0 16px;">Métricas de IA</h2>
                <div style="display:flex;gap:12px;">
                    <div style="flex:1;background:#f0f7ff;padding:16px;border-radius:8px;text-align:center;">
                        <p style="margin:0;font-size:24px;font-weight:700;color:#3897f0;">${aiData.resolutionRate}%</p>
                        <p style="margin:4px 0 0;font-size:12px;color:#666;">Resolución IA</p>
                    </div>
                    <div style="flex:1;background:#f0fff4;padding:16px;border-radius:8px;text-align:center;">
                        <p style="margin:0;font-size:24px;font-weight:700;color:#00b894;">${aiData.containmentRate}%</p>
                        <p style="margin:4px 0 0;font-size:12px;color:#666;">Contención</p>
                    </div>
                    <div style="flex:1;background:#fff5f5;padding:16px;border-radius:8px;text-align:center;">
                        <p style="margin:0;font-size:24px;font-weight:700;color:#d63031;">${aiData.handoffs}</p>
                        <p style="margin:4px 0 0;font-size:12px;color:#666;">Escalaciones</p>
                    </div>
                </div>
            </div>

            <!-- Footer -->
            <div style="padding:20px 24px;background:#f9f9f9;border-top:1px solid #eee;text-align:center;">
                <p style="margin:0;font-size:12px;color:#999;">
                    Este reporte fue generado automáticamente por Parallly Analytics.
                    <br>Configura la frecuencia en tu panel de administración.
                </p>
            </div>
        </div>`;

        // Send to all recipients
        // Metrics generation can take long enough to cross a billing boundary;
        // revalidate immediately before exposing customer data by email.
        if (!await this.canDeliverCustomerOutput(tenant.id)) return;
        for (const recipient of config.recipients) {
            await this.email.send({
                to: recipient,
                subject: `[Parallly] Reporte ${periodLabel} — ${tenant.name} (${start} → ${end})`,
                html,
            });
        }

        // Update last_sent_at
        await this.prisma.$queryRawUnsafe(
            `UPDATE "${tenant.schemaName}".scheduled_reports
             SET last_sent_at = NOW() WHERE id = $1::uuid`,
            config.id,
        );

        this.logger.log(`Report sent to ${config.recipients.length} recipients for tenant ${tenant.name}`);
    }

    private async canDeliverCustomerOutput(tenantId: string): Promise<boolean> {
        const access = await resolveTenantSubscriptionAccess(this.prisma, tenantId, 'write');
        if (access.allowed) return true;
        this.logger.warn(
            `[ScheduledReports] Skipping tenant=${tenantId}: `
            + `${access.error ?? 'subscription_restricted'}`,
        );
        return false;
    }
}
