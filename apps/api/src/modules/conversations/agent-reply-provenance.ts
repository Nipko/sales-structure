import { withAgentSourceFence } from '../../common/utils/agent-source-fence';
import type { PrismaService } from '../prisma/prisma.service';
import type { ExternalSourceAuthority } from '../ai/interfaces/external-source-authority';
import { LLMSourceAuthorityUnavailable } from '../ai/interfaces/llm-source-authority';
import type { RuntimeLearningExample } from '../learning/learning-contracts';
import { createRuntimeLearningFootprint, assertRuntimeLearningFootprint, type RuntimeLearningFootprint,
    type RuntimeLearningFootprintEntry } from '../learning/learning-runtime-footprint';
import { validServedAgentAuthority, type ServedAgentAuthority } from '../persona/served-agent-authority';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const unavailable = (): never => { throw new LLMSourceAuthorityUnavailable(); };

/** Validate and detach private persisted references. Nothing here treats hashes
 * as signatures, queries another tenant, or retains example text. */
export function mergeAgentReplyLearningFootprints(tenantId: string,
    inputs: readonly RuntimeLearningFootprint[]): readonly RuntimeLearningFootprint[] {
    if (!UUID.test(tenantId) || !Array.isArray(inputs)) return unavailable();
    const groups = new Map<string, Map<string, RuntimeLearningFootprintEntry>>();
    const owners = new Map<string, string>();
    for (const input of inputs) {
        if (!input || input.version !== 1 || input.tenantId !== tenantId || !UUID.test(input.agentId)
            || !Array.isArray(input.entries)
            || Object.keys(input).some(key => !['version','tenantId','agentId','entries'].includes(key))) return unavailable();
        const entries = groups.get(input.agentId) || new Map<string, RuntimeLearningFootprintEntry>();
        for (const entry of input.entries) {
            if (!entry || !UUID.test(entry.releaseId) || !UUID.test(entry.exampleId)
                || !HASH.test(entry.releaseHash) || !HASH.test(entry.projectionHash)
                || Object.keys(entry).some(key => !['releaseId','releaseHash','exampleId','projectionHash'].includes(key))) return unavailable();
            const key = `${entry.releaseId}:${entry.exampleId}`;
            const owner = owners.get(entry.releaseId);
            if (owner && owner !== input.agentId) return unavailable();
            owners.set(entry.releaseId, input.agentId);
            const prior = entries.get(key);
            if (prior && (prior.releaseHash !== entry.releaseHash || prior.projectionHash !== entry.projectionHash)) return unavailable();
            // One immutable release cannot have two hashes, even for different examples.
            if ([...entries.values()].some(other => other.releaseId === entry.releaseId && other.releaseHash !== entry.releaseHash)) return unavailable();
            entries.set(key, Object.freeze({releaseId:entry.releaseId,releaseHash:entry.releaseHash,
                exampleId:entry.exampleId,projectionHash:entry.projectionHash}));
        }
        groups.set(input.agentId, entries);
    }
    return Object.freeze([...groups.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([agentId,entries]) =>
        Object.freeze({version:1 as const,tenantId,agentId,entries:Object.freeze([...entries.values()]
            .sort((a,b) => `${a.releaseId}:${a.exampleId}`.localeCompare(`${b.releaseId}:${b.exampleId}`)))})));
}

export interface AgentReplyProvenanceCollector {
    readonly scope: ServedAgentAuthority;
    addExamples(examples: readonly RuntimeLearningExample[]): void;
    addInherited(footprints: readonly RuntimeLearningFootprint[]): void;
    getFootprints(): readonly RuntimeLearningFootprint[];
}

/** Monotonic for the whole reply, including guardrail rewrites and recovery.
 * Inherited agents remain separate: today's agent never re-owns past sources. */
export function createAgentReplyProvenanceCollector(scope: ServedAgentAuthority): AgentReplyProvenanceCollector {
    if (!scope || !validServedAgentAuthority(scope, scope.schemaName)) return unavailable();
    const frozenScope = Object.freeze(structuredClone(scope));
    let groups: readonly RuntimeLearningFootprint[] = frozenScope.kind === 'agent'
        ? [createRuntimeLearningFootprint(frozenScope.tenantId, frozenScope.agentId, [])] : [];
    const addInherited = (incoming: readonly RuntimeLearningFootprint[]) => {
        if (!Array.isArray(incoming)) return unavailable();
        // Build first: a rejected batch must not partially replace prior evidence.
        groups = mergeAgentReplyLearningFootprints(frozenScope.tenantId, [...groups, ...incoming]);
    };
    return Object.freeze({
        scope: frozenScope,
        addExamples(examples: readonly RuntimeLearningExample[]) {
            if (!Array.isArray(examples)) return unavailable();
            if (frozenScope.kind === 'legacy') { if (examples.length) return unavailable(); return; }
            addInherited([createRuntimeLearningFootprint(frozenScope.tenantId, frozenScope.agentId, examples)]);
        },
        addInherited,
        getFootprints: () => mergeAgentReplyLearningFootprints(frozenScope.tenantId, groups),
    });
}

/** This fences a provider attempt, not an accepted delivery receipt. All source
 * checks reuse one private tenant transaction; no row locks are acquired here. */
export function createAgentReplySourceAuthority(prisma: PrismaService, schema: string,
    collector: AgentReplyProvenanceCollector): ExternalSourceAuthority {
    if (!collector || !validServedAgentAuthority(collector.scope, schema)) return unavailable();
    return async (invoke, usage) => {
        let response: Awaited<ReturnType<typeof invoke>> | undefined;
        let providerError: unknown;
        let providerFailed = false;
        try {
            return await withAgentSourceFence(prisma, schema, async query => {
                const check = async () => {
                    const footprints = collector.getFootprints();
                    // Legacy replies have no agent group; still bind this query
                    // to the exact tenant before and after the provider attempt.
                    if (!footprints.length) {
                        const binding = await query<any[]>(`SELECT id FROM public.tenants
                            WHERE id=$1::uuid AND schema_name=$2 AND current_schema()=$2`, [collector.scope.tenantId, schema]);
                        if (binding.length !== 1) return unavailable();
                    }
                    for (const footprint of footprints) {
                        await assertRuntimeLearningFootprint(query, schema,
                            {tenantId:collector.scope.tenantId,agentId:footprint.agentId}, footprint, {mode:'readonly'});
                    }
                };
                await check();
                try { response = await invoke(); } catch (error) { providerError = error; providerFailed = true; }
                await check();
                if (providerFailed) throw providerError;
                return response as Awaited<ReturnType<typeof invoke>>;
            });
        } catch (error) {
            if (providerFailed && error === providerError) throw error;
            throw new LLMSourceAuthorityUnavailable(response === undefined
                ? providerError instanceof LLMSourceAuthorityUnavailable ? providerError.usage : undefined
                : usage?.(response));
        }
    };
}
