import { operationalConfigurationHash, type RevisionQuery } from './agent-configuration-revision';
import { revisionHash } from '../evaluation-revision/evaluation-revision';

/** Server-owned provenance. Never accepted in an HTTP DTO or model/tool args. */
export type ServedAgentAuthority = Readonly<{ tenantId: string; schemaName: string } & (
    { kind: 'agent'; agentId: string; version: number; operationalHash: string }
    | { kind: 'legacy'; legacyConfigHash: string }
)>;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
export const VERSION_GUARDED_TOOLS: ReadonlySet<string> = new Set([
    'create_appointment', 'schedule_test_drive', 'cancel_appointment', 'reschedule_appointment',
    'book_class', 'cancel_class_booking', 'enroll_student', 'cancel_enrollment',
    'create_repair_order', 'approve_repair', 'cancel_repair_order',
    'place_catalog_order', 'cancel_catalog_order',
]);
export class ServedAgentAuthorityError extends Error {
    readonly code = 'agent_operational_revision_changed';
    constructor() { super('agent_operational_revision_changed'); }
}
export function validServedAgentAuthority(value: unknown, schema: string, tenantId?: string): value is ServedAgentAuthority {
    const scope = value as ServedAgentAuthority;
    return !!scope && typeof scope === 'object' && /^[a-z][a-z0-9_]*$/.test(schema)
        && scope.schemaName === schema && UUID.test(scope.tenantId) && (!tenantId || scope.tenantId === tenantId)
        && (scope.kind === 'agent' ? UUID.test(scope.agentId) && Number.isInteger(scope.version) && scope.version > 0 && HASH.test(scope.operationalHash)
            : scope.kind === 'legacy' && HASH.test(scope.legacyConfigHash));
}
export function servedAgentAuthority(tenantId: string, schemaName: string, resolution: {
    agentId: string | null; version: number | null; operationalHash?: string; legacyConfigHash?: string;
}): ServedAgentAuthority | undefined {
    const scope = resolution.agentId ? { kind: 'agent' as const, tenantId, schemaName,
        agentId: resolution.agentId, version: resolution.version!, operationalHash: resolution.operationalHash! }
        : { kind: 'legacy' as const, tenantId, schemaName, legacyConfigHash: resolution.legacyConfigHash! };
    return validServedAgentAuthority(scope, schemaName, tenantId) ? Object.freeze(scope) : undefined;
}
export function sameServedAgentAuthority(left: unknown, right: unknown): boolean {
    return !!left && !!right && revisionHash(left) === revisionHash(right);
}
/** Must use the SAME query/transaction that will commit the domain effect.
 * No external connection, provider call, lazy DDL or callback transaction here.
 * Human API commands omit scope; live executor commands require it centrally.
 */
export async function assertServedAgentAuthority(query: RevisionQuery, schema: string, scope?: ServedAgentAuthority): Promise<void> {
    if (!scope) return;
    if (!validServedAgentAuthority(scope, schema)) throw new ServedAgentAuthorityError();
    await query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text', [`agent-privacy:${schema}`]);
    // Publication takes tenant before agent. Keep this order in the effect TX.
    const tenants = await query<any[]>('SELECT id FROM public.tenants WHERE id=$1::uuid AND schema_name=$2 AND is_active=true FOR SHARE', [scope.tenantId, schema]);
    if (!tenants[0]) throw new ServedAgentAuthorityError();
    if (scope.kind === 'legacy') {
        // There is no row to lock for "no durable agents". Short table SHARE
        // prevents a first agent INSERT crossing the absence check and effect.
        await query(`LOCK TABLE "${schema}".agent_personas IN SHARE MODE`);
        if ((await query<any[]>('SELECT id FROM agent_personas LIMIT 1'))[0]) throw new ServedAgentAuthorityError();
        const [legacy] = await query<any[]>('SELECT config_json FROM persona_config WHERE is_active=true ORDER BY version DESC LIMIT 1 FOR SHARE');
        if (!legacy || revisionHash(legacy.config_json) !== scope.legacyConfigHash) throw new ServedAgentAuthorityError();
        return;
    }
    const [agent] = await query<any[]>('SELECT * FROM agent_personas WHERE id=$1::uuid FOR SHARE', [scope.agentId]);
    if (!agent || agent.is_active !== true || Number(agent.version) !== scope.version
        || operationalConfigurationHash(agent) !== scope.operationalHash) throw new ServedAgentAuthorityError();
}
