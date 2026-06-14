import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Put, Query, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PrismaService } from '../prisma/prisma.service';
import { FiscalStorageService } from './fiscal-storage.service';
import { FiscalPdfService, BrandedInvoiceData } from './fiscal-pdf.service';
import { FiscalConfigService } from './fiscal-config.service';
import { FactusAdapter } from './adapters/factus.adapter';
import { computeNitDv } from './nit.util';

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
    /** DIVIPOLA/DANE code (5 digits) — reference for selecting the municipality. */
    @IsOptional() @IsString() @MaxLength(5) daneCode?: string;
    @IsOptional() @IsEmail() email?: string;
    @IsOptional() @IsString() @MaxLength(30) phone?: string;
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

    @Get(':tenantId/invoices/:id/pdf')
    async getInvoicePdf(
        @Param('tenantId') tenantId: string,
        @Param('id') id: string,
        @Query('format') format: string,
        @Res() res: Response,
    ): Promise<void> {
        const inv = await this.prisma.fiscalInvoice.findFirst({ where: { id, tenantId } });
        if (!inv) throw new NotFoundException({ error: 'invoice_not_found' });

        let buffer: Buffer | null = null;
        if (format === 'branded') {
            const cfg = await this.config.getConfig();
            buffer = await this.pdf.render(this.buildBranded(inv, cfg));
        } else {
            // Official: stored copy → fetch from Factus on demand → branded fallback.
            buffer = this.storage.read(tenantId, inv.id, 'pdf');
            if (!buffer && inv.provider === 'factus' && inv.invoiceNumber) {
                buffer = await this.factus.downloadPdf(inv.invoiceNumber).catch(() => null);
                if (buffer) this.storage.save(tenantId, inv.id, 'pdf', buffer);
            }
            if (!buffer) {
                const cfg = await this.config.getConfig();
                buffer = await this.pdf.render(this.buildBranded(inv, cfg));
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

    private buildBranded(inv: any, cfg: any): BrandedInvoiceData {
        const snap = (inv.acquirerSnapshot as any) || {};
        return {
            type: inv.type,
            invoiceNumber: inv.invoiceNumber || String(inv.id).slice(0, 8).toUpperCase(),
            cufe: inv.cufe,
            qrUrl: inv.qrUrl,
            issuedAt: inv.issuedAt,
            amountCents: inv.amountCents,
            taxCents: inv.taxCents,
            currency: inv.currency,
            itemDescription: cfg.itemDescription,
            issuerName: cfg.mode === 'US_REMOTE' ? cfg.usIssuer?.legalName || 'Parallly' : 'Parallly',
            issuerNit: cfg.mode === 'US_REMOTE' ? cfg.usIssuer?.taxId ?? null : null,
            acquirerName: snap.businessName || snap.names || null,
            acquirerDoc: snap.documentId ? `${snap.documentType || ''} ${snap.documentId}`.trim() : null,
            acquirerEmail: snap.email || null,
        };
    }
}
