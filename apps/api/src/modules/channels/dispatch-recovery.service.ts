import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CronLockService } from '../redis/cron-lock.service';
import { AgentDispatchOutboxStore } from './agent-dispatch-outbox.store';
import { OutboundQueueService } from './outbound-queue.service';

/**
 * What makes the outbox durable rather than just recorded.
 *
 * A turn commits its dispatch rows and then publishes their identifiers, and a
 * crash between those two steps used to lose a reply for good — Redis was the
 * only record. Here the rows are the record, and this pass republishes whatever
 * the queue never received or never finished.
 *
 * It also retires permissions nobody settled. Those are the dangerous ones: the
 * attempt may have reached the provider, so they are moved to reconciliation and
 * never made available again. This pass is the only place that transition
 * happens, precisely so that no admission attempt can perform it as a side
 * effect and destroy the lease a reconciler needs.
 */
@Injectable()
export class DispatchRecoveryService {
    private readonly logger = new Logger(DispatchRecoveryService.name);
    /** Bounded per tenant per pass, so one large backlog cannot starve the rest. */
    private static readonly PER_TENANT_LIMIT = 200;

    constructor(
        private readonly prisma: PrismaService,
        private readonly outbox: AgentDispatchOutboxStore,
        private readonly queue: OutboundQueueService,
        private readonly cronLock: CronLockService,
    ) {}

    // One instance only: the API and the worker load the same AppModule with
    // ScheduleModule, so without this the body runs twice.
    @Cron('*/2 * * * *')
    async recoverPendingDispatchCron(): Promise<void> {
        await this.cronLock.runExclusive('dispatch-recovery.recoverPending', 110,
            () => this.recoverPending(), { prefer: 'worker' });
    }

    async recoverPending(): Promise<{ republished: number; reconciled: number }> {
        let republished = 0, reconciled = 0;
        const tenants = await this.prisma.tenant.findMany({
            where: { isActive: true }, select: { id: true },
        });
        for (const tenant of tenants) {
            try {
                // Lapsed permissions first: a row still holding one must not be
                // republished, and this is what takes it out of that state.
                const expired = await this.outbox.expireLeases(tenant.id, DispatchRecoveryService.PER_TENANT_LIMIT);
                reconciled += expired.length;
                if (expired.length) {
                    this.logger.error(
                        `[Dispatch] ${expired.length} permission(s) lapsed unsettled for tenant ${tenant.id} — reconciliation required`);
                }
                const { rows } = await this.outbox.pending(tenant.id, DispatchRecoveryService.PER_TENANT_LIMIT);
                if (!rows.length) continue;
                // Publishing is deterministic per row, so a job that already
                // exists is left alone rather than duplicated.
                for (const row of rows) await this.queue.enqueueDispatch(tenant.id, row.id);
                // Marking after publication: a crash before this leaves the rows
                // pending, which republishes the same deterministic ids again —
                // the safe direction. Marking first could hide a lost publish.
                await this.outbox.markQueued(tenant.id, rows.map(row => row.id));
                republished += rows.length;
                this.logger.log(`[Dispatch] republished ${rows.length} pending row(s) for tenant ${tenant.id}`);
            } catch (error: any) {
                // One tenant's schema or lifecycle state must not stop the sweep.
                this.logger.warn(`[Dispatch] recovery skipped tenant ${tenant.id}: ${error?.message}`);
            }
        }
        return { republished, reconciled };
    }
}
