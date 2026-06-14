import { Logger } from '@nestjs/common';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { FiscalConfigService } from '../fiscal-config.service';
import { FiscalProviderFactory } from '../fiscal-provider.factory';
import { FISCAL_MAX_ATTEMPTS, FISCAL_QUEUE, FiscalJobData } from '../fiscal.constants';
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
        if (inv.status === 'issued') return; // idempotent

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
        const acquirer =
            (inv.acquirerSnapshot as FiscalAcquirer | null) ?? this.extractAcquirer(tenant?.settings);

        if (provider.name === 'factus' && (!acquirer || !acquirer.documentId)) {
            await this.markFailed(inv.id, 'missing_fiscal_data');
            this.escalate(inv.id, inv.tenantId, 'missing_fiscal_data');
            return; // non-retryable until the tenant completes its fiscal profile
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

        await this.prisma.fiscalInvoice.update({ where: { id: inv.id }, data: { attempts: { increment: 1 } } });

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
                    description: 'Reembolso suscripción Parallly',
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
                    description: 'Suscripción Parallly',
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

        const fiscalCurrency = provider.name === 'factus' ? 'COP' : inv.currency;
        await this.prisma.fiscalInvoice.update({
            where: { id: inv.id },
            data: {
                status: 'issued',
                providerRef: result.providerRef ?? undefined,
                invoiceNumber: result.invoiceNumber ?? undefined,
                cufe: result.cufe ?? undefined,
                qrUrl: result.qrUrl ?? undefined,
                pdfUrl: result.pdfUrl ?? undefined,
                xmlUrl: result.xmlUrl ?? undefined,
                taxCents: result.taxCents ?? 0,
                currency: fiscalCurrency,
                issuedAt: new Date(),
                failureReason: null,
                metadata: {
                    ...(inv.metadata as object),
                    trmApplied: trmApplied ?? null,
                    raw: result.raw,
                } as any,
            },
        });

        // Mirror onto BillingPayment for the existing receipt-download UI.
        if (inv.paymentId && result.invoiceNumber) {
            await this.prisma.billingPayment
                .update({
                    where: { id: inv.paymentId },
                    data: { invoiceNumber: result.invoiceNumber, invoicePdfUrl: result.pdfUrl ?? undefined },
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
        try {
            // Optional Sentry capture — required-but-via-require so the build does
            // not hard-depend on the types here.
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const Sentry = require('@sentry/nestjs');
            Sentry?.captureException?.(new Error(`Fiscal invoice ${id} failed: ${reason}`), {
                tags: { module: 'fiscal', tenantId },
            });
        } catch {
            /* Sentry optional */
        }
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
