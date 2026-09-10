import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ChannelGatewayService } from './channel-gateway.service';
import type { ChannelType } from '@parallext/shared';

const SETTINGS_KEY = 'dispatch.normalOutbox';
const CACHE_KEY = 'dispatch:rollout';
const CACHE_TTL = 60;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const CHANNEL = /^[a-z_]{2,40}$/;

export interface DispatchRolloutConfig {
    /** Master switch. Off means every producer keeps the path it has today. */
    readonly enabled: boolean;
    /** When non-empty, only these tenants take the new path. A pilot list. */
    readonly tenantIds: readonly string[];
    /** Channels the operator asked for, before intersecting with reality. */
    readonly channels: readonly string[];
}

export interface DispatchRolloutState extends DispatchRolloutConfig {
    /** Channels whose adapter actually implements the strict transport. */
    readonly migratedChannels: readonly string[];
    /** What the switch really does right now: requested AND migrated. */
    readonly effectiveChannels: readonly string[];
    /** Channels asked for that cannot be served, so the operator can see why. */
    readonly ignoredChannels: readonly string[];
}

/**
 * Off by default, and deliberately so.
 *
 * The durable dispatch path is built and tested, but nothing about it has met a
 * real provider: every answer in its suites is synthetic. Switching the live
 * reply path for a customer-facing channel is a decision with a pilot attached.
 * So the producer asks here, this answers no, and the previous behaviour is what
 * runs until somebody deliberately writes the setting.
 *
 * This is an operational kill switch, not a commercial feature. It stays in
 * `platform_settings` precisely so it can be flipped off for everyone in one
 * write, independently of any plan. Plan entitlement is a separate question and
 * is evaluated where capacity is enforced, not here.
 *
 * Never throws: an unreadable or malformed setting means off, because failing
 * open would put untested delivery in front of customers.
 */
@Injectable()
export class DispatchRolloutService {
    private readonly logger = new Logger(DispatchRolloutService.name);
    private static readonly OFF: DispatchRolloutConfig =
        Object.freeze({ enabled: false, tenantIds: Object.freeze([]), channels: Object.freeze([]) });
    /** Channels a batch may ever be created for, before the adapter check. */
    static readonly SUPPORTED_CHANNELS: readonly string[] =
        Object.freeze(['whatsapp', 'messenger', 'instagram', 'telegram']);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly gateway: ChannelGatewayService,
    ) {}

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

    /** Channels whose adapter really implements the strict transport, right now. */
    migratedChannels(): string[] {
        return DispatchRolloutService.SUPPORTED_CHANNELS
            .filter(channel => !!this.gateway.getStrictTransport(channel as ChannelType));
    }

    /**
     * What the switch actually does, for an operator to read back.
     * A channel asked for but not migrated is reported as ignored rather than
     * silently dropped, because a configuration that looks on and does nothing
     * is worse than one that says why.
     */
    async state(): Promise<DispatchRolloutState> {
        const config = await this.config();
        const migrated = this.migratedChannels();
        const effective = config.channels.filter(channel => migrated.includes(channel));
        return Object.freeze({
            ...config,
            migratedChannels: Object.freeze(migrated),
            effectiveChannels: Object.freeze(effective),
            ignoredChannels: Object.freeze(config.channels.filter(channel => !migrated.includes(channel))),
        });
    }

    /**
     * Whether this exact tenant and channel take the durable path right now.
     *
     * The channel must be BOTH requested and actually migrated. A configuration
     * naming a channel with no strict transport used to let a batch be created
     * that nothing could ever send — the reply owned by a path unable to deliver
     * it. It fails closed instead.
     */
    async enabledFor(tenantId: string, channelType: string): Promise<boolean> {
        const config = await this.config();
        if (!config.enabled || !config.channels.includes(channelType)) return false;
        if (!this.migratedChannels().includes(channelType)) {
            this.logger.warn(`Dispatch rollout names ${channelType}, which has no strict transport — ignored`);
            return false;
        }
        return config.tenantIds.length === 0 || config.tenantIds.includes(tenantId);
    }

    /**
     * Write the switch. Validated, audited, and effective immediately: the cache
     * is dropped rather than left to expire, so a rollback is not a minute long.
     */
    async set(input: unknown, actor: { userId?: string | null; email?: string | null }): Promise<DispatchRolloutState> {
        const requested = this.validate(input);
        const previous = await this.config();
        await this.prisma.$executeRaw`
            INSERT INTO platform_settings (key, value, updated_at)
            VALUES (${SETTINGS_KEY}, ${JSON.stringify(requested)}, NOW())
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
        `;
        await this.redis.del(CACHE_KEY).catch(() => {});
        await this.prisma.auditLog.create({
            data: {
                tenantId: null,
                userId: actor.userId ?? null,
                action: 'dispatch.rollout.updated',
                resource: SETTINGS_KEY,
                details: JSON.parse(JSON.stringify(
                    { previous, requested, actorEmail: actor.email ?? null })),
            },
        }).catch((error: any) => this.logger.warn(`Dispatch rollout audit not written: ${error?.message}`));
        this.logger.warn(`Dispatch rollout changed by ${actor.email || actor.userId || 'unknown'}: `
            + JSON.stringify(requested));
        return this.state();
    }

    /** The kill switch. One write, everyone off, cache dropped immediately. */
    async disable(actor: { userId?: string | null; email?: string | null }): Promise<DispatchRolloutState> {
        return this.set({ enabled: false, tenantIds: [], channels: [] }, actor);
    }

    /**
     * Refuse a configuration rather than store one that cannot mean what it says.
     * A channel outside the supported set, or a tenant id that is not an id, is a
     * mistake the operator should see now — not a silent no-op later.
     */
    private validate(input: unknown): DispatchRolloutConfig {
        const raw = (input ?? {}) as Record<string, unknown>;
        if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean')
            throw new Error('dispatch_rollout_invalid_enabled');
        const list = (value: unknown, field: string, pattern: RegExp): string[] => {
            if (value === undefined || value === null) return [];
            if (!Array.isArray(value)) throw new Error(`dispatch_rollout_invalid_${field}`);
            const entries = [...new Set(value.map(entry => String(entry).trim()))].filter(Boolean);
            for (const entry of entries) {
                if (!pattern.test(entry)) throw new Error(`dispatch_rollout_invalid_${field}:${entry}`);
            }
            return entries.sort();
        };
        const channels = list(raw.channels, 'channels', CHANNEL);
        for (const channel of channels) {
            if (!DispatchRolloutService.SUPPORTED_CHANNELS.includes(channel))
                throw new Error(`dispatch_rollout_unsupported_channel:${channel}`);
        }
        return Object.freeze({
            enabled: raw.enabled === true,
            tenantIds: Object.freeze(list(raw.tenantIds, 'tenantIds', UUID)),
            channels: Object.freeze(channels),
        });
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
