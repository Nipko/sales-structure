import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { RedisService } from '../redis/redis.service';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { LLMRouterService } from '../ai/router/llm-router.service';
import { PlatformStorageService } from './platform-storage.service';
import * as os from 'os';
import * as fs from 'fs';

interface AlertState {
    lastAlertedAt: number;
    value: number;
}

const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour between repeat alerts

@Injectable()
export class PlatformMonitorService implements OnModuleInit {
    private readonly logger = new Logger(PlatformMonitorService.name);
    private alertState = new Map<string, AlertState>();
    private adminEmails: string[] = [];

    constructor(
        private redis: RedisService,
        private email: EmailService,
        private prisma: PrismaService,
        private llmRouter: LLMRouterService,
        private storage: PlatformStorageService,
        @InjectQueue('outbound-messages') private outboundQueue: Queue,
        @InjectQueue('broadcast-messages') private broadcastQueue: Queue,
        @InjectQueue('automation-jobs') private automationQueue: Queue,
        @InjectQueue('nurturing') private nurturingQueue: Queue,
    ) { }

    async onModuleInit() {
        await this.refreshAdminEmails();
    }

    private async refreshAdminEmails() {
        try {
            const admins = await this.prisma.user.findMany({
                where: { role: 'super_admin', isActive: true },
                select: { email: true },
            });
            this.adminEmails = admins.map((a: { email: string }) => a.email).filter(Boolean);
        } catch {
            this.adminEmails = [];
        }
    }

    // ── System checks — every 10 minutes ──

    @Cron('*/10 * * * *')
    async checkSystem() {
        await this.checkDisk();
        await this.checkMemory();
        await this.checkRedisMemory();
        await this.checkLlmProviders();
    }

    // ── Queue depth — every 5 minutes ──

    @Cron('2,7,12,17,22,27,32,37,42,47,52,57 * * * *')
    async checkQueues() {
        const queues = [
            { name: 'outbound-messages', queue: this.outboundQueue, warnAt: 500, critAt: 2000 },
            { name: 'broadcast-messages', queue: this.broadcastQueue, warnAt: 1000, critAt: 5000 },
            { name: 'automation-jobs', queue: this.automationQueue, warnAt: 300, critAt: 1000 },
            { name: 'nurturing', queue: this.nurturingQueue, warnAt: 200, critAt: 500 },
        ];

        for (const q of queues) {
            try {
                const waiting = await q.queue.getWaitingCount();
                const active = await q.queue.getActiveCount();
                const failed = await q.queue.getFailedCount();
                const depth = waiting + active;

                if (depth >= q.critAt) {
                    await this.alert(
                        `queue:${q.name}:critical`,
                        `Cola ${q.name} CRITICA`,
                        `La cola <b>${q.name}</b> tiene <b>${depth}</b> jobs pendientes (umbral: ${q.critAt}).<br>
                         Waiting: ${waiting} | Active: ${active} | Failed: ${failed}<br><br>
                         Revisa Bull Board para más detalles.`,
                        depth,
                    );
                } else if (depth >= q.warnAt) {
                    await this.alert(
                        `queue:${q.name}:warning`,
                        `Cola ${q.name} alta`,
                        `La cola <b>${q.name}</b> tiene <b>${depth}</b> jobs pendientes (umbral warning: ${q.warnAt}).<br>
                         Waiting: ${waiting} | Active: ${active} | Failed: ${failed}`,
                        depth,
                    );
                }

                if (failed > 100) {
                    await this.alert(
                        `queue:${q.name}:failed`,
                        `Cola ${q.name} — ${failed} jobs fallidos`,
                        `La cola <b>${q.name}</b> tiene <b>${failed}</b> jobs en estado failed.<br>
                         Considera limpiarlos desde Bull Board o investigar la causa.`,
                        failed,
                    );
                }
            } catch (e: any) {
                this.logger.warn(`Queue check failed for ${q.name}: ${e.message}`);
            }
        }
    }

    // ── Disk usage ──

    private async checkDisk() {
        try {
            const stats = fs.statfsSync('/');
            const totalGB = (stats.blocks * stats.bsize) / (1024 ** 3);
            const freeGB = (stats.bfree * stats.bsize) / (1024 ** 3);
            const usedPct = Math.round(((totalGB - freeGB) / totalGB) * 100);

            if (usedPct >= 90) {
                await this.alert(
                    'disk:critical',
                    `Disco al ${usedPct}% — CRITICO`,
                    `El disco esta al <b>${usedPct}%</b> de capacidad.<br>
                     Total: ${totalGB.toFixed(1)} GB | Libre: ${freeGB.toFixed(1)} GB<br><br>
                     Ejecuta el script de limpieza o expande el disco urgentemente.`,
                    usedPct,
                );
            } else if (usedPct >= 80) {
                await this.alert(
                    'disk:warning',
                    `Disco al ${usedPct}%`,
                    `El disco esta al <b>${usedPct}%</b> de capacidad.<br>
                     Total: ${totalGB.toFixed(1)} GB | Libre: ${freeGB.toFixed(1)} GB<br><br>
                     Considera ejecutar <code>cleanup.sh</code> o revisar que consume espacio.`,
                    usedPct,
                );
            }
        } catch (e: any) {
            this.logger.debug(`Disk check skipped: ${e.message}`);
        }
    }

    // ── RAM usage ──

    private async checkMemory() {
        const totalMB = Math.round(os.totalmem() / (1024 ** 2));
        const freeMB = Math.round(os.freemem() / (1024 ** 2));
        const usedPct = Math.round(((totalMB - freeMB) / totalMB) * 100);

        if (usedPct >= 95) {
            await this.alert(
                'ram:critical',
                `RAM al ${usedPct}% — CRITICO`,
                `La memoria esta al <b>${usedPct}%</b>.<br>
                 Total: ${totalMB} MB | Libre: ${freeMB} MB<br><br>
                 El sistema puede empezar a usar swap o matar procesos (OOM killer).`,
                usedPct,
            );
        } else if (usedPct >= 85) {
            await this.alert(
                'ram:warning',
                `RAM al ${usedPct}%`,
                `La memoria esta al <b>${usedPct}%</b>.<br>
                 Total: ${totalMB} MB | Libre: ${freeMB} MB`,
                usedPct,
            );
        }
    }

    // ── Redis memory ──

    private async checkRedisMemory() {
        try {
            const client = (this.redis as any).client;
            if (!client?.info) return;

            const info: string = await client.info('memory');
            const usedMatch = info.match(/used_memory:(\d+)/);
            const maxMatch = info.match(/maxmemory:(\d+)/);

            if (!usedMatch || !maxMatch) return;

            const usedMB = parseInt(usedMatch[1]) / (1024 ** 2);
            const maxMB = parseInt(maxMatch[1]) / (1024 ** 2);
            if (maxMB === 0) return;

            const usedPct = Math.round((usedMB / maxMB) * 100);

            if (usedPct >= 90) {
                await this.alert(
                    'redis:critical',
                    `Redis al ${usedPct}% — CRITICO`,
                    `Redis esta al <b>${usedPct}%</b> de su memoria maxima (${maxMB.toFixed(0)} MB).<br>
                     Usado: ${usedMB.toFixed(0)} MB<br><br>
                     Con <code>noeviction</code>, Redis rechazara escrituras cuando se llene.
                     BullMQ dejara de funcionar.`,
                    usedPct,
                );
            } else if (usedPct >= 75) {
                await this.alert(
                    'redis:warning',
                    `Redis al ${usedPct}%`,
                    `Redis esta al <b>${usedPct}%</b> de su memoria maxima (${maxMB.toFixed(0)} MB).<br>
                     Usado: ${usedMB.toFixed(0)} MB`,
                    usedPct,
                );
            }
        } catch (e: any) {
            this.logger.debug(`Redis memory check skipped: ${e.message}`);
        }
    }

    // ── Hourly admin email refresh ──

    @Cron('0 * * * *')
    async refreshAdmins() {
        await this.refreshAdminEmails();
    }

    // ── Storage snapshots + early-warning alerts — daily 3:15 AM ──

    @Cron('15 3 * * *')
    async checkStorage() {
        try {
            await this.storage.captureSnapshot();
        } catch (e: any) {
            this.logger.warn(`Storage snapshot failed: ${e.message}`);
        }

        // Disk-fill projection — alert if the disk will be full within 14 days.
        try {
            const proj = await this.storage.getDiskProjection();
            if (proj && proj.daysUntilFull < 14) {
                await this.alert(
                    'disk:projection',
                    `Disco se llena en ~${proj.daysUntilFull} dias`,
                    `Al ritmo actual (+${proj.slopePctPerDay}%/dia, ${proj.currentPct}% ahora) el disco
                     llegara al 100% en aproximadamente <b>${proj.daysUntilFull} dias</b>.<br><br>
                     Libera espacio (limpieza de huerfanos en /admin/storage) o amplia el disco antes.`,
                    proj.daysUntilFull,
                );
            }
        } catch (e: any) {
            this.logger.debug(`Disk projection check skipped: ${e.message}`);
        }

        // Per-tenant media quota — alert tenants at >=90% of their plan quota.
        try {
            const rows = await this.storage.getPerTenantStorage();
            for (const r of rows) {
                if (r.mediaLimitMb > 0 && r.mediaPct >= 90) {
                    await this.alert(
                        `storage:tenant:${r.tenantId}`,
                        `Tenant ${r.tenantName} al ${r.mediaPct}% de su cuota de almacenamiento`,
                        `El tenant <b>${r.tenantName}</b> (${r.plan}) usa <b>${r.mediaUsedMb} MB</b> de
                         <b>${r.mediaLimitMb} MB</b> de su cuota multimedia (${r.mediaPct}%).<br><br>
                         Cuando llegue al 100% se rechazaran nuevas subidas. Considera contactarlo
                         para escalar su plan o ajustar su cuota.`,
                        r.mediaPct,
                    );
                }
            }
        } catch (e: any) {
            this.logger.debug(`Tenant quota check skipped: ${e.message}`);
        }
    }

    // ── LLM provider health ──

    private async checkLlmProviders() {
        try {
            const providers = await this.llmRouter.getProviderHealth();
            const unhealthy = providers.filter(p => p.configured && !p.healthy);
            const unconfigured = providers.filter(p => !p.configured);
            const withFailures = providers.filter(p => p.recentFailures >= 5);

            if (unhealthy.length > 0) {
                const names = unhealthy.map(p => `<b>${p.provider}</b> (${p.recentFailures} fallos)`).join(', ');
                await this.alert(
                    'llm:unhealthy',
                    `Proveedor(es) LLM caidos: ${unhealthy.map(p => p.provider).join(', ')}`,
                    `Los siguientes proveedores LLM estan marcados como no disponibles:<br>
                     ${names}<br><br>
                     El sistema esta usando proveedores de respaldo automaticamente.<br>
                     Verifica las API keys y el estado del servicio en el dashboard.`,
                    unhealthy.length,
                );
            }

            for (const p of withFailures) {
                await this.alert(
                    `llm:failures:${p.provider}`,
                    `LLM ${p.provider} — ${p.recentFailures} fallos recientes`,
                    `El proveedor <b>${p.provider}</b> ha fallado <b>${p.recentFailures}</b> veces en los ultimos 10 minutos.<br>
                     Estado: ${p.healthy ? 'Recuperado' : 'Caido'}<br>
                     ${p.unhealthyUntil ? `Marcado como caido hasta: ${p.unhealthyUntil}` : ''}<br><br>
                     Posibles causas: API key invalida, credito agotado, rate limit, servicio caido.`,
                    p.recentFailures,
                );
            }

            const configured = providers.filter(p => p.configured);
            if (configured.length === 0) {
                await this.alert(
                    'llm:none_configured',
                    'CRITICO: Ningun proveedor LLM configurado',
                    `No hay <b>ningun</b> proveedor de IA configurado. Los agentes de IA no pueden responder.<br><br>
                     Configura al menos una API key desde el panel de administracion.`,
                    0,
                );
            }
        } catch (e: any) {
            this.logger.debug(`LLM health check skipped: ${e.message}`);
        }
    }

    // ── Alert sender with cooldown ──

    private async alert(key: string, subject: string, html: string, value: number) {
        const prev = this.alertState.get(key);
        const now = Date.now();

        if (prev && (now - prev.lastAlertedAt) < COOLDOWN_MS) return;

        this.alertState.set(key, { lastAlertedAt: now, value });

        this.logger.warn(`ALERT [${key}]: ${subject} (value=${value})`);

        if (this.adminEmails.length === 0) return;

        const fullHtml = `
            <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
                <div style="background:#ff4757;color:white;padding:16px 24px;border-radius:8px 8px 0 0;">
                    <h2 style="margin:0;font-size:18px;">⚠️ Parallly — Alerta de Plataforma</h2>
                </div>
                <div style="padding:24px;background:#f8f9fa;border:1px solid #dee2e6;border-top:none;border-radius:0 0 8px 8px;">
                    <h3 style="margin:0 0 12px 0;color:#2d3436;">${subject}</h3>
                    <div style="color:#636e72;line-height:1.6;">${html}</div>
                    <hr style="border:none;border-top:1px solid #dee2e6;margin:20px 0;">
                    <p style="color:#b2bec3;font-size:12px;margin:0;">
                        Servidor: ${os.hostname()} | ${new Date().toISOString()}
                    </p>
                </div>
            </div>
        `;

        for (const email of this.adminEmails) {
            await this.email.send({
                to: email,
                subject: `[Parallly Alert] ${subject}`,
                html: fullHtml,
            });
        }
    }

    // ── Manual status (for /health/detailed or admin API) ──

    async getStatus(): Promise<Record<string, any>> {
        const queueStatus = async (q: Queue) => {
            try {
                return {
                    waiting: await q.getWaitingCount(),
                    active: await q.getActiveCount(),
                    completed: await q.getCompletedCount(),
                    failed: await q.getFailedCount(),
                    delayed: await q.getDelayedCount(),
                };
            } catch { return { error: 'unavailable' }; }
        };

        return {
            queues: {
                'outbound-messages': await queueStatus(this.outboundQueue),
                'broadcast-messages': await queueStatus(this.broadcastQueue),
                'automation-jobs': await queueStatus(this.automationQueue),
                'nurturing': await queueStatus(this.nurturingQueue),
            },
            activeAlerts: Array.from(this.alertState.entries()).map(([key, state]) => ({
                key,
                value: state.value,
                lastAlerted: new Date(state.lastAlertedAt).toISOString(),
            })),
        };
    }
}
