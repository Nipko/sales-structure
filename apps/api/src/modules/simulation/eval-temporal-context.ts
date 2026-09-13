import type { AgentEvaluationSnapshot } from '../conversations/agent-evaluation-snapshot';
import type { EvalNamespaceLease } from './isolated-eval-namespace';
import type { PrismaService } from '../prisma/prisma.service';
import { tenantActorDirectoryWithQuery } from '../appointments/tenant-user-scope.util';

/** Same precedence as the shared turn core. Tenant hours, including an empty
 * schedule or 24/7, replace the legacy agent schedule rather than merging it. */
export function evaluationTemporalInputs(snapshot?: AgentEvaluationSnapshot) {
    const tenantHours = snapshot?.contextInputs?.businessHours;
    const agentHours = snapshot?.config?.hours;
    const usesTenantHours = tenantHours !== undefined && tenantHours !== null;
    return {
        timezone: tenantHours?.timezone || agentHours?.timezone
            || snapshot?.contextInputs?.regional?.timezone?.value || 'America/Bogota',
        schedule: usesTenantHours ? (tenantHours.is247 ? {} : tenantHours.schedule ?? {}) : agentHours?.schedule,
        source: usesTenantHours ? 'tenant' as const : 'agent' as const,
    };
}

/** The synthetic scheduling directory is not a public tenant. Never resolve
 * its zone through public tenant lookup or a caller's metadata fallback. */
export async function evaluationNamespaceTimezone(prisma: Pick<PrismaService, 'transactionInTenantSchema'>,
    schema: string, namespace: EvalNamespaceLease): Promise<string> {
    return prisma.transactionInTenantSchema(schema, async query => {
        await tenantActorDirectoryWithQuery(query, schema, namespace);
        const rows = await query(`SELECT config_json #>> '{hours,timezone}' AS timezone
            FROM persona_config WHERE is_active = true ORDER BY id LIMIT 2 FOR SHARE`);
        if (rows.length !== 1 || typeof rows[0].timezone !== 'string' || !rows[0].timezone.trim())
            throw new Error('eval_timezone_unavailable');
        const timezone = rows[0].timezone;
        try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date()); }
        catch { throw new Error('eval_timezone_invalid'); }
        return timezone;
    });
}
