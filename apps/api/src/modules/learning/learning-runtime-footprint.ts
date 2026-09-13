import { LLMSourceAuthorityUnavailable } from '../ai/interfaces/llm-source-authority';
import { learningSnapshotHash, type RuntimeLearningExample } from './learning-contracts';
import { assertLearningInboxSource, type LearningSourceQuery } from './learning-inbox-source';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
type Scope = Readonly<{ tenantId: string; agentId: string }>;
export interface RuntimeLearningFootprintEntry {
    readonly releaseId: string;
    readonly releaseHash: string;
    readonly exampleId: string;
    readonly projectionHash: string;
}
/** Private server provenance, never an HTTP/job authority. Hashes detect changed
 * projections; they are not signatures and do not authenticate a caller. */
export interface RuntimeLearningFootprint extends Scope {
    readonly version: 1;
    readonly entries: readonly RuntimeLearningFootprintEntry[];
}
export type RuntimeLearningFootprintOptions =
    | { mode: 'readonly'; allowCandidate?: boolean }
    | { mode: 'admission'; allowCandidate?: false };
const unavailable = (): never => { throw new LLMSourceAuthorityUnavailable(); };
const validScope = (scope: Scope) => !!scope && UUID.test(scope.tenantId) && UUID.test(scope.agentId);

/** Preserve the hash of the whole supplied projection, including unexpected
 * properties: projecting only known fields here would hide tampering. */
export function createRuntimeLearningFootprint(tenantId: string, agentId: string,
    examples: readonly RuntimeLearningExample[]): RuntimeLearningFootprint {
    if (!validScope({ tenantId, agentId }) || !Array.isArray(examples)) return unavailable();
    const entries = new Map<string, RuntimeLearningFootprintEntry>();
    for (const example of examples) {
        if (!example || !UUID.test(example.id) || !UUID.test(example.releaseId) || !HASH.test(example.releaseHash)
            || example.authority !== 'style_only' || typeof example.situation !== 'string'
            || typeof example.responsePattern !== 'string' || typeof example.rationale !== 'string'
            || !Array.isArray(example.factsRequired) || example.factsRequired.some((fact: unknown) => typeof fact !== 'string')) return unavailable();
        const entry = Object.freeze({ releaseId: example.releaseId, releaseHash: example.releaseHash,
            exampleId: example.id, projectionHash: learningSnapshotHash(example) });
        const key = `${entry.releaseId}:${entry.exampleId}`;
        const prior = entries.get(key);
        if (prior && learningSnapshotHash(prior) !== learningSnapshotHash(entry)) return unavailable();
        entries.set(key, entry);
    }
    return Object.freeze({ version: 1, tenantId, agentId,
        entries: Object.freeze([...entries.values()].sort((a,b) => `${a.releaseId}:${a.exampleId}`.localeCompare(`${b.releaseId}:${b.exampleId}`))) });
}

/** Shared release checks retain every train AND holdout source, plus every live
 * example in the release. No schema resolution, transaction or provider here. */
export async function assertLearningReleaseSourcesAvailable(query: LearningSourceQuery, release: any, lock = false): Promise<void> {
    if (!release || !Array.isArray(release.snapshot?.examples) || !Array.isArray(release.snapshot?.heldout)
        || !Array.isArray(release.example_ids)) return unavailable();
    const sourceIds = [...new Set<string>([...release.snapshot.examples.map((e: any) => e.source_id),
        ...release.snapshot.heldout.map((source: any) => source.source_id)])].sort();
    if (sourceIds.some(id => !UUID.test(id)) || release.example_ids.some((id: string) => !UUID.test(id))) return unavailable();
    const sources = await query<any[]>(`SELECT s.* FROM learning_sources s WHERE id=ANY($1::uuid[])
        AND status='active' AND NOT EXISTS(SELECT 1 FROM customer_memory_erasure d WHERE d.contact_id=s.source_contact_id)
        ORDER BY s.id ${lock ? 'FOR SHARE OF s' : ''}`, [sourceIds]);
    if (sources.length !== sourceIds.length) return unavailable();
    for (const source of sources) {
        if (release.agent_id && source.agent_id !== release.agent_id) return unavailable();
        await assertLearningInboxSource(query, source, lock);
    }
    // Explicit columns avoid Prisma attempting to deserialize the vector column.
    const examples = await query<any[]>(`SELECT id,agent_id FROM learning_examples
        WHERE id=ANY($1::uuid[]) AND status NOT IN ('retired','rejected')
        ORDER BY id ${lock ? 'FOR SHARE' : ''}`, [release.example_ids]);
    if (examples.length !== release.example_ids.length
        || (release.agent_id && examples.some(example => example.agent_id !== release.agent_id))) return unavailable();
}

/** Caller owns the same tenant query throughout. Readonly adds NO locks, even
 * for model callbacks. Admission acquires privacy S on this same query before
 * its reads. Call before other locks, or after the caller's own privacy fence
 * (and tenant/agent authority locks), then take stable release/source/
 * projection locks. Nothing acquired here may span an external invocation. */
export async function assertRuntimeLearningFootprint(query: LearningSourceQuery, schema: string, expected: Scope,
    footprint: RuntimeLearningFootprint, options: RuntimeLearningFootprintOptions): Promise<void> {
    if (!validScope(expected) || !/^[a-z][a-z0-9_]*$/.test(schema) || !footprint || footprint.version !== 1
        || footprint.tenantId !== expected.tenantId || footprint.agentId !== expected.agentId
        || !Array.isArray(footprint.entries) || !options || !['readonly','admission'].includes(options.mode)
        || (options.mode === 'admission' && options.allowCandidate)) return unavailable();
    const entries = footprint.entries.map(entry => {
        if (!entry || !UUID.test(entry.releaseId) || !UUID.test(entry.exampleId)
            || !HASH.test(entry.releaseHash) || !HASH.test(entry.projectionHash)) return unavailable();
        return { ...entry };
    });
    if (new Set(entries.map(entry => `${entry.releaseId}:${entry.exampleId}`)).size !== entries.length) return unavailable();
    const lock = options.mode === 'admission';
    if (lock) await query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text', [`agent-privacy:${schema}`]);
    // Scope binding is checked even for an explicit empty footprint. An empty
    // footprint asserts no learning use; it never grants operational authority.
    const binding = await query<any[]>(`SELECT id FROM public.tenants
        WHERE id=$1::uuid AND schema_name=$2 AND current_schema()=$2 ${lock ? 'FOR SHARE' : ''}`, [expected.tenantId, schema]);
    if (binding.length !== 1) return unavailable();
    const releases: any[] = [];
    for (const releaseId of [...new Set(entries.map(entry => entry.releaseId))].sort()) {
        const [release] = await query<any[]>(`SELECT * FROM learning_releases WHERE id=$1::uuid AND agent_id=$2::uuid
            ${lock ? 'FOR SHARE' : ''}`, [releaseId, expected.agentId]);
        if (!release || !(release.status === 'published' || (options.mode === 'readonly' && options.allowCandidate && release.status === 'candidate'))
            || learningSnapshotHash(release.snapshot) !== release.snapshot_hash) return unavailable();
        releases.push(release);
    }
    // Lock all releases first in stable order, before reaching their sources.
    // Rollback only writes the release row and must wait until admission commits.
    for (const release of releases) {
        await assertLearningReleaseSourcesAvailable(query, release, lock);
        for (const entry of entries.filter(item => item.releaseId === release.id)) {
            if (entry.releaseHash !== release.snapshot_hash) return unavailable();
            const frozen = release.snapshot.examples.find((example: any) => example.id === entry.exampleId
                && ['brand_style','operational_pattern'].includes(example.kind));
            if (!frozen) return unavailable();
            const projection: RuntimeLearningExample = { id: frozen.id, releaseId: release.id, releaseHash: release.snapshot_hash,
                situation: frozen.intent, responsePattern: frozen.response_pattern, rationale: frozen.rationale,
                factsRequired: frozen.facts_required, authority: 'style_only' };
            if (learningSnapshotHash(projection) !== entry.projectionHash) return unavailable();
        }
    }
}
