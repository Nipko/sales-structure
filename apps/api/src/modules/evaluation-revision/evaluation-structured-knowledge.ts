import type { ServiceExecutionContext } from '../../common/types/execution-context';
import { persistenceDisabled } from '../../common/types/execution-context';
import { revisionHash } from './evaluation-revision';
import type { CaptureDatabase } from './evaluation-service-catalog-capture';

/** The complete eligible collections, not only the rows returned by one query.
 * These private factual inputs never replace the global dependency manifest. */
export interface StructuredKnowledgeCapture {
    version: 1;
    tenantId: string;
    sourceSchema: string;
    capturedAt: string;
    faqs: CapturedCollection;
    policies: CapturedCollection;
    integrityHash: string;
}
export interface CapturedCollection {
    state: 'present' | 'absent';
    rows: Array<Record<string, unknown>>;
}
export type StructuredKnowledgeKind = 'faqs' | 'policies';

// Only reader fields: no author identity, credentials or arbitrary metadata.
const DEFINITIONS = {
    faqs: {
        id: 'uuid', question: 'text', answer: 'text', category: 'text', tags: 'text[]',
        order_index: 'integer', is_published: 'boolean', views: 'integer', search_tsv: 'tsvector',
        created_at: 'timestamp', updated_at: 'timestamp',
    },
    policies: {
        id: 'uuid', type: 'text', title: 'text', content: 'text', version: 'integer',
        effective_from: 'timestamp', effective_to: 'timestamp', is_active: 'boolean',
        created_at: 'timestamp', updated_at: 'timestamp',
    },
} as const;
const ELIGIBLE = { faqs: 'is_published = true', policies: 'is_active = true' } as const;
const MAX_ROWS = 20_000;
const MAX_BYTES = 25 * 1024 * 1024;
const isRecord = (value: any): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const sourceSchemaValid = (schema: unknown): schema is string => typeof schema === 'string'
    && /^tenant_[a-z0-9_]{1,56}$/.test(schema) && !schema.startsWith('tenant_eval_');

export function sealStructuredKnowledgeCapture(body: Omit<StructuredKnowledgeCapture, 'integrityHash'>): StructuredKnowledgeCapture {
    // Dates/undefined must have the same representation after durable JSONB storage.
    const copy = JSON.parse(JSON.stringify(body));
    return { ...copy, integrityHash: revisionHash(copy) };
}

export function resolveStructuredKnowledgeCapture(input: StructuredKnowledgeCapture | undefined, tenantId: string): StructuredKnowledgeCapture {
    if (!isRecord(input) || input.version !== 1 || input.tenantId !== tenantId || !sourceSchemaValid(input.sourceSchema)
        || !Number.isFinite(Date.parse(input.capturedAt))
        || (['faqs', 'policies'] as const).some(kind => !isRecord(input[kind])
            || !['present', 'absent'].includes(input[kind].state) || !Array.isArray(input[kind].rows)
            || input[kind].rows.some(row => !isRecord(row))
            || (input[kind].state === 'absent' && input[kind].rows.length > 0)))
        throw new Error('evaluation_structured_knowledge_required');
    const { integrityHash, ...body } = input;
    if (revisionHash(body) !== integrityHash) throw new Error('evaluation_structured_knowledge_integrity_mismatch');
    return structuredClone(input);
}

/** One read-only MVCC transaction for both eligible collections and ownership. */
export async function captureStructuredKnowledge(database: CaptureDatabase, tenantId: string): Promise<StructuredKnowledgeCapture> {
    return database.readTransaction(async query => {
        const tenants = await query('SELECT schema_name FROM public.tenants WHERE id=$1::uuid', [tenantId]);
        const schema = tenants[0]?.schema_name;
        if (tenants.length !== 1 || !sourceSchemaValid(schema)) throw new Error('evaluation_structured_knowledge_tenant_unavailable');
        const relations = await query(`SELECT c.relname::text AS name, c.relkind::text AS kind
            FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname=$1 AND c.relname=ANY($2::text[])`, [schema, ['faqs', 'policies']]);
        const collections = {} as Record<StructuredKnowledgeKind, CapturedCollection>;
        for (const kind of ['faqs', 'policies'] as const) {
            const relation = relations.find(row => row.name === kind);
            if (!relation) { collections[kind] = { state: 'absent', rows: [] }; continue; }
            if (!['r', 'p'].includes(relation.kind)) throw new Error('evaluation_structured_knowledge_relation_unsupported');
            const columns = Object.keys(DEFINITIONS[kind]).map(column => column === 'search_tsv'
                ? 'search_tsv::text AS search_tsv' : `"${column}"`).join(', ');
            const rows = await query(`SELECT ${columns} FROM "${schema}"."${kind}"
                WHERE ${ELIGIBLE[kind]} ORDER BY id LIMIT $1`, [MAX_ROWS + 1]);
            if (rows.length > MAX_ROWS) throw new Error('evaluation_structured_knowledge_capacity_exceeded');
            collections[kind] = { state: 'present', rows };
        }
        const clock = await query('SELECT transaction_timestamp()::text AS captured_at');
        const body = { version: 1 as const, tenantId, sourceSchema: schema,
            capturedAt: new Date(clock[0]?.captured_at).toISOString(), ...collections };
        if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_BYTES) throw new Error('evaluation_structured_knowledge_capacity_exceeded');
        return sealStructuredKnowledgeCapture(body);
    });
}

/** Feed the canonical SQL predicates/ranking with captured rows. Parameterized
 * PostgreSQL recordsets retain tsvector, accent folding and NULL semantics. */
export function structuredKnowledgeRelation(input: StructuredKnowledgeCapture, tenantId: string,
    kind: StructuredKnowledgeKind, parameter: number, executionContext?: ServiceExecutionContext): { relation: string; json: string } {
    if (!persistenceDisabled(executionContext)) throw new Error('evaluation_structured_knowledge_readonly_required');
    if (!Number.isInteger(parameter) || parameter < 1) throw new Error('evaluation_structured_knowledge_parameter_invalid');
    const capture = resolveStructuredKnowledgeCapture(input, tenantId);
    if (capture[kind].state !== 'present') throw new Error(`evaluation_structured_knowledge_source_absent:${kind}`);
    const columns = Object.entries(DEFINITIONS[kind]).map(([name, type]) => `"${name}" ${type}`).join(', ');
    return { relation: `jsonb_to_recordset($${parameter}::jsonb) AS captured_${kind}(${columns})`, json: JSON.stringify(capture[kind].rows) };
}
