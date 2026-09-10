import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { AgentDraftService } from './agent-draft.service';
import { PersonaService } from './persona.service';
import {
    AGENT_PUBLICATION_TABLES, AgentPublicationStore,
    type PublicationChecks, type PublicationReceipt,
    type PublishAgentConfiguration, type RollbackAgentConfiguration,
} from './agent-publication-store';
import type { RevisionQuery } from './agent-configuration-revision';
import { resolveEvaluationSnapshot, type AgentEvaluationSnapshot } from '../conversations/agent-evaluation-snapshot';
import { EvaluationRevisionService } from '../evaluation-revision/evaluation-revision.service';
import { resolveTenantSubscriptionAccess } from '../../common/utils/subscription-entitlement.util';
import { auditActor } from '../../common/utils/audit-actor.util';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export interface PublicationActorRequest { id: string; role: string; impersonatedBy?: string | null }

/**
 * The application boundary the publication primitive deliberately refused to be.
 *
 * `AgentPublicationStore` says so itself: it is not an HTTP endpoint, and a
 * caller must supply the live checks before publication is exposed. Until now
 * nobody did, so a reviewed candidate could be stored and approved and then had
 * no way to reach the agent that serves customers.
 *
 * The two checks are what make an approval mean something at the moment it
 * takes effect rather than at the moment it was given:
 *
 *   - the evaluation snapshot must still describe today's world, or the
 *     evidence behind the approval is about a configuration, a corpus or a
 *     routing that has since moved;
 *   - the tenant must still be entitled to run what the candidate asks for.
 *     A plan downgrade, a revoked feature or a calendar disconnected between
 *     the review and the publication has to stop it, and it must be checked on
 *     the same transaction that writes the change.
 *
 * Both run inside the store's transaction, so refusing one rolls back
 * everything, including the version bump and the head pointer.
 */
@Injectable()
export class AgentPublicationService {
    private readonly logger = new Logger(AgentPublicationService.name);
    private readonly store: AgentPublicationStore;

    constructor(
        private readonly prisma: PrismaService,
        private readonly persona: PersonaService,
        private readonly drafts: AgentDraftService,
        // The revision manifest directly, not through `AgentTestService`: that
        // lives in ConversationsModule, which already imports this one, and the
        // cycle is not worth it for one call.
        private readonly revisions: EvaluationRevisionService,
        // Last, and defaulted: the positional specs that construct this service
        // directly must keep compiling, and an absent emitter degrades to no
        // notification rather than to a failed publication.
        private readonly events: EventEmitter2 = null as any,
    ) {
        this.store = new AgentPublicationStore(prisma);
    }

    private authorize(tenantId: string, agentId: string, actor: PublicationActorRequest, write: boolean): void {
        const allowed = write ? ['tenant_admin', 'super_admin'] : ['tenant_admin', 'tenant_supervisor', 'super_admin'];
        if (!allowed.includes(actor?.role)) throw new ForbiddenException({ error: 'agent_publication_admin_required' });
        if (!UUID.test(tenantId) || !UUID.test(agentId) || !UUID.test(String(actor?.id || '')))
            throw new BadRequestException({ error: 'agent_publication_scope_invalid' });
    }

    private async schema(tenantId: string): Promise<string> {
        const schema = await this.prisma.getTenantSchemaName(tenantId);
        if (!schema) throw new NotFoundException({ error: 'tenant_not_found' });
        if (!/^tenant_[a-z0-9_]+$/.test(schema)) throw new BadRequestException({ error: 'agent_publication_scope_invalid' });
        return schema;
    }

    /** Live checks, built per call so nothing is captured from an earlier request. */
    private checks(tenantId: string, agentId: string, schema: string): PublicationChecks {
        return {
            assertCandidateCurrent: async (snapshot: AgentEvaluationSnapshot) => {
                if (!snapshot) throw new BadRequestException({ error: 'evaluation_revision_manifest_required' });
                // Seal check first, against the tenant and agent of the REQUEST.
                // Passing the snapshot's own ids would compare it to itself and
                // pass for a snapshot sealed for somebody else entirely.
                resolveEvaluationSnapshot(snapshot, tenantId, agentId);
                await this.revisions.assertCurrent(snapshot.manifest);
            },
            assertCurrentPrerequisites: async (query: RevisionQuery, input) => {
                // One identity, from one source. The store passes the same
                // tenant this closure captured, and mixing the two would read
                // the plan of one tenant while entitling the configuration of
                // another the day they ever diverge.
                if (input.tenantId !== tenantId || input.agentId !== agentId) {
                    throw new ForbiddenException({ error: 'agent_publication_scope_mismatch' });
                }
                // Read the tenant on the SAME query: the store already holds it
                // FOR UPDATE, so this cannot race a plan change committing beside it.
                const [tenant] = await query<any[]>(
                    `SELECT to_jsonb(t)->>'industry' AS industry, to_jsonb(t)->'settings' AS settings
                     FROM public.tenants t WHERE t.id=$1::uuid`, [tenantId]);
                if (!tenant) throw new NotFoundException({ error: 'tenant_not_found' });
                const access = await resolveTenantSubscriptionAccess(this.prisma, tenantId, 'write');
                if (!access.allowed) {
                    throw new ForbiddenException({ error: 'agent_publication_subscription_restricted',
                        reason: access.error ?? 'restricted' });
                }
                await this.drafts.assertConfigurationEntitlement(
                    tenantId, schema, input.operational, tenant, input.body);
            },
        };
    }

    /**
     * The publication history of one agent, newest first, plus the current head.
     *
     * This is the observability half: without it a rollback is a request for an
     * identifier nobody can look up, and "what is serving right now, and what
     * did it replace" has no answer outside the database.
     */
    async history(tenantId: string, agentId: string, actor: PublicationActorRequest, limit = 20): Promise<any> {
        this.authorize(tenantId, agentId, actor, false);
        const schema = await this.schema(tenantId);
        const bounded = Number.isInteger(limit) && limit > 0 && limit <= 100 ? limit : 20;
        await this.store.ensure(schema);
        return this.prisma.transactionInTenantSchema(schema, async query => {
            const [tenant] = await query<any[]>(
                'SELECT id FROM public.tenants WHERE id=$1::uuid AND schema_name=current_schema() FOR SHARE', [tenantId]);
            if (!tenant) throw new NotFoundException({ error: 'tenant_not_found' });
            const [agent] = await query<any[]>('SELECT id, version FROM agent_personas WHERE id=$1::uuid', [agentId]);
            if (!agent) throw new NotFoundException({ error: 'agent_not_found' });
            const [head] = await query<any[]>(
                `SELECT e.id, e.kind, e.published_version, e.after_hash, e.created_at
                 FROM agent_publication_heads h JOIN agent_publication_events e
                   ON e.id = h.event_id AND e.agent_id = h.agent_id
                 WHERE h.agent_id = $1::uuid`, [agentId]);
            // Bodies are deliberately not returned: the history says what
            // happened and lets a rollback name its target, and the editor is
            // where a configuration is read.
            const events = await query<any[]>(
                `SELECT id, kind, candidate_id, rollback_of, base_version, published_version,
                        before_hash, after_hash, evidence_hash, requested_by, created_at
                 FROM agent_publication_events WHERE agent_id=$1::uuid
                 ORDER BY created_at DESC, published_version DESC LIMIT $2`, [agentId, bounded]);
            return {
                agentId,
                operationalVersion: Number(agent.version),
                head: head ? { id: head.id, kind: head.kind, operationalVersion: Number(head.published_version),
                    operationalHash: head.after_hash, createdAt: new Date(head.created_at).toISOString() } : null,
                events: events.map(row => ({
                    id: row.id, kind: row.kind, candidateId: row.candidate_id, rollbackOf: row.rollback_of,
                    baseVersion: Number(row.base_version), operationalVersion: Number(row.published_version),
                    beforeHash: row.before_hash, afterHash: row.after_hash, evidenceHash: row.evidence_hash,
                    requestedBy: row.requested_by, createdAt: new Date(row.created_at).toISOString(),
                })),
            };
        });
    }

    async publish(tenantId: string, agentId: string, candidateId: string,
        body: PublishAgentConfiguration, actor: PublicationActorRequest): Promise<PublicationReceipt> {
        this.authorize(tenantId, agentId, actor, true);
        const schema = await this.schema(tenantId);
        await this.store.ensure(schema);
        const receipt = await this.prisma.transactionInTenantSchema(schema, query =>
            this.store.publish(query, schema, { tenantId, agentId, candidateId,
                actor: { id: actor.id, role: actor.role }, body }, this.checks(tenantId, agentId, schema)));
        await this.settle(tenantId, agentId, actor, receipt, { candidateId });
        return receipt;
    }

    async rollback(tenantId: string, agentId: string,
        body: RollbackAgentConfiguration, actor: PublicationActorRequest): Promise<PublicationReceipt> {
        this.authorize(tenantId, agentId, actor, true);
        const schema = await this.schema(tenantId);
        await this.store.ensure(schema);
        const receipt = await this.prisma.transactionInTenantSchema(schema, query =>
            this.store.rollback(query, schema, { tenantId, agentId,
                actor: { id: actor.id, role: actor.role }, body }, this.checks(tenantId, agentId, schema)));
        await this.settle(tenantId, agentId, actor, receipt, { rollbackOf: body.expectedPublicationId });
        return receipt;
    }

    /**
     * After the COMMIT, never inside it.
     *
     * The cache drop has to happen or the runtime keeps serving the previous
     * revision until the entry expires; the audit row is the record of who
     * changed what. Neither may roll back a publication that already committed,
     * and an idempotent replay repeats both harmlessly.
     *
     * The notification is the third: `agent.config.updated` had two listeners
     * and no emitter anywhere in the API. `EvalAutorunListener` waits on it to
     * run the eval gate after a behaviour change, and `AgentQualitySignalService`
     * to reconcile its signals — both dormant since the edit path moved from
     * `PersonaService.updateAgent` to the draft/publication flow, which is where
     * an agent's behaviour actually changes for customers and where nothing was
     * announcing it. Unlike the other two, an idempotent replay must NOT repeat
     * it: re-running an evaluation for a publication that already happened
     * spends the tenant's autorun budget on nothing.
     */
    private async settle(tenantId: string, agentId: string, actor: PublicationActorRequest,
        receipt: PublicationReceipt, detail: Record<string, unknown>): Promise<void> {
        try {
            await this.persona.invalidatePersonaResolutionCaches(tenantId);
        } catch (error: any) {
            // A stale cache is bounded by its own TTL; losing the publication is not.
            this.logger.error(`[Publication] cache invalidation deferred for agent ${agentId}: ${error?.message}`);
        }
        try {
            // The REAL actor, so a publication made during an impersonation is
            // attributed to the super_admin who made it, not to the user acted as.
            const { userId, delegation } = auditActor(actor);
            await this.prisma.auditLog.create({ data: {
                tenantId, action: `agent.publication.${receipt.kind}`, resource: `agent:${agentId}`,
                userId, details: JSON.parse(JSON.stringify({
                    publicationId: receipt.id, operationalVersion: receipt.operationalVersion,
                    operationalHash: receipt.operationalHash, idempotentReplay: receipt.idempotentReplay,
                    ...(delegation ? { delegation } : {}), ...detail,
                })),
            } });
        } catch (error: any) {
            this.logger.error(`[Publication] audit write failed for ${receipt.id}: ${error?.message}`);
        }
        if (receipt.idempotentReplay || !this.events) return;
        try {
            this.events.emit('agent.config.updated', { tenantId, agentId,
                changed: `agent_publication_${receipt.kind}`, publicationId: receipt.id,
                operationalVersion: receipt.operationalVersion, operationalHash: receipt.operationalHash });
        } catch (error: any) {
            // A listener that throws cannot undo a publication that committed.
            this.logger.error(`[Publication] notification failed for ${receipt.id}: ${error?.message}`);
        }
    }
}

export { AGENT_PUBLICATION_TABLES };
