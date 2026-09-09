import { BadRequestException, Injectable, Logger } from '@nestjs/common';
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
    /**
     * Uncertain outbound effects waiting for a person. Two different quantities,
     * not two levels of one: `backlog` counts everything queued for a decision,
     * `overdue` only what already crossed DISPATCH_RECONCILIATION_SLA_SECONDS.
     */
    dispatchReconciliation: { backlog: number; overdue: number; stalled: number };
    /**
     * p95 ceiling in milliseconds for the two durable steps of a dispatch, and
     * the fewest samples an alert may be raised on. A percentile over four
     * requests is noise, not a signal about the path.
     */
    dispatchLatency: { p95Ms: number; minSamples: number };
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
    // A row lands here only when an attempt was authorized and its outcome is
    // unknowable, which is rare by design; a handful across the whole platform
    // is a person's afternoon, twenty at once is something systemic. Age is the
    // harder line: the SLA is already an hour, so the first row that crosses it
    // is the incident and there is no volume that makes it acceptable.
    // `stalled` counts a third thing entirely: rows whose job was never
    // published. One is already a customer waiting on a reply nothing is going
    // to send, so the threshold is the first row, like `overdue`.
    dispatchReconciliation: { backlog: 20, overdue: 1, stalled: 1 },
    // 500 ms is the runbook's objective, chosen with margin over what the load
    // harness measured (178 ms admit / 104 ms settle at 360 concurrent attempts
    // on 24 vCPU without PgBouncer). It is also a bucket edge, which is what
    // keeps the comparison against a bucketed p95 sound.
    dispatchLatency: { p95Ms: 500, minSamples: 50 },
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

    /**
     * Merge a partial config over a base, one level deep on nested objects.
     *
     * Every value is coerced, including the ones inside nested objects. Those
     * used to be spread raw while only the flat scalars went through `num()`,
     * so anything the panel could not turn into a number — an emptied field, a
     * typo, a null — became the threshold itself. The failure was not loud: a
     * comparison like `2 >= 'abc'` is simply `false`, so the alert stopped
     * firing while the panel went on displaying whatever had been typed. An
     * alert that silently stops watching is worse than one that was never
     * configured, because somebody believes it is on.
     *
     * Numeric strings are accepted because the panel's inputs produce them;
     * anything genuinely unreadable falls back to the base value here and is
     * refused outright by `set`, which is where a person is still watching.
     */
    private mergeOver(base: AlertConfig, partial: any): AlertConfig {
        const p = (partial && typeof partial === 'object') ? partial : {};
        const num = (v: any, fallback: number) => {
            const value = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
            return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
        };
        /** Field by field, so an unknown key cannot introduce an uncoerced one. */
        const nums = <T extends Record<string, number>>(baseObject: T, given: any): T => {
            const merged: Record<string, number> = { ...baseObject };
            for (const key of Object.keys(baseObject)) merged[key] = num(given?.[key], baseObject[key]);
            return merged as T;
        };
        const bools = <T extends Record<string, boolean>>(baseObject: T, given: any): T => {
            const merged: Record<string, boolean> = { ...baseObject };
            for (const key of Object.keys(baseObject)) {
                const value = given?.[key];
                merged[key] = typeof value === 'boolean' ? value
                    : value === 'true' ? true : value === 'false' ? false : baseObject[key];
            }
            return merged as T;
        };
        // Deep-merge the per-queue depth thresholds against the canonical queue set.
        const qd: Record<string, { warn: number; crit: number }> = {};
        for (const k of Object.keys(base.queueDepth)) qd[k] = nums(base.queueDepth[k], p.queueDepth?.[k]);
        const qf: Record<string, number> = {};
        for (const k of Object.keys(base.queueFailedByQueue)) {
            qf[k] = num(p.queueFailedByQueue?.[k], base.queueFailedByQueue[k]);
        }
        return {
            disk: nums(base.disk, p.disk),
            ram: nums(base.ram, p.ram),
            redis: nums(base.redis, p.redis),
            dbConnections: nums(base.dbConnections, p.dbConnections),
            pgbouncer: nums(base.pgbouncer, p.pgbouncer),
            sentryErrors: nums(base.sentryErrors, p.sentryErrors),
            slaBreaches: nums(base.slaBreaches, p.slaBreaches),
            dispatchReconciliation: nums(base.dispatchReconciliation, p.dispatchReconciliation),
            dispatchLatency: nums(base.dispatchLatency, p.dispatchLatency),
            queueDepth: qd,
            queueFailedByQueue: qf,
            queueFailed: num(p.queueFailed, base.queueFailed),
            paymentFailures: num(p.paymentFailures, base.paymentFailures),
            llmBudgetPct: num(p.llmBudgetPct, base.llmBudgetPct),
            storageQuotaPct: num(p.storageQuotaPct, base.storageQuotaPct),
            diskProjectionDays: num(p.diskProjectionDays, base.diskProjectionDays),
            backupStaleHours: num(p.backupStaleHours, base.backupStaleHours),
            channels: bools(base.channels, p.channels),
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

    /**
     * Every numeric field a caller actually sent, or the exact path that was not
     * a number. Reading is forgiving because a bad row must not take the alerts
     * down with it; writing is not, because a person is right there to be told.
     */
    private unreadable(base: any, partial: any, path = ''): string[] {
        if (!partial || typeof partial !== 'object') return [];
        const bad: string[] = [];
        for (const key of Object.keys(partial)) {
            const here = path ? `${path}.${key}` : key;
            const expected = base?.[key];
            const given = partial[key];
            if (expected && typeof expected === 'object') { bad.push(...this.unreadable(expected, given, here)); continue; }
            if (given === undefined || given === null) continue;
            if (typeof expected === 'number') {
                const value = typeof given === 'string' && given.trim() !== '' ? Number(given) : given;
                if (typeof value !== 'number' || !Number.isFinite(value)) bad.push(here);
            } else if (typeof expected === 'boolean') {
                if (typeof given !== 'boolean' && given !== 'true' && given !== 'false') bad.push(here);
            }
        }
        return bad;
    }

    /** Persist a (partial) config, merged over current. Returns the effective config. */
    async set(partial: any): Promise<AlertConfig> {
        const current = await this.get();
        const unreadable = this.unreadable(current, partial);
        // Saving it as the old value would report success and leave the operator
        // believing the threshold they typed is the one being watched.
        if (unreadable.length) throw new BadRequestException({ error: 'alert_threshold_not_a_number', fields: unreadable });
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
