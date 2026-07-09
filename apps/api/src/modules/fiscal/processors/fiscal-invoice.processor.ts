import { Logger } from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma/prisma.service';
import { FiscalConfigService } from '../fiscal-config.service';
import { FiscalProviderFactory } from '../fiscal-provider.factory';
import { FactusAdapter } from '../adapters/factus.adapter';
import { FiscalStorageService } from '../fiscal-storage.service';
import { CONSUMIDOR_FINAL_ACQUIRER, FISCAL_MAX_ATTEMPTS, FISCAL_QUEUE, FiscalJobData } from '../fiscal.constants';
import { FiscalAcquirer, FiscalIssueResult } from '../interfaces/fiscal-provider.interface';

/**
 * Worker that performs the actual fiscal provider call. Runs async so a slow or
 * failing fiscal step NEVER blocks the payment. Retryable transient errors are
 * re-thrown (BullMQ backoff); non-retryable validation failures (bad/missing
 * fiscal data, DIAN rejection) are marked failed and escalated, not retried.
 */
@Processor(FISCAL_QUEUE, { concurrency: 3 })
export class FiscalInvoiceProcessor extends WorkerHost {
    private readonly logger = new Logger(FiscalInvoiceProcessor.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly config: FiscalConfigService,
        private readonly factory: FiscalProviderFactory,
        private readonly factus: FactusAdapter,
        private readonly storage: FiscalStorageService,
    ) {
        super();
    }

    async process(job: Job<FiscalJobData>): Promise<unknown> {
        const { fiscalInvoiceId } = job.data;
        const inv = await this.prisma.fiscalInvoice.findUnique({ where: { id: fiscalInvoiceId } });
        if (!inv) {
            this.logger.warn(`[Fiscal] Invoice ${fiscalInvoiceId} not found — dropping job`);
            return;
        }
        // Idempotent — but a Factus invoice is only truly done once it has a CUFE
        // (DIAN-validated). An 'issued' row without a CUFE is still pending and must
        // be re-checked, so don't short-circuit it.
        if (inv.status === 'issued' && (inv.provider !== 'factus' || inv.cufe)) return;

        const tenant = await this.prisma.tenant.findUnique({
            where: { id: inv.tenantId },
            select: { billingCountry: true, settings: true },
        });
        const cfg = await this.config.getConfig();
        const provider = this.factory.resolve(cfg.mode, tenant?.billingCountry);
        if (!provider) {
            await this.markFailed(inv.id, 'no_provider');
            return;
        }

        // Acquirer: prefer the immutable snapshot taken at creation; fall back to
        // current tenant fiscal data.
        let acquirer =
            (inv.acquirerSnapshot as FiscalAcquirer | null) ?? this.extractAcquirer(tenant?.settings);

        // Colombia requires a fiscal document for EVERY sale. When the tenant was
        // charged before completing its fiscal profile, issue to the DIAN
        // "consumidor final" (adquirente no identificado, 222222222222) — the
        // legally-valid B2C fallback a POS uses — instead of failing. The tenant
        // is warned (checkout + billing) that missing data means this. We persist
        // the fallback snapshot so the archived record/PDF reflects who it was
        // issued to, and a retry of a previously-failed invoice now succeeds.
        let consumidorFinalFallback = false;
        if (provider.name === 'factus' && (!acquirer || !acquirer.documentId)) {
            acquirer = CONSUMIDOR_FINAL_ACQUIRER;
            consumidorFinalFallback = true;
            this.logger.warn(
                `[Fiscal] Invoice ${inv.id} (tenant=${inv.tenantId}) has no fiscal data — issuing to consumidor final (DIAN 222222222222)`,
            );
        }

        // FX → COP (only when the charge currency differs and a provider needs COP).
        let copAmountCents: number | undefined;
        let trmApplied: number | undefined;
        if (provider.name === 'factus' && inv.currency && inv.currency.toUpperCase() !== 'COP') {
            const rate = await this.latestRate(inv.currency, 'COP');
            if (rate) {
                trmApplied = rate;
                copAmountCents = Math.round(inv.amountCents * rate);
            } else {
                this.logger.warn(`[Fiscal] No ${inv.currency}->COP rate; issuing with original amount for ${inv.id}`);
            }
        }

        await this.prisma.fiscalInvoice.update({
            where: { id: inv.id },
            data: {
                attempts: { increment: 1 },
                // Record the consumidor-final fallback on the row so the branded
                // PDF and audit reflect the acquirer it was actually issued to.
                ...(consumidorFinalFallback ? { acquirerSnapshot: acquirer as any } : {}),
            },
        });

        const ivaTreatment = cfg.coIvaTreatment;
        const acq = (acquirer || {}) as FiscalAcquirer;
        let result: FiscalIssueResult;

        try {
            if (inv.type === 'credit_note') {
                const original = inv.relatedInvoiceId
                    ? await this.prisma.fiscalInvoice.findUnique({ where: { id: inv.relatedInvoiceId } })
                    : null;
                if (!original?.providerRef) {
                    await this.markFailed(inv.id, 'missing_original_provider_ref');
                    return;
                }
                result = await provider.issueCreditNote({
                    referenceCode: inv.id,
                    tenantId: inv.tenantId,
                    originalProviderRef: original.providerRef,
                    amountCents: copAmountCents ?? inv.amountCents,
                    currency: provider.name === 'factus' ? 'COP' : inv.currency,
                    description: `${cfg.itemDescription} — Reembolso`,
                    acquirer: acq,
                    ivaTreatment,
                    reason: 'Reembolso',
                });
            } else {
                result = await provider.issue({
                    referenceCode: inv.id,
                    tenantId: inv.tenantId,
                    amountCents: inv.amountCents,
                    copAmountCents,
                    currency: inv.currency,
                    description: await this.buildDescription(inv.paymentId, cfg.itemDescription),
                    acquirer: acq,
                    ivaTreatment,
                });
            }
        } catch (err: any) {
            const isFinal = job.attemptsMade + 1 >= (job.opts.attempts ?? FISCAL_MAX_ATTEMPTS);
            await this.prisma.fiscalInvoice.update({
                where: { id: inv.id },
                data: { failureReason: String(err?.message).slice(0, 500), status: isFinal ? 'failed' : 'pending' },
            });
            if (isFinal) this.escalate(inv.id, inv.tenantId, err?.message || 'unknown');
            throw err; // let BullMQ retry until attempts exhausted
        }

        if (result.status === 'failed') {
            await this.prisma.fiscalInvoice.update({
                where: { id: inv.id },
                data: {
                    status: 'failed',
                    failureReason: (result.failureReason || 'validation_failed').slice(0, 500),
                    metadata: { ...(inv.metadata as object), raw: result.raw } as any,
                },
            });
            this.escalate(inv.id, inv.tenantId, result.failureReason || 'validation_failed');
            return; // non-retryable
        }

        if (result.status === 'pending') {
            // Factus accepted the bill but the DIAN hasn't validated it yet (no CUFE),
            // so it has no QR / official PDF. Persist the provider ref/number and keep
            // the invoice 'pending'; throw so BullMQ retries and polls — issue()
            // reconciles the existing bill by reference on each attempt until the CUFE
            // appears. Never marked 'issued' without a CUFE.
            const isFinal = job.attemptsMade + 1 >= (job.opts.attempts ?? FISCAL_MAX_ATTEMPTS);
            await this.prisma.fiscalInvoice.update({
                where: { id: inv.id },
                data: {
                    status: 'pending',
                    providerRef: result.providerRef ?? inv.providerRef ?? undefined,
                    invoiceNumber: result.invoiceNumber ?? inv.invoiceNumber ?? undefined,
                    failureReason: (result.failureReason || 'pendiente_validacion_dian').slice(0, 500),
                },
            });
            this.logger.warn(
                `[Fiscal] Invoice ${inv.id} accepted by Factus, pending DIAN validation (no CUFE yet)${isFinal ? ' — attempts exhausted, will stay pending' : ''}`,
            );
            if (!isFinal) throw new Error('Factus bill pending DIAN validation'); // retry → poll
            return;
        }

        const fiscalCurrency = provider.name === 'factus' ? 'COP' : inv.currency;

        // Archive the official PDF/XML for the 5-year legal retention and expose
        // our own authenticated endpoints as the canonical document URLs.
        let pdfUrl: string | undefined = result.pdfUrl ?? undefined; // fallback: provider public_url
        let xmlUrl: string | undefined = result.xmlUrl ?? undefined;
        if (provider.name === 'factus' && result.invoiceNumber) {
            try {
                const pdfBuf = await this.factus.downloadPdf(result.invoiceNumber);
                if (pdfBuf) this.storage.save(inv.tenantId, inv.id, 'pdf', pdfBuf);
                const xmlBuf = await this.factus.downloadXml(result.invoiceNumber);
                if (xmlBuf) this.storage.save(inv.tenantId, inv.id, 'xml', xmlBuf);
            } catch (e: any) {
                this.logger.warn(`[Fiscal] Could not archive PDF/XML for ${inv.id}: ${e?.message}`);
            }
            pdfUrl = `/fiscal/${inv.tenantId}/invoices/${inv.id}/pdf`;
            xmlUrl = `/fiscal/${inv.tenantId}/invoices/${inv.id}/xml`;
        }

        await this.prisma.fiscalInvoice.update({
            where: { id: inv.id },
            data: {
                status: 'issued',
                providerRef: result.providerRef ?? undefined,
                invoiceNumber: result.invoiceNumber ?? undefined,
                cufe: result.cufe ?? undefined,
                qrUrl: result.qrUrl ?? undefined,
                pdfUrl,
                xmlUrl,
                taxCents: result.taxCents ?? 0,
                currency: fiscalCurrency,
                issuedAt: new Date(),
                failureReason: null,
                metadata: {
                    ...(inv.metadata as object),
                    trmApplied: trmApplied ?? null,
                    factusPublicUrl: result.pdfUrl ?? null,
                    consumidorFinalFallback: consumidorFinalFallback || undefined,
                    raw: result.raw,
                } as any,
            },
        });

        // Mirror onto BillingPayment for the existing receipt-download UI.
        if (inv.paymentId && result.invoiceNumber) {
            await this.prisma.billingPayment
                .update({
                    where: { id: inv.paymentId },
                    data: { invoiceNumber: result.invoiceNumber, invoicePdfUrl: pdfUrl ?? undefined },
                })
                .catch(() => undefined);
        }

        this.logger.log(`[Fiscal] Issued ${inv.type} ${inv.id} → ${result.invoiceNumber ?? result.providerRef}`);
        return { status: 'issued', number: result.invoiceNumber };
    }

    @OnWorkerEvent('failed')
    onFailed(job: Job<FiscalJobData>, err: Error) {
        this.logger.warn(`[Fiscal] Job ${job.id} (${job.data?.fiscalInvoiceId}) failed attempt ${job.attemptsMade}: ${err?.message}`);
    }

    private async markFailed(id: string, reason: string): Promise<void> {
        await this.prisma.fiscalInvoice.update({ where: { id }, data: { status: 'failed', failureReason: reason } });
        this.logger.warn(`[Fiscal] Invoice ${id} marked failed: ${reason}`);
    }

    /** Permanent failure = silent fiscal non-compliance. Log loudly + Sentry. */
    private escalate(id: string, tenantId: string, reason: string): void {
        this.logger.error(`[FISCAL][ESCALATE] Invoice ${id} (tenant=${tenantId}) failed permanently: ${reason}`);
        // Sentry is initialized globally in instrument.ts; captureException is a
        // no-op when it isn't, so this is safe to call unconditionally.
        Sentry.captureException(new Error(`Fiscal invoice ${id} failed: ${reason}`), {
            tags: { module: 'fiscal', tenantId },
        });
    }

    /** Compose the invoice line description: config base + plan name when available. */
    private async buildDescription(paymentId: string | null, base: string): Promise<string> {
        if (!paymentId) return base;
        const pay = await this.prisma.billingPayment
            .findUnique({ where: { id: paymentId }, include: { subscription: { include: { plan: true } } } })
            .catch(() => null);
        const planName = (pay as any)?.subscription?.plan?.name;
        return planName ? `${base} — ${planName}` : base;
    }

    private async latestRate(from: string, to: string): Promise<number | null> {
        const row = await this.prisma.exchangeRate.findFirst({
            where: { fromCurrency: from.toUpperCase(), toCurrency: to.toUpperCase() },
            orderBy: { rateDate: 'desc' },
        });
        return row ? Number(row.rate) : null;
    }

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
