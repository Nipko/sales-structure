import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

/**
 * Owner decision D19 (docs/onboarding-decisions-2026-09.md): the platform pays
 * the first N agent replies on a tenant's PUBLIC DEMO LINK, with a cap.
 *
 * The demo page is the visible win of day 0: a prospect, or the owner from a
 * second phone, talks to the agent before any channel is connected. Those
 * replies are charged to nobody's plan, so the platform bounds them here.
 *
 * Two independent caps:
 *  - `messagesPerTenant`: LIFETIME number of platform-paid replies per tenant.
 *    Counted in Redis with no TTL (`demo_msg:{tenantId}`, see
 *    TenantThrottleService.reserveDemoMessageCount).
 *  - `dailyCapPerPage`: replies per calendar day per demo page, so one shared
 *    link that goes viral cannot drain the lifetime allowance in an afternoon.
 *
 * Editable without a deploy: JSON blob in `platform_settings` under
 * `onboarding.demoAllowance`, cached in Redis for five minutes, calqued from
 * CouponGovernanceService. The super_admin changes it on `/admin/demo-allowance`
 * through `PUT /platform/demo-allowance` (DemoAllowanceController: strict
 * input, audited). `get()` never throws: a broken row or an unreachable
 * database falls back to the defaults, because the demo page has to keep
 * answering when the setting cannot be read. The screen reads through
 * `getWithSource()` instead, which says when that happened (`fallback`), so a
 * default served because the database was down is never shown, or saved back,
 * as the value in force.
 *
 * It only ever pays for TRIAL turns: on a plan that includes the web chat the
 * same link runs on the plan's quota (`isTrialLink`).
 */
export interface DemoAllowance {
    /** Master switch. Off = the platform pays nothing; the caller decides what the page shows. */
    enabled: boolean;
    /** Lifetime agent replies the platform pays on a tenant's demo link. Integer >= 0. */
    messagesPerTenant: number;
    /** Replies per calendar day per demo page. Integer >= 1. */
    dailyCapPerPage: number;
}

export const DEMO_ALLOWANCE_DEFAULTS: DemoAllowance = {
    enabled: true,
    messagesPerTenant: 200,
    dailyCapPerPage: 60,
};

/** Row key in `platform_settings`. Exported so a settings panel can address the same row. */
export const DEMO_ALLOWANCE_SETTINGS_KEY = 'onboarding.demoAllowance';

/**
 * The range an edit from the super_admin screen must stay inside.
 *
 * The floors are the ones `merge()` already enforces. The ceilings exist
 * because every reply on the link is paid by the platform: two extra zeros
 * typed by mistake would fund a viral page a hundred times over, and nothing
 * else would notice until the invoice.
 */
export const DEMO_ALLOWANCE_LIMITS = {
    messagesPerTenant: { min: 0, max: 10_000 },
    dailyCapPerPage: { min: 1, max: 1_000 },
} as const;

export type DemoAllowancePatch = Partial<DemoAllowance>;

/**
 * Where the effective allowance came from.
 *  - `stored`: the row in `platform_settings` was read (its well-formed fields
 *    over the defaults).
 *  - `default`: the database answered and there is no usable row, so the
 *    defaults ARE the value in force.
 *  - `fallback`: the database could not be read; the defaults stand in so the
 *    demo page keeps answering, but nobody knows what is really stored.
 */
export type DemoAllowanceSource = 'stored' | 'default' | 'fallback';

export interface DemoAllowanceReading {
    allowance: DemoAllowance;
    source: DemoAllowanceSource;
}

/** Error code of a save refused because the stored value could not be read. */
export const DEMO_ALLOWANCE_UNREADABLE = 'demo_allowance_unreadable';

export interface DemoAllowanceFieldError {
    path: string;
    constraint: 'unknown_field' | 'boolean' | 'integer' | 'min' | 'max' | 'empty';
}

/**
 * Strict reading of an edit.
 *
 * `merge()` quietly keeps the base value for anything malformed, which is right
 * for a stored row the demo page must survive and wrong for an edit: the screen
 * would say "guardado" while nothing changed. So an edit is refused whole, with
 * each field that is wrong named, and only a clean patch reaches `set()`.
 */
export function validateDemoAllowancePatch(input: unknown): {
    patch: DemoAllowancePatch;
    errors: DemoAllowanceFieldError[];
} {
    const errors: DemoAllowanceFieldError[] = [];
    const patch: DemoAllowancePatch = {};
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return { patch, errors: [{ path: '', constraint: 'empty' }] };
    }
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
        if (key === 'enabled') {
            if (typeof value === 'boolean') patch.enabled = value;
            else errors.push({ path: key, constraint: 'boolean' });
            continue;
        }
        if (key === 'messagesPerTenant' || key === 'dailyCapPerPage') {
            const { min, max } = DEMO_ALLOWANCE_LIMITS[key];
            if (typeof value !== 'number' || !Number.isInteger(value)) errors.push({ path: key, constraint: 'integer' });
            else if (value < min) errors.push({ path: key, constraint: 'min' });
            else if (value > max) errors.push({ path: key, constraint: 'max' });
            else patch[key] = value;
            continue;
        }
        errors.push({ path: key, constraint: 'unknown_field' });
    }
    if (!errors.length && Object.keys(patch).length === 0) errors.push({ path: '', constraint: 'empty' });
    return { patch: errors.length ? {} : patch, errors };
}

const SETTINGS_KEY = DEMO_ALLOWANCE_SETTINGS_KEY;
const SETTINGS_CATEGORY = 'onboarding';
const CACHE_KEY = 'onboarding:demo_allowance';
const CACHE_TTL = 300;

@Injectable()
export class DemoAllowanceService {
    private readonly logger = new Logger(DemoAllowanceService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
    ) {}

    /**
     * Defaults + whatever of the stored blob is well-formed. Each numeric cap
     * must be an integer at or above its floor; anything else (a string, a
     * float, a negative, `null`) keeps the base value, so one bad field never
     * takes the whole allowance down or opens it without bound.
     */
    private merge(base: DemoAllowance, partial: any): DemoAllowance {
        const p = partial && typeof partial === 'object' ? partial : {};
        const int = (v: any, min: number, fallback: number): number =>
            typeof v === 'number' && Number.isInteger(v) && v >= min ? v : fallback;
        return {
            enabled: typeof p.enabled === 'boolean' ? p.enabled : base.enabled,
            messagesPerTenant: int(p.messagesPerTenant, 0, base.messagesPerTenant),
            dailyCapPerPage: int(p.dailyCapPerPage, 1, base.dailyCapPerPage),
        };
    }

    /**
     * Effective allowance (defaults + overrides) for the runtime: the demo
     * page, the widget session and the reply lane. Cached; never throws.
     *
     * An unreachable cache is a miss, not a reason to answer with the
     * defaults: the database is the source of truth and is read instead.
     */
    async get(): Promise<DemoAllowance> {
        try {
            const cached = await this.redis.getJson<DemoAllowance>(CACHE_KEY);
            if (cached) return this.merge(DEMO_ALLOWANCE_DEFAULTS, cached);
        } catch (e: any) {
            this.logger.debug(`DemoAllowance cache read failed, reading the row: ${e?.message}`);
        }
        return (await this.getWithSource()).allowance;
    }

    /**
     * The allowance straight from `platform_settings`, and whether it IS the
     * stored value. Never throws: a database that cannot be read answers the
     * defaults with `source: 'fallback'`, which the super_admin screen shows
     * as such and refuses to save over.
     *
     * The cache write is best effort: a row that was read is returned even
     * when Redis refuses to keep it, instead of being thrown away for the
     * defaults.
     */
    async getWithSource(): Promise<DemoAllowanceReading> {
        let reading: DemoAllowanceReading;
        try {
            reading = await this.readStored();
        } catch (e: any) {
            this.logger.warn(`DemoAllowance could not be read, serving the defaults: ${e?.message}`);
            return { allowance: { ...DEMO_ALLOWANCE_DEFAULTS }, source: 'fallback' };
        }
        await this.cache(reading.allowance);
        return reading;
    }

    /**
     * Upsert the blob (partial over the stored value) and refresh the cache.
     *
     * Merges over a FRESH read of the row, never over the defaults a failed
     * read stands in with: that would write `enabled: true` and the default
     * caps over whatever the platform had stored. When the row cannot be read
     * the save is refused (503) and nothing is written.
     */
    async set(partial: any): Promise<DemoAllowance> {
        const current = await this.getWithSource();
        if (current.source === 'fallback') {
            throw new ServiceUnavailableException({
                error: DEMO_ALLOWANCE_UNREADABLE,
                message: 'The stored demo allowance could not be read; nothing was changed',
            });
        }
        const merged = this.merge(current.allowance, partial);
        const json = JSON.stringify(merged);
        await this.prisma.$executeRaw`
            INSERT INTO platform_settings (key, value, category, updated_at)
            VALUES (${SETTINGS_KEY}, ${json}, ${SETTINGS_CATEGORY}, NOW())
            ON CONFLICT (key) DO UPDATE SET value = ${json}, updated_at = NOW()
        `;
        // The row is written; a cache that refuses the new value expires on its
        // own TTL. Failing the save here would tell the operator nothing
        // changed when it did.
        await this.cache(merged);
        return merged;
    }

    /** The stored row, merged over the defaults. Throws when the database cannot be read. */
    private async readStored(): Promise<DemoAllowanceReading> {
        const rows = await this.prisma.$queryRaw<{ value: string }[]>`
            SELECT value FROM platform_settings WHERE key = ${SETTINGS_KEY} LIMIT 1
        `;
        let stored: unknown = null;
        if (rows?.[0]?.value) {
            try { stored = JSON.parse(rows[0].value); } catch { stored = null; }
        }
        // A row that is not a JSON object carries nothing `merge()` would keep:
        // the defaults are what is in force, and saying `stored` would be false.
        const usable = Boolean(stored) && typeof stored === 'object' && !Array.isArray(stored);
        return { allowance: this.merge(DEMO_ALLOWANCE_DEFAULTS, usable ? stored : {}), source: usable ? 'stored' : 'default' };
    }

    private async cache(allowance: DemoAllowance): Promise<void> {
        try {
            await this.redis.setJson(CACHE_KEY, allowance, CACHE_TTL);
        } catch (e: any) {
            this.logger.debug(`DemoAllowance cache write failed: ${e?.message}`);
        }
    }
}
