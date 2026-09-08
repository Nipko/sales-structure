import type { PrismaService } from '../prisma/prisma.service';
import { hasAgentSourceFence, withAgentSourceFence } from '../../common/utils/agent-source-fence';
import { disposeOwnedEvalNamespace } from '../simulation/isolated-eval-namespace';
import {
    assertKnowledgeReplicaInTransaction, captureKnowledgeReplicaInTransaction, EvaluationKnowledgeUnavailable,
    knowledgeReplicaSlotName, knowledgeSourceRevision, KNOWLEDGE_REPLICA_SLOTS, resolveKnowledgeReplica,
    type EvaluationKnowledgeReplica, type KnowledgeReplicaTransaction,
} from './evaluation-knowledge-replica';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SOURCE = /^tenant_[a-z0-9_]{1,56}$/;
const REGISTRY = 'public.evaluation_knowledge_usages';
type Tx = KnowledgeReplicaTransaction;
type UsageRow = { tenant_id: string; usage_token: string; agent_id: string; source_schema: string;
    slot: number; owner_token: string; integrity_hash: string; reference: EvaluationKnowledgeReplica;
    expires_at: Date; state: 'active' | 'released' | 'expired' | 'retired' };

/** Internal snapshot identity. Not an HTTP DTO, model parameter or authorization
 * to publish learning. A retry MUST keep the same token and agent. */
export interface AcquireKnowledgeReplica {
    tenantId: string;
    agentId: string;
    snapshotToken: string;
    ttlMs?: number;
}

function fail(code: string): never { throw new EvaluationKnowledgeUnavailable(`evaluation_knowledge_${code}`); }
function validSource(schema: string): boolean { return SOURCE.test(schema) && !schema.startsWith('tenant_eval_'); }

/** Metadata only. Bootstrap is serialized before any privacy/coordinator fence;
 * there is no per-tenant DDL, corpus JSON or provider credential in this table. */
export async function bootstrapKnowledgeReplicaLifecycle(prisma: PrismaService): Promise<void> {
    await prisma.$transaction(async tx => {
        await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended('evaluation-knowledge-bootstrap:v1',0))::text");
        await tx.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS ${REGISTRY} (
            tenant_id uuid NOT NULL, usage_token uuid NOT NULL, agent_id uuid NOT NULL,
            source_schema text NOT NULL, slot integer NOT NULL CHECK(slot>=0 AND slot<4),
            owner_token uuid NOT NULL, integrity_hash text NOT NULL, source_revision text NOT NULL,
            reference jsonb NOT NULL, expires_at timestamptz NOT NULL,
            state text NOT NULL CHECK(state IN ('active','released','expired','retired')),
            created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
            PRIMARY KEY(tenant_id,usage_token))`);
        await tx.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS evaluation_knowledge_usages_slot
            ON ${REGISTRY}(tenant_id,slot,owner_token,state)`);
    }, { timeout: 30_000 });
}

async function sourceFor(prisma: PrismaService, tenantId: string): Promise<string> {
    if (!UUID.test(tenantId)) fail('scope_invalid');
    const rows = await prisma.$queryRawUnsafe('SELECT schema_name FROM public.tenants WHERE id=$1::uuid', tenantId) as any[];
    if (rows.length !== 1 || !validSource(rows[0].schema_name)) fail('tenant_unavailable');
    return rows[0].schema_name;
}

/** Lock acquisition happens on a READ COMMITTED coordinator before the inner
 * MVCC transaction begins. Starting RR before waiting on an advisory lock would
 * let a second worker keep a snapshot from before the first worker committed.
 * Only the coordinator acquires privacy; the inner connection never reacquires
 * it (in particular when an exclusive erasure is queued behind the coordinator).
 * No provider callback or caller-supplied transaction is accepted here. */
async function coordinated<T>(prisma: PrismaService, tenantId: string, schema: string,
    work: (tx: Tx) => Promise<T>): Promise<T> {
    if (!UUID.test(tenantId) || !validSource(schema)) fail('scope_invalid');
    if (hasAgentSourceFence(prisma, schema)) fail('lifecycle_inside_source_use');
    return withAgentSourceFence(prisma, schema, async query => {
        await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text', [`evaluation-knowledge:${tenantId}`]);
        return prisma.$transaction(async tx => {
            await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'UTC'");
            await tx.$executeRawUnsafe('SET LOCAL search_path TO pg_catalog,public');
            return work(tx as Tx);
        }, { isolationLevel: 'RepeatableRead', timeout: 60_000 });
    });
}

async function assertAgent(tx: Tx, tenantId: string, schema: string, agentId: string): Promise<void> {
    const tenant = await tx.$queryRawUnsafe(`SELECT id FROM public.tenants
        WHERE id=$1::uuid AND schema_name=$2 AND is_active=true FOR SHARE`, tenantId, schema);
    if (tenant.length !== 1) fail('tenant_unavailable');
    // Evaluation is also how an inactive/draft agent is prepared. Ownership is
    // required; live routing and operational activation are not granted here.
    const agent = await tx.$queryRawUnsafe(`SELECT id FROM "${schema}".agent_personas
        WHERE id=$1::uuid FOR SHARE`, agentId);
    if (agent.length !== 1) fail('agent_unavailable');
}

async function slotReplica(tx: Tx, tenantId: string, slot: number, sourceSchema: string): Promise<EvaluationKnowledgeReplica | undefined> {
    const name = knowledgeReplicaSlotName(tenantId, slot);
    if (!(await tx.$queryRawUnsafe('SELECT 1 FROM pg_namespace WHERE nspname=$1', name)).length) return undefined;
    const rows = await tx.$queryRawUnsafe(`SELECT descriptor,integrity_hash FROM "${name}".__eval_knowledge_capture`);
    if (rows.length !== 1) fail('slot_owner_mismatch');
    const copy = resolveKnowledgeReplica(rows[0].descriptor, tenantId);
    if (copy.lease.schemaName !== name || copy.lease.sourceSchema !== sourceSchema || copy.management?.slot !== slot
        || copy.integrityHash !== rows[0].integrity_hash || copy.usage) fail('slot_owner_mismatch');
    const owner = await tx.$queryRawUnsafe(`SELECT 1 FROM "${name}".__eval_namespace
        WHERE tenant_id=$1::uuid AND owner_token=$2::uuid AND source_schema=$3`, tenantId, copy.lease.token, sourceSchema);
    if (owner.length !== 1) fail('slot_owner_mismatch');
    return copy;
}

function rowReference(row: UsageRow, tenantId: string, agentId: string, token: string): EvaluationKnowledgeReplica {
    const copy = resolveKnowledgeReplica(row.reference, tenantId);
    if (row.tenant_id !== tenantId || row.agent_id !== agentId || row.usage_token !== token
        || copy.usage?.token !== token || copy.usage.agentId !== agentId
        || copy.lease.token !== row.owner_token || copy.lease.sourceSchema !== row.source_schema
        || copy.management?.slot !== row.slot || copy.integrityHash !== row.integrity_hash
        || copy.usage.expiresAt !== new Date(row.expires_at).toISOString()) fail('usage_owner_mismatch');
    return copy;
}

async function dropUnused(tx: Tx, copy: EvaluationKnowledgeReplica, retire: boolean): Promise<boolean> {
    const schema = copy.lease.schemaName, tenant = copy.lease.tenantId;
    // Both sources of authority must agree there is no surviving use. This also
    // protects a managed capture made by the lower-level primitive before the
    // lifecycle registry existed: an unknown active local use is never guessed
    // to be abandoned by a normal release or expiry sweep.
    if (!retire) {
        const active = await tx.$queryRawUnsafe(`SELECT 1 FROM ${REGISTRY} WHERE tenant_id=$1::uuid
            AND slot=$2::integer AND owner_token=$3::uuid AND state='active' AND expires_at>clock_timestamp() LIMIT 1`,
            tenant, copy.management!.slot, copy.lease.token);
        const local = await tx.$queryRawUnsafe(`SELECT 1 FROM "${schema}".__eval_knowledge_usages WHERE expires_at>clock_timestamp() LIMIT 1`);
        if (active.length || local.length) return false;
    }
    await disposeOwnedEvalNamespace(async (sql, params = []) => {
        if (/^\s*(?:DROP|SET)\b/i.test(sql)) { await tx.$executeRawUnsafe(sql, ...params); return []; }
        return tx.$queryRawUnsafe(sql, ...params);
    }, copy.lease);
    return true;
}

async function reapInTransaction(tx: Tx, tenantId: string, sourceSchema: string): Promise<number> {
    const owner = await tx.$queryRawUnsafe('SELECT is_active,schema_name FROM public.tenants WHERE id=$1::uuid FOR SHARE', tenantId);
    const retire = owner.length !== 1 || owner[0].is_active !== true || owner[0].schema_name !== sourceSchema;
    await tx.$executeRawUnsafe(`UPDATE ${REGISTRY} SET state=CASE WHEN $3::boolean THEN 'retired' ELSE 'expired' END,
        updated_at=clock_timestamp() WHERE tenant_id=$1::uuid AND source_schema=$2 AND state='active'
        AND ($3::boolean OR expires_at<=clock_timestamp())`, tenantId, sourceSchema, retire);
    let removed = 0;
    for (let slot = 0; slot < KNOWLEDGE_REPLICA_SLOTS; slot++) {
        const name = knowledgeReplicaSlotName(tenantId, slot);
        if (!(await tx.$queryRawUnsafe('SELECT 1 FROM pg_namespace WHERE nspname=$1', name)).length) continue;
        // A tenant can have a retired source binding and a new one in the same
        // sweep. Never touch a slot belonging to the other source iteration.
        const marker = await tx.$queryRawUnsafe(`SELECT source_schema FROM "${name}".__eval_namespace WHERE tenant_id=$1::uuid`, tenantId);
        if (marker.length !== 1) fail('slot_owner_mismatch');
        if (marker[0].source_schema !== sourceSchema) continue;
        const copy = (await slotReplica(tx, tenantId, slot, sourceSchema))!;
        await tx.$executeRawUnsafe(`DELETE FROM "${name}".__eval_knowledge_usages u WHERE $1::boolean
            OR u.expires_at<=clock_timestamp() OR EXISTS(SELECT 1 FROM ${REGISTRY} r
                WHERE r.tenant_id=$2::uuid AND r.usage_token=u.token AND r.agent_id=u.agent_id
                AND r.owner_token=$3::uuid AND r.state<>'active')`, retire, tenantId, copy.lease.token);
        if (await dropUnused(tx, copy, retire)) removed++;
    }
    return removed;
}

/** Acquires one reference per snapshot. Shared corpus TTL is fixed at capture;
 * a later usage may receive less than its requested TTL, exposed explicitly in
 * usage.expiresAt. No retry or reuse extends either original deadline. */
export async function acquireKnowledgeReplica(prisma: PrismaService, input: AcquireKnowledgeReplica): Promise<EvaluationKnowledgeReplica> {
    const { tenantId, agentId, snapshotToken } = input, ttlMs = input.ttlMs ?? 3600_000;
    if (!UUID.test(tenantId) || !UUID.test(agentId) || !UUID.test(snapshotToken)
        || !Number.isInteger(ttlMs) || ttlMs < 1000 || ttlMs > 3600_000) fail('scope_invalid');
    const schema = await sourceFor(prisma, tenantId);
    if (hasAgentSourceFence(prisma, schema)) fail('lifecycle_inside_source_use');
    await bootstrapKnowledgeReplicaLifecycle(prisma);
    return coordinated(prisma, tenantId, schema, async tx => {
        await assertAgent(tx, tenantId, schema, agentId);
        const existing = await tx.$queryRawUnsafe(`SELECT * FROM ${REGISTRY} WHERE tenant_id=$1::uuid AND usage_token=$2::uuid`, tenantId, snapshotToken);
        if (existing.length) {
            const copy = rowReference(existing[0], tenantId, agentId, snapshotToken);
            if (existing[0].state !== 'active') fail('usage_retired');
            await assertKnowledgeReplicaInTransaction(tx, copy, tenantId);
            // Retry returns exactly the originally committed reference even if
            // source content since changed. It grants no claim of currentness;
            // execution still needs source/dependency/privacy guards.
            return copy;
        }
        await reapInTransaction(tx, tenantId, schema);
        const sourceRevision = await knowledgeSourceRevision(tx, schema);
        let available: number | undefined;
        let copy: EvaluationKnowledgeReplica | undefined;
        let captured = false;
        for (let slot = 0; slot < KNOWLEDGE_REPLICA_SLOTS; slot++) {
            const candidate = await slotReplica(tx, tenantId, slot, schema);
            if (!candidate) { available ??= slot; continue; }
            if (candidate.management!.sourceRevision !== sourceRevision) continue;
            const live = await tx.$queryRawUnsafe(`SELECT 1 FROM "${candidate.lease.schemaName}".__eval_namespace WHERE expires_at>clock_timestamp()+interval '1 second'`);
            if (live.length === 1) { copy = candidate; break; }
        }
        if (!copy) {
            if (available === undefined) fail('slots_exhausted');
            copy = await captureKnowledgeReplicaInTransaction(tx, tenantId, 3600_000,
                { slot: available, sourceRevision, usage: { token: snapshotToken, agentId } });
            captured = true;
        }
        const deadlines = await tx.$queryRawUnsafe(`SELECT LEAST(date_trunc('milliseconds',clock_timestamp())+$1::integer*interval '1 millisecond',
            $2::timestamptz) AS expires_at`, ttlMs, copy.lease.expiresAt);
        const expiresAt = new Date(deadlines[0].expires_at).toISOString();
        const reference = { ...copy, usage: { token: snapshotToken, agentId, expiresAt } };
        if (captured) {
            await tx.$executeRawUnsafe(`UPDATE "${copy.lease.schemaName}".__eval_knowledge_usages SET expires_at=$3::timestamptz
                WHERE token=$1::uuid AND agent_id=$2::uuid`, snapshotToken, agentId, expiresAt);
        } else {
            const added = await tx.$queryRawUnsafe(`INSERT INTO "${copy.lease.schemaName}".__eval_knowledge_usages(token,agent_id,expires_at)
                VALUES($1::uuid,$2::uuid,$3::timestamptz) ON CONFLICT(token) DO NOTHING RETURNING token`, snapshotToken, agentId, expiresAt);
            if (added.length !== 1) fail('usage_unregistered');
        }
        await assertKnowledgeReplicaInTransaction(tx, reference, tenantId);
        await tx.$executeRawUnsafe(`INSERT INTO ${REGISTRY}(tenant_id,usage_token,agent_id,source_schema,slot,owner_token,
            integrity_hash,source_revision,reference,expires_at,state)
            VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5::integer,$6::uuid,$7,$8,$9::jsonb,$10::timestamptz,'active')`,
            tenantId, snapshotToken, agentId, schema, copy.management!.slot, copy.lease.token,
            copy.integrityHash, sourceRevision, JSON.stringify(reference), expiresAt);
        return reference;
    });
}

/** Release is idempotent only for the exact original ownership tuple. Tombstones
 * remain after copy removal, preventing a delayed acquire from reviving it. */
export async function releaseKnowledgeReplica(prisma: PrismaService, input: EvaluationKnowledgeReplica): Promise<{ released: boolean; removed: boolean }> {
    const copy = resolveKnowledgeReplica(input, input?.lease?.tenantId);
    if (!copy.management || !copy.usage) fail('managed_usage_required');
    if (hasAgentSourceFence(prisma, copy.lease.sourceSchema)) fail('lifecycle_inside_source_use');
    await bootstrapKnowledgeReplicaLifecycle(prisma);
    return coordinated(prisma, copy.lease.tenantId, copy.lease.sourceSchema, async tx => {
        const rows = await tx.$queryRawUnsafe(`SELECT * FROM ${REGISTRY} WHERE tenant_id=$1::uuid AND usage_token=$2::uuid`, copy.lease.tenantId, copy.usage!.token);
        if (rows.length !== 1) fail('usage_owner_mismatch');
        const stored = rowReference(rows[0], copy.lease.tenantId, copy.usage!.agentId, copy.usage!.token);
        if (JSON.stringify(stored) !== JSON.stringify(copy)) {
            // JSONB property order is not evidence; compare the sealed corpus
            // identity and exact usage deadline, already validated above.
            if (stored.integrityHash !== copy.integrityHash || stored.usage!.expiresAt !== copy.usage!.expiresAt) fail('usage_owner_mismatch');
        }
        if (rows[0].state !== 'active') return { released: true, removed: false };
        const current = await slotReplica(tx, copy.lease.tenantId, copy.management!.slot, copy.lease.sourceSchema);
        if (current && current.lease.token !== copy.lease.token) fail('slot_owner_mismatch');
        await tx.$executeRawUnsafe(`UPDATE ${REGISTRY} SET state='released',updated_at=clock_timestamp()
            WHERE tenant_id=$1::uuid AND usage_token=$2::uuid AND owner_token=$3::uuid`, copy.lease.tenantId, copy.usage!.token, copy.lease.token);
        if (!current) return { released: true, removed: false };
        await tx.$executeRawUnsafe(`DELETE FROM "${copy.lease.schemaName}".__eval_knowledge_usages WHERE token=$1::uuid AND agent_id=$2::uuid`, copy.usage!.token, copy.usage!.agentId);
        return { released: true, removed: await dropUnused(tx, current, false) };
    });
}

/** Bounded paginated sweep includes inactive and deleted tenants through their
 * metadata rows. Cursor is the last processed tenant UUID; no scheduler is wired
 * by this primitive. Only exact owned deterministic slots can be removed. */
export async function reapKnowledgeReplicas(prisma: PrismaService, options: { tenantId?: string; afterTenantId?: string; limit?: number } = {}) {
    const limit = options.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500 || (options.tenantId && !UUID.test(options.tenantId))
        || (options.afterTenantId && !UUID.test(options.afterTenantId))) fail('scope_invalid');
    await bootstrapKnowledgeReplicaLifecycle(prisma);
    const tenants = await prisma.$queryRawUnsafe(`SELECT id FROM (SELECT id FROM public.tenants UNION SELECT tenant_id AS id FROM ${REGISTRY}) candidates
        WHERE ($1::uuid IS NULL OR id=$1::uuid) AND ($2::uuid IS NULL OR id>$2::uuid) ORDER BY id LIMIT $3::integer`,
        options.tenantId ?? null, options.afterTenantId ?? null, limit + 1) as any[];
    let removed = 0;
    const failures: Array<{ tenantId: string; code: string }> = [];
    for (const { id } of tenants.slice(0, limit)) {
        try {
            const sources = await prisma.$queryRawUnsafe(`SELECT schema_name AS schema FROM public.tenants WHERE id=$1::uuid
                UNION SELECT source_schema AS schema FROM ${REGISTRY} WHERE tenant_id=$1::uuid`, id) as any[];
            for (const { schema } of sources) {
                if (!validSource(schema)) fail('scope_invalid');
                removed += await coordinated(prisma, id, schema, tx => reapInTransaction(tx, id, schema));
            }
        } catch (error) {
            // Preserve the ambiguous resource, report only an opaque tenant ID
            // and stable code, and advance pagination for all other tenants.
            failures.push({ tenantId: id, code: error instanceof EvaluationKnowledgeUnavailable
                ? error.message : 'evaluation_knowledge_cleanup_failed' });
        }
    }
    return { processedTenants: Math.min(tenants.length, limit), removed, failures,
        nextCursor: tenants.length > limit ? tenants[limit - 1].id as string : null };
}

/** Erasure integration port: caller already owns the EXCLUSIVE source privacy
 * fence and must commit source erasure in this same transaction. No DDL bootstrap
 * or nested connection is allowed here. Runtime/Compliance wiring is separate. */
export async function retireKnowledgeReplicasInTransaction(tx: Tx, tenantId: string, sourceSchema: string): Promise<number> {
    if (!UUID.test(tenantId) || !validSource(sourceSchema)) fail('scope_invalid');
    const fence = await tx.$queryRawUnsafe(`SELECT 1 FROM pg_locks WHERE locktype='advisory'
        AND pid=pg_backend_pid() AND mode='ExclusiveLock' AND granted=true AND objsubid=1
        AND database=(SELECT oid FROM pg_database WHERE datname=current_database())
        AND classid=((hashtextextended($1,0)>>32)&4294967295)::oid
        AND objid=(hashtextextended($1,0)&4294967295)::oid`, `agent-privacy:${sourceSchema}`);
    if (fence.length !== 1) fail('exclusive_privacy_required');
    const registry = await tx.$queryRawUnsafe('SELECT to_regclass($1)::text AS name', REGISTRY);
    if (!registry[0]?.name) return 0;
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text', `evaluation-knowledge:${tenantId}`);
    await tx.$executeRawUnsafe(`UPDATE ${REGISTRY} SET state='retired',updated_at=clock_timestamp()
        WHERE tenant_id=$1::uuid AND source_schema=$2 AND state='active'`, tenantId, sourceSchema);
    let removed = 0;
    for (let slot = 0; slot < KNOWLEDGE_REPLICA_SLOTS; slot++) {
        const name = knowledgeReplicaSlotName(tenantId, slot);
        if (!(await tx.$queryRawUnsafe('SELECT 1 FROM pg_namespace WHERE nspname=$1', name)).length) continue;
        const marker = await tx.$queryRawUnsafe(`SELECT source_schema FROM "${name}".__eval_namespace WHERE tenant_id=$1::uuid`, tenantId);
        if (marker.length !== 1) fail('slot_owner_mismatch');
        if (marker[0].source_schema !== sourceSchema) continue;
        const copy = (await slotReplica(tx, tenantId, slot, sourceSchema))!;
        if (await dropUnused(tx, copy, true)) removed++;
    }
    return removed;
}
