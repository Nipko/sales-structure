import { Injectable, Logger } from '@nestjs/common';
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
 * CouponGovernanceService. `get()` never throws: a broken row or an
 * unreachable database falls back to the defaults, because the demo page has
 * to keep answering when the setting cannot be read.
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

    /** Effective allowance (defaults + overrides). Cached; never throws. */
    async get(): Promise<DemoAllowance> {
        try {
            const cached = await this.redis.getJson<DemoAllowance>(CACHE_KEY);
            if (cached) return this.merge(DEMO_ALLOWANCE_DEFAULTS, cached);

            const rows = await this.prisma.$queryRaw<{ value: string }[]>`
                SELECT value FROM platform_settings WHERE key = ${SETTINGS_KEY} LIMIT 1
            `;
            let stored: any = {};
            if (rows?.[0]?.value) {
                try { stored = JSON.parse(rows[0].value); } catch { stored = {}; }
            }
            const merged = this.merge(DEMO_ALLOWANCE_DEFAULTS, stored);
            await this.redis.setJson(CACHE_KEY, merged, CACHE_TTL);
            return merged;
        } catch (e: any) {
            this.logger.debug(`DemoAllowance get fell back to defaults: ${e.message}`);
            return { ...DEMO_ALLOWANCE_DEFAULTS };
        }
    }

    /** Upsert the blob (partial over the effective value) and refresh the cache. */
    async set(partial: any): Promise<DemoAllowance> {
        const merged = this.merge(await this.get(), partial);
        const json = JSON.stringify(merged);
        await this.prisma.$executeRaw`
            INSERT INTO platform_settings (key, value, category, updated_at)
            VALUES (${SETTINGS_KEY}, ${json}, ${SETTINGS_CATEGORY}, NOW())
            ON CONFLICT (key) DO UPDATE SET value = ${json}, updated_at = NOW()
        `;
        await this.redis.setJson(CACHE_KEY, merged, CACHE_TTL);
        return merged;
    }
}
