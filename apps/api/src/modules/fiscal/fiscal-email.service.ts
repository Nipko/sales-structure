import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { fiscalInvoiceEmail } from '../email/email-layouts';
import { FiscalConfigService } from './fiscal-config.service';
import { FiscalPdfService } from './fiscal-pdf.service';
import { buildBrandedInvoiceData } from './fiscal-branded.util';

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
    ) {}

    /**
     * Render the branded PDF and email it to the acquirer. Best-effort + idempotent
     * (guarded by `metadata.invoiceEmailSentAt`) — never throws.
     */
    async sendIssuedInvoice(invoiceId: string): Promise<void> {
        try {
            const inv = await this.prisma.fiscalInvoice.findUnique({ where: { id: invoiceId } });
            if (!inv || inv.status !== 'issued') return;
            if ((inv.metadata as any)?.invoiceEmailSentAt) return; // already sent

            const tenant = await this.prisma.tenant.findUnique({
                where: { id: inv.tenantId },
                select: { settings: true },
            });
            const fiscalData = (tenant?.settings as any)?.fiscalData || null;

            // Recipient: the acquirer email (invoice snapshot → tenant fiscal data).
            const snap = (inv.acquirerSnapshot as any) || {};
            const to: string | null = snap.email || fiscalData?.email || null;
            if (!to) {
                this.logger.warn(`[Fiscal] No acquirer email for invoice ${inv.id} — branded email skipped`);
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

            const data = buildBrandedInvoiceData(inv, cfg, fiscalData, relatedInvoiceNumber);
            const pdfBuffer = await this.pdf.render(data);

            const isCredit = inv.type === 'credit_note';
            const total = this.money(inv.amountCents, inv.currency);
            const filename = `${isCredit ? 'nota-credito' : 'factura'}-${data.invoiceNumber}.pdf`;

            const ok = await this.email.send({
                to,
                subject: `${isCredit ? 'Nota crédito' : 'Factura'} ${data.invoiceNumber} — ${data.issuerName}`,
                html: fiscalInvoiceEmail({
                    recipientName: data.acquirerName,
                    invoiceNumber: data.invoiceNumber,
                    total,
                    issuerName: data.issuerName,
                    cufe: data.cufe,
                    isCredit,
                }),
                attachments: [{ filename, content: pdfBuffer, contentType: 'application/pdf' }],
            });

            if (ok) {
                await this.prisma.fiscalInvoice.update({
                    where: { id: inv.id },
                    data: {
                        metadata: { ...(inv.metadata as object), invoiceEmailSentAt: new Date().toISOString() } as any,
                    },
                });
                this.logger.log(`[Fiscal] Branded invoice email sent to ${to} for ${inv.id}`);
            }
        } catch (err: any) {
            this.logger.error(`[Fiscal] sendIssuedInvoice(${invoiceId}) failed: ${err?.message}`);
        }
    }

    private money(cents: number, currency: string): string {
        try {
            return new Intl.NumberFormat('es-CO', {
                style: 'currency',
                currency: currency || 'COP',
                maximumFractionDigits: 0,
            }).format(cents / 100);
        } catch {
            return `${(cents / 100).toFixed(2)} ${currency}`;
        }
    }
}
