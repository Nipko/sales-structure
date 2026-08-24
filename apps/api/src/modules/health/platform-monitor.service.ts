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
import { SmsAlertService } from './sms-alert.service';
import { AlertConfigService } from './alert-config.service';
import { SentryStatsService } from './sentry-stats.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { PAYMENT_PROVIDER_NAMES, PaymentProviderName } from '../billing/types/provider-types';
import { SubscriptionStatus } from '../billing/types/subscription-status.enum';
import * as os from 'os';
import * as fs from 'fs';
import { CronLockService } from '../redis/cron-lock.service';

interface AlertState {
    lastAlertedAt: number;
    value: number;
}

const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour between repeat alerts

// ── Internal recurring billing engine thresholds ──

/** A charge the provider accepted but never resolved after this long is stuck money. */
const STUCK_CHARGE_MINUTES = 30;
/** Grace after the due time before a missing attempt means the scheduler stopped scheduling. */
const RENEWAL_OVERDUE_HOURS = 2;
/** Must match the accumulator RenewalSchedulerService writes (`billing:renewal:cop:{day}`). */
const DAILY_CAP_ENV = 'WOMPI_DAILY_CAP_COP_CENTS';
const DEFAULT_DAILY_CAP_COP_CENTS = 8_000_000_00;
const DAILY_CAP_WARN_RATIO = 0.7;
/**
 * The scheduler gives back the room it could not use, so the accumulator never
 * actually exceeds the cap: pinned this close to the ceiling IS the "exceeded"
 * signal, and every remaining renewal of the day is being deferred.
 */
const DAILY_CAP_CRIT_RATIO = 0.98;
const CARD_EXPIRY_WARN_DAYS = 30;
const DECLINE_RATE_THRESHOLD = 0.4;
/** Below this many settled attempts a "rate" is noise, not a signal. */
const DECLINE_MIN_ATTEMPTS = 10;
const PAYMENT_SOURCE_KINDS = ['card', 'nequi', 'daviplata', 'bancolombia_transfer', 'pse', 'unknown'];

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
        private smsAlert: SmsAlertService,
        private alertConfig: AlertConfigService,
        private sentry: SentryStatsService,
        private throttle: TenantThrottleService,
        private config: ConfigService,
        @InjectQueue('outbound-messages') private outboundQueue: Queue,
        @InjectQueue('broadcast-messages') private broadcastQueue: Queue,
        @InjectQueue('automation-jobs') private automationQueue: Queue,
        @InjectQueue('nurturing') private nurturingQueue: Queue,
        @InjectQueue('inbound-messages') private inboundQueue: Queue,
        private readonly cronLock: CronLockService,
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

    // Corre en UNA sola instancia: la API y el worker cargan el mismo
    // AppModule con ScheduleModule, asi que sin esto el cuerpo se
    // ejecuta dos veces. Ver CronLockService.
    @Cron('*/10 * * * *')
    async checkSystemCron() {
        await this.cronLock.runExclusive('platform-monitor.checkSystem', 240, () => this.checkSystem());
    }

    async checkSystem() {
        await this.checkDisk();
        await this.checkMemory();
        await this.checkRedisMemory();
        await this.checkDbConnections();
        await this.checkPgBouncerPool();
        await this.checkSentryErrors();
        await this.checkLlmProviders();
        // Backstop: auto-resolve incidents that simply stopped re-firing.
        await this.incidents.sweepStale(48);
    }

    // ── Queue depth — every 5 minutes ──

    // Corre en UNA sola instancia: la API y el worker cargan el mismo
    // AppModule con ScheduleModule, asi que sin esto el cuerpo se
    // ejecuta dos veces. Ver CronLockService.
    @Cron('2,7,12,17,22,27,32,37,42,47,52,57 * * * *')
    async checkQueuesCron() {
        await this.cronLock.runExclusive('platform-monitor.checkQueues', 120, () => this.checkQueues());
    }

    async checkQueues() {
        const cfg = await this.alertConfig.get();
        const queues = [
            { name: 'outbound-messages', queue: this.outboundQueue },
            { name: 'broadcast-messages', queue: this.broadcastQueue },
            { name: 'automation-jobs', queue: this.automationQueue },
            { name: 'nurturing', queue: this.nurturingQueue },
            // Most important queue on the platform: a backlog here means
            // customers are writing in and getting no answer.
            { name: 'inbound-messages', queue: this.inboundQueue },
        ];

        for (const q of queues) {
            try {
                const d = cfg.queueDepth[q.name] || { warn: 500, crit: 2000 };
                const waiting = await q.queue.getWaitingCount();
                const active = await q.queue.getActiveCount();
                const failed = await q.queue.getFailedCount();
                const depth = waiting + active;

                if (depth >= d.crit) {
                    await this.alert(
                        `queue:${q.name}:critical`,
                        `Cola ${q.name} CRITICA`,
                        `La cola <b>${q.name}</b> tiene <b>${depth}</b> jobs pendientes (umbral: ${d.crit}).<br>
                         Waiting: ${waiting} | Active: ${active} | Failed: ${failed}<br><br>
                         Revisa Bull Board para más detalles.`,
                        depth,
                    );
                    await this.incidents.resolveByKey(`queue:${q.name}:warning`);
                } else if (depth >= d.warn) {
                    await this.alert(
                        `queue:${q.name}:warning`,
                        `Cola ${q.name} alta`,
                        `La cola <b>${q.name}</b> tiene <b>${depth}</b> jobs pendientes (umbral warning: ${d.warn}).<br>
                         Waiting: ${waiting} | Active: ${active} | Failed: ${failed}`,
                        depth,
                    );
                    await this.incidents.resolveByKey(`queue:${q.name}:critical`);
                } else {
                    await this.incidents.resolveByKey(`queue:${q.name}:critical`);
                    await this.incidents.resolveByKey(`queue:${q.name}:warning`);
                }

                const failedThreshold = cfg.queueFailedByQueue?.[q.name] ?? cfg.queueFailed;
                if (failed > failedThreshold) {
                    await this.alert(
                        `queue:${q.name}:failed`,
                        `Cola ${q.name} — ${failed} jobs fallidos`,
                        `La cola <b>${q.name}</b> tiene <b>${failed}</b> jobs en estado failed (umbral: ${failedThreshold}).<br>
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

        // La cola de ingesta de WhatsApp vive en el servicio whatsapp bajo el
        // prefijo BullMQ 'wa' — no es inyectable aquí, así que se lee el failed
        // set directo de Redis (ZSET wa:webhooks:failed). Un job varado ahí es
        // un MENSAJE DE CLIENTE persistido cuyo turno de IA nunca corrió: el
        // redrive-cron del servicio whatsapp los reintenta (hasta 5 veces);
        // esta alerta cubre los que superan el tope o se acumulan.
        try {
            const cfg = await this.alertConfig.get();
            const client = (this.redis as any).client;
            const waFailed: number = await client.zcard('wa:webhooks:failed');
            const failedThreshold = cfg.queueFailedByQueue?.['wa-webhooks'] ?? cfg.queueFailed;
            if (waFailed > failedThreshold) {
                await this.alert(
                    `queue:wa-webhooks:failed`,
                    `Ingesta WhatsApp — ${waFailed} webhooks fallidos`,
                    `La cola <b>wa:webhooks</b> (ingesta de mensajes WhatsApp) tiene <b>${waFailed}</b> jobs fallidos.<br>
                     Son mensajes de clientes cuyo procesamiento por IA no corrió. El cron de re-drive los
                     reintenta automáticamente; si el número no baja, revisa la conectividad whatsapp→API
                     (INTERNAL_API_KEY, salud de la API) y el Bull Board del servicio whatsapp.`,
                    waFailed,
                );
            } else {
                await this.incidents.resolveByKey(`queue:wa-webhooks:failed`);
            }
        } catch (e: any) {
            this.logger.warn(`Queue check failed for wa:webhooks: ${e.message}`);
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
        // Dependencia OPCIONAL: si `pg` no está instalado se saltea el chequeo en
        // vez de romper el monitor, así que tiene que ser un require dentro del try.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
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

    // ── Application error rate (Sentry) ──

    private async checkSentryErrors() {
        try {
            const errors = await this.sentry.getErrorsLastHour();
            if (errors == null) return; // unconfigured or failed — stay silent
            const cfg = await this.alertConfig.get();

            if (errors >= cfg.sentryErrors.crit) {
                await this.alert(
                    'sentry:errors:critical',
                    `Pico de errores de la app: ${errors}/h — CRITICO`,
                    `Sentry reporto <b>${errors}</b> errores en la ultima hora (umbral critico: ${cfg.sentryErrors.crit}).<br><br>
                     Algo se rompio en la aplicacion. Revisa Sentry para el stack trace y el release afectado.`,
                    errors,
                );
                await this.incidents.resolveByKey('sentry:errors:warning');
            } else if (errors >= cfg.sentryErrors.warn) {
                await this.alert(
                    'sentry:errors:warning',
                    `Errores de la app elevados: ${errors}/h`,
                    `Sentry reporto <b>${errors}</b> errores en la ultima hora (umbral: ${cfg.sentryErrors.warn}).<br>
                     Revisa Sentry para identificar el problema mas frecuente.`,
                    errors,
                );
                await this.incidents.resolveByKey('sentry:errors:critical');
            } else {
                await this.incidents.resolveByKey('sentry:errors:critical');
                await this.incidents.resolveByKey('sentry:errors:warning');
            }
        } catch (e: any) {
            this.logger.debug(`Sentry error check skipped: ${e.message}`);
        }
    }

    // ── SLA breaches across tenants — every 10 min (offset from checkSystem) ──

    // Corre en UNA sola instancia: la API y el worker cargan el mismo
    // AppModule con ScheduleModule, asi que sin esto el cuerpo se
    // ejecuta dos veces. Ver CronLockService.
    @Cron('8,18,28,38,48,58 * * * *')
    async checkSlaBreachesCron() {
        await this.cronLock.runExclusive('platform-monitor.checkSlaBreaches', 240, () => this.checkSlaBreaches());
    }

    async checkSlaBreaches() {
        try {
            const cfg = await this.alertConfig.get();
            const tenants = await this.prisma.tenant.findMany({
                where: { isActive: true },
                select: { id: true, name: true, schemaName: true },
            });

            let total = 0;
            const byTenant: Array<{ name: string; n: number }> = [];
            for (const t of tenants) {
                try {
                    const rows = await this.prisma.executeInTenantSchema<Array<{ n: number }>>(
                        t.schemaName,
                        `SELECT COUNT(*)::int AS n
                         FROM conversations c
                         WHERE c.status IN ('waiting_human', 'with_human')
                           AND c.metadata->>'handoff' IS NOT NULL
                           AND (c.metadata->'handoff'->>'startedAt')::timestamp < NOW() - interval '10 minutes'
                           AND NOT EXISTS (
                               SELECT 1 FROM messages m
                               WHERE m.conversation_id = c.id
                                 AND m.direction = 'outbound'
                                 AND m.metadata->>'source' = 'agent'
                                 AND m.created_at > (c.metadata->'handoff'->>'startedAt')::timestamp
                           )`,
                        [],
                    );
                    const n = Number(rows?.[0]?.n ?? 0);
                    total += n;
                    if (n > 0) byTenant.push({ name: t.name, n });
                } catch { /* tenant tables may not exist yet */ }
            }

            const slaList = byTenant
                .sort((a, b) => b.n - a.n)
                .slice(0, 15)
                .map((x) => `<li><b>${this.escapeHtml(x.name)}</b> — ${x.n} conversacion(es)</li>`)
                .join('');

            if (total >= cfg.slaBreaches.crit) {
                await this.alert(
                    'sla:breaches:critical',
                    `${total} conversaciones violando SLA — CRITICO`,
                    `Hay <b>${total}</b> conversaciones en handoff esperando mas de 10 min sin respuesta de
                     un agente (umbral critico: ${cfg.slaBreaches.crit}), por tenant:<br>
                     <ul style="margin:6px 0 6px 18px;list-style:disc;">${slaList}</ul>
                     Indica un backlog operativo sistemico: agentes desconectados, sobrecarga o routing.
                     Revisa la disponibilidad de agentes en los tenants afectados.`,
                    total,
                );
                await this.incidents.resolveByKey('sla:breaches:warning');
            } else if (total >= cfg.slaBreaches.warn) {
                await this.alert(
                    'sla:breaches:warning',
                    `${total} conversaciones violando SLA`,
                    `Hay <b>${total}</b> conversaciones en handoff esperando mas de 10 min sin respuesta de
                     un agente (umbral: ${cfg.slaBreaches.warn}), por tenant:<br>
                     <ul style="margin:6px 0 6px 18px;list-style:disc;">${slaList}</ul>
                     Revisa la disponibilidad de agentes en los tenants afectados.`,
                    total,
                );
                await this.incidents.resolveByKey('sla:breaches:critical');
            } else {
                await this.incidents.resolveByKey('sla:breaches:critical');
                await this.incidents.resolveByKey('sla:breaches:warning');
            }
        } catch (e: any) {
            this.logger.debug(`SLA breach check skipped: ${e.message}`);
        }
    }

    // ── Hourly admin email refresh ──

    @Cron('0 * * * *')
    async refreshAdmins() {
        await this.refreshAdminEmails();
    }

    // ── Storage snapshots + early-warning alerts — daily 3:15 AM ──

    // Corre en UNA sola instancia: la API y el worker cargan el mismo
    // AppModule con ScheduleModule, asi que sin esto el cuerpo se
    // ejecuta dos veces. Ver CronLockService.
    @Cron('15 3 * * *')
    async checkStorageCron() {
        await this.cronLock.runExclusive('platform-monitor.checkStorage', 3600, () => this.checkStorage());
    }

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

    // Corre en UNA sola instancia: la API y el worker cargan el mismo
    // AppModule con ScheduleModule, asi que sin esto el cuerpo se
    // ejecuta dos veces. Ver CronLockService.
    @Cron('30 7 * * *')
    async checkRiskSignalsCron() {
        await this.cronLock.runExclusive('platform-monitor.checkRiskSignals', 3600, () => this.checkRiskSignals());
    }

    async checkRiskSignals() {
        await this.checkPaymentFailures();
        await this.checkWebhookFailures();
        // Ambos son señales de tendencia sobre ventanas de 24h/30d: correrlos con
        // el resto de los crons del motor (cada 15 min) sería ruido sin novedad.
        await this.checkExpiringPaymentSources();
        await this.checkDeclineRateByMethod();
        await this.checkLlmBudgets();
        await this.checkBackupHeartbeat();
    }

    /**
     * Alerts when a payment-provider webhook starts failing. The webhook is the
     * only automatic path for activations/renewals/cancellations, so a silent
     * failure means we keep charging (or stop charging) without reacting.
     * Counters are written by BillingWebhookController.recordWebhookFailure()
     * as per-provider, per-day Redis keys
     * (billing:webhook:fail:{provider}:{kind}:{YYYY-MM-DD}); we sum the last two
     * days as a rolling ~24-48h window.
     *
     * Thresholds are evaluated PER PROVIDER: with several providers live, a broken
     * secret in one would be diluted by the healthy traffic of the others and the
     * alert would never fire (or would fire without saying where to look).
     */
    private async checkWebhookFailures() {
        try {
            const days = [0, 1].map((offset) => {
                const d = new Date(Date.now() - offset * 24 * 60 * 60 * 1000);
                return d.toISOString().slice(0, 10);
            });
            const sumKind = async (provider: string, kind: string): Promise<number> => {
                let total = 0;
                for (const day of days) {
                    const v = await this.redis.get(`billing:webhook:fail:${provider}:${kind}:${day}`);
                    total += Number(v || 0);
                }
                return total;
            };

            // Signature rejections are the highest-signal failure: a persistent
            // stream almost always means the webhook secret at the provider no
            // longer matches ours (e.g. after rotating credentials or switching
            // accounts), so EVERY billing event of that provider is being silently
            // dropped. Alert on a low threshold. Processing errors (provider
            // hiccups / dispatch bugs) get a higher threshold since the daily
            // reconciliation recovers.
            const SIG_THRESHOLD = 5;
            const PROC_THRESHOLD = 10;

            // Incidents raised before the counters were split by provider used the
            // bare keys; resolve them once so they don't stay open forever.
            await this.incidents.resolveByKey('billing:webhook_signature');
            await this.incidents.resolveByKey('billing:webhook_processing');

            for (const provider of PAYMENT_PROVIDER_NAMES) {
                const [sig, parseFail, dispatchFail] = await Promise.all([
                    sumKind(provider, 'signature'),
                    sumKind(provider, 'parse'),
                    sumKind(provider, 'dispatch'),
                ]);
                const proc = parseFail + dispatchFail;
                const label = this.providerLabel(provider);
                const secretHint = this.providerWebhookSecretEnv(provider);

                if (sig >= SIG_THRESHOLD) {
                    await this.alert(
                        `billing:webhook_signature:${provider}`,
                        `${sig} webhooks de ${label} con firma rechazada`,
                        `El webhook de <b>${label}</b> rechazó <b>${sig}</b> notificaciones por firma inválida en las últimas 24-48h.<br>
                         <b>Causa más probable:</b> el secreto del webhook en ${label} ya no coincide con el nuestro
                         (<code>${secretHint}</code>), típicamente tras rotar credenciales o cambiar de cuenta.
                         Mientras esté así <b>no se procesa ningún alta/baja/pago de ${label} automáticamente</b>
                         (la reconciliación diaria mitiga, no reemplaza).<br>
                         <b>Solución:</b> revisa la firma/secreto del webhook en el panel de ${label} y en los GitHub Secrets.`,
                        sig,
                    );
                } else {
                    await this.incidents.resolveByKey(`billing:webhook_signature:${provider}`);
                }

                if (proc >= PROC_THRESHOLD) {
                    await this.alert(
                        `billing:webhook_processing:${provider}`,
                        `${proc} webhooks de ${label} con error de procesamiento`,
                        `El webhook de <b>${label}</b> falló al procesar <b>${proc}</b> notificaciones en las últimas 24-48h
                         (parseo: ${parseFail}, despacho: ${dispatchFail}).<br>
                         <b>Qué revisar:</b> disponibilidad de la API de ${label} y errores en <code>handleBillingEvent</code>
                         o en la cola de reconciliación. La reconciliación diaria recupera el estado, pero un volumen alto y
                         sostenido indica un problema real que conviene atender.`,
                        proc,
                    );
                } else {
                    await this.incidents.resolveByKey(`billing:webhook_processing:${provider}`);
                }
            }
        } catch (e: any) {
            this.logger.debug(`Webhook-failure check skipped: ${e.message}`);
        }
    }

    /**
     * Watches how the AGENT is behaving, not how the infrastructure is.
     *
     * Every other check here answers "is the platform up?". These answer "is the
     * agent telling customers the truth, and answering them at all?" — the
     * failures that cost the most and showed the least, because a turn that
     * invents a booking or dies in silence completes its queue job perfectly.
     *
     * Counters are written by ConversationsService.recordAgentSignal() as
     * platform-wide per-day keys (agent:signal:{signal}:{YYYY-MM-DD}) plus a set
     * of the tenants that contributed, so this reads a bounded number of keys
     * however many tenants exist. Window: today + yesterday (~24-48h).
     */
    @Cron('37 * * * *')
    async checkAgentReliabilityCron() {
        await this.cronLock.runExclusive(
            'platform-monitor.checkAgentReliability',
            1800,
            () => this.checkAgentReliability(),
        );
    }

    async checkAgentReliability() {
        try {
            const days = [0, 1].map((offset) => {
                const d = new Date(Date.now() - offset * 24 * 60 * 60 * 1000);
                return d.toISOString().slice(0, 10);
            });
            const total = async (signal: string): Promise<number> => {
                let sum = 0;
                for (const day of days) {
                    sum += Number(await this.redis.get(`agent:signal:${signal}:${day}`) || 0);
                }
                return sum;
            };

            const [claims, silent, committedThenFailed, deferred, confirmed] = await Promise.all([
                total('claim_unbacked'),
                total('silent_turn'),
                total('commit_then_failure'),
                total('concurrent_turn_deferred'),
                total('pending_confirmation_executed'),
            ]);

            // A customer told their booking was done when no tool did it. One is
            // an anecdote; a stream means the guardrail is firing over and over,
            // which is something upstream breaking again.
            const CLAIM_THRESHOLD = 5;
            // A turn that ended with the customer receiving nothing at all.
            const SILENT_THRESHOLD = 10;
            // Something WAS committed and then the turn broke. Rare by nature:
            // each one is a customer holding a booking nobody confirmed to them.
            const COMMIT_FAILURE_THRESHOLD = 1;
            // Second messages that had to wait for the first. Some is normal; a
            // lot means turns run long enough to collide routinely.
            const DEFERRED_THRESHOLD = 200;

            const context = `<br><small>Ventana 24-48h. Otras señales del mismo período:`
                + ` confirmaciones cerradas por el servidor <b>${confirmed}</b>,`
                + ` turnos diferidos por concurrencia <b>${deferred}</b>,`
                + ` turnos en silencio <b>${silent}</b>.</small>`;

            if (claims >= CLAIM_THRESHOLD) {
                await this.alert(
                    'agent:claim_unbacked',
                    `${claims} respuestas afirmaron una acción que ninguna herramienta ejecutó`,
                    `El agente le dijo a un cliente que su reserva, cobro o cita quedaba hecha <b>${claims}</b> veces`
                    + ` sin que ninguna herramienta lo hubiera hecho, en las últimas 24-48h.<br>`
                    + ` El guardrail las reescribió antes de enviarlas, así que el cliente no recibió la mentira —`
                    + ` pero que dispare seguido significa que el modelo intenta cerrar operaciones que no puede`
                    + ` ejecutar: normalmente porque la herramienta de cierre no llegó a ese turno, o porque la`
                    + ` vertical no tiene ninguna.<br>`
                    + ` <b>Dónde mirar:</b> ${await this.topTenantsFor('claim_unbacked', days)}${context}`,
                    claims,
                );
            } else {
                await this.incidents.resolveByKey('agent:claim_unbacked');
            }

            if (committedThenFailed >= COMMIT_FAILURE_THRESHOLD) {
                await this.alert(
                    'agent:commit_then_failure',
                    `${committedThenFailed} operación(es) se ejecutaron y el turno murió después`,
                    `<b>${committedThenFailed}</b> vez/veces se creó algo real —una reserva, un cobro, una cita— y el`
                    + ` turno falló antes de poder contárselo al cliente.<br>`
                    + ` El cliente recibió un aviso de que su solicitud quedó registrada, pero <b>nadie le confirmó los`
                    + ` detalles</b>: conviene revisar esas conversaciones a mano y cerrarlas con una persona.<br>`
                    + ` <b>Dónde mirar:</b> ${await this.topTenantsFor('commit_then_failure', days)}${context}`,
                    committedThenFailed,
                );
            } else {
                await this.incidents.resolveByKey('agent:commit_then_failure');
            }

            if (silent >= SILENT_THRESHOLD) {
                await this.alert(
                    'agent:silent_turn',
                    `${silent} turnos terminaron sin respuesta para el cliente`,
                    `<b>${silent}</b> mensajes de clientes se procesaron sin que saliera ninguna respuesta en las`
                    + ` últimas 24-48h.<br>`
                    + ` Estos turnos completan su trabajo en la cola sin error, así que no aparecen como fallo en`
                    + ` ningún otro lado. <b>Causas habituales:</b> el agente no tiene persona activa para ese canal,`
                    + ` o el modelo devolvió vacío.<br>`
                    + ` <b>Dónde mirar:</b> ${await this.topTenantsFor('silent_turn', days)}${context}`,
                    silent,
                );
            } else {
                await this.incidents.resolveByKey('agent:silent_turn');
            }

            if (deferred >= DEFERRED_THRESHOLD) {
                await this.alert(
                    'agent:concurrent_turn_deferred',
                    `${deferred} mensajes esperaron a que terminara el turno anterior`,
                    `<b>${deferred}</b> mensajes encontraron su conversación ocupada y se reencolaron en las últimas`
                    + ` 24-48h.<br>`
                    + ` Reencolar es lo correcto (evita dos respuestas cruzadas), pero este volumen indica que los`
                    + ` turnos tardan lo suficiente como para chocar de forma rutinaria.<br>`
                    + ` <b>Qué revisar:</b> latencia del proveedor LLM e iteraciones de herramientas por turno.`
                    + ` <b>Dónde mirar:</b> ${await this.topTenantsFor('concurrent_turn_deferred', days)}${context}`,
                    deferred,
                );
            } else {
                await this.incidents.resolveByKey('agent:concurrent_turn_deferred');
            }
        } catch (e: any) {
            this.logger.debug(`Agent-reliability check skipped: ${e.message}`);
        }
    }

    /** Names the tenants behind a signal, so the alert points somewhere. */
    private async topTenantsFor(signal: string, days: string[]): Promise<string> {
        try {
            const ids = new Set<string>();
            for (const day of days) {
                for (const id of await this.redis.smembers(`agent:signal:${signal}:tenants:${day}`)) {
                    ids.add(id);
                }
            }
            if (!ids.size) return 'sin tenants identificados';

            const counted = await Promise.all([...ids].map(async (id) => {
                let count = 0;
                for (const day of days) {
                    count += Number(await this.redis.get(`agent:signal:${signal}:${id}:${day}`) || 0);
                }
                return { id, count };
            }));
            counted.sort((a, b) => b.count - a.count);
            const top = counted.slice(0, 5);

            const tenants = await this.prisma.tenant.findMany({
                where: { id: { in: top.map(t => t.id) } },
                select: { id: true, name: true },
            });
            const nameOf = new Map(tenants.map(t => [t.id, t.name]));
            return top.map(t => `<b>${nameOf.get(t.id) || t.id}</b> (${t.count})`).join(', ');
        } catch {
            return 'no se pudo resolver el detalle por tenant';
        }
    }

    private providerLabel(provider: PaymentProviderName): string {
        const labels: Record<PaymentProviderName, string> = {
            mercadopago: 'MercadoPago',
            stripe: 'Stripe',
            wompi: 'Wompi',
            mock: 'Mock',
        };
        return labels[provider];
    }

    /** Env var holding the webhook/events secret of each provider, for the alert text. */
    private providerWebhookSecretEnv(provider: PaymentProviderName): string {
        const envs: Record<PaymentProviderName, string> = {
            mercadopago: 'MP_WEBHOOK_SECRET',
            stripe: 'STRIPE_WEBHOOK_SECRET',
            wompi: 'WOMPI_EVENTS_SECRET',
            mock: 'n/a',
        };
        return envs[provider];
    }

    private async checkPaymentFailures() {
        try {
            const cfg = await this.alertConfig.get();
            const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const rows = await this.prisma.billingPayment.findMany({
                where: { status: 'failed', createdAt: { gte: since } },
                select: { tenantId: true, amountCents: true },
                take: 500,
            }) as Array<{ tenantId: string; amountCents: number | null }>;
            const failed = rows.length;
            const THRESHOLD = cfg.paymentFailures;

            if (failed >= THRESHOLD) {
                const byTenant = new Map<string, { count: number; cents: number }>();
                for (const r of rows) {
                    const cur = byTenant.get(r.tenantId) || { count: 0, cents: 0 };
                    cur.count++;
                    cur.cents += Number(r.amountCents || 0);
                    byTenant.set(r.tenantId, cur);
                }
                const names = await this.tenantNames([...byTenant.keys()]);
                const list = [...byTenant.entries()]
                    .sort((a, b) => b[1].count - a[1].count)
                    .slice(0, 15)
                    .map(([tid, v]) => `<li><b>${this.escapeHtml(names.get(tid) || tid)}</b> — ${v.count} fallo(s)${v.cents ? ` (~$${(v.cents / 100).toFixed(2)})` : ''}</li>`)
                    .join('');
                await this.alert(
                    'billing:payment_failures',
                    `${failed} pagos fallidos en 24h`,
                    `Se registraron <b>${failed}</b> pagos fallidos en las ultimas 24 horas (umbral: ${THRESHOLD}), por tenant:<br>
                     <ul style="margin:6px 0 6px 18px;list-style:disc;">${list}</ul>
                     <b>Solucion:</b> revisa el estado del proveedor de pagos (MercadoPago/Stripe) y la cola de
                     reconciliacion. Si se concentra en un tenant, suele ser tarjeta vencida/sin fondos (riesgo de churn).`,
                    failed,
                );
            } else {
                await this.incidents.resolveByKey('billing:payment_failures');
            }
        } catch (e: any) {
            this.logger.debug(`Payment-failure check skipped: ${e.message}`);
        }
    }

    // ── Internal recurring billing engine — every 15 min ──
    //
    // Con MercadoPago el proveedor cobraba solo: si nuestro scheduler moría, no
    // pasaba nada. Con el motor propio (Wompi) NADIE cobra en su lugar y la
    // señal llega recién cuando un cliente reclama. Estos chequeos son esa señal.

    // Corre en UNA sola instancia: la API y el worker cargan el mismo
    // AppModule con ScheduleModule, asi que sin esto el cuerpo se
    // ejecuta dos veces. Ver CronLockService.
    @Cron('4,19,34,49 * * * *')
    async checkRecurringEngineCron() {
        await this.cronLock.runExclusive('platform-monitor.checkRecurringEngine', 450, () => this.checkRecurringEngine());
    }

    async checkRecurringEngine() {
        await this.checkStuckCharges();
        await this.checkUnscheduledRenewals();
        await this.checkDailyChargeCap();
    }

    /**
     * Charges the provider accepted and never resolved.
     *
     * An `indeterminate` one is the dangerous case: the money may already have
     * moved, so the engine freezes it by design and never spawns another attempt
     * for that cycle. Nothing recovers on its own — it needs a human resolving it
     * by `reference` against the provider, which is why the references travel in
     * the alert body.
     */
    private async checkStuckCharges() {
        try {
            const cutoff = new Date(Date.now() - STUCK_CHARGE_MINUTES * 60_000);
            const stuckStatuses = ['pending_provider', 'in_flight'];

            const [total, indeterminate] = await Promise.all([
                this.prisma.billingChargeAttempt.count({
                    where: { status: { in: stuckStatuses }, sentAt: { lt: cutoff } },
                }),
                this.prisma.billingChargeAttempt.count({
                    where: { status: { in: stuckStatuses }, sentAt: { lt: cutoff }, failureClass: 'indeterminate' },
                }),
            ]);

            if (total === 0) {
                await this.incidents.resolveByKey('billing:engine:stuck_charges:critical');
                await this.incidents.resolveByKey('billing:engine:stuck_charges:warning');
                return;
            }

            const sample = await this.prisma.billingChargeAttempt.findMany({
                where: {
                    status: { in: stuckStatuses },
                    sentAt: { lt: cutoff },
                    ...(indeterminate > 0 ? { failureClass: 'indeterminate' } : {}),
                },
                select: {
                    reference: true, tenantId: true, amountCents: true,
                    currency: true, sentAt: true, failureClass: true,
                },
                orderBy: { sentAt: 'asc' },
                take: 3,
            }) as Array<{
                reference: string; tenantId: string; amountCents: number;
                currency: string; sentAt: Date | null; failureClass: string | null;
            }>;

            const names = await this.tenantNames(sample.map((a) => a.tenantId));
            const list = sample
                .map((a) => {
                    const mins = a.sentAt ? Math.round((Date.now() - a.sentAt.getTime()) / 60_000) : '?';
                    const flag = a.failureClass === 'indeterminate' ? ' — <b>indeterminado</b>' : '';
                    return `<li><code>${this.escapeHtml(a.reference)}</code> — <b>${this.escapeHtml(names.get(a.tenantId) || a.tenantId)}</b>
                            — ${this.money(a.amountCents, a.currency)} — ${mins} min sin resolver${flag}</li>`;
                })
                .join('');

            if (indeterminate > 0) {
                await this.alert(
                    'billing:engine:stuck_charges:critical',
                    `${indeterminate} cobro(s) INDETERMINADOS sin resolver`,
                    `Hay <b>${total}</b> cobro(s) enviados al proveedor sin resolver hace más de ${STUCK_CHARGE_MINUTES} min,
                     de los cuales <b>${indeterminate}</b> quedaron en estado <b>indeterminado</b>: no sabemos si el dinero
                     se movió, y por eso el motor NO los reintenta ni genera otro intento para ese ciclo.<br>
                     <ul style="margin:6px 0 6px 18px;list-style:disc;">${list}</ul>
                     <b>Solución (manual):</b> buscá cada <code>reference</code> en el proveedor
                     (<code>GET /v1/transactions?reference=...</code> en Wompi). Si la transacción existe y está aprobada,
                     conciliá el intento; si no existe, recién ahí puede reintentarse el ciclo.`,
                    indeterminate,
                );
                await this.incidents.resolveByKey('billing:engine:stuck_charges:warning');
            } else {
                await this.alert(
                    'billing:engine:stuck_charges:warning',
                    `${total} cobro(s) colgados en el proveedor`,
                    `Hay <b>${total}</b> intento(s) de cobro en <code>in_flight</code>/<code>pending_provider</code>
                     con más de ${STUCK_CHARGE_MINUTES} min sin resolver:<br>
                     <ul style="margin:6px 0 6px 18px;list-style:disc;">${list}</ul>
                     <b>Qué revisar:</b> el webhook del proveedor y la cola de polling de cobros. Ambos convergen en el
                     mismo resolver; si ninguno llega, el intento se queda colgado y la suscripción no avanza de período.`,
                    total,
                );
                await this.incidents.resolveByKey('billing:engine:stuck_charges:critical');
            }
        } catch (e: any) {
            this.logger.debug(`Stuck-charge check skipped: ${e.message}`);
        }
    }

    /**
     * Subscriptions whose charge was due and for which no attempt was ever
     * claimed. With the internal engine this means nobody is charging: the
     * provider does not renew on its own, so silence here is lost revenue that
     * only surfaces when a customer complains.
     */
    private async checkUnscheduledRenewals() {
        try {
            const chargeable = [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING, SubscriptionStatus.PAST_DUE]
                .map((s) => `'${s}'`)
                .join(',');

            const rows = await this.prisma.$queryRawUnsafe(
                `SELECT s.tenant_id, s.next_charge_at, s.charge_amount_cents, s.charge_currency
                   FROM billing_subscriptions s
                  WHERE s.engine = 'internal'
                    AND s.status IN (${chargeable})
                    AND s.cancel_at_period_end = false
                    AND s.next_charge_at IS NOT NULL
                    AND s.next_charge_at < NOW() - interval '${RENEWAL_OVERDUE_HOURS} hours'
                    -- El scheduler reclama el intento hasta 15 min antes del vencimiento:
                    -- si no hay NINGUNA fila cerca de esa fecha, no es que el cobro falló,
                    -- es que nunca se agendó.
                    AND NOT EXISTS (
                        SELECT 1 FROM billing_charge_attempts a
                         WHERE a.subscription_id = s.id
                           AND a.created_at >= s.next_charge_at - interval '1 hour'
                    )
                  ORDER BY s.next_charge_at ASC
                  LIMIT 100`,
            ) as Array<{
                tenant_id: string; next_charge_at: Date;
                charge_amount_cents: number | null; charge_currency: string | null;
            }>;

            if (rows.length === 0) {
                await this.incidents.resolveByKey('billing:engine:charges_not_running');
                return;
            }

            const names = await this.tenantNames(rows.map((r) => r.tenant_id));
            const list = rows
                .slice(0, 15)
                .map((r) => {
                    const hours = Math.round((Date.now() - new Date(r.next_charge_at).getTime()) / 3_600_000);
                    return `<li><b>${this.escapeHtml(names.get(r.tenant_id) || r.tenant_id)}</b> — vencía hace ${hours}h
                            (${new Date(r.next_charge_at).toISOString().slice(0, 16).replace('T', ' ')} UTC)
                            — ${this.money(r.charge_amount_cents, r.charge_currency)}</li>`;
                })
                .join('');
            const pending = rows.reduce((acc, r) => acc + Number(r.charge_amount_cents || 0), 0);

            await this.alert(
                'billing:engine:charges_not_running',
                `${rows.length} cobro(s) del motor propio sin ejecutar`,
                `Hay <b>${rows.length}</b> suscripción(es) con <code>engine=internal</code> cuyo cobro venció hace más de
                 ${RENEWAL_OVERDUE_HOURS}h y para las que <b>no se creó ningún intento</b> (~${this.money(pending)} sin cobrar):<br>
                 <ul style="margin:6px 0 6px 18px;list-style:disc;">${list}</ul>
                 Con el motor propio <b>ningún proveedor cobra por nosotros</b>: esto significa que el scheduler dejó de
                 agendar.<br>
                 <b>Qué revisar:</b> que el cron <code>billing.renewalScheduler</code> esté corriendo (API y worker vivos),
                 la cola <code>billing-renewals</code>, y que las suscripciones tengan monto/moneda congelados y una fuente
                 de pago por defecto.`,
                rows.length,
            );
        } catch (e: any) {
            this.logger.debug(`Unscheduled-renewal check skipped: ${e.message}`);
        }
    }

    /**
     * Daily merchant ceiling. Once it is hit the provider refuses everything left
     * in the day, so the scheduler stops short and defers renewals to tomorrow —
     * which quietly pushes every affected customer's charge off its anniversary.
     */
    private async checkDailyChargeCap() {
        try {
            const cap = Number(this.config.get<string>(DAILY_CAP_ENV) || DEFAULT_DAILY_CAP_COP_CENTS);
            if (!Number.isFinite(cap) || cap <= 0) return;

            // Fecha en UTC igual que el escritor del acumulador: usar la fecha
            // local leería otro bucket durante parte del día.
            const key = `billing:renewal:cop:${new Date().toISOString().slice(0, 10)}`;
            const raw = await this.redis.get(key);
            const used = Number(raw || 0);
            if (!Number.isFinite(used) || used <= 0) {
                await this.incidents.resolveByKey('billing:engine:daily_cap:critical');
                await this.incidents.resolveByKey('billing:engine:daily_cap:warning');
                return;
            }

            const pct = Math.round((used / cap) * 100);
            const detail = `Se reservaron <b>${this.money(used, 'COP')}</b> de un tope diario de
                            <b>${this.money(cap, 'COP')}</b> (${pct}%).`;

            if (used >= cap * DAILY_CAP_CRIT_RATIO) {
                await this.alert(
                    'billing:engine:daily_cap:critical',
                    `Tope diario de cobros al ${pct}% — CRITICO`,
                    `${detail}<br><br>
                     El tope está agotado: <b>las renovaciones restantes del día se difieren a mañana</b> y se corren de su
                     fecha de aniversario. Al día siguiente el volumen diferido se suma al normal, así que puede repetirse.<br>
                     <b>Solución:</b> pedir al proveedor una ampliación del límite diario o subir <code>${DAILY_CAP_ENV}</code>
                     si el tope real es mayor que el configurado.`,
                    pct,
                );
                await this.incidents.resolveByKey('billing:engine:daily_cap:warning');
            } else if (used >= cap * DAILY_CAP_WARN_RATIO) {
                await this.alert(
                    'billing:engine:daily_cap:warning',
                    `Tope diario de cobros al ${pct}%`,
                    `${detail}<br>
                     Al llegar al tope las renovaciones restantes del día se difieren. Si esto se repite, el volumen ya no
                     entra en un día y conviene ampliar el límite con el proveedor.`,
                    pct,
                );
                await this.incidents.resolveByKey('billing:engine:daily_cap:critical');
            } else {
                await this.incidents.resolveByKey('billing:engine:daily_cap:critical');
                await this.incidents.resolveByKey('billing:engine:daily_cap:warning');
            }
        } catch (e: any) {
            this.logger.debug(`Daily-cap check skipped: ${e.message}`);
        }
    }

    /**
     * Cards about to expire. Not an outage — a work list: an expired card fails
     * every retry of the dunning ladder and ends in churn the tenant never saw
     * coming, so it has to be chased BEFORE the charge.
     */
    private async checkExpiringPaymentSources() {
        try {
            const rows = await this.prisma.$queryRawUnsafe(
                // exp_year llega a veces de 2 dígitos desde el tokenizador; normalizarlo
                // acá evita que una tarjeta '26' se lea como el año 26 y nunca venza.
                `WITH cards AS (
                     SELECT tenant_id,
                            make_date(CASE WHEN exp_year < 100 THEN 2000 + exp_year ELSE exp_year END, exp_month, 1)
                                + interval '1 month' AS expires_at
                       FROM billing_payment_sources
                      WHERE kind = 'card'
                        AND status = 'available'
                        AND exp_year IS NOT NULL AND exp_year >= 0
                        AND exp_month BETWEEN 1 AND 12
                 )
                 SELECT tenant_id,
                        COUNT(*)::int AS n,
                        COUNT(*) FILTER (WHERE expires_at <= NOW())::int AS expired
                   FROM cards
                  WHERE expires_at <= NOW() + interval '${CARD_EXPIRY_WARN_DAYS} days'
                  GROUP BY tenant_id
                  ORDER BY n DESC
                  LIMIT 100`,
            ) as Array<{ tenant_id: string; n: number; expired: number }>;

            if (rows.length === 0) {
                await this.incidents.resolveByKey('billing:engine:cards_expiring');
                return;
            }

            const total = rows.reduce((acc, r) => acc + Number(r.n), 0);
            const expired = rows.reduce((acc, r) => acc + Number(r.expired), 0);
            const names = await this.tenantNames(rows.map((r) => r.tenant_id));
            const list = rows
                .slice(0, 15)
                .map((r) => `<li><b>${this.escapeHtml(names.get(r.tenant_id) || r.tenant_id)}</b> — ${r.n} tarjeta(s)${
                    Number(r.expired) > 0 ? ` (${r.expired} ya vencida(s))` : ''
                }</li>`)
                .join('');

            await this.alert(
                'billing:engine:cards_expiring',
                `${total} tarjeta(s) por vencer en ${CARD_EXPIRY_WARN_DAYS} días`,
                `<b>${total}</b> tarjeta(s) activas de <b>${rows.length}</b> tenant(s) vencen dentro de
                 ${CARD_EXPIRY_WARN_DAYS} días${expired > 0 ? ` (<b>${expired}</b> ya vencida(s))` : ''}:<br>
                 <ul style="margin:6px 0 6px 18px;list-style:disc;">${list}</ul>
                 No es una caída: es una lista de trabajo. Una tarjeta vencida rechaza todos los reintentos del dunning
                 y termina en churn silencioso.<br>
                 <b>Acción:</b> confirmá que el aviso automático de tarjeta por vencer salió, y contactá a los tenants
                 que ya tienen la tarjeta vencida para que carguen un medio nuevo.`,
                total,
            );
        } catch (e: any) {
            this.logger.debug(`Expiring payment-source check skipped: ${e.message}`);
        }
    }

    /**
     * Decline rate per payment method over 24h.
     *
     * A single customer's card failing is normal; a whole method degrading is
     * ours to fix — a bad provider configuration, a disabled method or an outage
     * on their side. Grouping by method is what separates the two.
     */
    private async checkDeclineRateByMethod() {
        try {
            const rows = await this.prisma.$queryRawUnsafe(
                `SELECT COALESCE(ps.kind, 'unknown') AS kind,
                        COUNT(*)::int AS total,
                        COUNT(*) FILTER (WHERE a.status = 'failed')::int AS failed
                   FROM billing_charge_attempts a
                   LEFT JOIN billing_payment_sources ps ON ps.id = a.payment_source_id
                  WHERE a.status IN ('succeeded', 'failed')
                    AND a.settled_at >= NOW() - interval '24 hours'
                  GROUP BY 1`,
            ) as Array<{ kind: string; total: number; failed: number }>;

            const byKind = new Map(rows.map((r) => [r.kind, r]));
            for (const kind of PAYMENT_SOURCE_KINDS) {
                const row = byKind.get(kind);
                const total = Number(row?.total || 0);
                const failed = Number(row?.failed || 0);
                const rate = total > 0 ? failed / total : 0;

                if (total >= DECLINE_MIN_ATTEMPTS && rate > DECLINE_RATE_THRESHOLD) {
                    const pct = Math.round(rate * 100);
                    await this.alert(
                        `billing:engine:decline_rate:${kind}`,
                        `${this.sourceKindLabel(kind)}: ${pct}% de cobros rechazados en 24h`,
                        `El método <b>${this.sourceKindLabel(kind)}</b> rechazó <b>${failed}</b> de <b>${total}</b> cobros
                         resueltos en las últimas 24h (<b>${pct}%</b>, umbral: ${Math.round(DECLINE_RATE_THRESHOLD * 100)}%).<br>
                         Una tasa así no es "clientes sin fondos": apunta a un problema del proveedor o de configuración
                         de ese método.<br>
                         <b>Qué revisar:</b> el estado del método en el panel del proveedor, las credenciales del ambiente
                         en uso, y los <code>failure_code</code> de los intentos fallidos (si todos repiten el mismo código,
                         ahí está la causa).`,
                        pct,
                    );
                } else {
                    await this.incidents.resolveByKey(`billing:engine:decline_rate:${kind}`);
                }
            }
        } catch (e: any) {
            this.logger.debug(`Decline-rate check skipped: ${e.message}`);
        }
    }

    private sourceKindLabel(kind: string): string {
        const map: Record<string, string> = {
            card: 'Tarjeta',
            nequi: 'Nequi',
            daviplata: 'Daviplata',
            bancolombia_transfer: 'Bancolombia (transferencia)',
            pse: 'PSE',
            unknown: 'Sin fuente asociada',
        };
        return map[kind] || kind;
    }

    /** Cents → short human amount for alert bodies. */
    private money(cents: number | null | undefined, currency?: string | null): string {
        const value = Number(cents || 0) / 100;
        return `$${value.toLocaleString('es-CO', { maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ''}`;
    }

    private escapeHtml(s: string): string {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    private credTypeLabel(t: string): string {
        const map: Record<string, string> = {
            instagram_token: 'Instagram',
            messenger_token: 'Messenger',
            whatsapp_token: 'WhatsApp',
            system_user_token: 'WhatsApp (system user)',
            page_token: 'Messenger (page)',
        };
        return map[t] || t;
    }

    /** Resolve tenant ids → display names (falls back to the id). */
    private async tenantNames(tenantIds: string[]): Promise<Map<string, string>> {
        const map = new Map<string, string>();
        const ids = Array.from(new Set(tenantIds)).filter(Boolean);
        if (!ids.length) return map;
        try {
            const rows = await this.prisma.tenant.findMany({
                where: { id: { in: ids } },
                select: { id: true, name: true },
            });
            for (const r of rows as Array<{ id: string; name: string }>) map.set(r.id, r.name);
        } catch { /* ignore */ }
        return map;
    }

    // ── Channel token health — hourly (detail + remediation in the body) ──

    // Corre en UNA sola instancia: la API y el worker cargan el mismo
    // AppModule con ScheduleModule, asi que sin esto el cuerpo se
    // ejecuta dos veces. Ver CronLockService.
    @Cron('0 * * * *')
    async checkChannelTokensCron() {
        await this.cronLock.runExclusive('platform-monitor.checkChannelTokens', 1800, () => this.checkChannelTokens());
    }

    async checkChannelTokens() {
        try {
            // Refresh-failed credentials — list which tenant + channel so it's actionable.
            const errored = await this.prisma.whatsappCredential.findMany({
                where: { rotationState: 'error' },
                select: { tenantId: true, credentialType: true },
                take: 50,
            }) as Array<{ tenantId: string; credentialType: string }>;

            if (errored.length > 0) {
                const names = await this.tenantNames(errored.map((c) => c.tenantId));
                const list = errored
                    .map((c) => `<li><b>${this.escapeHtml(names.get(c.tenantId) || c.tenantId)}</b> — ${this.credTypeLabel(c.credentialType)}</li>`)
                    .join('');
                await this.alert(
                    'tokens:error',
                    `${errored.length} token(s) de canal en error`,
                    `Estas credenciales de canal fallaron al refrescar (estado 'error') y el canal se
                     desconectara cuando expire el token:<br>
                     <ul style="margin:6px 0 6px 18px;list-style:disc;">${list}</ul>
                     <b>Solucion:</b> entra al tenant afectado → Configuracion → Canales y <b>reconecta</b>
                     el canal (re-autoriza el OAuth). Si es Instagram/Messenger, la re-autorizacion genera un
                     token nuevo de 60 dias.`,
                    errored.length,
                );
            } else {
                await this.incidents.resolveByKey('tokens:error');
            }

            // Expiring soon — list tenant + channel + days-to-expiry.
            const in7 = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
            const expiring = await this.prisma.whatsappCredential.findMany({
                where: { rotationState: 'active', expiresAt: { lte: in7, gt: new Date() } },
                select: { tenantId: true, credentialType: true, expiresAt: true },
                orderBy: { expiresAt: 'asc' },
                take: 50,
            }) as Array<{ tenantId: string; credentialType: string; expiresAt: Date | null }>;

            if (expiring.length > 0) {
                const names = await this.tenantNames(expiring.map((c) => c.tenantId));
                const list = expiring
                    .map((c) => {
                        const days = c.expiresAt ? Math.max(0, Math.ceil((c.expiresAt.getTime() - Date.now()) / 86400000)) : '?';
                        const date = c.expiresAt ? c.expiresAt.toISOString().slice(0, 10) : '';
                        return `<li><b>${this.escapeHtml(names.get(c.tenantId) || c.tenantId)}</b> — ${this.credTypeLabel(c.credentialType)} — vence en ${days} dia(s)${date ? ` (${date})` : ''}</li>`;
                    })
                    .join('');
                await this.alert(
                    'tokens:expiring',
                    `${expiring.length} token(s) de canal por expirar`,
                    `Estas credenciales expiran en los proximos 7 dias y aun no se renovaron automaticamente:<br>
                     <ul style="margin:6px 0 6px 18px;list-style:disc;">${list}</ul>
                     <b>Solucion:</b> el refresco de Instagram corre a las 6AM (InstagramTokenRefreshService,
                     renueva tokens con <30 dias de vida). Si un token sigue apareciendo aqui, su refresco esta
                     fallando (revisa logs) o el canal necesita re-autorizacion: entra al tenant → Configuracion
                     → Canales y reconectalo.`,
                    expiring.length,
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
        const CRITICAL_KEYS = [
            'llm:none_configured', 'llm:unhealthy', 'tokens:error', 'backup:stale',
            // Con el motor propio nadie cobra en nuestro lugar: un cobro que no se
            // agendó no se recupera solo.
            'billing:engine:charges_not_running',
            // Se creó algo real —una reserva, un cobro— y el cliente nunca supo
            // los detalles. Sólo una persona puede cerrar esa conversación.
            'agent:commit_then_failure',
        ];
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

    /** Render an alert as a short plain-text SMS (severity tag + subject + host). */
    private toSmsText(severity: IncidentSeverity, subject: string): string {
        const tag = severity === 'critical' ? '[CRITICO]' : severity === 'warning' ? '[AVISO]' : '[INFO]';
        return `Parallly ${tag} ${subject} - ${os.hostname()}`.slice(0, 480);
    }

    // ── Alert sender: persist incident always, email/Telegram/SMS throttled ──

    private async alert(key: string, subject: string, html: string, value: number) {
        const severity = this.severityFromKey(key);
        const cfg = await this.alertConfig.get();

        // Persist/dedup the incident on every fire, independent of the email
        // cooldown, so re-fires bump count/lastSeen and survive restarts.
        await this.incidents.record(key, severity, subject, html, value);

        // El cooldown vive en REDIS, no en memoria del proceso.
        //
        // Los chequeos corren bajo `cronLock.runExclusive`, que no libera el
        // lock al terminar: expira por TTL mucho antes del siguiente tick, así
        // que en cada corrida la API y el worker vuelven a competir y gana
        // cualquiera de los dos. Con el estado en una Map de instancia, cada vez
        // que cambiaba el ganador el proceso nuevo arrancaba con la Map vacía y
        // remandaba la misma alerta: el cooldown de 1 hora se degradaba al
        // intervalo del cron, multiplicado por cada super_admin en la lista y
        // replicado a Telegram y —en las críticas— a SMS de Twilio, que se paga.
        //
        // SET NX con TTL: el primero en llegar manda la alerta, el otro no.
        const cooldownKey = `alert:cooldown:${key}`;
        const gotSlot = await this.redis
            .acquireLock(cooldownKey, Math.floor(COOLDOWN_MS / 1000))
            // Si Redis está caído se manda igual: perder una alerta de
            // plataforma es peor que mandarla dos veces.
            .catch(() => true);
        if (!gotSlot) return;

        const now = Date.now();
        // Se mantiene la Map como memoria local del último valor visto (la usa
        // el resumen en memoria); ya no gobierna el cooldown.
        this.alertState.set(key, { lastAlertedAt: now, value });

        this.logger.warn(`ALERT [${key}]: ${subject} (value=${value})`);

        // Telegram ops channel (throttled by the same cooldown above).
        if (cfg.channels.telegram) {
            await this.telegram.send(this.toTelegramText(severity, subject, html));
        }

        // SMS ops channel — critical only (intrusive/costly), throttled by the same cooldown.
        if (cfg.channels.sms && severity === 'critical') {
            await this.smsAlert.send(this.toSmsText(severity, subject));
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

    /**
     * Run all monitor checks on demand (the super_admin "run checks now" button),
     * so incidents refresh with their latest detailed bodies without waiting for
     * the crons. Each check is internally guarded, so this is best-effort.
     */
    async runChecksNow(): Promise<void> {
        await this.checkSystem();
        await this.checkQueues();
        await this.checkChannelTokens();
        await this.checkStorage();
        await this.checkRiskSignals();
        await this.checkSlaBreaches();
        await this.checkRecurringEngine();
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
