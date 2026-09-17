import { Logger } from '@nestjs/common';
import { CERTIFIED_SELF_SERVICE_CHANNELS } from '@parallext/shared';
import type { PrismaService } from '../prisma/prisma.service';

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
