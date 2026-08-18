import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CronLockService } from '../redis/cron-lock.service';
import { TenantPaymentStoreService } from './tenant-payment-store.service';
import { TenantPaymentsService } from './tenant-payments.service';

/**
 * The safety net for tenant-owned customer payments.
 *
 * Wompi commerce events are the fast path, but they are not guaranteed: the
 * events secret can be pasted wrong, the events URL can be missing from the
 * Wompi dashboard entirely, and retries can be exhausted while containers are
 * being recreated during a deploy. Before this sweep existed, any of those left
 * the customer charged and the order unpaid FOREVER — the poll path needed a
 * provider transaction id that only the lost webhook could have written.
 *
 * This closes the loop from the other side: the payment link id is known at
 * creation time, so it survives a lost event and can be used to ask the
 * provider what actually happened.
 */
@Injectable()
export class TenantPaymentReconciliationService {
    private readonly logger = new Logger(TenantPaymentReconciliationService.name);

    /**
     * Old enough that the webhook has had every chance to win, short enough
     * that a paying customer is not left waiting on an unpaid order.
     */
    private static readonly MIN_AGE_MINUTES = 15;
    /** Bounded so one tenant with a backlog cannot starve the others. */
    private static readonly PER_TENANT_LIMIT = 50;

    constructor(
        private readonly prisma: PrismaService,
        private readonly store: TenantPaymentStoreService,
        private readonly payments: TenantPaymentsService,
        private readonly cronLock: CronLockService,
    ) {}

    /**
     * Runs in ONE instance only: the API and the worker load the same AppModule
     * with ScheduleModule, so without the lock this body runs twice, in two
     * processes, milliseconds apart — two concurrent settlements racing on the
     * same payment. See CronLockService.
     */
    @Cron('*/10 * * * *')
    async reconcileOrphanIntentsCron(): Promise<void> {
        await this.cronLock.runExclusive(
            'tenant-payments.reconcileOrphanIntents',
            300,
            () => this.reconcileOrphanIntents(),
            { prefer: 'worker' },
        );
    }

    /**
     * Also callable directly (an operator forcing a reconciliation), which is
     * why the lock lives in the cron wrapper and not in here.
     */
    async reconcileOrphanIntents(): Promise<{ scanned: number; settled: number }> {
        let scanned = 0;
        let settled = 0;

        let tenants: Array<{ id: string }> = [];
        try {
            tenants = await this.prisma.tenant.findMany({
                where: { isActive: true },
                select: { id: true },
            });
        } catch (error: any) {
            this.logger.warn(`Could not list tenants for payment reconciliation: ${error.message}`);
            return { scanned, settled };
        }

        for (const tenant of tenants) {
            let orphans;
            try {
                orphans = await this.store.findWompiIntentsAwaitingProviderEvidence(
                    tenant.id,
                    TenantPaymentReconciliationService.MIN_AGE_MINUTES,
                    TenantPaymentReconciliationService.PER_TENANT_LIMIT,
                );
            } catch (error: any) {
                // A tenant without the payment tables (never configured a
                // provider) is the common case here, not an incident.
                this.logger.debug(
                    `Skipping payment reconciliation for tenant ${tenant.id}: ${error.message}`,
                );
                continue;
            }
            if (!orphans.length) continue;

            for (const intent of orphans) {
                scanned++;
                try {
                    const { outcome, intent: recovered } = await this.payments.recoverWompiIntentFromProvider(
                        tenant.id,
                        intent,
                        'reconciliation',
                    );
                    if (outcome === 'settled' && recovered && recovered.status !== 'pending') {
                        settled++;
                        this.logger.warn(
                            `[TenantPayments] Recovered intent ${intent.id} for tenant ${tenant.id} `
                            + `as '${recovered.status}' WITHOUT a commerce event — the tenant's Wompi `
                            + 'events URL or events secret is very likely misconfigured.',
                        );
                    }
                } catch (error: any) {
                    // One bad intent must never abort the sweep for the rest.
                    this.logger.warn(
                        `Payment reconciliation failed for intent ${intent.id}: ${error.message}`,
                    );
                }
            }
        }

        if (scanned > 0) {
            this.logger.log(
                `[TenantPayments] Reconciliation sweep: ${scanned} intent(s) without provider evidence, ${settled} settled`,
            );
        }
        return { scanned, settled };
    }
}
