import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as PDFDocument from 'pdfkit';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Invoice PDF generator — produces a clean B2B receipt for a successful
 * BillingPayment. Streams the PDF as a Buffer so the controller can pipe
 * it straight to the HTTP response (no disk write needed yet — when fiscal
 * integration arrives we'll persist to /data/invoices/ and update
 * BillingPayment.invoicePdfUrl).
 *
 * Currency formatting respects the payment's currency code. Amounts in DB
 * are stored in cents (amountCents) and divided by 100 for display.
 */
@Injectable()
export class InvoiceGeneratorService {
    private readonly logger = new Logger(InvoiceGeneratorService.name);

    constructor(private readonly prisma: PrismaService) {}

    async generate(tenantId: string, paymentId: string): Promise<Buffer> {
        const payment = await this.prisma.billingPayment.findUnique({
            where: { id: paymentId },
            include: {
                subscription: {
                    include: { plan: true },
                },
            },
        });

        if (!payment || payment.tenantId !== tenantId) {
            throw new NotFoundException({ error: 'payment_not_found' });
        }

        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: {
                name: true,
                billingEmail: true,
                billingCountry: true,
                settings: true,
                isInternal: true,
            },
        });
        if (tenant?.isInternal) {
            throw new BadRequestException({
                error: 'tenant_internal_no_invoice',
                message: 'Internal-use tenants do not generate sales invoices.',
            });
        }
        if (!['succeeded', 'refunded'].includes(payment.status)) {
            throw new BadRequestException({
                error: 'payment_not_invoiceable',
                status: payment.status,
            });
        }

        const planName = payment.subscription?.plan?.name || 'Subscription';
        const tenantName = tenant?.name || 'Customer';
        const tenantEmail = tenant?.billingEmail || '';

        return this.renderPdf({
            invoiceNumber: payment.invoiceNumber || `INV-${payment.id.slice(0, 8).toUpperCase()}`,
            paidAt: payment.paidAt || payment.createdAt,
            issuedAt: payment.createdAt,
            status: payment.status,
            amountCents: payment.amountCents,
            currency: payment.currency,
            provider: payment.provider,
            providerPaymentId: payment.providerPaymentId,
            planName,
            customerName: tenantName,
            customerEmail: tenantEmail,
            customerCountry: tenant?.billingCountry || null,
        });
    }

    private renderPdf(data: {
        invoiceNumber: string;
        paidAt: Date;
        issuedAt: Date;
        status: string;
        amountCents: number;
        currency: string;
        provider: string;
        providerPaymentId: string | null;
        planName: string;
        customerName: string;
        customerEmail: string;
        customerCountry: string | null;
    }): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            try {
                const doc = new PDFDocument({ size: 'A4', margin: 50 });
                const chunks: Buffer[] = [];
                doc.on('data', (c) => chunks.push(c));
                doc.on('end', () => resolve(Buffer.concat(chunks)));
                doc.on('error', reject);

                const accent = '#3897f0';
                const muted = '#6b7280';
                const dark = '#111827';
                const formattedAmount = this.formatCurrency(data.amountCents, data.currency);

                // Header
                doc.fillColor(accent).fontSize(28).font('Helvetica-Bold').text('Parallly', 50, 55);
                doc.fillColor(muted).fontSize(10).font('Helvetica')
                    .text('parallly-chat.cloud', 50, 88)
                    .text('it.executive@parallext.com', 50, 102);

                doc.fillColor(dark).fontSize(22).font('Helvetica-Bold')
                    .text('INVOICE', 400, 55, { align: 'right', width: 145 });
                doc.fillColor(muted).fontSize(10).font('Helvetica')
                    .text(`# ${data.invoiceNumber}`, 400, 86, { align: 'right', width: 145 })
                    .text(this.formatDate(data.issuedAt), 400, 100, { align: 'right', width: 145 });

                // Status badge
                const statusColor = data.status === 'succeeded' ? '#16a34a' : data.status === 'refunded' ? '#dc2626' : '#f59e0b';
                doc.roundedRect(440, 118, 105, 22, 4).fillAndStroke(statusColor, statusColor);
                doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold')
                    .text(data.status.toUpperCase(), 440, 124, { align: 'center', width: 105 });

                // Divider
                doc.moveTo(50, 160).lineTo(545, 160).strokeColor('#e5e7eb').lineWidth(1).stroke();

                // Bill to
                doc.fillColor(muted).fontSize(9).font('Helvetica-Bold').text('BILL TO', 50, 180);
                doc.fillColor(dark).fontSize(12).font('Helvetica-Bold').text(data.customerName, 50, 196);
                doc.fillColor(muted).fontSize(10).font('Helvetica');
                let yPos = 213;
                if (data.customerEmail) { doc.text(data.customerEmail, 50, yPos); yPos += 14; }
                if (data.customerCountry) { doc.text(data.customerCountry, 50, yPos); yPos += 14; }

                // Payment details (right column)
                doc.fillColor(muted).fontSize(9).font('Helvetica-Bold').text('PAID ON', 350, 180);
                doc.fillColor(dark).fontSize(12).font('Helvetica').text(this.formatDate(data.paidAt), 350, 196);

                doc.fillColor(muted).fontSize(9).font('Helvetica-Bold').text('PAYMENT METHOD', 350, 220);
                doc.fillColor(dark).fontSize(11).font('Helvetica').text(this.providerLabel(data.provider), 350, 236);

                if (data.providerPaymentId) {
                    doc.fillColor(muted).fontSize(8).font('Helvetica').text(`ref: ${data.providerPaymentId}`, 350, 252);
                }

                // Line items table
                const tableTop = 300;
                doc.rect(50, tableTop, 495, 26).fill('#f9fafb');
                doc.fillColor(dark).fontSize(10).font('Helvetica-Bold')
                    .text('DESCRIPTION', 60, tableTop + 9)
                    .text('AMOUNT', 470, tableTop + 9, { align: 'right', width: 65 });

                const rowY = tableTop + 36;
                doc.fillColor(dark).fontSize(11).font('Helvetica')
                    .text(`${data.planName} — Subscription`, 60, rowY)
                    .text(formattedAmount, 470, rowY, { align: 'right', width: 65 });

                // Total
                const totalY = rowY + 50;
                doc.moveTo(350, totalY).lineTo(545, totalY).strokeColor('#e5e7eb').lineWidth(1).stroke();
                doc.fillColor(muted).fontSize(10).font('Helvetica-Bold').text('TOTAL', 350, totalY + 12);
                doc.fillColor(accent).fontSize(18).font('Helvetica-Bold')
                    .text(formattedAmount, 350, totalY + 28, { align: 'right', width: 195 });

                // Footer
                const footerY = 720;
                doc.fillColor(muted).fontSize(9).font('Helvetica')
                    .text(
                        'Thank you for using Parallly. For questions about this invoice, contact it.executive@parallext.com.',
                        50, footerY, { align: 'center', width: 495 },
                    )
                    .text(
                        `This receipt was generated automatically on ${this.formatDate(new Date())}.`,
                        50, footerY + 16, { align: 'center', width: 495 },
                    );

                doc.end();
            } catch (err) {
                reject(err);
            }
        });
    }

    private formatCurrency(cents: number, currency: string): string {
        const amount = cents / 100;
        try {
            return new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: currency.toUpperCase(),
                minimumFractionDigits: 2,
            }).format(amount);
        } catch {
            return `${currency.toUpperCase()} ${amount.toFixed(2)}`;
        }
    }

    private formatDate(d: Date): string {
        return new Intl.DateTimeFormat('en-US', {
            year: 'numeric', month: 'long', day: 'numeric',
        }).format(d);
    }

    private providerLabel(provider: string): string {
        switch (provider) {
            case 'mercadopago': return 'MercadoPago';
            case 'stripe': return 'Stripe';
            case 'mock': return 'Mock (test)';
            default: return provider.charAt(0).toUpperCase() + provider.slice(1);
        }
    }
}
