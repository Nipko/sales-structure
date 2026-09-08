import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { hasAgentSourceFence } from '../../common/utils/agent-source-fence';
import { PrismaService } from '../prisma/prisma.service';
import { resolveReadyTenantContext } from '../../common/utils/tenant-lifecycle.util';
import { RedisService } from '../redis/redis.service';
import {
    DISPATCH_OUTBOX_DDL, DispatchOutboxError,
    admitDispatch, expireDispatchLeases, markDispatchQueued, prepareDispatchBatch,
    readDispatchBacklog, readDispatchBatchForInbound, readDispatchReconciliation, readDispatchRow,
    readNextDispatchInBatch, readPendingDispatch, recordDispatchPreflightFailure,
    markDispatchResolutionExported, readUnexportedDispatchResolutions,
    resolveDispatchReconciliation, settleDispatch,
    type DispatchReconciliationBacklog, type DispatchReconciliationEntry, type DispatchResolution,
    type DispatchResolutionRecord,
    type DispatchBinding, type DispatchItem, type DispatchOutcome, type DispatchRow,
} from './agent-dispatch-outbox';
import {
    assertServedAgentConnectionAuthority, validServedAgentAuthority, type ServedAgentAuthority,
} from '../persona/served-agent-authority';
import { assertRuntimeLearningFootprint, type RuntimeLearningFootprint } from '../learning/learning-runtime-footprint';

/**
 * Owns the transactions the outbox primitives run in, and the checks that must
 * happen with the SAME connection that grants a permission.
 *
 * The order is the one the dispatch plan fixes and the widget admission already
 * follows: privacy fence, tenant, the agent that serves this exact connection,
 * the learning sources the payload derives from, and only then the dispatch row.
 * Nothing here calls a provider, and no lock on a tenant or an agent is held
 * across one: the permission is committed first and the request goes out after.
 */
@Injectable()
export class AgentDispatchOutboxStore {
    private readonly initialized = new Map<string, Promise<void>>();

    constructor(private readonly prisma: PrismaService, private readonly redis: RedisService) {}

    /** Bootstrap outside every fence. Ownership is verified before any DDL. */
    private async schemaFor(tenantId: string): Promise<string> {
        const ready = await resolveReadyTenantContext(this.prisma, this.redis, tenantId);
        if (!ready) throw new DispatchOutboxError('dispatch_tenant_unavailable');
        const schema = ready.schemaName;
        if (!/^tenant_[a-z0-9_]+$/.test(schema) || schema.startsWith('tenant_eval_'))
            throw new DispatchOutboxError('dispatch_tenant_unavailable');
        if (hasAgentSourceFence(this.prisma, schema)) throw new DispatchOutboxError('dispatch_nested_source_fence');
        if (!this.initialized.has(schema)) {
            const initialize = this.prisma.transactionInTenantSchema(schema, async query => {
                await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text',
                    [`dispatch-outbox-bootstrap:${schema}`]);
                if (!(await query<any[]>(
                    `SELECT id FROM public.tenants WHERE id=$1::uuid AND schema_name=$2
                     AND current_schema()=$2 AND is_active=true FOR SHARE`, [tenantId, schema]))[0])
                    throw new DispatchOutboxError('dispatch_tenant_unavailable');
                for (const statement of DISPATCH_OUTBOX_DDL) await query(statement);
            }).catch(error => { this.initialized.delete(schema); throw error; });
            this.initialized.set(schema, initialize);
        }
        await this.initialized.get(schema);
        return schema;
    }

    private async privacy(query: <R = any[]>(sql: string, params?: any[]) => Promise<R>,
        schema: string, tenantId: string): Promise<void> {
        await query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text', [`agent-privacy:${schema}`]);
        if (!(await query<any[]>(
            `SELECT id FROM public.tenants WHERE id=$1::uuid AND schema_name=$2
             AND current_schema()=$2 AND is_active=true FOR SHARE`, [tenantId, schema]))[0])
            throw new DispatchOutboxError('dispatch_tenant_unavailable');
    }

    /**
     * Record the whole result before anything reaches the work queue. The batch
     * and its rows commit together; publishing identifiers is a later, separate
     * step, and a crash between the two is recovered from these rows.
     */
    async prepare(tenantId: string, input: {
        binding: DispatchBinding;
        items: readonly DispatchItem[];
        operationalScope: ServedAgentAuthority;
        learningFootprints?: readonly RuntimeLearningFootprint[];
        sources?: readonly { id: string; sourceContactId?: string | null }[];
    }): Promise<{ schemaName: string; batchId: string; rows: DispatchRow[] }> {
        const schema = await this.schemaFor(tenantId);
        if (!validServedAgentAuthority(input.operationalScope, schema, tenantId))
            throw new DispatchOutboxError('dispatch_authority_required');
        const result = await this.prisma.transactionInTenantSchema(schema, async query => {
            await this.privacy(query, schema, tenantId);
            return prepareDispatchBatch(query, schema, {
                binding: input.binding, items: input.items,
                operationalScope: input.operationalScope as unknown as Record<string, any>,
                learningFootprint: input.learningFootprints as readonly any[] | undefined,
                sources: input.sources,
            });
        });
        return { schemaName: schema, ...result };
    }

    /**
     * Does a batch already own the answer to this inbound?
     *
     * Deliberately does NOT bootstrap: a tenant that never took this path has no
     * table and therefore no batch, and creating one on every ordinary turn would
     * make the question expensive for everybody. It also deliberately does not
     * consult the rollout switch — a batch that committed keeps the reply even
     * after the switch is turned off, which is the whole point of asking.
     *
     * Throws when it cannot tell. A caller must never read uncertainty as "no".
     */
    async findBatchForInbound(tenantId: string, schemaName: string,
        binding: DispatchBinding): Promise<DispatchRow[] | null> {
        // The caller supplies the schema it already resolved for this turn, so
        // asking does not add a lifecycle lookup to every ordinary message. It is
        // not trusted: the privacy fence below re-checks tenant, schema and
        // current_schema() together before anything is read.
        if (!/^tenant_[a-z0-9_]+$/.test(schemaName)) throw new DispatchOutboxError('dispatch_tenant_unavailable');
        return this.prisma.transactionInTenantSchema(schemaName, async query => {
            await this.privacy(query, schemaName, tenantId);
            return readDispatchBatchForInbound(query, schemaName, binding);
        });
    }

    /**
     * Publish everything in a batch that still has work, and mark it queued.
     * Used both by a fresh batch and by one recovered from a previous attempt,
     * so an interrupted turn finishes instead of being answered twice.
     */
    async publishBatch(tenantId: string, rows: readonly DispatchRow[],
        publish: (dispatchId: string, delayMs: number) => Promise<void>, gapMs = 0): Promise<number> {
        // Only the head. Publishing later items would park them behind the
        // predecessor guard and churn the queue; the worker chains the rest as
        // each effect actually arrives, which is what orders the reply.
        const head = [...rows]
            .filter(row => !row.redacted && ['prepared', 'queued', 'failed'].includes(row.state))
            .sort((left, right) => left.itemIndex - right.itemIndex)[0];
        if (!head) return 0;
        await publish(head.id, 0).catch(() => undefined);
        void gapMs;
        await this.markQueued(tenantId, [head.id]).catch(() => undefined);
        return 1;
    }

    /** The next effect of this batch, if the one just delivered has a successor. */
    async nextInBatch(tenantId: string, dispatchId: string): Promise<DispatchRow | null> {
        const schema = await this.schemaFor(tenantId);
        return this.prisma.transactionInTenantSchema(schema, async query => {
            await this.privacy(query, schema, tenantId);
            return readNextDispatchInBatch(query, schema, dispatchId);
        });
    }

    async read(tenantId: string, dispatchId: string): Promise<DispatchRow | null> {
        const schema = await this.schemaFor(tenantId);
        return this.prisma.transactionInTenantSchema(schema, async query => {
            await this.privacy(query, schema, tenantId);
            return readDispatchRow(query, schema, dispatchId);
        });
    }

    async pending(tenantId: string, limit = 100): Promise<{ schemaName: string; rows: DispatchRow[] }> {
        const schema = await this.schemaFor(tenantId);
        const rows = await this.prisma.transactionInTenantSchema(schema, async query => {
            await this.privacy(query, schema, tenantId);
            return readPendingDispatch(query, schema, limit);
        });
        return { schemaName: schema, rows };
    }

    async markQueued(tenantId: string, dispatchIds: readonly string[]): Promise<number> {
        const schema = await this.schemaFor(tenantId);
        return this.prisma.transactionInTenantSchema(schema, async query => {
            await this.privacy(query, schema, tenantId);
            return markDispatchQueued(query, schema, dispatchIds);
        });
    }

    /** The committed pass that retires permissions nobody settled. */
    async expireLeases(tenantId: string, limit = 100): Promise<DispatchRow[]> {
        const schema = await this.schemaFor(tenantId);
        return this.prisma.transactionInTenantSchema(schema, async query => {
            await this.privacy(query, schema, tenantId);
            return expireDispatchLeases(query, schema, limit);
        });
    }

    /**
     * Grant one attempt, or refuse it. Everything the permission depends on is
     * verified with the same query that writes it, so a publication or an
     * erasure committing in parallel is either fully before or fully after.
     *
     * Returns the payload the caller is authorized to send exactly once. The
     * caller performs the request only after this transaction has committed, and
     * holds no lock from it while doing so.
     */
    async admit(tenantId: string, dispatchId: string, options?: { leaseSeconds?: number }): Promise<{
        schemaName: string; leaseToken: string; row: DispatchRow;
    }> {
        const schema = await this.schemaFor(tenantId);
        const leaseToken = randomUUID();
        const leaseSeconds = options?.leaseSeconds ?? 120;
        const row = await this.prisma.transactionInTenantSchema(schema, async query => {
            await this.privacy(query, schema, tenantId);
            const current = await readDispatchRow(query, schema, dispatchId);
            if (!current) throw new DispatchOutboxError('dispatch_unavailable');
            if (current.redacted || !current.binding) throw new DispatchOutboxError('dispatch_redacted');
            const scope = current.operationalScope as unknown as ServedAgentAuthority;
            if (!validServedAgentAuthority(scope, schema, tenantId))
                throw new DispatchOutboxError('dispatch_authority_required');
            // Another agent can win this connection without changing the first
            // one's own version or hash, so the routing itself is re-checked.
            await assertServedAgentConnectionAuthority(query, schema, scope,
                current.binding.channelType, current.binding.channelAccountId);
            // Words derived from a retired example may not go out under a new
            // permission, even though the words themselves have not changed.
            for (const footprint of [...(current.learningFootprint || [])]
                .sort((a, b) => String(a?.agentId).localeCompare(String(b?.agentId)))) {
                await assertRuntimeLearningFootprint(query, schema,
                    { tenantId, agentId: footprint?.agentId }, footprint, { mode: 'admission' });
            }
            // Shared read of the destination binding: this transaction must not
            // update the conversation or the contact, nor escalate their locks.
            const [conversation] = await query<any[]>(
                `SELECT c.id FROM conversations c WHERE c.id=$1::uuid AND c.contact_id=$2::uuid
                 AND c.channel_type=$3 FOR SHARE`,
                [current.binding.conversationId, current.binding.contactId, current.binding.channelType]);
            if (!conversation) throw new DispatchOutboxError('dispatch_binding_changed');
            return admitDispatch(query, schema, { dispatchId, leaseToken, leaseSeconds });
        });
        return { schemaName: schema, leaseToken, row };
    }

    /** Record what the attempt this lease authorized actually produced. */
    async settle(tenantId: string, dispatchId: string, leaseToken: string,
        outcome: DispatchOutcome): Promise<DispatchRow> {
        const schema = await this.schemaFor(tenantId);
        return this.prisma.transactionInTenantSchema(schema, async query => {
            await this.privacy(query, schema, tenantId);
            return settleDispatch(query, schema, { dispatchId, leaseToken, outcome });
        });
    }

    /** The uncertain effects waiting for a person, oldest first. */
    async reconciliation(tenantId: string, options: { limit?: number; search?: string | null } = {}):
        Promise<DispatchReconciliationEntry[]> {
        const schema = await this.schemaFor(tenantId);
        return this.prisma.transactionInTenantSchema(schema, async query => {
            await this.privacy(query, schema, tenantId);
            return readDispatchReconciliation(query, schema, options);
        });
    }

    /** How big the backlog is and how old, for an alert to act on. */
    async backlog(tenantId: string): Promise<DispatchReconciliationBacklog> {
        const schema = await this.schemaFor(tenantId);
        return this.prisma.transactionInTenantSchema(schema, async query => {
            await this.privacy(query, schema, tenantId);
            return readDispatchBacklog(query, schema);
        });
    }

    /**
     * Apply a person's decision about an uncertain effect.
     *
     * The decision and the state change it authorises commit together, so an
     * irreversible resolution can never exist without the actor and the
     * evidence that justified it. The global audit copy is drained from that
     * row afterwards and can be retried; the record itself cannot be lost.
     */
    async resolve(tenantId: string, input: {
        dispatchId: string; resolution: DispatchResolution; evidence: string;
        actorId?: string | null; actorRole?: string | null; receipt?: string | null;
    }): Promise<{ row: DispatchRow; resolution: DispatchResolutionRecord }> {
        const schema = await this.schemaFor(tenantId);
        return this.prisma.transactionInTenantSchema(schema, async query => {
            await this.privacy(query, schema, tenantId);
            return resolveDispatchReconciliation(query, schema, input);
        });
    }

    /** Decisions still to be copied into the global audit log, oldest first. */
    async unexportedResolutions(tenantId: string, limit = 50): Promise<readonly DispatchResolutionRecord[]> {
        const schema = await this.schemaFor(tenantId);
        return this.prisma.transactionInTenantSchema(schema, async query => {
            await this.privacy(query, schema, tenantId);
            return readUnexportedDispatchResolutions(query, schema, limit);
        });
    }

    async markResolutionExported(tenantId: string, resolutionId: string): Promise<void> {
        const schema = await this.schemaFor(tenantId);
        await this.prisma.transactionInTenantSchema(schema, async query => {
            await this.privacy(query, schema, tenantId);
            await markDispatchResolutionExported(query, schema, resolutionId);
        });
    }

    /** A failure before any permission existed. Spends an attempt on purpose. */
    async failPreflight(tenantId: string, dispatchId: string, input: {
        errorCode: string; retryInSeconds?: number; permanent?: boolean;
    }): Promise<DispatchRow> {
        const schema = await this.schemaFor(tenantId);
        return this.prisma.transactionInTenantSchema(schema, async query => {
            await this.privacy(query, schema, tenantId);
            return recordDispatchPreflightFailure(query, schema, { dispatchId, ...input });
        });
    }
}
