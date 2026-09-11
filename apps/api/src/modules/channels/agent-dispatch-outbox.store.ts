import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { hasAgentSourceFence } from '../../common/utils/agent-source-fence';
import { PrismaService } from '../prisma/prisma.service';
import { resolveReadyTenantContext } from '../../common/utils/tenant-lifecycle.util';
import { RedisService } from '../redis/redis.service';
import { recordDispatchLatency } from './dispatch-latency';
import {
    DISPATCH_OUTBOX_DDL, DispatchOutboxError,
    admitDispatch, expireDispatchLeases, markDispatchQueued, prepareDispatchBatch,
    readDispatchBacklog, readDispatchBatchForInbound, readDispatchReconciliation, readDispatchRow,
    readNextDispatchInBatch, readPendingDispatch, recordDispatchPreflightFailure,
    markDispatchResolutionExported, readUnexportedDispatchResolutions,
    resolveDispatchReconciliation, settleDispatch,
    redactSettledDispatchOutbox,
    type DispatchReconciliationBacklog, type DispatchReconciliationEntry, type DispatchResolution,
    type DispatchResolutionRecord,
    type DispatchBinding, type DispatchItem, type DispatchOriginKind,
    type DispatchOutcome, type DispatchRow,
} from './agent-dispatch-outbox';
import {
    assertServedAgentConnectionAuthority, ServedAgentAuthorityError,
    validServedAgentAuthority, type ServedAgentAuthority,
} from '../persona/served-agent-authority';
import {
    revalidateProactivePolicy, validProactivePolicyAuthority,
    type ProactivePolicyAuthority,
} from '../persona/proactive-policy-authority';
import {
    revalidateHumanOperator, validHumanOperatorAuthority, type HumanOperatorAuthority,
} from '../persona/human-operator-authority';
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
        /** `proactive` for an effect nobody asked for. Defaults to a reply. */
        originKind?: DispatchOriginKind;
    }): Promise<{ schemaName: string; batchId: string; rows: DispatchRow[] }> {
        const schema = await this.schemaFor(tenantId);
        // ── TWO KINDS OF AUTHORITY, BECAUSE THERE ARE TWO KINDS OF EFFECT ────
        //
        // A reply is served by an agent persona at a version. A reminder is
        // served by a POLICY over a domain row, and has no persona at all — the
        // reminders passed an object with no `kind` and no hash, this check
        // refused it, and the migration would have died at the first real row.
        //
        // A message a PERSON sent is served by neither. An agent in the
        // console and a tenant calling the send API are both effects whose
        // authority is a human being and a role, and those six call sites had
        // no authority they could honestly carry — which is why they were still
        // on the legacy queue rather than here.
        //
        // The union is closed on purpose. Anything that is none of the three is
        // refused, so a future producer has to say what it is served on behalf
        // of rather than inheriting a permissive default.
        if (!validServedAgentAuthority(input.operationalScope, schema, tenantId)
            && !validProactivePolicyAuthority(input.operationalScope, schema, tenantId)
            && !validHumanOperatorAuthority(input.operationalScope, schema, tenantId)) {
            throw new DispatchOutboxError('dispatch_authority_required');
        }
        // ── AND THE AUTHORITY HAS TO BE ABOUT THIS CONNECTION ───────────────
        //
        // Two of the three name a connection of their own, and it must be the
        // one the binding will send from: the account on the row is the account
        // Meta bills, so an authority granted for one number cannot cover a
        // message leaving another.
        //
        // This was checked only at ADMIT. The row committed, published, took a
        // lease and only then refused — hours later for a reminder, with a
        // `dispatch_binding_changed` that reads like the thread moved when in
        // fact the producer built the two halves inconsistently. Refusing here
        // costs the producer one synchronous error at the moment it can still
        // be fixed.
        const declared = input.operationalScope as { channelType?: string; channelAccountId?: string };
        if ((validProactivePolicyAuthority(input.operationalScope, schema, tenantId)
                || validHumanOperatorAuthority(input.operationalScope, schema, tenantId))
            && (declared.channelType !== input.binding.channelType
                || declared.channelAccountId !== input.binding.channelAccountId)) {
            throw new DispatchOutboxError('dispatch_binding_changed');
        }
        const result = await this.prisma.transactionInTenantSchema(schema, async query => {
            await this.privacy(query, schema, tenantId);
            return prepareDispatchBatch(query, schema, {
                binding: input.binding, items: input.items,
                operationalScope: input.operationalScope as unknown as Record<string, any>,
                learningFootprint: input.learningFootprints as readonly any[] | undefined,
                sources: input.sources,
                originKind: input.originKind,
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
        // ── `queued` MEANS PUBLISHED, AND IS ONLY WRITTEN WHEN IT WAS ───────
        //
        // The publish failure is swallowed on purpose: the row is the record,
        // and the recovery pass republishes anything nothing ever published.
        // That asymmetry is the whole reason this lane exists.
        //
        // But `markQueued` ran regardless, so a row whose publish threw was
        // written `queued` — a state that says a job exists for it. Nothing
        // broke, because `queued` is still available and recovery still finds
        // it; the row simply said something that had not happened, and an
        // operator reading "queued" while no job exists has no way to tell that
        // from a worker being behind.
        //
        // Left `prepared` when the publish failed, which is exactly what it is.
        let published = true;
        await publish(head.id, 0).catch(() => { published = false; });
        void gapMs;
        if (published) await this.markQueued(tenantId, [head.id]).catch(() => undefined);
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
        // Around the transaction only: the SLO is about the durable step, and
        // including the recorder's own write would measure the measurement.
        const startedAt = Date.now();
        const row = await this.prisma.transactionInTenantSchema(schema, async query => {
            await this.privacy(query, schema, tenantId);
            const current = await readDispatchRow(query, schema, dispatchId);
            if (!current) throw new DispatchOutboxError('dispatch_unavailable');
            if (current.redacted || !current.binding) throw new DispatchOutboxError('dispatch_redacted');
            const scope = current.operationalScope as unknown as
                ServedAgentAuthority | ProactivePolicyAuthority | HumanOperatorAuthority;
            if (validProactivePolicyAuthority(scope, schema, tenantId)) {
                // ── IS THIS STILL THE EFFECT THE POLICY AUTHORISED? ─────────
                //
                // In THIS transaction, the one that grants the lease. A check
                // that commits separately answers about a moment that has
                // already passed, and the window between it and the POST is
                // exactly where a cancellation lands.
                //
                // The connection is re-checked too: an effect prepared for one
                // number must not be sent from another, because the account on
                // the row is the account Meta bills.
                if (scope.channelType !== current.binding.channelType
                    || scope.channelAccountId !== current.binding.channelAccountId) {
                    throw new DispatchOutboxError('dispatch_binding_changed');
                }
                const verdict = await revalidateProactivePolicy(query, schema, scope);
                if (verdict.kind !== 'current') {
                    // ── SUPPRESSED, AND THE SUPPRESSION HAS TO COMMIT ───────
                    //
                    // The appointment moved or was cancelled: sending "your
                    // appointment is tomorrow at 3" about a row that now says
                    // Thursday is worse than sending nothing, and a retry says
                    // the same false thing.
                    //
                    // Admitted and settled in ONE transaction, then reported by
                    // the caller AFTER it commits. Throwing from in here rolled
                    // the suppression back with everything else, so the row
                    // stayed `queued` and the next pass tried again — a
                    // refusal that refused nothing.
                    await admitDispatch(query, schema, { dispatchId, leaseToken, leaseSeconds });
                    return settleDispatch(query, schema, {
                        dispatchId, leaseToken,
                        outcome: { kind: 'suppressed',
                            errorCode: `proactive_${verdict.kind}:${verdict.detail}`.slice(0, 120) },
                    });
                }
            } else if (validHumanOperatorAuthority(scope, schema, tenantId)) {
                // ── MAY THIS PERSON STILL SEND THIS? ────────────────────────
                //
                // Authentication happened at the edge, minutes or hours ago,
                // and proves who ASKED — not who may still speak. Between then
                // and now the account can be deactivated, the role reduced, the
                // user moved to another tenant. A queued message going out
                // after somebody was removed is the case an operator most
                // specifically tried to stop.
                if (scope.channelType !== current.binding.channelType
                    || scope.channelAccountId !== current.binding.channelAccountId) {
                    throw new DispatchOutboxError('dispatch_binding_changed');
                }
                const verdict = await revalidateHumanOperator(query, schema, scope);
                if (verdict.kind !== 'current') {
                    // Suppressed inside this transaction and reported after it
                    // commits, exactly as a stale policy is: throwing from in
                    // here would roll the suppression back and the next pass
                    // would send what was just revoked.
                    await admitDispatch(query, schema, { dispatchId, leaseToken, leaseSeconds });
                    return settleDispatch(query, schema, {
                        dispatchId, leaseToken,
                        outcome: { kind: 'suppressed',
                            errorCode: `human_${verdict.kind}:${verdict.detail}`.slice(0, 120) },
                    });
                }
            } else if (validServedAgentAuthority(scope, schema, tenantId)) {
                // Another agent can win this connection without changing the
                // first one's own version or hash, so the routing itself is
                // re-checked.
                //
                // ── AND A CHANGED AGENT SUPPRESSES, IT DOES NOT RETRY ───────
                //
                // This used to let `ServedAgentAuthorityError` escape, which
                // the processor reads as a retryable preflight failure: the row
                // stays available and the next pass tries again. But the
                // condition is a configuration that CHANGED — the persona was
                // edited, or another agent won this connection — and no number
                // of retries brings the old hash back. So an edited agent's
                // queued reply burned five attempts over hours against a rule
                // it could never satisfy, and only then stopped.
                //
                // The other two authorities already suppress for the same
                // shape of reason, and this is the same answer: the words were
                // composed by a persona that no longer exists in that form, and
                // delivering them later is exactly what the authority is for.
                try {
                    await assertServedAgentConnectionAuthority(query, schema, scope,
                        current.binding.channelType, current.binding.channelAccountId);
                } catch (error: any) {
                    if (!(error instanceof ServedAgentAuthorityError)) throw error;
                    // Admitted and settled in ONE transaction, reported after
                    // it commits — the same shape as a stale policy, for the
                    // same reason: throwing from in here would roll the
                    // suppression back with everything else.
                    await admitDispatch(query, schema, { dispatchId, leaseToken, leaseSeconds });
                    return settleDispatch(query, schema, {
                        dispatchId, leaseToken,
                        outcome: { kind: 'suppressed',
                            errorCode: `agent_${error.code}`.slice(0, 120) },
                    });
                }
            } else {
                throw new DispatchOutboxError('dispatch_authority_required');
            }
            // Words derived from a retired example may not go out under a new
            // permission, even though the words themselves have not changed.
            for (const footprint of [...(current.learningFootprint || [])]
                .sort((a, b) => String(a?.agentId).localeCompare(String(b?.agentId)))) {
                await assertRuntimeLearningFootprint(query, schema,
                    { tenantId, agentId: footprint?.agentId }, footprint, { mode: 'admission' });
            }
            // The destination binding is checked inside `admitDispatch`, in this
            // same transaction and against all FOUR identifiers. It used to be
            // checked here as well, on three of them and with a different rule
            // about a NULL connection — two answers to one question, in one
            // transaction, which is how the two drift apart.
            return admitDispatch(query, schema, { dispatchId, leaseToken, leaseSeconds });
        });
        // Only a granted permission is timed. A refused admission is a different
        // event with a different distribution, and folding the two together
        // would let a burst of cheap rejections hide a slow admission path.
        await recordDispatchLatency(this.redis, 'admit', Date.now() - startedAt);
        // Reported after the commit, so the suppression is durable before
        // anybody is told about it.
        if (row.state === 'suppressed') throw new DispatchOutboxError('dispatch_effect_superseded');
        return { schemaName: schema, leaseToken, row };
    }

    /** Record what the attempt this lease authorized actually produced. */
    async settle(tenantId: string, dispatchId: string, leaseToken: string,
        outcome: DispatchOutcome): Promise<DispatchRow> {
        const schema = await this.schemaFor(tenantId);
        const startedAt = Date.now();
        const row = await this.prisma.transactionInTenantSchema(schema, async query => {
            await this.privacy(query, schema, tenantId);
            return settleDispatch(query, schema, { dispatchId, leaseToken, outcome });
        });
        // Timed after it committed, and never on the throwing path: a settle that
        // failed is the reconciliation the outbox already reports, not a latency
        // sample. Recording it would make the distribution look better the more
        // often the write broke.
        await recordDispatchLatency(this.redis, 'settle', Date.now() - startedAt);
        return row;
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

    /**
     * Drop the content of terminal rows past the retention window.
     *
     * Deliberately NOT inside the privacy fence the erasure paths take. Those
     * hold it exclusively so a retraction cannot interleave with a turn; this is
     * a scheduled sweep over rows nothing can send any more, and blocking every
     * turn of a tenant for it would trade a real cost for no guarantee.
     */
    async redactSettled(tenantId: string, options: { olderThanDays?: number; limit?: number } = {}): Promise<number> {
        const schema = await this.schemaFor(tenantId);
        return this.prisma.transactionInTenantSchema(schema, query =>
            redactSettledDispatchOutbox(query, schema, options));
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
