import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { OnEvent } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { BillingEventType } from '../billing/types/billing-event.enum';
import { FiscalConfigService, FiscalConfig } from './fiscal-config.service';
import { FiscalProviderFactory } from './fiscal-provider.factory';
import { FISCAL_MAX_ATTEMPTS, FISCAL_QUEUE, FiscalJobData } from './fiscal.constants';
import { FiscalAcquirer } from './interfaces/fiscal-provider.interface';
import { RedisService } from '../redis/redis.service';
import { tenantPurgingFenceKey } from '../../common/utils/tenant-lifecycle.util';
import { Cron } from '@nestjs/schedule';

/** Shape of the EventEmitter2 payload billing.service emits for payment events. */
interface BillingEventPayload {
    tenantId?: string;
    subscriptionId?: string;
    paymentId?: string;
    providerPaymentId?: string;
    amountCents?: number;
    currency?: string;
    event?: {
        provider?: string;
        payment?: {
            providerPaymentId?: string;
            amountCents?: number;
            currency?: string;
            paidAt?: string | Date;
        };
    };
}

/**
 * Orchestrates fiscal invoice issuance, fully decoupled from the payment
 * provider. Listens to the NORMALIZED billing events (so MercadoPago today and
 * Stripe tomorrow behave identically), creates a FiscalInvoice row, and hands
 * the actual provider call to the BullMQ processor (async, retryable — never
 * blocks the payment).
 */
@Injectable()
export class FiscalInvoiceService {
    private readonly logger = new Logger(FiscalInvoiceService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly config: FiscalConfigService,
        private readonly factory: FiscalProviderFactory,
        @InjectQueue(FISCAL_QUEUE) private readonly queue: Queue<FiscalJobData>,
        private readonly redis: RedisService,
    ) {}

    /**
     * Serialize invoice creation with purge's tenant checkpoint. The shared row
     * lock means either the invoice commits before purge deactivates/stamps it,
     * or creation observes purgeSaga.startedAt and is rejected.
     */
    private async withTenantPurgeGate<T>(
        tenantId: string,
        work: (tx: any) => Promise<T>,
    ): Promise<T | null> {
        if (await this.redis.get(tenantPurgingFenceKey(tenantId))) return null;
        return this.prisma.$transaction(async (tx: any) => {
            const rows = await tx.$queryRawUnsafe(
                `SELECT settings->'purgeSaga'->>'startedAt' AS purge_started_at
                   FROM public.tenants
                  WHERE id = $1::uuid
                  FOR SHARE`,
                tenantId,
            ) as Array<{ purge_started_at: string | null }>;
            if (!rows[0] || rows[0].purge_started_at) return null;
            return work(tx);
        });
    }

    @OnEvent(BillingEventType.PAYMENT_SUCCEEDED)
    async onPaymentSucceeded(payload: BillingEventPayload): Promise<void> {
        try {
            const tenantId = payload.tenantId;
            const charge = payload.event?.payment;
            const providerPaymentId = payload.providerPaymentId ?? charge?.providerPaymentId;
            if (!tenantId || (!payload.paymentId && !providerPaymentId)) {
                return; // not enough context to issue a fiscal document
            }

            const cfg = await this.config.getConfig();
            const tenant = await this.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { billingCountry: true, settings: true, isInternal: true },
            });
            if (!tenant) return;

            const payment = await this.prisma.billingPayment.findUnique({
                where: payload.paymentId
                    ? { id: payload.paymentId }
                    : { providerPaymentId: providerPaymentId! },
                select: { id: true, amountCents: true, currency: true, metadata: true },
            });
            if (!payment) {
                this.logger.warn(`[Fiscal] BillingPayment ${payload.paymentId ?? providerPaymentId} not found — cannot link invoice`);
                return;
            }

            const provider = this.factory.resolve(cfg.mode, tenant.billingCountry);

            // Idempotency: one fiscal invoice per payment.
            const existing = await this.prisma.fiscalInvoice.findUnique({ where: { paymentId: payment.id } });
            if (existing && existing.status !== 'blocked_config') {
                this.logger.debug(`[Fiscal] Invoice already exists for payment ${payment.id} — skipping`);
                return;
            }

            // A DIAN consecutive is a finite, paid resource, and an invoice
            // asserts a SALE. These two cases are not sales, so they get a
            // recorded decision instead of a document: the row keeps the
            // one-per-payment invariant (nothing is issued twice, nothing is
            // silently missing) and shows up in /admin/fiscal as skipped.
            // El riel de cobro y el fiscal se configuran por separado, y ya se
            // cruzaron una vez: pagos de prueba de Wompi en sandbox emitiendo
            // facturas DIAN reales contra plata que no existió. Sandbox se
            // registra como omitido; un origen desconocido queda bloqueado para
            // revisión. Nunca se adivina el ambiente de un movimiento de dinero.
            const paymentMetadata = payment.metadata as any ?? {};
            const railEnvironment = paymentMetadata.railEnvironment;
            const internalAtPayment = Object.prototype.hasOwnProperty.call(paymentMetadata, 'tenantInternalAtPayment')
                ? paymentMetadata.tenantInternalAtPayment === true
                : tenant.isInternal; // legacy payments predate the immutable snapshot
            const skipReason = internalAtPayment
                ? 'tenant_internal_use'
                : railEnvironment === 'sandbox'
                    ? 'test_mode_payment'
                    : payment.amountCents <= 0
                        ? 'no_consideration'
                        : null;
            if (skipReason) {
                if (!existing) {
                    await this.recordSkippedIssuance(tenantId, payment, provider?.name ?? 'unresolved', skipReason);
                }
                return;
            }

            if (!provider) {
                if (!existing) {
                    await this.recordBlockedIssuance(
                        tenantId,
                        payment,
                        'unresolved',
                        'billing_country_missing_or_not_routed',
                    );
                }
                this.logger.error(`[Fiscal] Payment ${payment.id} has no fiscal provider; durable blocked_config row created`);
                return;
            }

            // Phased rollout: stay dormant until the provider is actually
            // configured (Factus creds + numbering range). This makes deploying
            // the fiscal layer before go-live a no-op instead of generating
            // doomed-to-fail invoices + Sentry noise on real payments.
            // Deliberately AFTER the skip decisions and without a row: this one
            // is a transient config gap, not a ruling on the payment.
            if (!this.isProviderReady(provider.name, cfg, railEnvironment)) {
                if (!existing) {
                    await this.recordBlockedIssuance(
                        tenantId,
                        payment,
                        provider.name,
                        'fiscal_provider_not_ready',
                    );
                }
                this.logger.warn(`[Fiscal] ${provider.name} not configured yet — payment ${payment.id} is blocked_config and retryable`);
                return;
            }

            if (existing?.status === 'blocked_config') {
                await this.prisma.fiscalInvoice.update({
                    where: { id: existing.id },
                    data: {
                        status: 'pending',
                        provider: provider.name,
                        failureReason: null,
                        acquirerSnapshot: (this.extractAcquirer(tenant.settings) ?? undefined) as any,
                    },
                });
                await this.enqueue({ fiscalInvoiceId: existing.id, kind: 'issue' });
                return;
            }

            const acquirer = this.extractAcquirer(tenant.settings);
            const invoice: any = await this.withTenantPurgeGate(tenantId, (tx) =>
                tx.fiscalInvoice.create({
                    data: {
                        tenantId,
                        paymentId: payment.id,
                        type: 'invoice',
                        status: 'pending',
                        provider: provider.name,
                        amountCents: payment.amountCents,
                        currency: payment.currency,
                        acquirerSnapshot: acquirer ? (acquirer as any) : undefined,
                    },
                }));
            if (!invoice) return;

            await this.enqueue({ fiscalInvoiceId: invoice.id, kind: 'issue' });
            this.logger.log(`[Fiscal] Queued invoice ${invoice.id} for tenant=${tenantId} (${provider.name})`);
        } catch (err: any) {
            // Never let fiscal issuance break the billing event pipeline.
            this.logger.error(`[Fiscal] onPaymentSucceeded failed: ${err?.message}`);
        }
    }

    @OnEvent(BillingEventType.PAYMENT_REFUNDED)
    async onPaymentRefunded(payload: BillingEventPayload): Promise<void> {
        try {
            const tenantId = payload.tenantId;
            const charge = payload.event?.payment;
            const providerPaymentId = payload.providerPaymentId ?? charge?.providerPaymentId;
            if (!tenantId || (!payload.paymentId && !providerPaymentId)) return;

            const payment = await this.prisma.billingPayment.findUnique({
                where: payload.paymentId ? { id: payload.paymentId } : { providerPaymentId: providerPaymentId! },
                select: { id: true, currency: true, amountCents: true, metadata: true },
            });
            if (!payment) return;

            const original = await this.prisma.fiscalInvoice.findFirst({
                where: { paymentId: payment.id, type: 'invoice', status: 'issued' },
            });
            if (!original) {
                this.logger.warn(`[Fiscal] Refunded payment ${payment.id} has no issued invoice yet — reconciliation will create the note after issuance`);
                return;
            }

            const refundLockKey = `lock:fiscal:refund:${original.id}`;
            const refundLockToken = await this.redis.acquireLockToken(refundLockKey, 120).catch(() => null);
            if (!refundLockToken) return; // durable payment metadata lets the cron retry
            try {

            const cfg = await this.config.getConfig();
            if (!this.isProviderReady(
                original.provider,
                cfg,
                (payment.metadata as any)?.railEnvironment,
            )) {
                this.logger.warn(`[Fiscal] ${original.provider} not configured — skipping credit note for ${original.id}`);
                return;
            }

            const targetRefundedCents = Math.min(
                payment.amountCents,
                Math.max(
                    0,
                    Number((payment.metadata as any)?.refundedAmountCents
                        ?? payload.amountCents
                        ?? charge?.amountCents
                        ?? original.amountCents),
                ),
            );
            const credited = await this.prisma.fiscalInvoice.aggregate({
                where: {
                    relatedInvoiceId: original.id,
                    type: 'credit_note',
                    status: { not: 'cancelled' },
                },
                _sum: { amountCents: true },
            });
            const refundCents = targetRefundedCents - (credited._sum.amountCents ?? 0);
            if (refundCents <= 0) return;
            const creditNote: any = await this.withTenantPurgeGate(tenantId, (tx) =>
                tx.fiscalInvoice.create({
                    data: {
                        tenantId,
                        paymentId: null, // standalone; linked via relatedInvoiceId
                        type: 'credit_note',
                        status: 'pending',
                        provider: original.provider,
                        relatedInvoiceId: original.id,
                        amountCents: refundCents,
                        currency: payment.currency,
                        acquirerSnapshot: (original.acquirerSnapshot as any) ?? undefined,
                    },
                }));
            if (!creditNote) return;

            await this.enqueue({ fiscalInvoiceId: creditNote.id, kind: 'credit_note' });
            this.logger.log(`[Fiscal] Queued credit note ${creditNote.id} for original ${original.id}`);
            } finally {
                await this.redis.releaseLockToken(refundLockKey, refundLockToken).catch(() => undefined);
            }
        } catch (err: any) {
            this.logger.error(`[Fiscal] onPaymentRefunded failed: ${err?.message}`);
        }
    }

    /** Re-enqueue a failed/pending invoice for another issuance attempt (super admin retry). */
    async requeue(fiscalInvoiceId: string): Promise<boolean> {
        const inv = await this.prisma.fiscalInvoice.findUnique({ where: { id: fiscalInvoiceId } });
        // 'cancelled' y 'skipped' son decisiones tomadas: reintentar tiene que
        // ser incapaz de resucitarlas y gastar un consecutivo que ya se decidió
        // no gastar. 'issued' ya consumió el suyo.
        if (!inv || ['issued', 'cancelled', 'skipped'].includes(inv.status)) return false;
        if (inv.status === 'blocked_config') {
            if (!inv.paymentId) return false;
            await this.onPaymentSucceeded({ tenantId: inv.tenantId, paymentId: inv.paymentId });
            const fresh = await this.prisma.fiscalInvoice.findUnique({ where: { id: inv.id } });
            return fresh?.status === 'pending';
        }
        const updated = await this.withTenantPurgeGate(inv.tenantId, (tx) =>
            tx.fiscalInvoice.update({
                where: { id: fiscalInvoiceId },
                data: { status: 'pending', failureReason: null },
            }));
        if (!updated) return false;
        await this.enqueue({ fiscalInvoiceId, kind: inv.type === 'credit_note' ? 'credit_note' : 'issue' });
        this.logger.log(`[Fiscal] Re-queued ${inv.type} ${fiscalInvoiceId} for retry`);
        return true;
    }

    /**
     * Anular una factura que TODAVÍA no consumió consecutivo.
     *
     * Es el contrapeso de `requeue`: una factura creada por un cobro que no
     * era una venta quedaba en 'pending' esperando que alguien tocara
     * "Reintentar", y no había forma de bajarla. Sólo aplica antes de la DIAN —
     * si ya tiene CUFE o número, el documento existe y anularlo es una nota
     * crédito, no un cambio de estado.
     */
    async cancelPending(fiscalInvoiceId: string, reason: string): Promise<
        { ok: true } | { ok: false; error: 'not_found' | 'already_issued' }
    > {
        const inv = await this.prisma.fiscalInvoice.findUnique({ where: { id: fiscalInvoiceId } });
        if (!inv) return { ok: false, error: 'not_found' };
        if (inv.cufe || inv.invoiceNumber || inv.status === 'issued') {
            return { ok: false, error: 'already_issued' };
        }
        await this.prisma.fiscalInvoice.update({
            where: { id: fiscalInvoiceId },
            data: {
                status: 'cancelled',
                metadata: { ...(inv.metadata as any ?? {}), cancelReason: reason } as any,
            },
        });
        this.logger.warn(
            `[Fiscal] Invoice ${fiscalInvoiceId} (tenant=${inv.tenantId}) cancelled before issuance — ${reason}. `
            + 'No DIAN consecutive was consumed.',
        );
        return { ok: true };
    }

    private async enqueue(data: FiscalJobData): Promise<void> {
        const jobId = `fiscal.${data.fiscalInvoiceId}.${data.kind}`;
        if (typeof (this.queue as any).getJob === 'function') {
            const existing = await this.queue.getJob(jobId);
            if (existing) {
                const state = await existing.getState().catch(() => 'unknown');
                if (['waiting', 'active', 'delayed', 'prioritized', 'waiting-children'].includes(state)) return;
                await existing.remove().catch(() => undefined);
            }
        }
        await this.queue.add(data.kind, data, {
            jobId,
            attempts: FISCAL_MAX_ATTEMPTS,
            backoff: { type: 'exponential', delay: 30_000 },
            removeOnComplete: { age: 86_400 },
            removeOnFail: { age: 7 * 86_400 },
        });
    }

    /**
     * Is the resolved provider actually usable? Factus needs API credentials
     * (env) AND a numbering range (config). us_remote has no external deps.
     * Used to keep the fiscal layer dormant until go-live configuration exists.
     */
    private isProviderReady(providerName: string, cfg: FiscalConfig, railEnvironment?: string): boolean {
        // Fiscal issuance always needs positive proof that real money moved.
        // This is independent from the legal issuer: US_REMOTE receipts must
        // not turn a legacy/unknown (or sandbox) rail into a sale either.
        if (railEnvironment !== 'production') return false;
        if (providerName === 'factus') {
            const e = process.env;
            const creds = !!(e.FACTUS_CLIENT_ID && e.FACTUS_CLIENT_SECRET && e.FACTUS_USERNAME && e.FACTUS_PASSWORD);
            // Sandbox payments were already recorded as skipped. Anything that
            // reaches Factus must be positively identified as a production
            // charge and must use the production fiscal account/range. `unknown`
            // stays blocked_config until operations classifies/backfills it.
            const environmentMatches = cfg.factusEnvironment === 'production';
            return creds && !!cfg.factusNumberingRangeId && environmentMatches;
        }
        return true;
    }

    /**
     * Record that a payment was deliberately NOT invoiced.
     *
     * Written as a `fiscal_invoices` row rather than only a log line so the
     * decision is queryable next to the documents it replaces, and so the
     * UNIQUE(payment_id) still holds: a payment can never end up with both a
     * skip and an invoice, and a later replay cannot quietly issue one.
     */
    private async recordSkippedIssuance(
        tenantId: string,
        payment: { id: string; amountCents: number; currency: string },
        providerName: string,
        reason: 'tenant_internal_use' | 'test_mode_payment' | 'no_consideration',
    ): Promise<void> {
        const row = await this.withTenantPurgeGate(tenantId, (tx) =>
            tx.fiscalInvoice.create({
                data: {
                    tenantId,
                    paymentId: payment.id,
                    type: 'invoice',
                    status: 'skipped',
                    provider: providerName,
                    amountCents: payment.amountCents,
                    currency: payment.currency,
                    metadata: { skipReason: reason } as any,
                },
            }));
        if (!row) return;
        this.logger.log(
            `[Fiscal] Payment ${payment.id} (tenant=${tenantId}) not invoiced — ${reason}. `
            + 'No DIAN consecutive was consumed.',
        );
    }

    private async recordBlockedIssuance(
        tenantId: string,
        payment: { id: string; amountCents: number; currency: string },
        providerName: string,
        reason: string,
    ): Promise<void> {
        await this.withTenantPurgeGate(tenantId, (tx) => tx.fiscalInvoice.create({
            data: {
                tenantId,
                paymentId: payment.id,
                type: 'invoice',
                status: 'blocked_config',
                provider: providerName,
                amountCents: payment.amountCents,
                currency: payment.currency,
                failureReason: reason,
                metadata: { blockReason: reason } as any,
            },
        }));
    }

    /** Durable payment→invoice repair for a lost event or a config gap. */
    @Cron('17,47 * * * *')
    async reconcilePaymentInvoices(): Promise<{ discovered: number; retried: number }> {
        const missing = await this.prisma.$queryRawUnsafe(
            `SELECT p.id, p.tenant_id, p.provider_payment_id, p.amount_cents, p.currency
               FROM public.billing_payments p
               LEFT JOIN public.fiscal_invoices f ON f.payment_id = p.id
              WHERE p.status IN ('succeeded', 'refunded') AND f.id IS NULL
              ORDER BY p.created_at ASC
              LIMIT 500`,
        ) as Array<{
            id: string;
            tenant_id: string;
            provider_payment_id: string | null;
            amount_cents: number;
            currency: string;
        }>;
        for (const payment of missing) {
            await this.onPaymentSucceeded({
                tenantId: payment.tenant_id,
                paymentId: payment.id,
                providerPaymentId: payment.provider_payment_id ?? undefined,
                amountCents: payment.amount_cents,
                currency: payment.currency,
            });
        }

        // Do not page blindly over every blocked row. Some blocks are
        // deliberately permanent until an operator changes the underlying
        // facts (unknown rail environment, non-routed country, missing Factus
        // production configuration). If 200 of those older rows sit at the
        // front of the table, a simple ORDER BY created_at LIMIT 200 starves
        // every later payment forever. Select only rows that the *current*
        // fiscal configuration can actually move to pending.
        const cfg = await this.config.getConfig();
        const factusReadyForProduction = this.isProviderReady('factus', cfg, 'production');
        const blocked = await this.prisma.$queryRawUnsafe(
            `SELECT f.id, f.tenant_id, f.payment_id, p.provider_payment_id
               FROM public.fiscal_invoices f
               JOIN public.billing_payments p ON p.id = f.payment_id
               JOIN public.tenants t ON t.id = f.tenant_id
              WHERE f.status = 'blocked_config'
                AND p.metadata->>'railEnvironment' = 'production'
                AND (
                    $1::text = 'US_REMOTE'
                    OR (
                        $1::text = 'CO_LOCAL'
                        AND $2::boolean
                        AND UPPER(COALESCE(t.billing_country, '')) = 'CO'
                    )
                )
              ORDER BY f.created_at ASC, f.id ASC
              LIMIT 200`,
            cfg.mode,
            factusReadyForProduction,
        ) as Array<{
            id: string;
            tenant_id: string;
            payment_id: string;
            provider_payment_id: string | null;
        }>;
        let retried = 0;
        for (const invoice of blocked) {
            await this.onPaymentSucceeded({
                tenantId: invoice.tenant_id,
                paymentId: invoice.payment_id,
                providerPaymentId: invoice.provider_payment_id ?? undefined,
            });
            const fresh = await this.prisma.fiscalInvoice.findUnique({ where: { id: invoice.id } });
            if (fresh?.status === 'pending') retried++;
        }

        // A refund may precede DIAN validation. The payment carries its durable
        // cumulative refund total, so once the original becomes issued this
        // sweep creates exactly the missing delta note.
        const refunded = await this.prisma.$queryRawUnsafe(
            `SELECT p.id, p.tenant_id, p.provider_payment_id
               FROM public.billing_payments p
               JOIN public.fiscal_invoices f
                 ON f.payment_id = p.id AND f.type = 'invoice' AND f.status = 'issued'
               LEFT JOIN LATERAL (
                    SELECT COALESCE(SUM(cn.amount_cents), 0)::bigint AS credited_cents
                      FROM public.fiscal_invoices cn
                     WHERE cn.related_invoice_id = f.id
                       AND cn.type = 'credit_note'
                       AND cn.status <> 'cancelled'
               ) credit ON TRUE
              WHERE LEAST(
                        p.amount_cents::bigint,
                        CASE
                          WHEN COALESCE(p.metadata->>'refundedAmountCents', '') ~ '^[0-9]+$'
                            THEN (p.metadata->>'refundedAmountCents')::bigint
                          WHEN p.status = 'refunded' THEN p.amount_cents::bigint
                          ELSE 0
                        END
                    ) > credit.credited_cents
              ORDER BY p.created_at ASC
              LIMIT 500`,
        ) as Array<{ id: string; tenant_id: string; provider_payment_id: string | null }>;
        for (const payment of refunded) {
            await this.onPaymentRefunded({
                tenantId: payment.tenant_id,
                paymentId: payment.id,
                providerPaymentId: payment.provider_payment_id ?? undefined,
            });
        }
        return { discovered: missing.length, retried };
    }

    /** Map Tenant.settings.fiscalData (JSONB) into a FiscalAcquirer, or null if absent. */
    private extractAcquirer(settings: unknown): FiscalAcquirer | null {
        const fd = (settings as any)?.fiscalData;
        if (!fd || !fd.documentId) return null;
        return {
            documentType: String(fd.documentType ?? ''),
            documentId: String(fd.documentId),
            dv: fd.dv ? String(fd.dv) : undefined,
            legalOrganizationId: String(fd.legalOrganizationId ?? '2'),
            businessName: fd.businessName || undefined,
            names: fd.names || undefined,
            tributeId: fd.tributeId ? String(fd.tributeId) : undefined,
            address: fd.address || undefined,
            municipalityId: fd.municipalityId ? String(fd.municipalityId) : undefined,
            daneCode: fd.daneCode || undefined,
            email: fd.email || undefined,
            phone: fd.phone || undefined,
        };
    }
}
