import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { fiscalInvoiceEmail } from '../email/email-layouts';
import { FiscalConfigService } from './fiscal-config.service';
import { FiscalPdfService } from './fiscal-pdf.service';
import { FiscalStorageService } from './fiscal-storage.service';
import { FactusAdapter } from './adapters/factus.adapter';
import { buildBrandedInvoiceData } from './fiscal-branded.util';
import { createZip, ZipEntry } from './zip.util';
import { EmailAttachment } from '../email/email.service';
import { CronLockService } from '../redis/cron-lock.service';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/**
 * Sends OUR branded PDF of an issued fiscal invoice to the acquirer, replacing
 * the payment/fiscal provider's default email (Factus `send_email` is off).
 */
@Injectable()
export class FiscalEmailService {
    private readonly logger = new Logger(FiscalEmailService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly config: FiscalConfigService,
        private readonly pdf: FiscalPdfService,
        private readonly email: EmailService,
        private readonly storage: FiscalStorageService,
        private readonly factus: FactusAdapter,
        private readonly cronLock: CronLockService,
    ) {}

    @Cron('29 * * * * *')
    async recoverCron(): Promise<void> {
        await this.cronLock.runExclusive('fiscal-email.recover', 40, () => this.recoverDue(), { prefer: 'worker' });
    }

    async recoverDue(limit = 50): Promise<number> {
        await this.prisma.$executeRawUnsafe(`UPDATE fiscal_invoices SET email_delivery_state='failed',
            email_lease_token=NULL,email_lease_expires_at=NULL,email_error_code='fiscal_email_claim_expired',
            email_next_attempt_at=NOW()
            WHERE email_delivery_state='claimed' AND email_lease_expires_at<=NOW()`);
        await this.prisma.$executeRawUnsafe(`UPDATE fiscal_invoices SET email_delivery_state='reconciliation_required',
            email_lease_token=NULL,email_lease_expires_at=NULL,email_error_code='fiscal_email_outcome_unknown',
            email_next_attempt_at=NOW()
            WHERE email_delivery_state='sending' AND email_lease_expires_at<=NOW()`);
        const bounded=Math.min(Math.max(Number(limit)||1,1),100);
        const rows=await this.prisma.$queryRawUnsafe<any[]>(`SELECT id FROM fiscal_invoices
            WHERE status='issued' AND email_delivery_state IN ('pending','failed')
              AND email_delivery_attempts<5 AND email_next_attempt_at<=NOW()
            ORDER BY created_at,id LIMIT ${bounded}`);
        for(const row of rows)await this.sendIssuedInvoice(row.id);
        return rows.length;
    }

    /**
     * Render the branded PDF and email it to the acquirer. Best-effort + idempotent
     * (guarded by `metadata.invoiceEmailSentAt`) — never throws.
     */
    async sendIssuedInvoice(invoiceId: string): Promise<void> {
        if(!UUID.test(invoiceId))return;
        const lease=randomUUID();
        let started=false;
        try {
            const claim=await this.prisma.$transaction(async(tx:any)=>{
                const rows=await tx.$queryRawUnsafe(`SELECT * FROM fiscal_invoices WHERE id=$1::uuid FOR UPDATE`,invoiceId);
                const row=rows[0];
                if(!row||row.status!=='issued')return row?.email_delivery_state||'missing';
                if(row.metadata?.invoiceEmailSentAt&&row.email_delivery_state==='pending'){
                    await tx.$executeRawUnsafe(`UPDATE fiscal_invoices SET email_delivery_state='legacy_sent',
                        email_provider_reference='legacy:invoiceEmailSentAt',email_completed_at=COALESCE(issued_at,created_at)
                        WHERE id=$1::uuid`,invoiceId);return 'legacy_sent';
                }
                if(!['pending','failed'].includes(row.email_delivery_state)||Number(row.email_delivery_attempts)>=5)
                    return row.email_delivery_state;
                await tx.$executeRawUnsafe(`UPDATE fiscal_invoices SET email_delivery_state='claimed',
                    email_delivery_attempts=email_delivery_attempts+1,email_lease_token=$2::uuid,
                    email_lease_expires_at=NOW()+INTERVAL '90 seconds',email_error_code=NULL
                    WHERE id=$1::uuid`,invoiceId,lease);return 'claimed';
            });
            if(claim!=='claimed')return;
            const inv = await this.prisma.fiscalInvoice.findUnique({ where: { id: invoiceId } });
            if (!inv || inv.status !== 'issued') {
                await this.suppress(invoiceId,lease,'fiscal_invoice_unavailable');return;
            }

            const tenant = await this.prisma.tenant.findUnique({
                where: { id: inv.tenantId },
                select: { settings: true, name: true, billingEmail: true },
            });
            const fiscalData = (tenant?.settings as any)?.fiscalData || null;

            // Recipient: the acquirer email (invoice snapshot → tenant fiscal data).
            const snap = (inv.acquirerSnapshot as any) || {};
            const to: string | null = snap.email || fiscalData?.email || tenant?.billingEmail || null;
            if (!to) {
                this.logger.warn(`[Fiscal] No acquirer email for invoice ${inv.id} — branded email skipped`);
                await this.suppress(invoiceId,lease,'fiscal_email_recipient_missing');
                return;
            }

            const cfg = await this.config.getConfig();
            let relatedInvoiceNumber: string | null = null;
            if (inv.type === 'credit_note' && inv.relatedInvoiceId) {
                const orig = await this.prisma.fiscalInvoice.findUnique({
                    where: { id: inv.relatedInvoiceId },
                    select: { invoiceNumber: true },
                });
                relatedInvoiceNumber = orig?.invoiceNumber ?? null;
            }

            const acquirerFallback = {
                businessName: tenant?.name,
                email: tenant?.billingEmail,
                ...(fiscalData || {}),
            };
            const data = buildBrandedInvoiceData(inv, cfg, acquirerFallback, relatedInvoiceNumber);
            const pdfBuffer = await this.pdf.render(data);

            const isCredit = inv.type === 'credit_note';
            const isCommercial = inv.provider === 'us_remote';
            const total = this.money(inv.amountCents, inv.currency);
            const baseName = `${isCommercial ? (isCredit ? 'nota-credito-comercial' : 'recibo-comercial') : (isCredit ? 'nota-credito' : 'factura')}-${data.invoiceNumber}`;

            // Entrega estándar: un único .zip con la factura (nuestro PDF con marca)
            // + el XML firmado (documento legal DIAN). El XML se toma del storage o
            // se descarga de Factus (best-effort).
            const zipEntries: ZipEntry[] = [{ name: `${baseName}.pdf`, data: pdfBuffer }];
            let xml: Buffer | null = null;
            if (inv.provider === 'factus' && inv.invoiceNumber && !isCredit) {
                xml = this.storage.read(inv.tenantId, inv.id, 'xml');
                if (!xml) {
                    xml = await this.factus.downloadXml(inv.invoiceNumber).catch(() => null);
                    if (xml) this.storage.save(inv.tenantId, inv.id, 'xml', xml);
                }
                if (xml) zipEntries.push({ name: `${baseName}.xml`, data: xml });
                else this.logger.warn(`[Fiscal] XML no disponible para el zip en ${inv.id}`);
            }
            const zipBuffer = createZip(zipEntries);
            const attachments: EmailAttachment[] = [
                { filename: `${baseName}.zip`, content: zipBuffer, contentType: 'application/zip' },
            ];

            const send = this.email.prepareBoundedSend({
                to,
                subject: `${isCommercial ? (isCredit ? 'Nota de crédito comercial' : 'Recibo comercial') : (isCredit ? 'Nota crédito' : 'Factura')} ${data.invoiceNumber} — ${data.issuerName}`,
                html: fiscalInvoiceEmail({
                    recipientName: data.acquirerName,
                    invoiceNumber: data.invoiceNumber,
                    total,
                    issuerName: data.issuerName,
                    cufe: data.cufe,
                    isCredit,
                    hasXml: !!xml,
                    commercial: isCommercial,
                }),
                attachments,
            });
            const began=await this.prisma.$executeRawUnsafe(`UPDATE fiscal_invoices SET email_delivery_state='sending',
                email_started_at=NOW() WHERE id=$1::uuid AND email_delivery_state='claimed'
                  AND email_lease_token=$2::uuid AND email_lease_expires_at>NOW()`,invoiceId,lease);
            if(Number(began)!==1)return;
            started=true;
            const receipt=await send();
            if(!receipt)throw new Error('fiscal_email_provider_no_receipt');
            const settled=await this.prisma.$executeRawUnsafe(`UPDATE fiscal_invoices SET email_delivery_state='sent',
                email_provider_reference=$3,email_completed_at=NOW(),email_lease_token=NULL,email_lease_expires_at=NULL,
                email_error_code=NULL,metadata=COALESCE(metadata,'{}'::jsonb)||jsonb_build_object('invoiceEmailSentAt',NOW()::text)
                WHERE id=$1::uuid AND email_delivery_state='sending' AND email_lease_token=$2::uuid`,
            invoiceId,lease,String(receipt).slice(0,512));
            if(Number(settled)!==1)throw new Error('fiscal_email_lease_lost_after_send');
            this.logger.log(`[Fiscal] Branded invoice email sent to ${to} for ${inv.id}`);
        } catch (err: any) {
            await this.prisma.$executeRawUnsafe(`UPDATE fiscal_invoices SET
                email_delivery_state=$3,email_error_code=$4,email_lease_token=NULL,email_lease_expires_at=NULL,
                email_next_attempt_at=CASE WHEN $3='failed' THEN NOW()+INTERVAL '30 seconds' ELSE email_next_attempt_at END
                WHERE id=$1::uuid AND email_lease_token=$2::uuid`,invoiceId,lease,
            started?'reconciliation_required':'failed',started?'fiscal_email_outcome_unknown':String(err?.message||'fiscal_email_preflight_failed').slice(0,160))
                .catch(()=>undefined);
            this.logger.error(`[Fiscal] sendIssuedInvoice(${invoiceId}) failed: ${err?.message}`);
        }
    }

    private async suppress(id:string,lease:string,reason:string):Promise<void>{
        await this.prisma.$executeRawUnsafe(`UPDATE fiscal_invoices SET email_delivery_state='suppressed',
            email_error_code=$3,email_lease_token=NULL,email_lease_expires_at=NULL,email_completed_at=NOW()
            WHERE id=$1::uuid AND email_delivery_state='claimed' AND email_lease_token=$2::uuid`,id,lease,reason);
    }

    private money(cents: number, currency: string): string {
        try {
            return new Intl.NumberFormat('es-CO', {
                style: 'currency',
                currency: currency || 'COP',
                maximumFractionDigits: currency?.toUpperCase() === 'COP' ? 0 : 2,
            }).format(cents / 100);
        } catch {
            return `${(cents / 100).toFixed(2)} ${currency}`;
        }
    }
}
