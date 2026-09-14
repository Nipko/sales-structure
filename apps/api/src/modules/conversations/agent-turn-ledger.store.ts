import { Injectable, Logger } from '@nestjs/common';
import type { TurnOutcome } from '@parallext/shared';
import { hasAgentSourceFence } from '../../common/utils/agent-source-fence';
import { PrismaService } from '../prisma/prisma.service';
import {
    TURN_LEDGER_DDL, TurnLedgerError,
    openTurnLedger, readRecentTurnOutcomes, readTurnLedger, recordTurnDelivery, recordTurnHandoff,
    recordTurnOutcome, recordTurnResult, redactTurnLedger, settleTurnLedger,
    type RecentTurnOutcome,
    type TurnBinding, type TurnDeliveryRoute, type TurnEnvelope, type TurnHandoffRecord,
    type TurnLedgerRedactionScope, type TurnLedgerRow, type TurnWriterRecord,
} from './agent-turn-ledger';

/**
 * Owns the transactions the turn ledger runs in.
 *
 * Every statement is its own transaction on purpose. The ledger records what
 * already happened; holding it open across a model call or a provider request
 * would put the busiest path in the system behind a database transaction for
 * the length of an external call.
 */
@Injectable()
export class AgentTurnLedgerStore {
    private readonly logger = new Logger(AgentTurnLedgerStore.name);
    private readonly initialized = new Map<string, Promise<void>>();

    constructor(private readonly prisma: PrismaService) {}

    private assertSchema(schema: string): void {
        if (!/^tenant_[a-z0-9_]+$/.test(schema)) throw new TurnLedgerError('turn_ledger_tenant_unavailable');
        if (hasAgentSourceFence(this.prisma, schema)) throw new TurnLedgerError('turn_ledger_nested_source_fence');
    }

    /** Bootstrap outside every fence, once per schema per process. */
    private async ready(schema: string): Promise<void> {
        this.assertSchema(schema);
        if (!this.initialized.has(schema)) {
            const initialize = this.prisma.transactionInTenantSchema(schema, async query => {
                await query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))::text',
                    [`turn-ledger-bootstrap:${schema}`]);
                for (const statement of TURN_LEDGER_DDL) await query(statement);
            }, { schemaLock: true }).catch(error => { this.initialized.delete(schema); throw error; });
            this.initialized.set(schema, initialize);
        }
        await this.initialized.get(schema);
    }

    private async run<T>(schema: string, work: (query: <R = any[]>(sql: string, params?: any[]) => Promise<R>) => Promise<T>): Promise<T> {
        await this.ready(schema);
        return this.prisma.transactionInTenantSchema(schema, async query => {
            await query('SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))::text', [`agent-privacy:${schema}`]);
            return work(query);
        });
    }

    /**
     * Claim the inbound and report what a previous attempt left behind.
     *
     * Returning `null` means the ledger could not answer — not that the turn is
     * new. The caller keeps its old behaviour in that case and says so in the
     * log, because a silent "nothing ran" would authorise regenerating a turn
     * whose writers already committed.
     */
    async open(schema: string, binding: TurnBinding): Promise<TurnLedgerRow | null> {
        try {
            return await this.run(schema, query => openTurnLedger(query, schema, binding));
        } catch (error: any) {
            if (error instanceof TurnLedgerError && error.code === 'turn_ledger_binding_mismatch') throw error;
            this.logger.error(`[TurnLedger] unavailable for ${binding.inboundMessageId}: ${error?.message}`);
            return null;
        }
    }

    async read(schema: string, inboundMessageId: string): Promise<TurnLedgerRow | null> {
        try {
            return await this.run(schema, query => readTurnLedger(query, schema, inboundMessageId));
        } catch (error: any) {
            this.logger.error(`[TurnLedger] read unavailable for ${inboundMessageId}: ${error?.message}`);
            return null;
        }
    }

    /** The envelope commits before a single effect leaves the process. */
    async recordResult(schema: string, input: {
        inboundMessageId: string;
        envelope: TurnEnvelope;
        writers?: readonly TurnWriterRecord[];
        agentId?: string | null;
        agentVersion?: number | null;
        operationalScope?: Record<string, any>;
    }): Promise<TurnLedgerRow | null> {
        try {
            return await this.run(schema, query => recordTurnResult(query, schema, input));
        } catch (error: any) {
            this.logger.error(`[TurnLedger] result not recorded for ${input.inboundMessageId}: ${error?.message}`);
            return null;
        }
    }

    async recordDelivery(schema: string, inboundMessageId: string, route: TurnDeliveryRoute): Promise<void> {
        try {
            await this.run(schema, query => recordTurnDelivery(query, schema, { inboundMessageId, route }));
        } catch (error: any) {
            this.logger.warn(`[TurnLedger] delivery route not recorded for ${inboundMessageId}: ${error?.message}`);
        }
    }

    async recordHandoff(schema: string, inboundMessageId: string, handoff: TurnHandoffRecord): Promise<void> {
        try {
            await this.run(schema, query => recordTurnHandoff(query, schema, { inboundMessageId, handoff }));
        } catch (error: any) {
            this.logger.warn(`[TurnLedger] handoff not recorded for ${inboundMessageId}: ${error?.message}`);
        }
    }

    /**
     * What this turn decided, silence included.
     *
     * A failure to record it is logged and swallowed like the other
     * non-authoritative writes here — except when the outcome itself is invalid.
     * That one rethrows: `assertTurnOutcome` refusing a `wait` that carries
     * effects is the boundary doing its job, and swallowing it would let the
     * caller believe silence was recorded while a chargeable message went out.
     */
    async recordOutcome(schema: string, inboundMessageId: string, outcome: TurnOutcome): Promise<void> {
        try {
            await this.run(schema, query => recordTurnOutcome(query, schema, { inboundMessageId, outcome }));
        } catch (error: any) {
            if (String(error?.message || '').startsWith('turn_outcome_')) throw error;
            this.logger.warn(`[TurnLedger] outcome not recorded for ${inboundMessageId}: ${error?.message}`);
        }
    }

    /**
     * Recent decisions on this conversation.
     *
     * Returns an empty list when the ledger cannot answer — and the caller must
     * read that as "we do not know", not as "nothing was said". Treating an
     * unavailable ledger as "no notice yet" errs towards speaking once too
     * often, which is the safe direction: a customer hears an answer, and the
     * cost is one message rather than a customer left in silence.
     */
    async recentOutcomes(schema: string, conversationId: string, since: Date, limit = 20):
        Promise<readonly RecentTurnOutcome[]> {
        try {
            return await this.run(schema, query =>
                readRecentTurnOutcomes(query, schema, { conversationId, since, limit }));
        } catch (error: any) {
            this.logger.warn(`[TurnLedger] recent outcomes unavailable for ${conversationId}: ${error?.message}`);
            return [];
        }
    }

    /**
     * Close the turn, and say out loud when it could not be closed.
     *
     * This used to swallow the failure at `warn`. It mattered: the result
     * constraint refused a silent turn — `outcome` with no `envelope` — so every
     * `wait` and every `suppress` failed to settle, stayed `result_recorded`
     * forever, and the only trace was a line nobody greps for. The constraint is
     * fixed; this is the half that makes the next one visible.
     *
     * Still not fatal to the turn: the customer has already been answered (or
     * deliberately not), and throwing here would undo nothing and retry an
     * effect. What changes is that the row stays in a state a sweep can find,
     * and the failure is an ERROR with the reason attached rather than a shrug.
     */
    async settle(schema: string, inboundMessageId: string): Promise<boolean> {
        try {
            await this.run(schema, query => settleTurnLedger(query, schema, inboundMessageId));
            return true;
        } catch (error: any) {
            this.logger.error(
                `[TurnLedger] turn ${inboundMessageId} is UNSETTLED and recoverable: ${error?.message}`);
            return false;
        }
    }

    /**
     * Turns that produced a result and never closed, oldest first.
     *
     * The recovery path for the failure above: a row past `open` that is not
     * `settled` is work somebody has to look at, and until this existed there
     * was no way to ask for the list.
     */
    async unsettled(schema: string, olderThan: Date, limit = 100):
        Promise<readonly { inboundMessageId: string; state: string; updatedAt: Date }[]> {
        try {
            return await this.run(schema, async query => {
                const rows = await query<any[]>(
                    `SELECT inbound_message_id, state, updated_at
                       FROM "${schema}".agent_turn_ledger
                      WHERE state <> 'settled' AND state <> 'open' AND updated_at < $1
                      ORDER BY updated_at ASC LIMIT $2`, [olderThan, limit]);
                return rows.map(row => ({
                    inboundMessageId: String(row.inbound_message_id),
                    state: String(row.state),
                    updatedAt: new Date(row.updated_at),
                }));
            });
        } catch (error: any) {
            this.logger.error(`[TurnLedger] unsettled turns unreadable for ${schema}: ${error?.message}`);
            return [];
        }
    }

    /**
     * Erasure by contact or by withdrawn release, on the caller's transaction.
     *
     * The compliance and learning-retirement paths already hold the exclusive
     * `agent-privacy` fence when they call this, so it takes their query rather
     * than opening a second transaction that could commit apart from the erasure
     * it belongs to.
     */
    async redactWithin(query: (sql: string, params?: any[]) => Promise<any>, schema: string,
        scope: TurnLedgerRedactionScope): Promise<number> {
        return redactTurnLedger(query as any, schema, scope);
    }

    /** The same erasure when the caller has no transaction of its own. */
    async redact(schema: string, scope: TurnLedgerRedactionScope): Promise<number> {
        return this.run(schema, query => redactTurnLedger(query, schema, scope));
    }
}
