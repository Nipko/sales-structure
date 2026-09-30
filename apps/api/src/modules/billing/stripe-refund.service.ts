import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StripeAdapter } from './adapters/stripe.adapter';
import { ProviderRefund, ProviderRefundSnapshot } from './adapters/payment-provider.interface';
import { BillingEventType } from './types/billing-event.enum';
import { NormalizedBillingEvent } from './types/provider-types';

const OPEN = ['reserved', 'unknown', 'pending', 'needs_review'];
// Stripe may prune idempotency keys after 24h. Leave an hour of margin;
// after this deadline recovery is read-only, followed by explicit review.
const REPLAY_WINDOW_MS = 23 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface RefundOperationResult {
    providerPaymentId: string;
    partialAmountCents: number | null;
    operationId: string;
    status: 'succeeded' | 'pending' | 'failed' | 'needs_review';
    errorCode?: string;
}

@Injectable()
export class StripeRefundService {
    private readonly logger = new Logger(StripeRefundService.name);

    constructor(private readonly prisma: PrismaService, private readonly adapter: StripeAdapter, private readonly events: EventEmitter2) {}

    private result(operation: any, payment: any): RefundOperationResult {
        return { providerPaymentId: payment.providerPaymentId, partialAmountCents: operation.requestedFull ? null : operation.amountCents,
            operationId: operation.id, status: (payment.metadata as any)?.stripeRefundNeedsReview ? 'needs_review'
                : ['succeeded', 'failed', 'needs_review'].includes(operation.status) ? operation.status : 'pending',
            ...(operation.errorCode ? { errorCode: operation.errorCode } : {}) };
    }

    private assertReplay(operation: any, input: { paymentId: string; amountCents?: number; reason?: string }) {
        if (operation.paymentId !== input.paymentId || operation.requestedFull !== (input.amountCents === undefined)
            || (input.amountCents !== undefined && operation.amountCents !== input.amountCents)
            || (operation.reason ?? null) !== (input.reason ?? null)) {
            throw new ConflictException({ error: 'refund_request_conflict' });
        }
    }

    async refundPayment(input: { paymentId: string; amountCents?: number; reason?: string; actorUserId?: string; requestId?: string; expectedRefundedAmountCents?: number }): Promise<RefundOperationResult> {
        const id = input.requestId;
        if (!id || !UUID.test(id)) throw new BadRequestException({ error: 'invalid_refund_request_id' });
        await this.prisma.$transaction(async tx => {
            await tx.$queryRawUnsafe('SELECT id FROM billing_payments WHERE id = $1::uuid FOR UPDATE', input.paymentId);
            const existing = await tx.billingRefundOperation.findUnique({ where: { id } });
            if (existing) { this.assertReplay(existing, input); return; }
            const payment = await tx.billingPayment.findUnique({ where: { id: input.paymentId } });
            if (!payment) throw new NotFoundException({ error: 'payment_not_found' });
            if (payment.provider !== 'stripe' || !payment.providerPaymentId) throw new BadRequestException({ error: 'missing_provider_payment_id' });
            const pending = await tx.billingRefundOperation.findFirst({ where: { paymentId: payment.id, status: { in: OPEN } } });
            if (pending || (payment.metadata as any)?.stripeRefundNeedsReview || (payment.metadata as any)?.refundPendingTotalCents != null) {
                throw new ConflictException({ error: 'refund_in_progress', operationId: pending?.id });
            }
            if (payment.status !== 'succeeded') throw new BadRequestException({ error: 'cannot_refund' });
            const refunded = Number((payment.metadata as any)?.refundedAmountCents ?? 0);
            if (input.expectedRefundedAmountCents !== undefined && input.expectedRefundedAmountCents !== refunded) {
                throw new ConflictException({ error: 'refund_balance_changed' });
            }
            const remaining = payment.amountCents - refunded;
            const amountCents = input.amountCents ?? remaining;
            if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw new BadRequestException({ error: 'invalid_refund_amount' });
            if (amountCents > remaining) throw new BadRequestException({ error: 'refund_exceeds_payment' });
            await tx.billingRefundOperation.create({ data: { id, paymentId: payment.id, amountCents, currency: payment.currency,
                requestedFull: input.amountCents === undefined, actorUserId: input.actorUserId, reason: input.reason } });
        });
        return this.process(id);
    }

    private assertSnapshot(payment: any, snapshot: ProviderRefundSnapshot) {
        const environment = payment.metadata?.railEnvironment;
        if (snapshot.currency !== payment.currency.toUpperCase() || snapshot.amountPaidCents !== payment.amountCents
            || (environment === 'production' && snapshot.livemode !== true)
            || (environment === 'sandbox' && snapshot.livemode !== false)
            || !Number.isSafeInteger(snapshot.succeededAmountCents) || snapshot.succeededAmountCents > payment.amountCents) {
            throw new Error('stripe_refund_identity_mismatch');
        }
    }

    private match(operation: any, snapshot: ProviderRefundSnapshot): ProviderRefund | undefined {
        const matches = snapshot.refunds.filter(r => r.operationId === operation.id || r.id === operation.providerRefundId);
        if (matches.length > 1) throw new Error('stripe_refund_operation_duplicate');
        const refund = matches[0];
        if (refund && (refund.amountCents !== operation.amountCents || refund.currency !== operation.currency.toUpperCase()
            || (refund.operationId && refund.operationId !== operation.id))) throw new Error('stripe_refund_identity_mismatch');
        return refund;
    }

    /** Both the HTTP request and the cron reclaim the same durable operation. */
    async process(id: string): Promise<RefundOperationResult> {
        let operation = await this.prisma.billingRefundOperation.findUnique({ where: { id }, include: { payment: true } });
        if (!operation) throw new NotFoundException({ error: 'refund_operation_not_found' });
        if (!OPEN.includes(operation.status)) return this.result(operation, operation.payment);
        const token = randomUUID();
        const now = new Date();
        const claimed = await this.prisma.billingRefundOperation.updateMany({ where: { id, status: { in: OPEN },
            OR: [{ processingUntil: null }, { processingUntil: { lt: now } }] },
            data: { processingToken: token, processingUntil: new Date(now.getTime() + 180_000), attempts: { increment: 1 } } });
        if (claimed.count !== 1) return this.result(operation, operation.payment);
        let firstSubmission = false;
        let submitting = false;
        try {
            operation = await this.prisma.billingRefundOperation.findUniqueOrThrow({ where: { id }, include: { payment: true } });
            let snapshot = await this.adapter.getRefundSnapshot(operation.payment.providerPaymentId!);
            this.assertSnapshot(operation.payment, snapshot);
            let refund = this.match(operation, snapshot);
            if (!refund && operation.status !== 'needs_review') {
                if (operation.firstSubmittedAt && Date.now() - operation.firstSubmittedAt.getTime() >= REPLAY_WINDOW_MS) {
                    await this.setState(id, token, 'needs_review', 'stripe_refund_replay_window_expired');
                } else {
                    // Never use an omitted amount: a replay must have exactly the
                    // original parameters even when another refund exists remotely.
                    const reservedRemote = snapshot.refunds.filter(r => !['failed', 'canceled'].includes(r.status)).reduce((sum, r) => sum + r.amountCents, 0);
                    if (!operation.firstSubmittedAt && operation.amountCents > snapshot.amountPaidCents - reservedRemote) {
                        await this.setState(id, token, 'failed', 'refund_exceeds_payment');
                    } else {
                        const armed = await this.prisma.billingRefundOperation.updateMany({ where: { id, processingToken: token,
                            status: { in: ['reserved', 'unknown', 'pending'] } }, data: {
                            status: 'unknown', firstSubmittedAt: operation.firstSubmittedAt ?? new Date(), errorCode: null,
                        } });
                        if (armed.count !== 1) throw new Error('stripe_refund_claim_lost');
                        firstSubmission = !operation.firstSubmittedAt;
                        submitting = true;
                        const received = await this.adapter.refundPayment(operation.payment.providerPaymentId!, operation.amountCents,
                            { operationId: id, idempotencyKey: `parallly:refund:${id}` });
                        submitting = false;
                        if (received.paymentIntentId !== snapshot.paymentIntentId || received.amountCents !== operation.amountCents
                            || received.currency !== snapshot.currency || received.livemode !== snapshot.livemode || received.operationId !== id) {
                            throw new Error('stripe_refund_identity_mismatch');
                        }
                        await this.prisma.billingRefundOperation.updateMany({ where: { id, processingToken: token }, data: { providerRefundId: received.id } });
                        // A 200 response may be pending/requires_action/failed. Only
                        // a canonical succeeded refund changes payment accounting.
                        snapshot = await this.adapter.getRefundSnapshot(operation.payment.providerPaymentId!);
                        refund = this.match({ ...operation, providerRefundId: received.id }, snapshot);
                        if (!refund) throw new Error('stripe_refund_confirmation_pending');
                    }
                }
            }
            await this.applySnapshot(operation.payment.id);
        } catch (error: any) {
            // After submission, transport errors and 5xx are not proof of failure.
            // Even a later parameter/authentication error cannot erase an earlier
            // uncertain POST. Canonical failed/canceled refunds release the fence.
            const fresh = await this.prisma.billingRefundOperation.findUnique({ where: { id } });
            const beforeSubmission = !fresh?.firstSubmittedAt;
            const notRefundable = error?.getResponse?.()?.error === 'stripe_payment_not_refundable';
            const rejected = firstSubmission && submitting && ['StripeInvalidRequestError', 'StripeAuthenticationError', 'StripePermissionError'].includes(error?.type)
                && [400, 401, 403, 404, 422].includes(error?.statusCode);
            const definitive = (beforeSubmission && notRefundable) || rejected;
            await this.setState(id, token, definitive ? 'failed' : 'unknown', definitive
                ? (notRefundable ? 'stripe_payment_not_refundable' : 'stripe_refund_rejected') : 'stripe_refund_confirmation_pending');
            this.logger.warn(`Stripe refund ${id} awaits canonical confirmation`);
        } finally {
            await this.prisma.billingRefundOperation.updateMany({ where: { id, processingToken: token }, data: {
                processingToken: null, processingUntil: null, nextCheckAt: new Date(Date.now() + 300_000),
            } });
        }
        const updated = await this.prisma.billingRefundOperation.findUniqueOrThrow({ where: { id }, include: { payment: true } });
        return this.result(updated, updated.payment);
    }

    private async setState(id: string, token: string, status: string, errorCode: string) {
        await this.prisma.billingRefundOperation.updateMany({ where: { id, processingToken: token, status: { in: ['reserved', 'unknown', 'pending'] } }, data: { status, errorCode } });
    }

    /** One payment row lock serializes HTTP recovery and webhook settlement. */
    private async applySnapshot(paymentId: string, event?: NormalizedBillingEvent) {
        const result = await this.prisma.$transaction(async tx => {
            await tx.$queryRawUnsafe('SELECT id FROM billing_payments WHERE id = $1::uuid FOR UPDATE', paymentId);
            const payment = await tx.billingPayment.findUniqueOrThrow({ where: { id: paymentId } });
            if (event && await tx.billingEvent.findUnique({ where: { provider_providerEventId: { provider: 'stripe', providerEventId: event.providerEventId } } })) return null;
            // Read canonical state AFTER obtaining the shared payment lock.
            // A stale pre-lock snapshot must not overwrite a later webhook.
            // No provider mutation runs in this transaction.
            const snapshot = await this.adapter.getRefundSnapshot(payment.providerPaymentId!);
            this.assertSnapshot(payment, snapshot);
            const operations = await tx.billingRefundOperation.findMany({ where: { paymentId } });
            let needsReview = false;
            for (const operation of operations) {
                const refund = this.match(operation, snapshot);
                if (!refund) continue;
                const lateFailure = operation.status === 'succeeded' && ['failed', 'canceled'].includes(refund.status);
                if (lateFailure || operation.errorCode === 'stripe_refund_late_failure') needsReview = true;
                const status = lateFailure ? 'needs_review' : operation.status === 'succeeded' || refund.status === 'succeeded' ? 'succeeded'
                    : ['failed', 'canceled'].includes(refund.status) ? 'failed' : 'pending';
                await tx.billingRefundOperation.update({ where: { id: operation.id }, data: { providerRefundId: refund.id,
                    status: operation.errorCode === 'stripe_refund_late_failure' ? 'needs_review' : status,
                    errorCode: lateFailure ? 'stripe_refund_late_failure' : operation.errorCode === 'stripe_refund_late_failure' ? operation.errorCode
                        : status === 'failed' ? 'stripe_refund_failed' : null } });
            }
            const previous = Number((payment.metadata as any)?.refundedAmountCents ?? 0);
            // A late bank failure needs an accounting correction, not a second
            // credit note or a silently reduced historical refund total.
            const accountedIds: string[] = Array.isArray((payment.metadata as any)?.stripeAccountedRefundIds)
                ? (payment.metadata as any).stripeAccountedRefundIds : [];
            if (snapshot.refunds.some(r => accountedIds.includes(r.id) && ['failed', 'canceled'].includes(r.status))) needsReview = true;
            const total = Math.max(previous, snapshot.succeededAmountCents);
            const delta = total - previous;
            if (delta || needsReview) await tx.billingPayment.update({ where: { id: paymentId }, data: {
                status: total >= payment.amountCents ? 'refunded' : payment.status,
                metadata: { ...(payment.metadata as any), refundedAmountCents: total,
                    stripeAccountedRefundIds: [...new Set([...accountedIds, ...snapshot.refunds.filter(r => r.status === 'succeeded').map(r => r.id)])],
                    ...(needsReview ? { stripeRefundNeedsReview: true } : {}) },
            } });
            if (event) await tx.billingEvent.create({ data: { tenantId: payment.tenantId, subscriptionId: payment.subscriptionId,
                provider: 'stripe', providerEventId: event.providerEventId, eventType: event.type, payload: event.rawPayload as any } });
            if (delta || needsReview) await tx.auditLog.create({ data: { tenantId: payment.tenantId,
                action: needsReview ? 'stripe_refund_review_required' : 'payment_refunded', resource: `billing_payments/${payment.id}`,
                details: { canonicalTotalCents: snapshot.succeededAmountCents, accountedTotalCents: total,
                    refundedAmountCents: delta, operationIds: operations.map(o => o.id) } } });
            return { payment, delta };
        }, { timeout: 120_000 });
        if (result?.delta) this.events.emit(BillingEventType.PAYMENT_REFUNDED, { tenantId: result.payment.tenantId,
            subscriptionId: result.payment.subscriptionId, paymentId, providerPaymentId: result.payment.providerPaymentId,
            amountCents: result.delta, currency: result.payment.currency,
            event: { provider: 'stripe', payment: { providerPaymentId: result.payment.providerPaymentId,
                amountCents: result.delta, currency: result.payment.currency, status: 'refunded' } } });
        return { processed: result !== null, ...(result === null ? { reason: 'duplicate' } : {}) };
    }

    async handleEvent(event: NormalizedBillingEvent) {
        if (!event.providerPaymentId) throw new BadRequestException({ error: 'stripe_refund_payment_missing' });
        const payment = await this.prisma.billingPayment.findFirst({ where: { provider: 'stripe', providerPaymentId: event.providerPaymentId } });
        if (!payment) throw new ServiceUnavailableException({ error: 'stripe_refund_payment_pending' });
        return this.applySnapshot(payment.id, event);
    }

    async reconcilePending(): Promise<{ scanned: number; finalized: number; errors: number }> {
        const rows = await this.prisma.billingRefundOperation.findMany({ where: { status: { in: OPEN }, nextCheckAt: { lte: new Date() } },
            orderBy: { nextCheckAt: 'asc' }, take: 25, select: { id: true } });
        let finalized = 0;
        let errors = 0;
        for (const row of rows) {
            try { if (['succeeded', 'failed'].includes((await this.process(row.id)).status)) finalized++; }
            catch { errors++; }
        }
        return { scanned: rows.length, finalized, errors };
    }

    async resolve(input: { paymentId: string; operationId: string; providerRefundId?: string; confirmNotCreated?: boolean; reason: string; actorUserId?: string }) {
        if (!input.reason?.trim() || input.reason.trim().length < 10 || (!!input.providerRefundId === !!input.confirmNotCreated)) {
            throw new BadRequestException({ error: 'refund_resolution_invalid' });
        }
        const operation = await this.prisma.billingRefundOperation.findUnique({ where: { id: input.operationId }, include: { payment: true } });
        if (!operation || operation.paymentId !== input.paymentId) throw new NotFoundException({ error: 'refund_operation_not_found' });
        if (operation.status !== 'needs_review' || !['stripe_refund_replay_window_expired', 'stripe_refund_legacy_pending'].includes(operation.errorCode ?? '')) {
            throw new ConflictException({ error: 'refund_resolution_not_allowed' });
        }
        const snapshot = await this.adapter.getRefundSnapshot(operation.payment.providerPaymentId!);
        this.assertSnapshot(operation.payment, snapshot);
        const matched = this.match(operation, snapshot);
        if (matched) { await this.applySnapshot(input.paymentId); return this.process(operation.id); }
        const refund = input.providerRefundId ? snapshot.refunds.find(r => r.id === input.providerRefundId) : undefined;
        if (input.providerRefundId && (!refund || refund.amountCents !== operation.amountCents || refund.currency !== operation.currency
            || (refund.operationId && refund.operationId !== operation.id))) throw new BadRequestException({ error: 'stripe_refund_identity_mismatch' });
        await this.prisma.$transaction(async tx => {
            await tx.$queryRawUnsafe('SELECT id FROM billing_payments WHERE id = $1::uuid FOR UPDATE', input.paymentId);
            if (refund && await tx.billingRefundOperation.findFirst({ where: { providerRefundId: refund.id, id: { not: operation.id } } })) {
                throw new ConflictException({ error: 'stripe_refund_already_bound' });
            }
            const updated = await tx.billingRefundOperation.updateMany({ where: { id: operation.id, status: 'needs_review',
                errorCode: operation.errorCode, OR: [{ processingUntil: null }, { processingUntil: { lt: new Date() } }] },
                data: refund ? { providerRefundId: refund.id, status: 'pending', errorCode: null }
                    : { status: 'failed', errorCode: 'stripe_refund_absence_confirmed' } });
            if (updated.count !== 1) throw new ConflictException({ error: 'refund_in_progress', operationId: operation.id });
            if (operation.errorCode === 'stripe_refund_legacy_pending') {
                await tx.$executeRawUnsafe(`UPDATE billing_payments SET metadata = metadata - 'refundPendingAmountCents' - 'refundPendingTotalCents'
                    - 'refundPendingCheckCount' - 'refundPendingNextCheckAt' WHERE id = $1::uuid`, input.paymentId);
            }
            await tx.auditLog.create({ data: { tenantId: operation.payment.tenantId, userId: input.actorUserId,
                action: 'stripe_refund_manually_resolved', resource: `billing_refund_operations/${operation.id}`,
                details: { reason: input.reason, providerRefundId: refund?.id ?? null, confirmedNotCreated: !refund } } });
        });
        return this.process(operation.id);
    }
}
