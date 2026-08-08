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

/** Shape of the EventEmitter2 payload billing.service emits for payment events. */
interface BillingEventPayload {
    tenantId?: string;
    subscriptionId?: string;
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
            if (!tenantId || !charge?.providerPaymentId) {
                return; // not enough context to issue a fiscal document
            }

            const cfg = await this.config.getConfig();
            const tenant = await this.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { billingCountry: true, settings: true },
            });
            if (!tenant) return;

            const provider = this.factory.resolve(cfg.mode, tenant.billingCountry);
            if (!provider) {
                this.logger.debug(`[Fiscal] No provider for tenant=${tenantId} — skipping issuance`);
                return;
            }

            // Phased rollout: stay dormant until the provider is actually
            // configured (Factus creds + numbering range). This makes deploying
            // the fiscal layer before go-live a no-op instead of generating
            // doomed-to-fail invoices + Sentry noise on real payments.
            if (!this.isProviderReady(provider.name, cfg)) {
                this.logger.warn(`[Fiscal] ${provider.name} not configured yet — skipping issuance for tenant ${tenantId}`);
                return;
            }

            const payment = await this.prisma.billingPayment.findUnique({
                where: { providerPaymentId: charge.providerPaymentId },
                select: { id: true, amountCents: true, currency: true },
            });
            if (!payment) {
                this.logger.warn(`[Fiscal] BillingPayment ${charge.providerPaymentId} not found — cannot link invoice`);
                return;
            }

            // Idempotency: one fiscal invoice per payment.
            const existing = await this.prisma.fiscalInvoice.findUnique({ where: { paymentId: payment.id } });
            if (existing) {
                this.logger.debug(`[Fiscal] Invoice already exists for payment ${payment.id} — skipping`);
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
            if (!tenantId || !charge?.providerPaymentId) return;

            const payment = await this.prisma.billingPayment.findUnique({
                where: { providerPaymentId: charge.providerPaymentId },
                select: { id: true, currency: true },
            });
            if (!payment) return;

            const original = await this.prisma.fiscalInvoice.findFirst({
                where: { paymentId: payment.id, type: 'invoice', status: 'issued' },
            });
            if (!original) {
                this.logger.warn(`[Fiscal] No issued invoice for refunded payment ${payment.id} — no credit note`);
                return;
            }

            const cfg = await this.config.getConfig();
            if (!this.isProviderReady(original.provider, cfg)) {
                this.logger.warn(`[Fiscal] ${original.provider} not configured — skipping credit note for ${original.id}`);
                return;
            }

            const refundCents = charge.amountCents ?? original.amountCents;
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
        } catch (err: any) {
            this.logger.error(`[Fiscal] onPaymentRefunded failed: ${err?.message}`);
        }
    }

    /** Re-enqueue a failed/pending invoice for another issuance attempt (super admin retry). */
    async requeue(fiscalInvoiceId: string): Promise<boolean> {
        const inv = await this.prisma.fiscalInvoice.findUnique({ where: { id: fiscalInvoiceId } });
        if (!inv || inv.status === 'issued') return false;
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

    private async enqueue(data: FiscalJobData): Promise<void> {
        await this.queue.add(data.kind, data, {
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
    private isProviderReady(providerName: string, cfg: FiscalConfig): boolean {
        if (providerName === 'factus') {
            const e = process.env;
            const creds = !!(e.FACTUS_CLIENT_ID && e.FACTUS_CLIENT_SECRET && e.FACTUS_USERNAME && e.FACTUS_PASSWORD);
            return creds && !!cfg.factusNumberingRangeId;
        }
        return true;
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
