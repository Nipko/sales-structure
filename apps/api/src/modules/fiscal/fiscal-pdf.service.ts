import { Injectable, Logger } from '@nestjs/common';
import * as PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';

export interface BrandedInvoiceData {
    type: string; // invoice | credit_note
    invoiceNumber: string;
    cufe?: string | null;
    qrUrl?: string | null;
    issuedAt?: Date | null;
    amountCents: number; // total (gross)
    taxCents: number; // IVA
    currency: string;
    itemDescription: string;
    issuerName: string;
    issuerNit?: string | null;
    acquirerName?: string | null;
    acquirerDoc?: string | null;
    acquirerEmail?: string | null;
}

/**
 * Branded graphic representation of a DIAN electronic invoice. The fiscal source
 * of truth remains the signed XML + the provider's official PDF; this is an
 * additional Parallly-branded rendering that still carries the mandatory fields
 * (number, CUFE, QR) so it is a valid graphic representation.
 */
@Injectable()
export class FiscalPdfService {
    private readonly logger = new Logger(FiscalPdfService.name);

    async render(data: BrandedInvoiceData): Promise<Buffer> {
        let qrPng: Buffer | null = null;
        if (data.qrUrl) {
            try {
                qrPng = await QRCode.toBuffer(data.qrUrl, { margin: 1, width: 130 });
            } catch (err: any) {
                this.logger.warn(`QR render failed: ${err?.message}`);
            }
        }

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
                const isCredit = data.type === 'credit_note';
                const docTitle = isCredit ? 'NOTA CRÉDITO ELECTRÓNICA' : 'FACTURA ELECTRÓNICA DE VENTA';
                const subtotal = Math.max(0, data.amountCents - (data.taxCents || 0));

                // Header — issuer
                doc.fillColor(accent).fontSize(26).font('Helvetica-Bold').text('Parallly', 50, 55);
                doc.fillColor(muted).fontSize(10).font('Helvetica')
                    .text(data.issuerName || 'Parallly', 50, 86);
                if (data.issuerNit) doc.text(`NIT: ${data.issuerNit}`, 50, 100);

                doc.fillColor(dark).fontSize(15).font('Helvetica-Bold')
                    .text(docTitle, 320, 55, { align: 'right', width: 225 });
                doc.fillColor(muted).fontSize(10).font('Helvetica')
                    .text(`No. ${data.invoiceNumber}`, 320, 80, { align: 'right', width: 225 })
                    .text(this.fmtDate(data.issuedAt), 320, 94, { align: 'right', width: 225 });

                doc.moveTo(50, 124).lineTo(545, 124).strokeColor('#e5e7eb').lineWidth(1).stroke();

                // Acquirer
                doc.fillColor(muted).fontSize(9).font('Helvetica-Bold').text('ADQUIRENTE', 50, 140);
                doc.fillColor(dark).fontSize(12).font('Helvetica-Bold').text(data.acquirerName || 'Consumidor final', 50, 155);
                doc.fillColor(muted).fontSize(10).font('Helvetica');
                let y = 172;
                if (data.acquirerDoc) { doc.text(`Doc: ${data.acquirerDoc}`, 50, y); y += 14; }
                if (data.acquirerEmail) { doc.text(data.acquirerEmail, 50, y); y += 14; }

                // Line items table
                const tableTop = 220;
                doc.rect(50, tableTop, 495, 26).fill('#f9fafb');
                doc.fillColor(dark).fontSize(10).font('Helvetica-Bold')
                    .text('DESCRIPCIÓN', 60, tableTop + 9)
                    .text('VALOR', 470, tableTop + 9, { align: 'right', width: 65 });

                const rowY = tableTop + 36;
                doc.fillColor(dark).fontSize(11).font('Helvetica')
                    .text(data.itemDescription, 60, rowY, { width: 380 })
                    .text(this.money(subtotal, data.currency), 470, rowY, { align: 'right', width: 65 });

                // Totals
                const totalsY = rowY + 50;
                doc.fillColor(muted).fontSize(10).font('Helvetica');
                doc.text('Subtotal', 350, totalsY, { width: 120 }).text(this.money(subtotal, data.currency), 470, totalsY, { align: 'right', width: 65 });
                doc.text('IVA', 350, totalsY + 16, { width: 120 }).text(this.money(data.taxCents || 0, data.currency), 470, totalsY + 16, { align: 'right', width: 65 });
                doc.moveTo(350, totalsY + 34).lineTo(545, totalsY + 34).strokeColor('#e5e7eb').lineWidth(1).stroke();
                doc.fillColor(dark).fontSize(13).font('Helvetica-Bold')
                    .text('TOTAL', 350, totalsY + 42, { width: 120 })
                    .text(this.money(data.amountCents, data.currency), 460, totalsY + 42, { align: 'right', width: 75 });

                // CUFE + QR
                const fiscalY = totalsY + 90;
                if (qrPng) doc.image(qrPng, 50, fiscalY, { width: 110 });
                doc.fillColor(muted).fontSize(8).font('Helvetica-Bold').text('CUFE', 175, fiscalY);
                doc.fillColor(dark).fontSize(8).font('Helvetica').text(data.cufe || '—', 175, fiscalY + 12, { width: 370 });
                if (data.qrUrl) {
                    doc.fillColor(muted).fontSize(8).font('Helvetica-Bold').text('Validación DIAN', 175, fiscalY + 44);
                    doc.fillColor(accent).fontSize(8).font('Helvetica').text(data.qrUrl, 175, fiscalY + 56, { width: 370, link: data.qrUrl });
                }

                // Footer
                doc.fillColor(muted).fontSize(8).font('Helvetica')
                    .text('Representación gráfica de documento electrónico validado por la DIAN. Generado por Parallly.', 50, 760, { align: 'center', width: 495 });

                doc.end();
            } catch (err) {
                reject(err);
            }
        });
    }

    private money(cents: number, currency: string): string {
        try {
            return new Intl.NumberFormat('es-CO', { style: 'currency', currency: currency || 'COP', maximumFractionDigits: 0 }).format(cents / 100);
        } catch {
            return `${(cents / 100).toFixed(2)} ${currency}`;
        }
    }

    private fmtDate(d?: Date | null): string {
        const date = d ? new Date(d) : new Date();
        return new Intl.DateTimeFormat('es-CO', { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
    }
}
