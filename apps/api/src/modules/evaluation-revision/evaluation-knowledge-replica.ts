import { createHash, randomUUID } from 'crypto';
import type { PrismaService } from '../prisma/prisma.service';
import { persistenceDisabled, type ServiceExecutionContext } from '../../common/types/execution-context';
import { revisionHash } from './evaluation-revision';
import { isolatedEvalNamespaceForPrisma, type EvalNamespaceLease } from '../simulation/isolated-eval-namespace';

// Explicit reader projections. Never clone source defaults, triggers, credentials,
// authors, provider bindings or arbitrary database expressions into this replica.
const TABLES = {
    knowledge_documents: {
        id: 'uuid', title: 'text', content_text: 'text', status: 'text', language: 'text', version: 'integer',
        source_url: 'text', audience: 'text', agent_ids: 'uuid[]', is_regulated: 'boolean', jurisdiction: 'text',
        authority: 'text', valid_from: 'date', valid_to: 'date', updated_at: 'timestamp',
    },
    knowledge_embeddings: {
        id: 'uuid', document_id: 'uuid', chunk_index: 'integer', chunk_text: 'text',
        embedding: 'public.vector(1536)', metadata: 'jsonb', search_tsv: 'tsvector',
    },
    faqs: { id: 'uuid', question: 'text', answer: 'text', is_published: 'boolean', updated_at: 'timestamp' },
    policies: { id: 'uuid', title: 'text', content: 'text', type: 'text', version: 'integer', is_active: 'boolean',
        effective_from: 'timestamp', effective_to: 'timestamp', updated_at: 'timestamp' },
    companies: { id: 'uuid', name: 'text', about: 'text', address: 'text', city: 'text', country: 'text',
        phone: 'text', email: 'text', website: 'text', is_primary: 'boolean', updated_at: 'timestamp' },
    knowledge_conflict_cases: { id: 'uuid', source_a: 'jsonb', source_b: 'jsonb', quote_a: 'text', quote_b: 'text',
        document_a: 'uuid', document_b: 'uuid', updated_at: 'timestamptz' },
    knowledge_conflict_decisions: { id: 'uuid', case_id: 'uuid', revision: 'integer', decision: 'text', scope: 'jsonb' },
} as const;
type Table = keyof typeof TABLES;
type Collection = { state: 'present' | 'absent'; rows: number; hash: string };
type Transaction = { $queryRawUnsafe(sql: string, ...params: any[]): Promise<any[]>; $executeRawUnsafe(sql: string, ...params: any[]): Promise<any> };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const NAMESPACE = /^tenant_eval_[a-f0-9]{8}_[a-f0-9]{24}$/;
const SOURCE = /^tenant_[a-z0-9_]{1,56}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_ROWS = 100_000;
const MAX_BYTES = 512 * 1024 * 1024;
/** Technical reservations, independent of subscription entitlements. Fixed slots
 * enforce the aggregate bound across processes without an MVCC count race. */
export const KNOWLEDGE_REPLICA_SLOTS = 4;
export const KNOWLEDGE_REPLICA_SLOT_BYTES = MAX_BYTES;
export function knowledgeReplicaSlotName(tenantId: string, slot: number): string {
    if (!UUID.test(tenantId) || !Number.isInteger(slot) || slot < 0 || slot >= KNOWLEDGE_REPLICA_SLOTS)
        throw new EvaluationKnowledgeUnavailable('evaluation_knowledge_allocation_invalid');
    const suffix = createHash('sha256').update(`knowledge-replica:v1:${tenantId}:${slot}`).digest('hex').slice(0, 24);
    return `tenant_eval_${tenantId.replace(/-/g, '').slice(0, 8)}_${suffix}`;
}
export interface KnowledgeReplicaUsage { token: string; agentId: string }
export interface KnowledgeReplicaAllocation { slot: number; sourceRevision: string; usage: KnowledgeReplicaUsage }
const COMPATIBLE_TYPES: Readonly<Record<string, readonly string[]>> = {
    text: ['text', 'varchar'], uuid: ['uuid'], 'uuid[]': ['_uuid'], integer: ['int4'], boolean: ['bool'],
    jsonb: ['jsonb'], tsvector: ['tsvector'], date: ['date'],
    timestamp: ['timestamp', 'timestamptz'], timestamptz: ['timestamp', 'timestamptz'], 'public.vector(1536)': ['vector'],
};

/** Server-only reference. The corpus stays in PostgreSQL, never in snapshot JSON
 * or a vector-sized tool argument. A historical reference is not live authority. */
export interface EvaluationKnowledgeReplica {
    version: 1;
    kind: 'knowledge_replica';
    lease: EvalNamespaceLease;
    capturedAt: string;
    keywordSearch: 'available' | 'absent';
    collections: Record<Table, Collection>;
    integrityHash: string;
    management?: { slot: number; sourceRevision: string; reservedBytes: number };
    /** Per-snapshot lease; excluded from the shared corpus seal, included in the
     * outer AgentEvaluationSnapshot seal and checked against the owned DB row. */
    usage?: KnowledgeReplicaUsage;
}

export class EvaluationKnowledgeUnavailable extends Error {
    constructor(code = 'evaluation_knowledge_unavailable') { super(code); this.name = 'EvaluationKnowledgeUnavailable'; }
}

export function resolveKnowledgeReplica(input: EvaluationKnowledgeReplica | undefined, tenantId: string): EvaluationKnowledgeReplica {
    if (!input || input.version !== 1 || input.kind !== 'knowledge_replica' || input.lease?.tenantId !== tenantId
        || !NAMESPACE.test(input.lease.schemaName) || !UUID.test(input.lease.token)
        || !SOURCE.test(input.lease.sourceSchema) || input.lease.sourceSchema.startsWith('tenant_eval_')
        || !Number.isFinite(Date.parse(input.capturedAt)) || !Number.isFinite(Date.parse(input.lease.expiresAt))
        || !['available', 'absent'].includes(input.keywordSearch)
        || (input.management && (!Number.isInteger(input.management.slot) || input.management.slot < 0
            || input.management.slot >= KNOWLEDGE_REPLICA_SLOTS || !HASH.test(input.management.sourceRevision)
            || input.management.reservedBytes !== KNOWLEDGE_REPLICA_SLOT_BYTES))
        || (input.usage && (!input.management || !UUID.test(input.usage.token) || typeof input.usage.agentId !== 'string' || !input.usage.agentId))
        || !Array.isArray(input.lease.tables)
        || (Object.keys(TABLES) as Table[]).some(table => {
            const value = input.collections?.[table];
            return !value || !['present', 'absent'].includes(value.state) || !Number.isSafeInteger(value.rows)
                || value.rows < 0 || !HASH.test(value.hash) || (value.state === 'absent' && value.rows !== 0)
                || input.lease.tables.includes(table) !== (value.state === 'present');
        }) || input.lease.tables.some(table => !(table in TABLES)))
        throw new EvaluationKnowledgeUnavailable('evaluation_knowledge_replica_required');
    const { integrityHash, usage, ...body } = input;
    if (revisionHash(body) !== integrityHash) throw new EvaluationKnowledgeUnavailable('evaluation_knowledge_integrity_mismatch');
    return structuredClone(input);
}

async function signature(tx: Transaction, schema: string, table: Table): Promise<Collection> {
    // Hash rows in the database: vectors and content never make a round trip
    // through Node merely to prove that the read replica is unchanged.
    const rows = await tx.$queryRawUnsafe(`SELECT COUNT(*)::integer AS rows,
        encode(sha256(convert_to(COALESCE(string_agg(row_hash,',' ORDER BY id),''),'UTF8')),'hex') AS hash
        FROM (SELECT id::text AS id,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') AS row_hash
            FROM "${schema}"."${table}" r) signed_rows`);
    return { state: 'present', rows: rows[0].rows, hash: rows[0].hash };
}

/** One MVCC source revision, copied server-side into a distinct owned namespace.
 * The only writes are to the new replica. No historical customer conversations,
 * accounts, caches, model requests or source-table repairs are involved. */
export async function captureKnowledgeReplica(prisma: PrismaService, tenantId: string, ttlMs = 3600_000,
    allocation?: KnowledgeReplicaAllocation): Promise<EvaluationKnowledgeReplica> {
    if (!UUID.test(tenantId) || !Number.isInteger(ttlMs) || ttlMs < 1000 || ttlMs > 3600_000)
        throw new EvaluationKnowledgeUnavailable('evaluation_knowledge_capture_scope_invalid');
    if (allocation && (!HASH.test(allocation.sourceRevision) || !UUID.test(allocation.usage?.token) || !UUID.test(allocation.usage?.agentId)))
        throw new EvaluationKnowledgeUnavailable('evaluation_knowledge_allocation_invalid');
    const schema = allocation ? knowledgeReplicaSlotName(tenantId, allocation.slot)
        : `tenant_eval_${tenantId.replace(/-/g, '').slice(0, 8)}_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const token = randomUUID();
    let namespaceCreated = false;
    try {
        return await prisma.$transaction(async (tx: Transaction) => {
            await tx.$executeRawUnsafe('SET LOCAL search_path TO pg_catalog, public');
            await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'UTC'");
            const owners = await tx.$queryRawUnsafe('SELECT schema_name FROM public.tenants WHERE id=$1::uuid', tenantId);
            const sourceSchema = owners[0]?.schema_name;
            if (owners.length !== 1 || !SOURCE.test(sourceSchema) || sourceSchema.startsWith('tenant_eval_'))
                throw new EvaluationKnowledgeUnavailable('evaluation_knowledge_tenant_unavailable');
            const relations = await tx.$queryRawUnsafe(`SELECT c.relname::text AS name,c.relkind::text AS kind
                FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname=$1 AND c.relname=ANY($2::text[])`, sourceSchema, Object.keys(TABLES));
            if (relations.some(row => !['r', 'p'].includes(row.kind)))
                throw new EvaluationKnowledgeUnavailable('evaluation_knowledge_relation_unsupported');
            const sourceColumns = await tx.$queryRawUnsafe(`SELECT c.relname::text AS table_name,a.attname::text AS name,
                t.typname::text AS type,tn.nspname::text AS type_schema,
                (a.attcollation=0 OR a.attcollation='pg_catalog.default'::regcollation) AS default_collation
                FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
                JOIN pg_type t ON t.oid=a.atttypid JOIN pg_namespace tn ON tn.oid=t.typnamespace
                WHERE n.nspname=$1 AND c.relname=ANY($2::text[]) AND a.attnum>0 AND NOT a.attisdropped`, sourceSchema, Object.keys(TABLES));
            for (const table of Object.keys(TABLES) as Table[]) {
                if (!relations.some(row => row.name === table)) continue;
                for (const [name, type] of Object.entries(TABLES[table])) {
                    const column = sourceColumns.find(row => row.table_name === table && row.name === name);
                    if (!column && ((table === 'companies' && name !== 'id') || (table === 'knowledge_embeddings' && name === 'search_tsv'))) continue;
                    if (!column || column.type_schema !== (type.startsWith('public.vector') ? 'public' : 'pg_catalog')
                        || !COMPATIBLE_TYPES[type]?.includes(column.type) || column.default_collation !== true)
                        throw new EvaluationKnowledgeUnavailable('evaluation_knowledge_column_unsupported');
                }
            }
            const keywordSearch = sourceColumns.some(row => row.table_name === 'knowledge_embeddings' && row.name === 'search_tsv')
                ? 'available' as const : 'absent' as const;
            if (relations.some(row => row.name === 'knowledge_embeddings')) {
                const vector = await tx.$queryRawUnsafe(`SELECT 1 FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
                    WHERE e.extname='vector' AND n.nspname='public'`);
                if (vector.length !== 1) throw new EvaluationKnowledgeUnavailable('evaluation_knowledge_vector_unavailable');
            }
            await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
            namespaceCreated = true;
            await tx.$executeRawUnsafe(`CREATE TABLE "${schema}".__eval_namespace
                (tenant_id uuid NOT NULL,owner_token uuid NOT NULL,source_schema text NOT NULL,expires_at timestamptz NOT NULL)`);
            const clock = await tx.$queryRawUnsafe(`INSERT INTO "${schema}".__eval_namespace
                VALUES($1::uuid,$2::uuid,$3,clock_timestamp()+$4::integer*interval '1 millisecond')
                RETURNING expires_at,transaction_timestamp() AS captured_at`, tenantId, token, sourceSchema, ttlMs);
            const collections = {} as Record<Table, Collection>;
            let copiedBytes = 0;
            for (const table of Object.keys(TABLES) as Table[]) {
                if (!relations.some(row => row.name === table)) {
                    collections[table] = { state: 'absent', rows: 0, hash: revisionHash(null) }; continue;
                }
                const columns = Object.entries(TABLES[table]);
                const copiedType = (name: string, type: string) => {
                    if (type !== 'timestamp' && type !== 'timestamptz') return type;
                    // A timestamp without a zone and an instant have different
                    // JSON/Date semantics in conflict hashes. Preserve the
                    // reviewed source type instead of converting between them.
                    return sourceColumns.find(row => row.table_name === table && row.name === name)?.type || type;
                };
                await tx.$executeRawUnsafe(`CREATE TABLE "${schema}"."${table}"
                    (${columns.map(([name, type]) => `"${name}" ${copiedType(name, type)}`).join(',')}, PRIMARY KEY(id))`);
                let predicate = table === 'knowledge_documents' ? "s.status='ready'"
                    : table === 'faqs' ? 's.is_published=true' : table === 'policies' ? 's.is_active=true' : 'true';
                if (table === 'knowledge_embeddings') predicate = collections.knowledge_documents.state === 'present'
                    ? `EXISTS(SELECT 1 FROM "${schema}".knowledge_documents d WHERE d.id=s.document_id)` : 'false';
                if (table === 'knowledge_conflict_cases') predicate = collections.knowledge_documents.state === 'present'
                    ? `EXISTS(SELECT 1 FROM "${schema}".knowledge_documents d WHERE d.id=s.document_a OR d.id=s.document_b)` : 'false';
                if (table === 'knowledge_conflict_decisions') predicate = collections.knowledge_conflict_cases.state === 'present'
                    ? `EXISTS(SELECT 1 FROM "${schema}".knowledge_conflict_cases c WHERE c.id=s.case_id)` : 'false';
                // Legacy companies may lack is_primary; JSON projection preserves
                // its absent/null meaning without selecting an absent SQL column.
                const projection = table === 'companies'
                    ? `SELECT projected.* FROM "${sourceSchema}"."${table}" s CROSS JOIN LATERAL
                        jsonb_populate_record(NULL::"${schema}"."${table}",to_jsonb(s)) projected WHERE ${predicate}`
                    : `SELECT ${columns.map(([name]) => table === 'knowledge_embeddings' && name === 'search_tsv' && keywordSearch === 'absent'
                        ? 'NULL::tsvector AS search_tsv' : `s."${name}"`).join(',')} FROM "${sourceSchema}"."${table}" s WHERE ${predicate}`;
                const size = await tx.$queryRawUnsafe(`SELECT COUNT(*)::integer AS rows,COALESCE(SUM(octet_length(to_jsonb(r)::text)),0)::text AS bytes
                    FROM (${projection} LIMIT $1) r`, MAX_ROWS + 1);
                copiedBytes += Number(size[0].bytes);
                if (size[0].rows > MAX_ROWS || copiedBytes > MAX_BYTES)
                    throw new EvaluationKnowledgeUnavailable('evaluation_knowledge_capacity_exceeded');
                await tx.$executeRawUnsafe(`INSERT INTO "${schema}"."${table}" ${projection}`);
                collections[table] = await signature(tx, schema, table);
            }
            if (collections.knowledge_embeddings.state === 'present') {
                await tx.$executeRawUnsafe(`CREATE INDEX ON "${schema}".knowledge_embeddings(document_id)`);
                await tx.$executeRawUnsafe(`CREATE INDEX ON "${schema}".knowledge_embeddings USING gin(search_tsv)`);
            }
            if (collections.knowledge_conflict_decisions.state === 'present')
                await tx.$executeRawUnsafe(`CREATE INDEX ON "${schema}".knowledge_conflict_decisions(case_id,revision DESC)`);
            const body = { version: 1 as const, kind: 'knowledge_replica' as const,
                lease: { tenantId, sourceSchema, schemaName: schema, token,
                    expiresAt: new Date(clock[0].expires_at).toISOString(), tables: (Object.keys(TABLES) as Table[]).filter(table => collections[table].state === 'present') },
                capturedAt: new Date(clock[0].captured_at).toISOString(), keywordSearch, collections,
                ...(allocation ? { management: { slot: allocation.slot, sourceRevision: allocation.sourceRevision, reservedBytes: KNOWLEDGE_REPLICA_SLOT_BYTES } } : {}) };
            const replica = { ...body, integrityHash: revisionHash(body) };
            await tx.$executeRawUnsafe(`CREATE TABLE "${schema}".__eval_knowledge_capture(integrity_hash text NOT NULL,descriptor jsonb NOT NULL,logical_bytes bigint NOT NULL)`);
            await tx.$executeRawUnsafe(`INSERT INTO "${schema}".__eval_knowledge_capture VALUES($1,$2::jsonb,$3::bigint)`,
                replica.integrityHash, JSON.stringify(replica), copiedBytes);
            if (allocation) {
                await tx.$executeRawUnsafe(`CREATE TABLE "${schema}".__eval_knowledge_usages
                    (token uuid PRIMARY KEY,agent_id uuid NOT NULL,expires_at timestamptz NOT NULL)`);
                await tx.$executeRawUnsafe(`INSERT INTO "${schema}".__eval_knowledge_usages VALUES($1::uuid,$2::uuid,$3::timestamptz)`,
                    allocation.usage.token, allocation.usage.agentId, replica.lease.expiresAt);
            }
            return allocation ? { ...replica, usage: { ...allocation.usage } } : replica;
        }, { isolationLevel: 'RepeatableRead', timeout: 60_000 });
    } catch (error) {
        if (error instanceof EvaluationKnowledgeUnavailable) throw error;
        if (allocation && !namespaceCreated && ['42P06', '23505'].includes(String((error as any)?.meta?.code)))
            throw new EvaluationKnowledgeUnavailable('evaluation_knowledge_slot_busy');
        throw new EvaluationKnowledgeUnavailable('evaluation_knowledge_capture_failed');
    }
}

/** A full integrity/lease read in one read-only MVCC transaction. The model and
 * domain writers cannot supply this reference. Global source/permission guards
 * must still be checked by the caller; this copy grants no future entitlement. */
export async function knowledgeReplicaSchema(prisma: PrismaService, input: EvaluationKnowledgeReplica, tenantId: string,
    executionContext?: ServiceExecutionContext): Promise<string> {
    if (!persistenceDisabled(executionContext)) throw new EvaluationKnowledgeUnavailable('evaluation_knowledge_readonly_required');
    const replica = resolveKnowledgeReplica(input, tenantId), schema = replica.lease.schemaName;
    try {
        await prisma.$transaction(async (tx: Transaction) => {
            await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
            await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'UTC'");
            const owner = await tx.$queryRawUnsafe(`SELECT 1 FROM "${schema}".__eval_namespace
                WHERE tenant_id=$1::uuid AND owner_token=$2::uuid AND source_schema=$3 AND expires_at>clock_timestamp()
                    AND EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=$1::uuid AND t.schema_name=$3)`,
                tenantId, replica.lease.token, replica.lease.sourceSchema);
            const seal = await tx.$queryRawUnsafe(`SELECT integrity_hash FROM "${schema}".__eval_knowledge_capture`);
            if (owner.length !== 1 || seal.length !== 1 || seal[0].integrity_hash !== replica.integrityHash)
                throw new EvaluationKnowledgeUnavailable('evaluation_knowledge_lease_lost');
            if (replica.management) {
                if (!replica.usage) throw new EvaluationKnowledgeUnavailable('evaluation_knowledge_usage_required');
                const usages = await tx.$queryRawUnsafe(`SELECT 1 FROM "${schema}".__eval_knowledge_usages
                    WHERE token=$1::uuid AND agent_id=$2::uuid AND expires_at>clock_timestamp()`, replica.usage.token, replica.usage.agentId);
                if (usages.length !== 1) throw new EvaluationKnowledgeUnavailable('evaluation_knowledge_usage_lost');
            }
            const relations = await tx.$queryRawUnsafe(`SELECT c.relname::text AS name,c.relkind::text AS kind
                FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname=$1 AND c.relname=ANY($2::text[])`, schema, Object.keys(TABLES));
            for (const table of Object.keys(TABLES) as Table[]) {
                const relation = relations.find(row => row.name === table), expected = replica.collections[table];
                if (!relation && expected.state === 'absent') continue;
                if (!relation || relation.kind !== 'r' || expected.state !== 'present'
                    || revisionHash(await signature(tx, schema, table)) !== revisionHash(expected))
                    throw new EvaluationKnowledgeUnavailable('evaluation_knowledge_content_changed');
            }
        }, { isolationLevel: 'RepeatableRead', timeout: 30_000 });
        return schema;
    } catch (error) {
        if (error instanceof EvaluationKnowledgeUnavailable) throw error;
        throw new EvaluationKnowledgeUnavailable('evaluation_knowledge_read_failed');
    }
}

export async function disposeKnowledgeReplica(prisma: PrismaService, input: EvaluationKnowledgeReplica): Promise<void> {
    const replica = resolveKnowledgeReplica(input, input?.lease?.tenantId);
    await isolatedEvalNamespaceForPrisma(prisma).dispose(replica.lease);
}
