import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

/**
 * Super_admin-tunable thresholds for the platform alerts/incidents. Stored as a
 * single JSON blob in platform_settings (key `ops.alert_config`), cached in
 * Redis. get() always returns a fully-populated config (merged with DEFAULTS)
 * and never throws, so the monitor can rely on it inside its checks.
 */
export interface AlertConfig {
    disk: { warn: number; crit: number };
    ram: { warn: number; crit: number };
    redis: { warn: number; crit: number };
    dbConnections: { warn: number; crit: number };
    pgbouncer: { warnSec: number; critSec: number };
    sentryErrors: { warn: number; crit: number };
    slaBreaches: { warn: number; crit: number };
    queueDepth: Record<string, { warn: number; crit: number }>;
    /** Alert when a queue's failed count is greater than its own threshold. */
    queueFailedByQueue: Record<string, number>;
    /** Legacy fallback for queues introduced by a newer deploy. */
    queueFailed: number;
    paymentFailures: number;
    llmBudgetPct: number;
    storageQuotaPct: number;
    diskProjectionDays: number;
    backupStaleHours: number;
    channels: { email: boolean; telegram: boolean; sms: boolean };
}

export const ALERT_CONFIG_DEFAULTS: AlertConfig = {
    disk: { warn: 80, crit: 90 },
    ram: { warn: 85, crit: 95 },
    redis: { warn: 75, crit: 90 },
    dbConnections: { warn: 80, crit: 90 },
    pgbouncer: { warnSec: 5, critSec: 20 },
    sentryErrors: { warn: 50, crit: 200 },
    slaBreaches: { warn: 10, crit: 30 },
    queueDepth: {
        // La cola de ENTRANTES faltaba, y es la que el propio platform-monitor
        // llama "la más importante de la plataforma": un backlog acá significa
        // clientes escribiendo y el bot mudo. Al no estar declarada, el chequeo
        // caía a un literal de 500/2000 que además era inconfigurable — el
        // merge recorre las claves de ESTE objeto, así que un PUT con
        // queueDepth['inbound-messages'] se descartaba en silencio.
        //
        // Umbrales más bajos que el saliente a propósito: 200 entrantes sin
        // procesar ya son 200 personas esperando respuesta.
        'inbound-messages': { warn: 200, crit: 1000 },
        'outbound-messages': { warn: 500, crit: 2000 },
        'broadcast-messages': { warn: 1000, crit: 5000 },
        'automation-jobs': { warn: 300, crit: 1000 },
        'nurturing': { warn: 200, crit: 500 },
        // DIAN: una factura fiscal atascada es una obligación legal sin cumplir.
        'fiscal-invoice': { warn: 20, crit: 100 },
    },
    // A single threshold of 100 concealed customer messages that never reached
    // the conversation runtime. Inbound queues therefore alert on the first
    // failed item, while bulk/background queues retain noise-resistant limits.
    queueFailedByQueue: {
        'inbound-messages': 0,
        'wa-webhooks': 0,
        'outbound-messages': 20,
        'broadcast-messages': 100,
        'automation-jobs': 20,
        'nurturing': 20,
        'fiscal-invoice': 0,
    },
    queueFailed: 100,
    paymentFailures: 5,
    llmBudgetPct: 90,
    storageQuotaPct: 90,
    diskProjectionDays: 14,
    backupStaleHours: 26,
    channels: { email: true, telegram: true, sms: false },
};

const SETTINGS_KEY = 'ops.alert_config';
const CACHE_KEY = 'ops:alert_config';
const CACHE_TTL = 300;

@Injectable()
export class AlertConfigService {
    private readonly logger = new Logger(AlertConfigService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
    ) {}

    /** Merge a partial config over a base, one level deep on nested objects. */
    private mergeOver(base: AlertConfig, partial: any): AlertConfig {
        const p = (partial && typeof partial === 'object') ? partial : {};
        const num = (v: any, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
        // Deep-merge the per-queue depth thresholds against the canonical queue set.
        const qd: Record<string, { warn: number; crit: number }> = {};
        for (const k of Object.keys(base.queueDepth)) {
            const pk = (p.queueDepth && typeof p.queueDepth === 'object' && p.queueDepth[k]) || {};
            qd[k] = { ...base.queueDepth[k], ...pk };
        }
        const qf: Record<string, number> = {};
        for (const k of Object.keys(base.queueFailedByQueue)) {
            qf[k] = num(p.queueFailedByQueue?.[k], base.queueFailedByQueue[k]);
        }
        return {
            disk: { ...base.disk, ...(p.disk || {}) },
            ram: { ...base.ram, ...(p.ram || {}) },
            redis: { ...base.redis, ...(p.redis || {}) },
            dbConnections: { ...base.dbConnections, ...(p.dbConnections || {}) },
            pgbouncer: { ...base.pgbouncer, ...(p.pgbouncer || {}) },
            sentryErrors: { ...base.sentryErrors, ...(p.sentryErrors || {}) },
            slaBreaches: { ...base.slaBreaches, ...(p.slaBreaches || {}) },
            queueDepth: qd,
            queueFailedByQueue: qf,
            queueFailed: num(p.queueFailed, base.queueFailed),
            paymentFailures: num(p.paymentFailures, base.paymentFailures),
            llmBudgetPct: num(p.llmBudgetPct, base.llmBudgetPct),
            storageQuotaPct: num(p.storageQuotaPct, base.storageQuotaPct),
            diskProjectionDays: num(p.diskProjectionDays, base.diskProjectionDays),
            backupStaleHours: num(p.backupStaleHours, base.backupStaleHours),
            channels: { ...base.channels, ...(p.channels || {}) },
        };
    }

    /** Effective config (DEFAULTS merged with stored overrides). Cached; never throws. */
    async get(): Promise<AlertConfig> {
        try {
            const cached = await this.redis.getJson<AlertConfig>(CACHE_KEY);
            if (cached) return this.mergeOver(ALERT_CONFIG_DEFAULTS, cached);

            const rows = await this.prisma.$queryRaw<{ value: string }[]>`
                SELECT value FROM platform_settings WHERE key = ${SETTINGS_KEY} LIMIT 1
            `;
            let stored: any = {};
            if (rows?.[0]?.value) {
                try { stored = JSON.parse(rows[0].value); } catch { stored = {}; }
            }
            const merged = this.mergeOver(ALERT_CONFIG_DEFAULTS, stored);
            await this.redis.setJson(CACHE_KEY, merged, CACHE_TTL);
            return merged;
        } catch (e: any) {
            this.logger.debug(`AlertConfig get fell back to defaults: ${e.message}`);
            return { ...ALERT_CONFIG_DEFAULTS };
        }
    }

    /** Persist a (partial) config, merged over current. Returns the effective config. */
    async set(partial: any): Promise<AlertConfig> {
        const current = await this.get();
        const merged = this.mergeOver(current, partial);
        const json = JSON.stringify(merged);
        await this.prisma.$executeRaw`
            INSERT INTO platform_settings (key, value, category, updated_at)
            VALUES (${SETTINGS_KEY}, ${json}, 'ops', NOW())
            ON CONFLICT (key) DO UPDATE SET value = ${json}, updated_at = NOW()
        `;
        await this.redis.setJson(CACHE_KEY, merged, CACHE_TTL);
        return merged;
    }
}
