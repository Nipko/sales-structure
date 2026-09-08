import { Injectable, Logger } from '@nestjs/common';
import { hasAgentSourceFence } from '../../common/utils/agent-source-fence';
import { PrismaService } from '../prisma/prisma.service';
import {
    TURN_LEDGER_DDL, TurnLedgerError,
    openTurnLedger, readTurnLedger, recordTurnDelivery, recordTurnHandoff,
    recordTurnResult, redactTurnLedger, settleTurnLedger,
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
            }).catch(error => { this.initialized.delete(schema); throw error; });
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

    async settle(schema: string, inboundMessageId: string): Promise<void> {
        try {
            await this.run(schema, query => settleTurnLedger(query, schema, inboundMessageId));
        } catch (error: any) {
            this.logger.warn(`[TurnLedger] turn not settled for ${inboundMessageId}: ${error?.message}`);
        }
    }

    /** Erasure by contact or by withdrawn release. Reaches the stored envelope. */
    async redact(schema: string, scope: TurnLedgerRedactionScope): Promise<number> {
        return this.run(schema, query => redactTurnLedger(query, schema, scope));
    }
}
