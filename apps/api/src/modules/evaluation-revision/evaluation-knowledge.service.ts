import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AGENT_TEST_EXECUTION_CONTEXT } from '../../common/types/execution-context';
import { withAgentSourceFence } from '../../common/utils/agent-source-fence';
import type { AgentEvaluationSnapshot } from '../conversations/agent-evaluation-snapshot';
import type { ExternalSourceAuthority } from '../ai/interfaces/external-source-authority';
import { LLMSourceAuthorityUnavailable } from '../ai/interfaces/llm-source-authority';
import type { LLMResponse } from '../ai/interfaces/illm-provider.interface';
import { EvaluationRevisionService } from './evaluation-revision.service';
import { acquireKnowledgeReplica, releaseKnowledgeReplica, reapKnowledgeReplicas } from './evaluation-knowledge-lifecycle';
import { resolveKnowledgeReplica, knowledgeReplicaSchema, EvaluationKnowledgeUnavailable, type EvaluationKnowledgeReplica } from './evaluation-knowledge-replica';

/** Owns evaluation corpus references. It never grants operational agent authority
 * or places corpus content in the snapshot, job payload or public test request. */
@Injectable()
export class EvaluationKnowledgeService {
    private readonly logger = new Logger(EvaluationKnowledgeService.name);
    private sweepCursor: string | undefined;
    private sweeping = false;
    constructor(private readonly prisma: PrismaService, private readonly revisions: EvaluationRevisionService) {}

    capture(tenantId: string, agentId: string, snapshotToken = randomUUID()): Promise<EvaluationKnowledgeReplica> {
        return acquireKnowledgeReplica(this.prisma, { tenantId, agentId, snapshotToken });
    }

    reference(snapshot: AgentEvaluationSnapshot): EvaluationKnowledgeReplica {
        const copy = resolveKnowledgeReplica(snapshot.knowledgeInputs, snapshot.tenantId);
        if (!copy.management || copy.usage?.agentId !== snapshot.agentId
            || copy.lease.sourceSchema !== snapshot.structuredKnowledgeInputs?.sourceSchema)
            throw new EvaluationKnowledgeUnavailable('evaluation_knowledge_snapshot_scope_mismatch');
        return copy;
    }

    /** Execution requires a live usage. Historical review only validates the
     * snapshot seal; an expired corpus does not erase a completed evaluation. */
    async assertExecutable(snapshot: AgentEvaluationSnapshot): Promise<void> {
        await knowledgeReplicaSchema(this.prisma, this.reference(snapshot), snapshot.tenantId, AGENT_TEST_EXECUTION_CONTEXT);
    }

    async release(snapshot: AgentEvaluationSnapshot): Promise<void> {
        await releaseKnowledgeReplica(this.prisma, this.reference(snapshot));
    }

    /** One provider attempt, including embeddings/reranking and the answer that
     * uses retrieved text. Composes with Replay/Learning using the same private
     * source fence, without making business-effect transactions reentrant. */
    dataSourceAuthority(snapshot: AgentEvaluationSnapshot): ExternalSourceAuthority {
        const frozen = structuredClone(snapshot), copy = this.reference(frozen);
        return async <T>(invoke: () => Promise<T>, usage?: (result: T) => LLMResponse['usage']): Promise<T> => {
            let response: T | undefined;
            let providerError: unknown;
            try {
                return await withAgentSourceFence(this.prisma, copy.lease.sourceSchema, async () => {
                    const check = async () => {
                        await this.assertExecutable(frozen);
                        await this.revisions.assertCurrent(frozen.manifest);
                    };
                    await check();
                    try { response = await invoke(); } catch (error) { providerError = error; }
                    await check();
                    if (providerError !== undefined) throw providerError;
                    return response as T;
                });
            } catch (error) {
                if (providerError !== undefined && error === providerError) throw error;
                throw new LLMSourceAuthorityUnavailable(response === undefined
                    ? providerError instanceof LLMSourceAuthorityUnavailable ? providerError.usage : undefined
                    : usage?.(response));
            }
        };
    }

    /** A restart does not lose ownership: the durable usage registry and expiry
     * markers remain authoritative. The cursor only bounds work per cron tick. */
    @Cron('*/5 * * * *')
    async reapExpired(): Promise<void> {
        if (this.sweeping) return;
        this.sweeping = true;
        try {
            const result = await reapKnowledgeReplicas(this.prisma, { afterTenantId: this.sweepCursor, limit: 100 });
            this.sweepCursor = result.nextCursor || undefined;
            if (result.failures.length) this.logger.warn(`Evaluation knowledge cleanup retained ${result.failures.length} tenant scopes for review/retry.`);
        } catch {
            this.logger.warn('Evaluation knowledge cleanup could not complete; durable ownership will be retried.');
        } finally { this.sweeping = false; }
    }
}
