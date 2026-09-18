import { Logger } from '@nestjs/common';
import { CERTIFIED_SELF_SERVICE_CHANNELS, advanceOnboardingStage, isOnboardingStage } from '@parallext/shared';
import type { PrismaService } from '../prisma/prisma.service';
import { mutateTenantSettingsAtomic } from '../../common/utils/tenant-settings.util';

const logger = new Logger('BindDefaultAgent');

/**
 * A channel that was just connected is assigned to the default agent when the
 * tenant has exactly one active agent.
 *
 * The first agent is born with no assignments: as the default agent it already
 * serves every channel (serving-persona resolves `is_default = true`), and the
 * five "asignado, pero sin una conexión activa" rows that used to greet a
 * brand-new account came from seeding five types nobody had connected. The
 * assignment is therefore made HERE, when a connection actually exists, so the
 * `channel_assignment` check and the editor's chips tell the truth after
 * connecting. With several active agents the assignment is a business decision
 * and stays in the editor.
 *
 * The version bump tells every open editor that the agent changed. No cache is
 * cleared on purpose: the pipeline resolved the same default agent for this
 * channel type before the binding existed, so a stale entry serves the same
 * agent, and the type had no traffic — hence no entry — before it was connected.
 * Never throws: a failed binding must not break a successful connection.
 *
 * DDL (tenant-schema.sql, `agent_personas`): `channels TEXT[] DEFAULT '{}'`
 * and `version INTEGER DEFAULT 1`, both nullable, no trigger and no unique
 * index on either — which is why the statement COALESCEs both instead of
 * trusting the defaults, and why a mocked query is enough to pin its shape.
 */
export async function bindDefaultAgentToChannel(prisma: PrismaService, tenantId: string, channelType: string): Promise<boolean> {
    if (!(CERTIFIED_SELF_SERVICE_CHANNELS as readonly string[]).includes(channelType)) return false;
    try {
        const schema = await prisma.getTenantSchemaName(tenantId);
        if (!schema) return false;
        const rows = await prisma.executeInTenantSchema<any[]>(schema,
            `UPDATE agent_personas
                SET channels = array_append(COALESCE(channels, '{}'::text[]), $1),
                    version = COALESCE(version, 0) + 1,
                    updated_at = NOW()
              WHERE is_default = true AND is_active = true
                AND NOT ($1 = ANY(COALESCE(channels, '{}'::text[])))
                AND (SELECT COUNT(*) FROM agent_personas WHERE is_active = true) = 1
              RETURNING id`,
            [channelType]);
        return Boolean(rows?.[0]?.id);
    } catch (e: any) {
        logger.warn(`bindDefaultAgentToChannel(${channelType}) failed for ${tenantId}: ${e?.message}`);
        return false;
    }
}

export interface ChannelConnectionRecord {
    /** The default agent now serves this type (false: already bound, several agents, or the write failed). */
    readonly bound: boolean;
}

export interface ChannelConnectionRecordOptions {
    /**
     * When the connection happened, for a caller that records it later than
     * that (the Agent Quality repair of a lost Embedded Signup bridge call).
     * Default: now. Only ever written into an empty `first_channel_connected_at`.
     */
    readonly connectedAt?: Date;
}

/**
 * The onboarding-stage half of a connection, as a pure transformer for
 * `mutateTenantSettingsAtomic`.
 *
 * Returns the SAME object — the transformer's no-op signal, so no write and no
 * `updated_at` churn — when nothing moves, and in particular when the tenant
 * has NO stored stage. That tenant predates the stage contract, which reads
 * "no stage" as "already active": creating `channel_connected` for it would put
 * a two-year-old account into the contract below `live`, and its next reply
 * would stamp `firstReplyAt` — "activated today" — through `recordFirstReply`.
 */
export function applyChannelConnectedStage(
    current: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
    if (!isOnboardingStage(current.onboardingStage)) return current;
    const stage = advanceOnboardingStage(current.onboardingStage, 'channel_connected');
    if (current.onboardingStage === stage) return current;
    return { ...current, onboardingStage: stage };
}

/**
 * Everything a first connection has to leave behind, for the connect paths
 * that do not run inside the channel controller.
 *
 * WhatsApp Embedded Signup runs in the `whatsapp` service, which writes
 * `channel_accounts` itself and only tells the API afterwards. None of the
 * three things below happened there, and the 14-sep recording is what that
 * looks like: WhatsApp "conectado", the agent never assigned to it, the setup
 * card still asking to "asignar un canal" and the red bar back on Home.
 *
 *   1. `first_channel_connected_at` — the activation instant (TTFV). Guarded
 *      by IS NULL, so only the first connection of the tenant's life writes it.
 *   2. The default agent is assigned to the channel type.
 *   3. `settings.onboardingStage` advances to `channel_connected`, monotonic
 *      and under the row lock (`mutateTenantSettingsAtomic`): a plain read +
 *      `tenant.update` would rewrite the whole settings snapshot and drop any
 *      branch written in between. Only a STORED stage advances: a tenant from
 *      before the stage contract never gets one here
 *      (`applyChannelConnectedStage`).
 *
 * Each step is independent and none of them throws: this runs inside a request
 * that must succeed (a connection that already happened), and a failed
 * side effect here — or a bridge call that never arrived — is repaired by the
 * next connection or by Agent Quality's overview (`findUnrecordedConnection`
 * in agent-quality.service.ts), never by failing this one.
 *
 * TWIN: `ChannelManagementController.markFirstChannelConnected` does the same
 * three steps for the channels it connects itself, and must advance the stage
 * through `applyChannelConnectedStage` for the same reason.
 */
export async function recordChannelConnected(
    prisma: PrismaService,
    tenantId: string,
    channelType: string,
    options: ChannelConnectionRecordOptions = {},
): Promise<ChannelConnectionRecord> {
    try {
        await prisma.tenant.updateMany({
            where: { id: tenantId, firstChannelConnectedAt: null },
            data: { firstChannelConnectedAt: options.connectedAt ?? new Date() },
        });
    } catch (e: any) {
        logger.warn(`firstChannelConnectedAt(${channelType}) failed for ${tenantId}: ${e?.message}`);
    }

    const bound = await bindDefaultAgentToChannel(prisma, tenantId, channelType);

    try {
        await mutateTenantSettingsAtomic(prisma, tenantId,
            (current) => applyChannelConnectedStage(current) as Record<string, unknown>);
    } catch (e: any) {
        logger.warn(`onboardingStage advance (${channelType}) failed for ${tenantId}: ${e?.message}`);
    }

    return { bound };
}
