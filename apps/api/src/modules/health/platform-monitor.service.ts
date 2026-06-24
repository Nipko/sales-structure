import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { RedisService } from '../redis/redis.service';
import { EmailService } from '../email/email.service';
import { PrismaService } from '../prisma/prisma.service';
import { LLMRouterService } from '../ai/router/llm-router.service';
import { PlatformStorageService } from './platform-storage.service';
import { IncidentService, IncidentSeverity } from './incident.service';
import { TelegramAlertService } from './telegram-alert.service';
import { AlertConfigService } from './alert-config.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
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
        private incidents: IncidentService,
        private telegram: TelegramAlertService,
        private alertConfig: AlertConfigService,
        private throttle: TenantThrottleService,
        private config: ConfigService,
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
        await this.checkDbConnections();
        await this.checkPgBouncerPool();
        await this.checkLlmProviders();
        // Backstop: auto-resolve incidents that simply stopped re-firing.
        await this.incidents.sweepStale(48);
    }

    // ── Queue depth — every 5 minutes ──

    @Cron('2,7,12,17,22,27,32,37,42,47,52,57 * * * *')
    async checkQueues() {
        const cfg = await this.alertConfig.get();
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
                    await this.incidents.resolveByKey(`queue:${q.name}:warning`);
                } else if (depth >= q.warnAt) {
                    await this.alert(
                        `queue:${q.name}:warning`,
                        `Cola ${q.name} alta`,
                        `La cola <b>${q.name}</b> tiene <b>${depth}</b> jobs pendientes (umbral warning: ${q.warnAt}).<br>
                         Waiting: ${waiting} | Active: ${active} | Failed: ${failed}`,
                        depth,
                    );
                    await this.incidents.resolveByKey(`queue:${q.name}:critical`);
                } else {
                    await this.incidents.resolveByKey(`queue:${q.name}:critical`);
                    await this.incidents.resolveByKey(`queue:${q.name}:warning`);
                }

                if (failed > cfg.queueFailed) {
                    await this.alert(
                        `queue:${q.name}:failed`,
                        `Cola ${q.name} — ${failed} jobs fallidos`,
                        `La cola <b>${q.name}</b> tiene <b>${failed}</b> jobs en estado failed.<br>
                         Considera limpiarlos desde Bull Board o investigar la causa.`,
                        failed,
                    );
                } else {
                    await this.incidents.resolveByKey(`queue:${q.name}:failed`);
                }
            } catch (e: any) {
                this.logger.warn(`Queue check failed for ${q.name}: ${e.message}`);
            }
        }
    }

    // ── Disk usage ──

    private async checkDisk() {
        try {
            const cfg = await this.alertConfig.get();
            const stats = fs.statfsSync('/');
            const totalGB = (stats.blocks * stats.bsize) / (1024 ** 3);
            const freeGB = (stats.bfree * stats.bsize) / (1024 ** 3);
            const usedPct = Math.round(((totalGB - freeGB) / totalGB) * 100);

            if (usedPct >= cfg.disk.crit) {
                await this.alert(
                    'disk:critical',
                    `Disco al ${usedPct}% — CRITICO`,
                    `El disco esta al <b>${usedPct}%</b> de capacidad.<br>
                     Total: ${totalGB.toFixed(1)} GB | Libre: ${freeGB.toFixed(1)} GB<br><br>
                     Ejecuta el script de limpieza o expande el disco urgentemente.`,
                    usedPct,
                );
                await this.incidents.resolveByKey('disk:warning');
            } else if (usedPct >= cfg.disk.warn) {
                await this.alert(
                    'disk:warning',
                    `Disco al ${usedPct}%`,
                    `El disco esta al <b>${usedPct}%</b> de capacidad.<br>
                     Total: ${totalGB.toFixed(1)} GB | Libre: ${freeGB.toFixed(1)} GB<br><br>
                     Considera ejecutar <code>cleanup.sh</code> o revisar que consume espacio.`,
                    usedPct,
                );
                await this.incidents.resolveByKey('disk:critical');
            } else {
                await this.incidents.resolveByKey('disk:critical');
                await this.incidents.resolveByKey('disk:warning');
            }
        } catch (e: any) {
            this.logger.debug(`Disk check skipped: ${e.message}`);
        }
    }

    // ── RAM usage ──

    private async checkMemory() {
        const cfg = await this.alertConfig.get();
        const totalMB = Math.round(os.totalmem() / (1024 ** 2));
        const freeMB = Math.round(os.freemem() / (1024 ** 2));
        const usedPct = Math.round(((totalMB - freeMB) / totalMB) * 100);

        if (usedPct >= cfg.ram.crit) {
            await this.alert(
                'ram:critical',
                `RAM al ${usedPct}% — CRITICO`,
                `La memoria esta al <b>${usedPct}%</b>.<br>
                 Total: ${totalMB} MB | Libre: ${freeMB} MB<br><br>
                 El sistema puede empezar a usar swap o matar procesos (OOM killer).`,
                usedPct,
            );
            await this.incidents.resolveByKey('ram:warning');
        } else if (usedPct >= cfg.ram.warn) {
            await this.alert(
                'ram:warning',
                `RAM al ${usedPct}%`,
                `La memoria esta al <b>${usedPct}%</b>.<br>
                 Total: ${totalMB} MB | Libre: ${freeMB} MB`,
                usedPct,
            );
            await this.incidents.resolveByKey('ram:critical');
        } else {
            await this.incidents.resolveByKey('ram:critical');
            await this.incidents.resolveByKey('ram:warning');
        }
    }

    // ── Redis memory ──

    private async checkRedisMemory() {
        try {
            const cfg = await this.alertConfig.get();
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

            if (usedPct >= cfg.redis.crit) {
                await this.alert(
                    'redis:critical',
                    `Redis al ${usedPct}% — CRITICO`,
                    `Redis esta al <b>${usedPct}%</b> de su memoria maxima (${maxMB.toFixed(0)} MB).<br>
                     Usado: ${usedMB.toFixed(0)} MB<br><br>
                     Con <code>noeviction</code>, Redis rechazara escrituras cuando se llene.
                     BullMQ dejara de funcionar.`,
                    usedPct,
                );
                await this.incidents.resolveByKey('redis:warning');
            } else if (usedPct >= cfg.redis.warn) {
                await this.alert(
                    'redis:warning',
                    `Redis al ${usedPct}%`,
                    `Redis esta al <b>${usedPct}%</b> de su memoria maxima (${maxMB.toFixed(0)} MB).<br>
                     Usado: ${usedMB.toFixed(0)} MB`,
                    usedPct,
                );
                await this.incidents.resolveByKey('redis:critical');
            } else {
                await this.incidents.resolveByKey('redis:critical');
                await this.incidents.resolveByKey('redis:warning');
            }
        } catch (e: any) {
            this.logger.debug(`Redis memory check skipped: ${e.message}`);
        }
    }

    // ── PostgreSQL client-backend saturation ──
    // NOTE: counts real PG *client backends* only (excludes autovacuum/walwriter/etc
    // so the % isn't inflated). Apps go through PgBouncer (transaction mode), which
    // keeps this low by design — so this mainly catches direct-connection leaks
    // (migrations via DIRECT_DATABASE_URL), a misconfigured pool, or PgBouncer being
    // bypassed. The deeper app-saturation signal (PgBouncer SHOW POOLS cl_waiting/
    // maxwait) is a planned follow-up.

    private async checkDbConnections() {
        try {
            const cfg = await this.alertConfig.get();
            const rows = await this.prisma.$queryRawUnsafe(
                `SELECT count(*)::int AS used, current_setting('max_connections')::int AS max
                 FROM pg_stat_activity WHERE backend_type = 'client backend'`,
            ) as Array<{ used: number; max: number }>;
            const used = Number(rows?.[0]?.used ?? 0);
            const max = Number(rows?.[0]?.max ?? 0);
            if (max <= 0) return;
            const usedPct = Math.round((used / max) * 100);

            if (usedPct >= cfg.dbConnections.crit) {
                await this.alert(
                    'db:connections:critical',
                    `Conexiones cliente a PostgreSQL al ${usedPct}% — CRITICO`,
                    `Hay <b>${used}</b> de <b>${max}</b> conexiones cliente a PostgreSQL (${usedPct}%).<br><br>
                     Normalmente PgBouncer las mantiene bajas; un valor tan alto indica fuga de conexiones,
                     migraciones atascadas (DIRECT_DATABASE_URL) o bypass de PgBouncer. Cerca del maximo,
                     las nuevas conexiones empezaran a fallar.`,
                    usedPct,
                );
                await this.incidents.resolveByKey('db:connections:warning');
            } else if (usedPct >= cfg.dbConnections.warn) {
                await this.alert(
                    'db:connections:warning',
                    `Conexiones cliente a PostgreSQL al ${usedPct}%`,
                    `Hay <b>${used}</b> de <b>${max}</b> conexiones cliente a PostgreSQL (${usedPct}%).<br>
                     PgBouncer suele mantener esto bajo: revisa fugas de conexiones o el estado del pool.`,
                    usedPct,
                );
                await this.incidents.resolveByKey('db:connections:critical');
            } else {
                await this.incidents.resolveByKey('db:connections:critical');
                await this.incidents.resolveByKey('db:connections:warning');
            }
        } catch (e: any) {
            this.logger.debug(`DB connections check skipped: ${e.message}`);
        }
    }

    // ── PgBouncer pool saturation (the real app-side signal) ──
    // Reads SHOW POOLS from the PgBouncer admin console (the `parallext` user is
    // in stats_users/admin_users). maxwait = seconds the oldest client has been
    // waiting for a pooled connection; with query_wait_timeout=60s, a rising
    // maxwait means requests are about to start failing. Best-effort + silent if
    // pg isn't installed or the admin DB is unreachable.

    private async checkPgBouncerPool() {
        const cfg = await this.alertConfig.get();
        const url = this.config.get<string>('DATABASE_URL');
        if (!url) return;

        let parsed: URL;
        try { parsed = new URL(url); } catch { return; }
        if (!parsed.port || !parsed.hostname) return;

        let pg: any;
        try { pg = require('pg'); } catch { return; } // pg not present → skip

        // URL.username/password are percent-encoded; decode defensively — a literal
        // '%' in the password would otherwise make decodeURIComponent throw.
        const safeDecode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };

        let client: any;
        try {
            client = new pg.Client({
                host: parsed.hostname,
                port: Number(parsed.port),
                user: safeDecode(parsed.username),
                password: safeDecode(parsed.password),
                database: 'pgbouncer', // PgBouncer admin pseudo-database
                connectionTimeoutMillis: 4000,
                query_timeout: 4000,
                application_name: 'parallext-monitor',
            });
            await client.connect();
            const res = await client.query('SHOW POOLS');
            const rows: any[] = res?.rows || [];

            let clWaiting = 0;
            let maxwait = 0;
            for (const r of rows) {
                if (r.database === 'pgbouncer') continue; // skip the admin pseudo-pool
                clWaiting += Number(r.cl_waiting || 0);
                maxwait = Math.max(maxwait, Number(r.maxwait || 0));
            }

            if (maxwait >= cfg.pgbouncer.critSec) {
                await this.alert(
                    'pgbouncer:pool:critical',
                    `PgBouncer: clientes esperando ${maxwait}s — CRITICO`,
                    `El pool de PgBouncer esta saturado: el cliente mas antiguo lleva <b>${maxwait}s</b>
                     esperando una conexion y hay <b>${clWaiting}</b> en cola.<br><br>
                     Con query_wait_timeout=60s los requests empezaran a fallar pronto. Sube
                     default_pool_size, revisa queries lentas o conexiones que no se liberan.`,
                    maxwait,
                );
                await this.incidents.resolveByKey('pgbouncer:pool:warning');
            } else if (maxwait >= cfg.pgbouncer.warnSec) {
                await this.alert(
                    'pgbouncer:pool:warning',
                    `PgBouncer: clientes esperando hasta ${maxwait}s`,
                    `Hay <b>${clWaiting}</b> cliente(s) esperando una conexion del pool de PgBouncer
                     (espera maxima <b>${maxwait}s</b>).<br>El pool esta bajo presion; vigila el trafico
                     y las queries lentas.`,
                    maxwait,
                );
                await this.incidents.resolveByKey('pgbouncer:pool:critical');
            } else {
                await this.incidents.resolveByKey('pgbouncer:pool:critical');
                await this.incidents.resolveByKey('pgbouncer:pool:warning');
            }
        } catch (e: any) {
            this.logger.debug(`PgBouncer pool check skipped: ${e.message}`);
        } finally {
            try { if (client) await client.end(); } catch { /* ignore */ }
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
        const cfg = await this.alertConfig.get();
        try {
            await this.storage.captureSnapshot();
        } catch (e: any) {
            this.logger.warn(`Storage snapshot failed: ${e.message}`);
        }

        // Disk-fill projection — alert if the disk will be full within 14 days.
        try {
            const proj = await this.storage.getDiskProjection();
            if (proj && proj.daysUntilFull < cfg.diskProjectionDays) {
                await this.alert(
                    'disk:projection',
                    `Disco se llena en ~${proj.daysUntilFull} dias`,
                    `Al ritmo actual (+${proj.slopePctPerDay}%/dia, ${proj.currentPct}% ahora) el disco
                     llegara al 100% en aproximadamente <b>${proj.daysUntilFull} dias</b>.<br><br>
                     Libera espacio (limpieza de huerfanos en /admin/storage) o amplia el disco antes.`,
                    proj.daysUntilFull,
                );
            } else {
                await this.incidents.resolveByKey('disk:projection');
            }
        } catch (e: any) {
            this.logger.debug(`Disk projection check skipped: ${e.message}`);
        }

        // Per-tenant media quota — alert tenants at >=90% of their plan quota.
        try {
            const rows = await this.storage.getPerTenantStorage();
            for (const r of rows) {
                if (r.mediaLimitMb > 0 && r.mediaPct >= cfg.storageQuotaPct) {
                    await this.alert(
                        `storage:tenant:${r.tenantId}`,
                        `Tenant ${r.tenantName} al ${r.mediaPct}% de su cuota de almacenamiento`,
                        `El tenant <b>${r.tenantName}</b> (${r.plan}) usa <b>${r.mediaUsedMb} MB</b> de
                         <b>${r.mediaLimitMb} MB</b> de su cuota multimedia (${r.mediaPct}%).<br><br>
                         Cuando llegue al 100% se rechazaran nuevas subidas. Considera contactarlo
                         para escalar su plan o ajustar su cuota.`,
                        r.mediaPct,
                    );
                } else {
                    await this.incidents.resolveByKey(`storage:tenant:${r.tenantId}`);
                }
            }
        } catch (e: any) {
            this.logger.debug(`Tenant quota check skipped: ${e.message}`);
        }
    }

    // ── Risk signals — daily 7:30 AM (payments, tokens, AI budget, backups) ──

    @Cron('30 7 * * *')
    async checkRiskSignals() {
        await this.checkPaymentFailures();
        await this.checkChannelTokens();
        await this.checkLlmBudgets();
        await this.checkBackupHeartbeat();
    }

    private async checkPaymentFailures() {
        try {
            const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const failed = await this.prisma.billingPayment.count({
                where: { status: 'failed', createdAt: { gte: since } },
            });
            const cfg = await this.alertConfig.get();
            const THRESHOLD = cfg.paymentFailures;
            if (failed >= THRESHOLD) {
                await this.alert(
                    'billing:payment_failures',
                    `${failed} pagos fallidos en 24h`,
                    `Se registraron <b>${failed}</b> pagos fallidos en las ultimas 24 horas (umbral: ${THRESHOLD}).<br><br>
                     Revisa el estado del proveedor de pagos (MercadoPago/Stripe) y la cola de reconciliacion.`,
                    failed,
                );
            } else {
                await this.incidents.resolveByKey('billing:payment_failures');
            }
        } catch (e: any) {
            this.logger.debug(`Payment-failure check skipped: ${e.message}`);
        }
    }

    private async checkChannelTokens() {
        try {
            const errored = await this.prisma.whatsappCredential.count({ where: { rotationState: 'error' } });
            if (errored > 0) {
                await this.alert(
                    'tokens:error',
                    `${errored} token(s) de canal en error`,
                    `Hay <b>${errored}</b> credencial(es) de canal cuyo refresco fallo (estado 'error').<br>
                     Esos canales se desconectaran cuando expire el token. Reconecta el canal afectado
                     desde el panel del tenant.`,
                    errored,
                );
            } else {
                await this.incidents.resolveByKey('tokens:error');
            }

            const in7 = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
            const expiring = await this.prisma.whatsappCredential.count({
                where: { rotationState: 'active', expiresAt: { lte: in7, gt: new Date() } },
            });
            if (expiring > 0) {
                await this.alert(
                    'tokens:expiring',
                    `${expiring} token(s) de canal por expirar`,
                    `Hay <b>${expiring}</b> credencial(es) de canal que expiran en los proximos 7 dias y aun
                     no se renovaron automaticamente.<br>Verifica que el cron de refresco este corriendo.`,
                    expiring,
                );
            } else {
                await this.incidents.resolveByKey('tokens:expiring');
            }
        } catch (e: any) {
            this.logger.debug(`Token health check skipped: ${e.message}`);
        }
    }

    private async checkLlmBudgets() {
        try {
            const cfg = await this.alertConfig.get();
            const tenants = await this.prisma.tenant.findMany({
                where: { isActive: true },
                select: { id: true, name: true },
            });
            for (const t of tenants) {
                const budget = await this.throttle.getPlanLimit(t.id, 'llmCostBudgetUsdCents'); // cents; Infinity if -1, 0 if unset
                if (!Number.isFinite(budget) || budget <= 0) {
                    await this.incidents.resolveByKey(`llm:budget:${t.id}`);
                    continue;
                }
                const spentCents = await this.throttle.getLlmSpendUsdCents(t.id); // USD cents, month-to-date
                const pct = Math.round((spentCents / (budget as number)) * 100);
                if (pct >= cfg.llmBudgetPct) {
                    await this.alert(
                        `llm:budget:${t.id}`,
                        `Tenant ${t.name} al ${pct}% de su presupuesto de IA`,
                        `El tenant <b>${t.name}</b> consumio <b>$${(spentCents / 100).toFixed(2)}</b> de su
                         presupuesto mensual de IA de <b>$${((budget as number) / 100).toFixed(2)}</b> (${pct}%).<br><br>
                         Al llegar al 100% se corta el acceso a LLM (circuit breaker de costo).`,
                        pct,
                    );
                } else {
                    await this.incidents.resolveByKey(`llm:budget:${t.id}`);
                }
            }
        } catch (e: any) {
            this.logger.debug(`LLM budget check skipped: ${e.message}`);
        }
    }

    private async checkBackupHeartbeat() {
        try {
            const cfg = await this.alertConfig.get();
            const last = await this.redis.get('backup:last_success');
            if (!last) return; // heartbeat not wired yet — stay silent (no false positive)
            const ts = Number(last) || Date.parse(last);
            if (!Number.isFinite(ts)) return;
            const ageH = (Date.now() - ts) / (60 * 60 * 1000);
            if (ageH > cfg.backupStaleHours) {
                await this.alert(
                    'backup:stale',
                    `Backup sin exito hace ${Math.round(ageH)}h`,
                    `El ultimo backup exitoso fue hace <b>${Math.round(ageH)} horas</b> (heartbeat en Redis).<br>
                     Los backups corren a las 2AM; revisa <code>/var/log/parallext-backup.log</code> en el VPS.`,
                    Math.round(ageH),
                );
            } else {
                await this.incidents.resolveByKey('backup:stale');
            }
        } catch (e: any) {
            this.logger.debug(`Backup heartbeat check skipped: ${e.message}`);
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
            } else {
                await this.incidents.resolveByKey('llm:unhealthy');
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

            // Auto-resolve per-provider failure incidents once the count decays (<5).
            for (const p of providers) {
                if (p.recentFailures < 5) {
                    await this.incidents.resolveByKey(`llm:failures:${p.provider}`);
                }
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
            } else {
                await this.incidents.resolveByKey('llm:none_configured');
            }
        } catch (e: any) {
            this.logger.debug(`LLM health check skipped: ${e.message}`);
        }
    }

    /** Map an alert key to an incident severity. */
    private severityFromKey(key: string): IncidentSeverity {
        const CRITICAL_KEYS = ['llm:none_configured', 'llm:unhealthy', 'tokens:error', 'backup:stale'];
        if (key.endsWith(':critical') || CRITICAL_KEYS.includes(key)) {
            return 'critical';
        }
        return 'warning';
    }

    /** Render an alert as Telegram-safe HTML (strip the email markup to text). */
    private toTelegramText(severity: IncidentSeverity, subject: string, html: string): string {
        const emoji = severity === 'critical' ? '🔴' : severity === 'warning' ? '🟠' : '🔵';
        const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const bodyText = html
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/?[^>]+>/g, '')
            .replace(/&nbsp;/gi, ' ')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        return `${emoji} <b>${esc(subject)}</b>\n\n${esc(bodyText)}\n\n🖥 ${esc(os.hostname())}`;
    }

    // ── Alert sender: persist incident always, email/Telegram throttled ──

    private async alert(key: string, subject: string, html: string, value: number) {
        const severity = this.severityFromKey(key);
        const cfg = await this.alertConfig.get();

        // Persist/dedup the incident on every fire, independent of the email
        // cooldown, so re-fires bump count/lastSeen and survive restarts.
        await this.incidents.record(key, severity, subject, html, value);

        const prev = this.alertState.get(key);
        const now = Date.now();

        if (prev && (now - prev.lastAlertedAt) < COOLDOWN_MS) return;

        this.alertState.set(key, { lastAlertedAt: now, value });

        this.logger.warn(`ALERT [${key}]: ${subject} (value=${value})`);

        // Telegram ops channel (throttled by the same cooldown above).
        if (cfg.channels.telegram) {
            await this.telegram.send(this.toTelegramText(severity, subject, html));
        }

        if (!cfg.channels.email || this.adminEmails.length === 0) return;

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
