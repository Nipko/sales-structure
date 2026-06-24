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
    queueFailed: number;
    paymentFailures: number;
    llmBudgetPct: number;
    storageQuotaPct: number;
    diskProjectionDays: number;
    backupStaleHours: number;
    channels: { email: boolean; telegram: boolean };
}

export const ALERT_CONFIG_DEFAULTS: AlertConfig = {
    disk: { warn: 80, crit: 90 },
    ram: { warn: 85, crit: 95 },
    redis: { warn: 75, crit: 90 },
    dbConnections: { warn: 80, crit: 90 },
    pgbouncer: { warnSec: 5, critSec: 20 },
    sentryErrors: { warn: 50, crit: 200 },
    slaBreaches: { warn: 10, crit: 30 },
    queueFailed: 100,
    paymentFailures: 5,
    llmBudgetPct: 90,
    storageQuotaPct: 90,
    diskProjectionDays: 14,
    backupStaleHours: 26,
    channels: { email: true, telegram: true },
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
        return {
            disk: { ...base.disk, ...(p.disk || {}) },
            ram: { ...base.ram, ...(p.ram || {}) },
            redis: { ...base.redis, ...(p.redis || {}) },
            dbConnections: { ...base.dbConnections, ...(p.dbConnections || {}) },
            pgbouncer: { ...base.pgbouncer, ...(p.pgbouncer || {}) },
            sentryErrors: { ...base.sentryErrors, ...(p.sentryErrors || {}) },
            slaBreaches: { ...base.slaBreaches, ...(p.slaBreaches || {}) },
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
