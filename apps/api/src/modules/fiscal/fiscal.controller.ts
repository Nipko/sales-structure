import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PrismaService } from '../prisma/prisma.service';
import { FiscalStorageService } from './fiscal-storage.service';
import { FiscalPdfService, BrandedInvoiceData } from './fiscal-pdf.service';
import { FiscalConfigService } from './fiscal-config.service';
import { FiscalInvoiceService } from './fiscal-invoice.service';
import { FactusAdapter } from './adapters/factus.adapter';
import { computeNitDv } from './nit.util';
import { copAmountInWords } from './number-to-words.util';

/** Factus doc-type catalog code → human label for the graphic representation. */
const ACQUIRER_DOC_LABELS: Record<string, string> = {
    '1': 'RC', '2': 'TI', '3': 'CC', '4': 'TE', '5': 'CE', '6': 'NIT', '7': 'Pasaporte', '8': 'DIE', '10': 'NIT',
};
/** DIAN unit-of-measure code → label. */
const UNIT_MEASURE_LABELS: Record<string, string> = { '94': 'Unidad' };

/** Acquirer fiscal profile saved on Tenant.settings.fiscalData. */
class FiscalDataDto {
    /** Factus identification_document_id: '6' NIT, '3' cédula ciudadanía, '5' cédula extranjería, '7' pasaporte. */
    @IsString() @IsIn(['1', '2', '3', '4', '5', '6', '7', '10'])
    documentType!: string;

    @IsString() @MaxLength(30)
    documentId!: string;

    @IsOptional() @IsString() @MaxLength(2)
    dv?: string;

    /** '1' persona jurídica, '2' persona natural. */
    @IsString() @IsIn(['1', '2'])
    legalOrganizationId!: string;

    @IsOptional() @IsString() @MaxLength(200) businessName?: string;
    @IsOptional() @IsString() @MaxLength(200) names?: string;
    /** Factus customer tribute_id ('18' responsable de IVA, '21' no responsable). */
    @IsOptional() @IsString() tributeId?: string;
    @IsOptional() @IsString() @MaxLength(200) address?: string;
    /** Factus municipality_id (internal id from /v2/municipalities). */
    @IsOptional() @IsString() municipalityId?: string;
    /** DIVIPOLA/DANE code (5 digits) — selected municipality; the Factus id is resolved from it. */
    @IsOptional() @IsString() @MaxLength(5) daneCode?: string;
    @IsOptional() @IsString() @MaxLength(120) municipalityName?: string;
    @IsOptional() @IsEmail() email?: string;
    @IsOptional() @IsString() @MaxLength(30) phone?: string;
    /** Opt-in: issue as "consumidor final" (DIAN 222222222222); the other fields are forced server-side. */
    @IsOptional() @IsBoolean() consumidorFinal?: boolean;
}

/**
 * Tenant-facing fiscal endpoints: manage the acquirer fiscal profile and list
 * issued fiscal invoices. tenantId is a path param (super_admin can operate on
 * any tenant), guarded by TenantGuard like the rest of /billing.
 */
@Controller('fiscal')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
export class FiscalController {
    constructor(
        private readonly prisma: PrismaService,
        private readonly storage: FiscalStorageService,
        private readonly pdf: FiscalPdfService,
        private readonly config: FiscalConfigService,
        private readonly fiscalService: FiscalInvoiceService,
        private readonly factus: FactusAdapter,
    ) {}

    @Get(':tenantId/data')
    async getFiscalData(@Param('tenantId') tenantId: string) {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true, billingCountry: true },
        });
        if (!tenant) throw new NotFoundException({ error: 'tenant_not_found' });
        const fiscalData = (tenant.settings as any)?.fiscalData ?? null;
        return { success: true, data: { fiscalData, billingCountry: tenant.billingCountry } };
    }

    @Put(':tenantId/data')
    async setFiscalData(@Param('tenantId') tenantId: string, @Body() body: FiscalDataDto) {
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
        if (!tenant) throw new NotFoundException({ error: 'tenant_not_found' });

        // Opt-in "consumidor final": issue as the DIAN adquirente no identificado
        // (222222222222). Forces the canonical values server-side so downstream
        // issuance and the fiscal gate treat it as a complete, valid profile.
        if (body.consumidorFinal === true) {
            const fiscalData = {
                consumidorFinal: true,
                documentType: '3', // cédula de ciudadanía
                documentId: '222222222222',
                legalOrganizationId: '2',
                names: 'Consumidor Final',
                tributeId: '21', // no responsable de IVA
                email: body.email,
            };
            const settings = { ...((tenant.settings as object) ?? {}), fiscalData };
            await this.prisma.tenant.update({ where: { id: tenantId }, data: { settings: settings as any } });
            return { success: true, data: { fiscalData } };
        }

        // Persona jurídica must carry a business name; natural a name.
        if (body.legalOrganizationId === '1' && !body.businessName) {
            throw new BadRequestException({ error: 'business_name_required', message: 'Razón social requerida para persona jurídica.' });
        }
        if (body.legalOrganizationId === '2' && !body.names) {
            throw new BadRequestException({ error: 'names_required', message: 'Nombres requeridos para persona natural.' });
        }

        // NIT: validate or compute the verification digit (módulo 11).
        let dv = body.dv;
        if (body.documentType === '6') {
            const computed = computeNitDv(body.documentId);
            if (computed == null) {
                throw new BadRequestException({ error: 'invalid_nit', message: 'NIT inválido.' });
            }
            if (dv && dv !== String(computed)) {
                throw new BadRequestException({ error: 'invalid_dv', message: `El dígito de verificación no corresponde al NIT (esperado ${computed}).` });
            }
            dv = String(computed);
        }

        const fiscalData = {
            consumidorFinal: false,
            documentType: body.documentType,
            documentId: body.documentId.trim(),
            dv,
            legalOrganizationId: body.legalOrganizationId,
            businessName: body.businessName,
            names: body.names,
            tributeId: body.tributeId,
            address: body.address,
            municipalityId: body.municipalityId,
            daneCode: body.daneCode,
            municipalityName: body.municipalityName,
            email: body.email,
            phone: body.phone,
        };

        const settings = { ...((tenant.settings as object) ?? {}), fiscalData };
        await this.prisma.tenant.update({ where: { id: tenantId }, data: { settings: settings as any } });
        return { success: true, data: { fiscalData } };
    }

    @Get(':tenantId/invoices')
    async listInvoices(@Param('tenantId') tenantId: string) {
        const invoices = await this.prisma.fiscalInvoice.findMany({
            where: { tenantId },
            orderBy: { createdAt: 'desc' },
            take: 100,
            select: {
                id: true,
                type: true,
                status: true,
                provider: true,
                invoiceNumber: true,
                cufe: true,
                qrUrl: true,
                pdfUrl: true,
                amountCents: true,
                currency: true,
                taxCents: true,
                failureReason: true,
                issuedAt: true,
                createdAt: true,
            },
        });
        return { success: true, data: invoices };
    }

    /**
     * Re-queue a failed/pending fiscal invoice for another issuance attempt.
     * Tenant-facing (scoped to :tenantId so a tenant can only retry its own).
     * With the consumidor-final fallback this now succeeds even when the tenant
     * never completed its fiscal profile.
     */
    @Post(':tenantId/invoices/:id/retry')
    async retryInvoice(@Param('tenantId') tenantId: string, @Param('id') id: string) {
        const inv = await this.prisma.fiscalInvoice.findFirst({
            where: { id, tenantId },
            select: { id: true },
        });
        if (!inv) throw new NotFoundException({ error: 'invoice_not_found' });
        const ok = await this.fiscalService.requeue(id);
        if (!ok) {
            throw new BadRequestException({ error: 'cannot_retry', message: 'La factura ya está emitida o no se puede reintentar.' });
        }
        return { success: true };
    }

    @Get(':tenantId/invoices/:id/pdf')
    async getInvoicePdf(
        @Param('tenantId') tenantId: string,
        @Param('id') id: string,
        @Query('format') format: string,
        @Res() res: Response,
    ): Promise<void> {
        const inv = await this.prisma.fiscalInvoice.findFirst({ where: { id, tenantId } });
        if (!inv) throw new NotFoundException({ error: 'invoice_not_found' });

        // Acquirer fallback for the branded PDF when the invoice snapshot is empty
        // (created before the tenant completed its fiscal profile) — use the tenant's
        // current fiscal data instead of defaulting to "Consumidor Final".
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
        const acquirerFallback = (tenant?.settings as any)?.fiscalData || null;

        // Nota crédito: número de la factura de venta afectada, para referenciarla.
        let relatedInvoiceNumber: string | null = null;
        if (inv.type === 'credit_note' && inv.relatedInvoiceId) {
            const orig = await this.prisma.fiscalInvoice.findUnique({
                where: { id: inv.relatedInvoiceId },
                select: { invoiceNumber: true },
            });
            relatedInvoiceNumber = orig?.invoiceNumber ?? null;
        }

        let buffer: Buffer | null = null;
        if (format === 'branded') {
            const cfg = await this.config.getConfig();
            buffer = await this.pdf.render(this.buildBranded(inv, cfg, acquirerFallback, relatedInvoiceNumber));
        } else {
            // Official: stored copy → fetch from Factus on demand → branded fallback.
            buffer = this.storage.read(tenantId, inv.id, 'pdf');
            if (!buffer && inv.provider === 'factus' && inv.invoiceNumber) {
                buffer = await this.factus.downloadPdf(inv.invoiceNumber).catch(() => null);
                if (buffer) this.storage.save(tenantId, inv.id, 'pdf', buffer);
            }
            if (!buffer) {
                const cfg = await this.config.getConfig();
                buffer = await this.pdf.render(this.buildBranded(inv, cfg, acquirerFallback, relatedInvoiceNumber));
            }
        }
        if (!buffer) throw new NotFoundException({ error: 'pdf_unavailable' });
        res.set({
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="parallly-${inv.invoiceNumber || inv.id.slice(0, 8)}.pdf"`,
        });
        res.send(buffer);
    }

    @Get(':tenantId/invoices/:id/xml')
    async getInvoiceXml(
        @Param('tenantId') tenantId: string,
        @Param('id') id: string,
        @Res() res: Response,
    ): Promise<void> {
        const inv = await this.prisma.fiscalInvoice.findFirst({ where: { id, tenantId } });
        if (!inv) throw new NotFoundException({ error: 'invoice_not_found' });
        let buffer = this.storage.read(tenantId, inv.id, 'xml');
        if (!buffer && inv.provider === 'factus' && inv.invoiceNumber) {
            buffer = await this.factus.downloadXml(inv.invoiceNumber).catch(() => null);
            if (buffer) this.storage.save(tenantId, inv.id, 'xml', buffer);
        }
        if (!buffer) throw new NotFoundException({ error: 'xml_unavailable' });
        res.set({
            'Content-Type': 'application/xml',
            'Content-Disposition': `attachment; filename="parallly-${inv.invoiceNumber || inv.id.slice(0, 8)}.xml"`,
        });
        res.send(buffer);
    }

    private buildBranded(inv: any, cfg: any, acquirerFallback?: any, relatedInvoiceNumber?: string | null): BrandedInvoiceData {
        const snapRaw = (inv.acquirerSnapshot as any) || null;
        // Prefer the immutable snapshot; if it carries no document (was null at
        // creation, before the tenant had fiscal data), fall back to the tenant's
        // current fiscal data instead of wrongly printing "Consumidor Final".
        const snap = (snapRaw && snapRaw.documentId)
            ? snapRaw
            : (acquirerFallback && acquirerFallback.documentId ? acquirerFallback : (snapRaw || {}));
        const co = cfg.coIssuer || {};
        const us = cfg.usIssuer || {};
        const isCo = cfg.mode !== 'US_REMOTE';

        // Prefijo + consecutivo: el número DIAN viene como '<PREFIJO><consecutivo>'
        // (p.ej. SETP990010633). Separarlos para mostrar el prefijo como campo.
        const fullNumber = inv.invoiceNumber || String(inv.id).slice(0, 8).toUpperCase();
        const parts = /^([A-Za-z]+)\s*(\d+)$/.exec(fullNumber);
        const prefix = parts ? parts[1] : null;
        const consecutive = parts ? parts[2] : fullNumber;

        // Resolución/rango/prefijo AUTORITATIVOS desde Factus (stamped en metadata al
        // emitir); si no están, se usa la config manual del emisor.
        const nr = (inv.metadata as any)?.numberingRange || null;
        const resolvedPrefix = nr?.prefix || prefix;
        const dianResolution = nr?.resolution ? `Resolución ${nr.resolution}` : (isCo ? co.dianResolution ?? null : null);
        const authRange = (nr?.from != null && nr?.to != null) ? `${nr.from} — ${nr.to}` : (isCo ? co.authRange ?? null : null);
        const resolutionValidUntil = nr?.endDate ? String(nr.endDate) : (isCo ? co.resolutionValidUntil ?? null : null);

        // Documento del adquirente legible: mapear el código Factus a NIT/CC/… y
        // anexar el dígito de verificación (numeral 3, obligatorio).
        const docLabel = ACQUIRER_DOC_LABELS[String(snap.documentType ?? '')] || (snap.documentType ? String(snap.documentType) : '');
        const acquirerDoc = snap.documentId
            ? `${docLabel ? docLabel + ' ' : ''}${snap.documentId}${snap.dv ? '-' + snap.dv : ''}`.trim()
            : null;

        // Valor en letras solo tiene sentido en COP (facturación DIAN); en US_REMOTE
        // (recibo USD) se omite.
        const amountInWords = (inv.currency || '').toUpperCase() === 'COP' ? copAmountInWords(inv.amountCents) : null;

        return {
            type: inv.type,
            invoiceNumber: fullNumber,
            prefix: resolvedPrefix,
            consecutive,
            cufe: inv.cufe,
            // The DIAN QR is deterministic from the CUFE — build it when the stored
            // qrUrl is missing so already-issued invoices still render the QR.
            qrUrl: inv.qrUrl || (inv.cufe
                ? `https://${cfg.factusEnvironment === 'production' ? 'catalogo-vpfe' : 'catalogo-vpfe-hab'}.dian.gov.co/document/searchqr?documentkey=${inv.cufe}`
                : null),
            issuedAt: inv.issuedAt,
            amountCents: inv.amountCents,
            taxCents: inv.taxCents,
            currency: inv.currency,
            amountInWords,
            itemDescription: cfg.itemDescription,
            itemCode: cfg.itemCodeReference || null,
            unitMeasure: UNIT_MEASURE_LABELS[String(cfg.defaultUnitMeasureCode ?? '')] || 'Unidad',
            // Emisor: CO_LOCAL lee cfg.coIssuer (datos de Parallly); US_REMOTE lee cfg.usIssuer
            issuerName: isCo ? co.legalName || 'Parallly' : us.legalName || 'Parallly',
            issuerNit: isCo ? co.nit ?? null : us.taxId ?? null,
            issuerAddress: isCo ? co.address ?? null : us.address ?? null,
            issuerEmail: isCo ? co.email ?? null : us.email ?? null,
            issuerPhone: isCo ? co.phone ?? null : null,
            issuerRegime: isCo ? co.regime || 'Responsable de IVA' : null,
            dianResolution,
            authRange,
            resolutionValidUntil,
            acquirerName: snap.businessName || snap.names || null,
            acquirerDoc,
            acquirerEmail: snap.email || null,
            // Reflejamos lo que declaramos a la DIAN: payment_form '1' (contado) y
            // payment_method_code '48' (tarjeta de crédito) — ver FactusAdapter.
            paymentMethod: 'Contado',
            paymentMeans: 'Tarjeta de crédito',
            trm: (inv.metadata as any)?.trmApplied ?? null,
            relatedInvoiceNumber: relatedInvoiceNumber ?? null,
        };
    }
}
