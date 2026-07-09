import { Injectable, Logger } from '@nestjs/common';
import * as PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import { PARALLLY_LOGO_PNG_BASE64 } from './assets/parallly-logo';

export interface BrandedInvoiceData {
    type: string; // 'invoice' | 'credit_note'
    invoiceNumber: string;
    cufe?: string | null;
    qrUrl?: string | null;
    issuedAt?: Date | null;
    amountCents: number; // total bruto
    taxCents: number; // IVA
    currency: string;
    itemDescription: string;
    // Emisor (Parallly)
    issuerName: string;
    issuerNit?: string | null;
    issuerAddress?: string | null;
    issuerEmail?: string | null;
    issuerPhone?: string | null;
    issuerRegime?: string | null;
    // Resolución DIAN
    dianResolution?: string | null;
    authRange?: string | null;
    resolutionValidUntil?: string | null;
    // Adquirente
    acquirerName?: string | null;
    acquirerDoc?: string | null;
    acquirerEmail?: string | null;
    // Pago
    paymentMethod?: string | null;
    paymentMeans?: string | null;
}

/**
 * Representación gráfica con marca Parallly de una FEV / Nota Crédito DIAN.
 * El documento legal sigue siendo el XML firmado + el PDF oficial de Factus;
 * esta es una representación gráfica adicional que mantiene los campos
 * obligatorios (emisor con NIT, número, CUFE, QR ≥2cm, IVA discriminado,
 * resolución de numeración) y agrega marca, logo y un diseño cuidado.
 *
 * Diseño "Moderna Minimalista" (panel de diseño jun-2026) con mejoras de los
 * jueces: QR en todas las páginas (hook pageAdded), caja de resolución DIAN,
 * fecha+hora COT, badge de régimen, NC en rojo, guardas de consumidor final.
 */
@Injectable()
export class FiscalPdfService {
    private readonly logger = new Logger(FiscalPdfService.name);
    private readonly logo = Buffer.from(PARALLLY_LOGO_PNG_BASE64, 'base64');

    /** Render a QR string (e.g. the DIAN catalog URL) into a PNG data URL, or null. */
    async renderQrPng(data: string, width = 220): Promise<string | null> {
        if (!data) return null;
        try {
            const buf = await QRCode.toBuffer(data, { margin: 1, width });
            return `data:image/png;base64,${buf.toString('base64')}`;
        } catch (err: any) {
            this.logger.warn(`QR render failed: ${err?.message}`);
            return null;
        }
    }

    async render(data: BrandedInvoiceData): Promise<Buffer> {
        let qrPng: Buffer | null = null;
        if (data.qrUrl) {
            try {
                qrPng = await QRCode.toBuffer(data.qrUrl, { margin: 1, width: 160 });
            } catch (err: any) {
                this.logger.warn(`QR render failed: ${err?.message}`);
            }
        }

        return new Promise((resolve, reject) => {
            try {
                const isCredit = data.type === 'credit_note';
                const C_DARK = isCredit ? '#7f1d1d' : '#064e3b';
                const C_MID = '#10b981';
                const C_LIGHT = '#d1fae5';
                const C_SURF = '#f8fafc';
                const C_TEXT = '#111827';
                const C_MUTED = '#6b7280';
                const C_WHITE = '#ffffff';
                const C_CUFE = '#374151';
                const C_REGIME = '#065f46';
                const C_REGBG = '#d1fae5';
                const C_ACCENT = '#6ee7b7';
                const C_HSUBT = '#a7f3d0';

                const PAGE_W = 595.28;
                const PAGE_H = 841.89;
                const MARGIN = 50;
                const INNER_W = PAGE_W - MARGIN * 2;

                const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true });
                const chunks: Buffer[] = [];
                doc.on('data', (c) => chunks.push(c));
                doc.on('end', () => resolve(Buffer.concat(chunks)));
                doc.on('error', reject);

                const roundRect = (x: number, y: number, w: number, h: number, r: number, fillColor?: string | null, strokeColor?: string | null) => {
                    doc.save();
                    if (fillColor) doc.roundedRect(x, y, w, h, r).fillColor(fillColor).fill();
                    if (strokeColor) doc.roundedRect(x, y, w, h, r).strokeColor(strokeColor).lineWidth(0.5).stroke();
                    doc.restore();
                };
                const cardBox = (x: number, y: number, w: number, h: number) => roundRect(x, y, w, h, 6, C_SURF, C_LIGHT);
                const sectionLabel = (text: string, x: number, y: number, w = 200) => {
                    doc.fillColor(C_MID).font('Helvetica-Bold').fontSize(7).text(text.toUpperCase(), x, y, { characterSpacing: 0.8, width: w });
                };

                const drawFooter = () => {
                    const footerH = 38;
                    const footerY = PAGE_H - footerH;
                    roundRect(0, footerY, PAGE_W, footerH, 0, C_DARK, null);
                    const legal = `Representación gráfica de la ${isCredit ? 'Nota Crédito' : 'Factura Electrónica de Venta'} validada por la DIAN`;
                    doc.fillColor(C_ACCENT).font('Helvetica').fontSize(7.5).text(legal, MARGIN, footerY + 8, { width: INNER_W, align: 'center' });
                    doc.fillColor(C_HSUBT).font('Helvetica').fontSize(7).text('Gracias por confiar en Parallly — automatización inteligente para tu negocio.', MARGIN, footerY + 21, { width: INNER_W, align: 'center' });
                };
                // QR + footer en cada página adicional (multipágina)
                doc.on('pageAdded', () => drawFooter());

                // ── HEADER BAND ──
                const HEADER_H = 92;
                roundRect(0, 0, PAGE_W, HEADER_H, 0, C_DARK, null);

                // Logo (PNG blanco embebido). Fallback a wordmark si falla.
                try {
                    doc.image(this.logo, MARGIN, 18, { height: 26 });
                } catch {
                    doc.fillColor(C_WHITE).font('Helvetica-Bold').fontSize(22).text('Parall', MARGIN, 16, { continued: true }).fillColor(C_ACCENT).text('y');
                }

                // Datos del emisor (izquierda)
                doc.fillColor(C_ACCENT).font('Helvetica-Bold').fontSize(9).text(data.issuerName, MARGIN, 50, { width: 260 });
                let ly = 62;
                const nitLine = data.issuerNit ? `NIT ${data.issuerNit}` : '';
                const addrLine = [nitLine, data.issuerAddress].filter(Boolean).join('  ·  ');
                if (addrLine) { doc.fillColor(C_HSUBT).font('Helvetica').fontSize(8).text(addrLine, MARGIN, ly, { width: 260 }); ly += 10; }
                const contactLine = [data.issuerEmail, data.issuerPhone].filter(Boolean).join('  ·  ');
                if (contactLine) { doc.fillColor(C_HSUBT).font('Helvetica').fontSize(8).text(contactLine, MARGIN, ly, { width: 260 }); }

                // Tipo de documento + número (derecha)
                const docTypeLabel = isCredit ? 'NOTA CRÉDITO ELECTRÓNICA' : 'FACTURA ELECTRÓNICA DE VENTA';
                doc.fillColor(C_ACCENT).font('Helvetica-Bold').fontSize(8).text(docTypeLabel, MARGIN, 16, { width: INNER_W, align: 'right', characterSpacing: 0.8 });
                doc.fillColor(C_WHITE).font('Helvetica-Bold').fontSize(20).text(data.invoiceNumber, MARGIN, 28, { width: INNER_W, align: 'right' });
                doc.fillColor(C_HSUBT).font('Helvetica').fontSize(9).text(this.fmtDatetime(data.issuedAt), MARGIN, 54, { width: INNER_W, align: 'right' });

                // Badge régimen (header, derecha)
                const regimeText = data.issuerRegime || 'Responsable de IVA';
                doc.save();
                const badgeTextW = doc.font('Helvetica-Bold').fontSize(8).widthOfString(regimeText);
                const badgeW = badgeTextW + 16;
                const badgeX = PAGE_W - MARGIN - badgeW;
                roundRect(badgeX, 70, badgeW, 14, 4, C_REGBG, null);
                doc.fillColor(C_REGIME).font('Helvetica-Bold').fontSize(8).text(regimeText, badgeX + 8, 72.5, { width: badgeTextW });
                doc.restore();

                // ── Franja de aviso ──
                const greetY = HEADER_H;
                const greetH = 18;
                roundRect(0, greetY, PAGE_W, greetH, 0, '#f8fdf9', null);
                doc.fillColor('#2D6A4F').font('Helvetica-Oblique').fontSize(8.5).text('Este documento es una representación gráfica válida ante la DIAN. Conserve esta copia.', MARGIN, greetY + 4, { width: INNER_W, align: 'center' });

                let cy = HEADER_H + greetH + 16;

                // ── Tarjetas Emisor / Adquirente ──
                const halfW = (INNER_W - 12) / 2;
                const cardH = 86;
                cardBox(MARGIN, cy, halfW, cardH);
                sectionLabel('Emisor', MARGIN + 12, cy + 10, halfW - 24);
                doc.fillColor(C_TEXT).font('Helvetica-Bold').fontSize(10.5).text(data.issuerName, MARGIN + 12, cy + 22, { width: halfW - 24 });
                doc.fillColor(C_TEXT).font('Helvetica').fontSize(9).text(`NIT: ${data.issuerNit || 'No configurado'}`, MARGIN + 12, cy + 37, { width: halfW - 24 });
                if (data.issuerAddress) doc.fillColor(C_MUTED).fontSize(8.5).text(data.issuerAddress, MARGIN + 12, cy + 50, { width: halfW - 24 });
                if (data.issuerEmail) doc.fillColor(C_MUTED).fontSize(8.5).text(data.issuerEmail, MARGIN + 12, cy + 62, { width: halfW - 24 });

                const acqX = MARGIN + halfW + 12;
                cardBox(acqX, cy, halfW, cardH);
                sectionLabel('Adquirente', acqX + 12, cy + 10, halfW - 24);
                const acqName = data.acquirerName || 'Consumidor Final';
                const acqDoc = data.acquirerDoc || '222222222222';
                doc.fillColor(C_TEXT).font('Helvetica-Bold').fontSize(10.5).text(acqName, acqX + 12, cy + 22, { width: halfW - 24 });
                doc.fillColor(C_TEXT).font('Helvetica').fontSize(9).text(`Doc: ${acqDoc}`, acqX + 12, cy + 37, { width: halfW - 24 });
                if (data.acquirerEmail) doc.fillColor(C_MUTED).fontSize(8.5).text(data.acquirerEmail, acqX + 12, cy + 50, { width: halfW - 24 });

                cy += cardH + 14;

                // ── Caja resolución DIAN ──
                const resH = 40;
                roundRect(MARGIN, cy, INNER_W, resH, 6, '#fff9f0', '#f4a261');
                const resItems = [
                    { label: 'Resolución DIAN', val: data.dianResolution || '— Sin configurar —' },
                    { label: 'Rango autorizado', val: data.authRange || '—' },
                    { label: 'Vigencia', val: data.resolutionValidUntil || '—' },
                ];
                const resColW = INNER_W / resItems.length;
                resItems.forEach((item, i) => {
                    const rx = MARGIN + i * resColW + 14;
                    doc.fillColor('#b8763a').font('Helvetica-Bold').fontSize(7).text(item.label.toUpperCase(), rx, cy + 9, { width: resColW - 20, characterSpacing: 0.6 });
                    doc.fillColor('#7d4d1a').font('Helvetica').fontSize(9).text(item.val, rx, cy + 20, { width: resColW - 20 });
                });
                cy += resH + 14;

                // ── Tabla de ítems ──
                const COL_DESC = INNER_W * 0.5;
                const COL_QTY = INNER_W * 0.1;
                const COL_UNIT = INNER_W * 0.2;
                const COL_TOT = INNER_W * 0.2;
                const headerH = 22;
                roundRect(MARGIN, cy, INNER_W, headerH, 6, C_DARK, null);
                doc.fillColor(C_ACCENT).font('Helvetica-Bold').fontSize(7.5);
                doc.text('DESCRIPCIÓN DEL SERVICIO', MARGIN + 12, cy + 7, { width: COL_DESC - 12 });
                doc.text('CANT.', MARGIN + COL_DESC, cy + 7, { width: COL_QTY, align: 'right' });
                doc.text('P. UNITARIO', MARGIN + COL_DESC + COL_QTY, cy + 7, { width: COL_UNIT, align: 'right' });
                doc.text('TOTAL', MARGIN + COL_DESC + COL_QTY + COL_UNIT, cy + 7, { width: COL_TOT - 12, align: 'right' });
                cy += headerH;

                const subtotalCents = Math.max(0, data.amountCents - (data.taxCents || 0));
                const rowH = 34;
                roundRect(MARGIN, cy, INNER_W, rowH, 6, C_WHITE, C_LIGHT);
                doc.fillColor(C_TEXT).font('Helvetica-Bold').fontSize(10).text(data.itemDescription, MARGIN + 12, cy + 7, { width: COL_DESC - 18 });
                doc.fillColor(C_MUTED).font('Helvetica').fontSize(8.5).text('Unidad: Servicio', MARGIN + 12, cy + 20, { width: COL_DESC - 18 });
                doc.fillColor(C_TEXT).font('Helvetica').fontSize(10).text('1', MARGIN + COL_DESC, cy + 11, { width: COL_QTY, align: 'right' });
                doc.text(this.money(subtotalCents, data.currency), MARGIN + COL_DESC + COL_QTY, cy + 11, { width: COL_UNIT, align: 'right' });
                doc.text(this.money(subtotalCents, data.currency), MARGIN + COL_DESC + COL_QTY + COL_UNIT, cy + 11, { width: COL_TOT - 12, align: 'right' });
                cy += rowH + 16;

                // ── Totales ──
                const totW = 220;
                const totX = PAGE_W - MARGIN - totW;
                const totH = 82;
                cardBox(totX, cy, totW, totH);
                const ivaLabel = (data.taxCents || 0) > 0 ? 'IVA 19%' : 'IVA excluido (art. 476 num. 21 ET)';
                const totLines = [
                    { label: 'Subtotal (sin IVA)', val: this.money(subtotalCents, data.currency) },
                    { label: ivaLabel, val: this.money(data.taxCents || 0, data.currency) },
                ];
                let ty = cy + 12;
                totLines.forEach((line) => {
                    doc.fillColor(C_MUTED).font('Helvetica').fontSize(9).text(line.label, totX + 12, ty, { width: 130 });
                    doc.fillColor(C_TEXT).font('Helvetica').fontSize(9).text(line.val, totX + 12, ty, { width: totW - 24, align: 'right' });
                    ty += 14;
                });
                doc.moveTo(totX + 12, ty + 2).lineTo(totX + totW - 12, ty + 2).strokeColor(C_LIGHT).lineWidth(0.5).stroke();
                ty += 10;
                doc.fillColor(C_DARK).font('Helvetica-Bold').fontSize(10).text(`Total ${data.currency}`, totX + 12, ty + 6, { width: 80 });
                doc.fillColor(C_DARK).font('Helvetica-Bold').fontSize(20).text(this.money(data.amountCents, data.currency), totX + 12, ty, { width: totW - 24, align: 'right' });

                // ── Forma/medio de pago (izquierda, alineado con totales) ──
                const pmW = INNER_W - totW - 14;
                cardBox(MARGIN, cy, pmW, totH);
                sectionLabel('Forma de pago', MARGIN + 12, cy + 12, pmW - 24);
                doc.fillColor(C_TEXT).font('Helvetica-Bold').fontSize(10).text(data.paymentMethod || 'Contado', MARGIN + 12, cy + 24, { width: pmW - 24 });
                sectionLabel('Medio de pago', MARGIN + 12, cy + 44, pmW - 24);
                doc.fillColor(C_TEXT).font('Helvetica-Bold').fontSize(10).text(data.paymentMeans || 'Transferencia / PSE', MARGIN + 12, cy + 56, { width: pmW - 24 });

                cy += totH + 14;

                // ── CUFE ──
                const cufeH = 42;
                cardBox(MARGIN, cy, INNER_W, cufeH);
                sectionLabel('CUFE — Código Único de Factura Electrónica', MARGIN + 12, cy + 9, INNER_W - 24);
                doc.fillColor(C_CUFE).font('Courier').fontSize(7.5).text(data.cufe || '—', MARGIN + 12, cy + 21, { width: INNER_W - 24, lineBreak: true });
                cy += cufeH + 14;

                // ── QR + Observaciones ──
                const qrSize = 64; // > 2 cm (56.7 pt)
                const qrCardW = qrSize + 18;
                const qrCardH = qrSize + 24;
                const obsW = INNER_W - qrCardW - 14;
                cardBox(MARGIN, cy, obsW, qrCardH);
                sectionLabel('Observaciones', MARGIN + 12, cy + 9, obsW - 24);
                const obsText = `Documento electrónico generado y validado por la DIAN mediante el proveedor tecnológico Factus. Moneda: ${data.currency}. Verifique la validez con el código QR en el portal de la DIAN.`;
                doc.fillColor(C_MUTED).font('Helvetica').fontSize(9).text(obsText, MARGIN + 12, cy + 21, { width: obsW - 24, lineGap: 2 });

                const qrCardX = MARGIN + obsW + 14;
                cardBox(qrCardX, cy, qrCardW, qrCardH);
                if (qrPng) {
                    doc.image(qrPng, qrCardX + 9, cy + 9, { width: qrSize, height: qrSize });
                } else {
                    roundRect(qrCardX + 9, cy + 9, qrSize, qrSize, 4, '#e2e8f0', C_LIGHT);
                    doc.fillColor(C_MUTED).font('Helvetica').fontSize(7).text('QR DIAN', qrCardX + 9, cy + 9 + qrSize / 2 - 4, { width: qrSize, align: 'center' });
                }
                doc.fillColor(C_MID).font('Helvetica-Bold').fontSize(6.5).text('Verificar en DIAN', qrCardX + 9, cy + 9 + qrSize + 4, { width: qrSize, align: 'center' });

                drawFooter();
                doc.end();
            } catch (err) {
                reject(err);
            }
        });
    }

    /** Fecha Y hora con zona horaria COT (Art. 11 num. 5 + Anexo Técnico v1.9). */
    private fmtDatetime(d?: Date | null): string {
        const date = d ? new Date(d) : new Date();
        try {
            const s = new Intl.DateTimeFormat('es-CO', {
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', hour12: false,
                timeZone: 'America/Bogota',
            }).format(date);
            return `${s} COT`;
        } catch {
            return date.toISOString();
        }
    }

    private money(cents: number, currency: string): string {
        try {
            return new Intl.NumberFormat('es-CO', { style: 'currency', currency: currency || 'COP', maximumFractionDigits: 0 }).format(cents / 100);
        } catch {
            return `${(cents / 100).toFixed(2)} ${currency}`;
        }
    }
}
