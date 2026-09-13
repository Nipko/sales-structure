import { createHash } from 'crypto';
import { LLMSourceAuthorityUnavailable } from '../ai/interfaces/llm-source-authority';
import { learningSnapshotHash, type RuntimeLearningExample } from './learning-contracts';
import { assertRuntimeLearningFootprint, createRuntimeLearningFootprint } from './learning-runtime-footprint';

const tenantId = '10000000-0000-4000-8000-000000000001';
const agentId = '20000000-0000-4000-8000-000000000002';
const schema = 'tenant_learning_footprint_unit';
const releaseId = '30000000-0000-4000-8000-000000000003';
const exampleId = '40000000-0000-4000-8000-000000000004';
const foreignId = '50000000-0000-4000-8000-000000000005';

const example = (): RuntimeLearningExample => ({
    id: exampleId,
    releaseId,
    releaseHash: 'a'.repeat(64),
    situation: 'support',
    responsePattern: 'Acknowledge the customer and ask one useful question.',
    rationale: 'Keep the next step clear.',
    factsRequired: ['verified order status'],
    authority: 'style_only',
});

describe('runtime learning footprint serialization', () => {
    it('retains only bound identifiers and the hash of the complete style projection', () => {
        const input = example();
        // Spell out the wire projection independently: omitting rationale, facts
        // or authority would make materially different examples share a receipt.
        const expectedProjectionHash = createHash('sha256').update(JSON.stringify({
            authority: input.authority,
            factsRequired: input.factsRequired,
            id: input.id,
            rationale: input.rationale,
            releaseHash: input.releaseHash,
            releaseId: input.releaseId,
            responsePattern: input.responsePattern,
            situation: input.situation,
        })).digest('hex');

        expect(createRuntimeLearningFootprint(tenantId, agentId, [input])).toEqual({
            version: 1,
            tenantId,
            agentId,
            entries: [{ releaseId, releaseHash: input.releaseHash, exampleId, projectionHash: expectedProjectionHash }],
        });
        const serialized = JSON.stringify(createRuntimeLearningFootprint(tenantId, agentId, [input]));
        for (const raw of [input.responsePattern, input.situation, input.rationale, ...input.factsRequired]) {
            expect(serialized).not.toContain(raw);
        }
    });

    it('is stable across object key insertion order and deduplicates identical projections', () => {
        const input = example();
        const reordered = Object.fromEntries(Object.entries(input).reverse()) as unknown as RuntimeLearningExample;
        const expected = createRuntimeLearningFootprint(tenantId, agentId, [input]);

        expect(createRuntimeLearningFootprint(tenantId, agentId, [reordered])).toEqual(expected);
        expect(createRuntimeLearningFootprint(tenantId, agentId, [input, reordered, structuredClone(input)])).toEqual(expected);
    });

    it.each([
        ['response pattern', { responsePattern: 'A different response.' }],
        ['rationale', { rationale: 'A different reason.' }],
        ['required facts', { factsRequired: ['verified appointment status'] }],
        ['situation', { situation: 'booking' }],
        ['release hash', { releaseHash: 'b'.repeat(64) }],
    ])('rejects conflicting %s for the same release/example identity', (_field, change) => {
        expect(() => createRuntimeLearningFootprint(tenantId, agentId, [example(), { ...example(), ...change as object }]))
            .toThrow(LLMSourceAuthorityUnavailable);
    });

    it('keeps the same example in two distinct immutable releases as separate provenance', () => {
        const first = example();
        const second = { ...first, releaseId: foreignId, releaseHash: 'b'.repeat(64) };
        const footprint = createRuntimeLearningFootprint(tenantId, agentId, [first, second]);
        expect(footprint.entries).toHaveLength(2);
        expect(new Set(footprint.entries.map(entry => entry.releaseId))).toEqual(new Set([releaseId, foreignId]));
    });

    it('captures provenance without retaining mutable references to the input', () => {
        const input = example();
        const footprint = createRuntimeLearningFootprint(tenantId, agentId, [input]);
        const before = JSON.stringify(footprint);
        input.responsePattern = 'Changed after queue admission.';
        input.factsRequired.push('another fact');
        input.releaseHash = 'c'.repeat(64);
        expect(JSON.stringify(footprint)).toBe(before);
    });

    it.each([
        ['tenant', () => createRuntimeLearningFootprint('not-a-tenant', agentId, [example()])],
        ['agent', () => createRuntimeLearningFootprint(tenantId, 'not-an-agent', [example()])],
        ['release', () => createRuntimeLearningFootprint(tenantId, agentId, [{ ...example(), releaseId: 'not-a-release' }])],
        ['example', () => createRuntimeLearningFootprint(tenantId, agentId, [{ ...example(), id: 'not-an-example' }])],
        ['hash length', () => createRuntimeLearningFootprint(tenantId, agentId, [{ ...example(), releaseHash: 'abc' }])],
        ['hash alphabet', () => createRuntimeLearningFootprint(tenantId, agentId, [{ ...example(), releaseHash: 'z'.repeat(64) }])],
    ])('rejects an invalid %s before serializing a durable reference', (_field, create) => {
        expect(create as () => unknown).toThrow(LLMSourceAuthorityUnavailable);
    });
});

describe('runtime learning footprint tenant boundary', () => {
    it.each(['tenant', 'agent'] as const)('rejects a footprint for another %s even when no examples were selected', async field => {
        const query = jest.fn(async () => { throw new Error('foreign footprint reached the database'); });
        const footprint = { ...createRuntimeLearningFootprint(tenantId, agentId, []),
            [field === 'tenant' ? 'tenantId' : 'agentId']: foreignId };
        await expect(assertRuntimeLearningFootprint(query, schema, { tenantId, agentId }, footprint, { mode: 'readonly' }))
            .rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
        expect(query).not.toHaveBeenCalled();
    });
});

// A small record-backed port for unit boundary checks. The PostgreSQL suite
// separately proves locks, retirement races and real Inbox source lineage.
function fixture(status = 'published') {
    const sourceId = '60000000-0000-4000-8000-000000000006';
    const heldoutId = '70000000-0000-4000-8000-000000000007';
    const projected = example();
    const snapshot = {
        examples: [{ id: exampleId, source_id: sourceId, kind: 'brand_style', intent: projected.situation,
            response_pattern: projected.responsePattern, rationale: projected.rationale, facts_required: projected.factsRequired }],
        heldout: [{ source_id: heldoutId }],
    };
    const release = { id: releaseId, agent_id: agentId, status, snapshot, snapshot_hash: learningSnapshotHash(snapshot), example_ids: [exampleId] };
    projected.releaseHash = release.snapshot_hash;
    const records = {
        currentSchema: schema,
        release,
        sources: [sourceId, heldoutId].map(id => ({ id, agent_id: agentId, source_kind: 'file', status: 'active' })),
        examples: [{ id: exampleId, agent_id: agentId, status: 'approved' }],
    };
    const query = jest.fn(async (sql: string, params: any[] = []): Promise<any[]> => {
        if (sql.includes('pg_advisory_xact_lock_shared')) return [];
        if (sql.includes('FROM public.tenants')) {
            return params[0] === tenantId && params[1] === schema && records.currentSchema === schema ? [{ id: tenantId }] : [];
        }
        if (sql.includes('FROM learning_releases')) {
            return params[0] === records.release.id && params[1] === records.release.agent_id ? [records.release] : [];
        }
        if (sql.includes('FROM learning_sources')) {
            return records.sources.filter(source => params[0].includes(source.id) && source.status === 'active');
        }
        if (sql.includes('FROM learning_examples')) {
            return records.examples.filter(entry => params[0].includes(entry.id) && !['retired', 'rejected'].includes(entry.status));
        }
        throw new Error(`Unexpected footprint query: ${sql}`);
    });
    return { records, query, projected, footprint: createRuntimeLearningFootprint(tenantId, agentId, [projected]) };
}

describe('runtime learning footprint admission', () => {
    it('checks the tenant/query schema binding even for an explicit empty footprint', async () => {
        const { records, query } = fixture();
        const footprint = createRuntimeLearningFootprint(tenantId, agentId, []);
        await expect(assertRuntimeLearningFootprint(query as any, schema, { tenantId, agentId }, footprint, { mode: 'readonly' }))
            .resolves.toBeUndefined();
        expect(query).toHaveBeenCalledTimes(1);
        expect(query.mock.calls[0][1]).toEqual([tenantId, schema]);

        records.currentSchema = 'tenant_another_connection';
        await expect(assertRuntimeLearningFootprint(query as any, schema, { tenantId, agentId }, footprint, { mode: 'readonly' }))
            .rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
    });

    it('admits a published exact projection with all of its source records available', async () => {
        const { query, footprint } = fixture();
        await expect(assertRuntimeLearningFootprint(query as any, schema, { tenantId, agentId }, footprint, { mode: 'admission' }))
            .resolves.toBeUndefined();
    });

    it('allows a candidate only for an explicitly permitted readonly check', async () => {
        const { query, footprint } = fixture('candidate');
        await expect(assertRuntimeLearningFootprint(query as any, schema, { tenantId, agentId }, footprint, { mode: 'readonly' }))
            .rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
        await expect(assertRuntimeLearningFootprint(query as any, schema, { tenantId, agentId }, footprint,
            { mode: 'readonly', allowCandidate: true })).resolves.toBeUndefined();
    });

    it.each([false, true])('never admits a candidate with allowCandidate=%s', async allowCandidate => {
        const { query, footprint } = fixture('candidate');
        await expect(assertRuntimeLearningFootprint(query as any, schema, { tenantId, agentId }, footprint,
            { mode: 'admission', allowCandidate } as any)).rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
    });

    it.each(['retired', 'rolled_back'])('rejects a release with status %s despite intact projection hashes', async status => {
        const { query, footprint } = fixture(status);
        await expect(assertRuntimeLearningFootprint(query as any, schema, { tenantId, agentId }, footprint, { mode: 'admission' }))
            .rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
    });

    it.each(['release', 'example'] as const)('rejects a %s owned by another agent', async record => {
        const { query, records, footprint } = fixture();
        if (record === 'release') records.release.agent_id = foreignId;
        else records.examples[0].agent_id = foreignId;
        await expect(assertRuntimeLearningFootprint(query as any, schema, { tenantId, agentId }, footprint, { mode: 'readonly' }))
            .rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
    });

    it('does not omit a withdrawn holdout source because only a training example was selected', async () => {
        const { query, records, footprint } = fixture();
        records.sources[1].status = 'withdrawn';
        await expect(assertRuntimeLearningFootprint(query as any, schema, { tenantId, agentId }, footprint, { mode: 'admission' }))
            .rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
    });

    it('detects a stale projection and does not ignore unexpected projection fields', async () => {
        const { query, projected } = fixture();
        for (const changed of [{ ...projected, rationale: 'Substituted after review.' }, { ...projected, injected: 'unreviewed data' }]) {
            const footprint = createRuntimeLearningFootprint(tenantId, agentId, [changed]);
            await expect(assertRuntimeLearningFootprint(query as any, schema, { tenantId, agentId }, footprint, { mode: 'readonly' }))
                .rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
        }
    });

    it.each(['bad_projection_hash', 'bad_release_id', 'duplicate_entry', 'unsupported_version'])('rejects malformed %s before a database read', async fault => {
        const { query, footprint } = fixture();
        const changed: any = structuredClone(footprint);
        if (fault === 'bad_projection_hash') changed.entries[0].projectionHash = 'no-hash';
        if (fault === 'bad_release_id') changed.entries[0].releaseId = 'not-a-uuid';
        if (fault === 'duplicate_entry') changed.entries.push({ ...changed.entries[0] });
        if (fault === 'unsupported_version') changed.version = 2;
        await expect(assertRuntimeLearningFootprint(query as any, schema, { tenantId, agentId }, changed, { mode: 'readonly' }))
            .rejects.toBeInstanceOf(LLMSourceAuthorityUnavailable);
        expect(query).not.toHaveBeenCalled();
    });
});
