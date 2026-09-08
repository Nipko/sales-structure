import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

const SETTINGS_KEY = 'dispatch.normalOutbox';
const CACHE_KEY = 'dispatch:rollout';
const CACHE_TTL = 60;

export interface DispatchRolloutConfig {
    /** Master switch. Off means every producer keeps the path it has today. */
    readonly enabled: boolean;
    /** When non-empty, only these tenants take the new path. A pilot list. */
    readonly tenantIds: readonly string[];
    /** Channels allowed on the new path, intersected with migrated transports. */
    readonly channels: readonly string[];
}

/**
 * Off by default, and deliberately so.
 *
 * The durable dispatch path is built and tested, but nothing about it has met a
 * real provider: every answer in its suites is synthetic. Switching the live
 * reply path for a customer-facing channel is a decision with a pilot attached,
 * and the pilot has not happened. So the producer asks here, this answers no,
 * and the previous behaviour is what runs until somebody deliberately writes
 * the setting.
 *
 * `platform_settings` key `dispatch.normalOutbox`, JSON, e.g.
 * `{"enabled":true,"tenantIds":["<uuid>"],"channels":["whatsapp"]}`.
 *
 * Never throws: an unreadable or malformed setting means off, because failing
 * open here would put untested delivery in front of customers.
 */
@Injectable()
export class DispatchRolloutService {
    private readonly logger = new Logger(DispatchRolloutService.name);
    private static readonly OFF: DispatchRolloutConfig =
        Object.freeze({ enabled: false, tenantIds: Object.freeze([]), channels: Object.freeze([]) });

    constructor(private readonly prisma: PrismaService, private readonly redis: RedisService) {}

    async config(): Promise<DispatchRolloutConfig> {
        try {
            const cached = await this.redis.getJson<DispatchRolloutConfig>(CACHE_KEY);
            if (cached) return this.normalize(cached);
            const rows = await this.prisma.$queryRaw<{ value: string }[]>`
                SELECT value FROM platform_settings WHERE key = ${SETTINGS_KEY} LIMIT 1
            `;
            let stored: any = {};
            if (rows?.[0]?.value) {
                try { stored = JSON.parse(rows[0].value); } catch { stored = {}; }
            }
            const config = this.normalize(stored);
            await this.redis.setJson(CACHE_KEY, config, CACHE_TTL).catch(() => {});
            return config;
        } catch (error: any) {
            this.logger.debug(`Dispatch rollout unreadable, staying off: ${error?.message}`);
            return DispatchRolloutService.OFF;
        }
    }

    /**
     * Whether this exact tenant and channel take the durable path right now.
     * An empty pilot list with the switch on means every tenant; an empty
     * channel list means none, so turning the switch on alone changes nothing.
     */
    async enabledFor(tenantId: string, channelType: string): Promise<boolean> {
        const config = await this.config();
        if (!config.enabled || !config.channels.includes(channelType)) return false;
        return config.tenantIds.length === 0 || config.tenantIds.includes(tenantId);
    }

    private normalize(stored: any): DispatchRolloutConfig {
        const list = (value: unknown) => Object.freeze(Array.isArray(value)
            ? [...new Set(value.filter(entry => typeof entry === 'string' && entry.trim()).map(String))] : []);
        return Object.freeze({
            enabled: stored?.enabled === true,
            tenantIds: list(stored?.tenantIds),
            channels: list(stored?.channels),
        });
    }
}
