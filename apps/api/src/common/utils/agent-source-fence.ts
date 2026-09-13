import { AsyncLocalStorage } from 'async_hooks';
import type { PrismaService } from '../../modules/prisma/prisma.service';

export type AgentSourceQuery = <R = any[]>(sql: string, params?: any[]) => Promise<R>;
interface SourceFence {
    prisma: PrismaService;
    schema: string;
    query: AgentSourceQuery;
    active: boolean;
}
const fences = new AsyncLocalStorage<SourceFence>();

/** A nested caller must defer exclusive retirement to its outer owner. */
export function hasAgentSourceFence(prisma: PrismaService, schema: string): boolean {
    const scope = fences.getStore();
    return !!scope?.active && scope.prisma === prisma && scope.schema === schema;
}

/** Source checks may compose during one provider call. Acquiring a second shared
 * lock on another connection deadlocks behind a queued erasure: the erasure
 * waits for the outer call, which waits for that second connection.
 *
 * Reuse only this server-owned source transaction, with the same Prisma owner
 * and tenant schema. This does not make business commands reentrant or permit
 * callers to skip source checks. No request/snapshot carries this capability.
 */
export async function withAgentSourceFence<T>(prisma: PrismaService, schema: string,
    work: (query: AgentSourceQuery) => Promise<T>): Promise<T> {
    const inherited = fences.getStore();
    if (inherited) {
        if (!inherited.active) throw new Error('agent_source_fence_expired');
        if (inherited.prisma !== prisma || inherited.schema !== schema) throw new Error('agent_source_fence_scope_mismatch');
        const result = await work(inherited.query);
        if (!inherited.active) throw new Error('agent_source_fence_expired');
        return result;
    }
    let owned: SourceFence | undefined;
    try {
        return await prisma.transactionInTenantSchema(schema, async query => {
            await query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text', [`agent-privacy:${schema}`]);
            const scope: SourceFence = owned = { prisma, schema, query, active: true };
            try {
                return await fences.run(scope, async () => {
                    const result = await work(query);
                    if (!scope.active) throw new Error('agent_source_fence_expired');
                    return result;
                });
            } finally { scope.active = false; }
        }, { timeout: 120000 });
    } finally {
        // Prisma can reject on timeout before the still-pending callback settles.
        if (owned) owned.active = false;
    }
}
