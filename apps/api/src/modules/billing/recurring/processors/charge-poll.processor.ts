import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { PaymentProviderFactory } from '../../payment-provider.factory';
import { PaymentProviderName } from '../../types/provider-types';
import { SubscriptionEngineService } from '../subscription-engine.service';
import { CHARGE_POLL_QUEUE } from '../renewal-scheduler.service';

const POLL_DELAYS_MS = [10_000, 30_000, 60_000, 180_000, 600_000, 1_800_000, 7_200_000];

/**
 * Asks the provider what happened to a charge it accepted but has not resolved.
 *
 * This is not a fallback for a broken webhook — it is a peer. Wompi retries a
 * webhook only 3 times in 24h and gives no delivery guarantee, so a payment that
 * really happened could otherwise never be recorded: the customer is charged and
 * the subscription still expires. Polling and the webhook converge on the same
 * settlement methods, and whichever arrives second is a no-op.
 */
@Processor(CHARGE_POLL_QUEUE, { concurrency: 4 })
export class ChargePollProcessor extends WorkerHost {
    private readonly logger = new Logger(ChargePollProcessor.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly engine: SubscriptionEngineService,
        private readonly providerFactory: PaymentProviderFactory,
        @InjectQueue(CHARGE_POLL_QUEUE) private readonly pollQueue: Queue,
    ) {
        super();
    }

    async process(job: Job<{ attemptId: string; providerChargeId?: string; pollNumber: number }>): Promise<void> {
        const { attemptId, providerChargeId, pollNumber = 0 } = job.data || ({} as any);
        if (!attemptId) return;

        const attempt = await this.prisma.billingChargeAttempt.findUnique({ where: { id: attemptId } });
        if (!attempt) return;

        // The webhook may have resolved it first — that is the happy path.
        if (['succeeded', 'failed', 'abandoned', 'stale', 'superseded'].includes(attempt.status)) {
            this.logger.debug(`[Poll] Attempt ${attemptId} already resolved as ${attempt.status}`);
            return;
        }

        const charging = this.providerFactory.getCharging(attempt.provider as PaymentProviderName);

        let charge;
        try {
            const chargeId = providerChargeId || attempt.providerTxnId;
            charge = chargeId
                ? await charging.getCharge(chargeId)
                // No provider id: the request timed out before we learned it.
                // The reference is the only handle left, and looking it up is
                // the difference between recovering the charge and either losing
                // the money or double-charging the customer.
                : await charging.getChargeByReference(attempt.reference);
        } catch (err: any) {
            this.logger.warn(`[Poll] Could not read charge for attempt ${attemptId}: ${err?.message}`);
            await this.reschedule(attemptId, providerChargeId, pollNumber);
            return;
        }

        if (!charge) {
            // The provider has no record of this reference. After the whole
            // backoff has elapsed that means the charge never landed, so the
            // cycle can be retried safely by the dunning policy.
            if (pollNumber >= POLL_DELAYS_MS.length - 1) {
                await this.engine.settleFailed(
                    attemptId,
                    { status: 'error', statusMessage: 'provider has no record of this reference' },
                    'soft',
                );
                this.logger.warn(`[Poll] Attempt ${attemptId} never reached the provider — released for retry`);
                return;
            }
            await this.reschedule(attemptId, providerChargeId, pollNumber);
            return;
        }

        if (charge.status === 'approved') {
            await this.engine.settleApproved(attemptId, charge);
            return;
        }
        if (charge.status === 'declined' || charge.status === 'error' || charge.status === 'voided') {
            await this.engine.settleFailed(attemptId, charge, this.engine.classifyFailure(charge));
            return;
        }

        // Still pending.
        if (pollNumber >= POLL_DELAYS_MS.length - 1) {
            // Two hours of PENDING is not normal. Freeze rather than guess:
            // treating it as failed could mean retrying a charge that is about
            // to settle, and treating it as settled would grant service for
            // money that never arrived.
            await this.engine.markIndeterminate(
                attemptId,
                `still PENDING after ${POLL_DELAYS_MS.length} polls`,
            );
            return;
        }
        await this.reschedule(attemptId, charge.providerChargeId || providerChargeId, pollNumber);
    }

    private async reschedule(attemptId: string, providerChargeId: string | undefined, pollNumber: number): Promise<void> {
        const next = pollNumber + 1;
        if (next >= POLL_DELAYS_MS.length) return;
        await this.pollQueue.add(
            'poll',
            { attemptId, providerChargeId, pollNumber: next },
            {
                jobId: `poll-${attemptId}-${next}`,
                attempts: 1,
                delay: POLL_DELAYS_MS[next],
                removeOnComplete: { age: 86_400 },
            },
        );
    }
}
