import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsBoolean, IsIn, IsObject, IsOptional, IsString } from 'class-validator';
import type { Response } from 'express';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { FiscalConfigService, FiscalConfig } from './fiscal-config.service';
import { FiscalInvoiceService } from './fiscal-invoice.service';
import { FiscalPdfService, BrandedInvoiceData } from './fiscal-pdf.service';
import { FactusAdapter } from './adapters/factus.adapter';
import { copAmountInWords } from './number-to-words.util';
import { FiscalAcquirer, FiscalInvoiceData } from './interfaces/fiscal-provider.interface';

class FiscalConfigDto {
    @IsOptional() @IsIn(['CO_LOCAL', 'US_REMOTE']) mode?: 'CO_LOCAL' | 'US_REMOTE';
    @IsOptional() @IsIn(['excluido', 'gravado_19']) coIvaTreatment?: 'excluido' | 'gravado_19';
    @IsOptional() @IsBoolean() fiscalGateEnabled?: boolean;
    @IsOptional() @IsIn(['sandbox', 'production']) factusEnvironment?: string;
    @IsOptional() @IsString() factusNumberingRangeId?: string;
    @IsOptional() @IsString() factusCreditNumberingRangeId?: string;
    @IsOptional() @IsString() defaultUnitMeasureId?: string;
    @IsOptional() @IsString() defaultStandardCodeId?: string;
    @IsOptional() @IsString() defaultProductTributeId?: string;
    @IsOptional() @IsString() defaultUnitMeasureCode?: string;
    @IsOptional() @IsString() defaultStandardCode?: string;
    @IsOptional() @IsString() defaultMunicipalityId?: string;
    @IsOptional() @IsString() itemDescription?: string;
    @IsOptional() @IsString() itemCodeReference?: string;
    @IsOptional() @IsObject() usIssuer?: { legalName?: string; taxId?: string; address?: string; email?: string };
    @IsOptional() @IsObject() coIssuer?: {
        legalName?: string; nit?: string; address?: string; email?: string; phone?: string;
        regime?: string; dianResolution?: string; authRange?: string; resolutionValidUntil?: string;
    };
}

/**
 * Super-admin fiscal configuration: the global fiscal mode toggle
 * (CO_LOCAL ↔ US_REMOTE), IVA treatment, Factus numbering/catalog defaults and
 * the US issuer details. Editable without redeploy. Switching to US_REMOTE is
 * guarded (the US issuer must be configured) and audited.
 */
@Controller('fiscal-admin')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('super_admin')
export class FiscalAdminController {
    constructor(
        private readonly config: FiscalConfigService,
        private readonly prisma: PrismaService,
        private readonly fiscalService: FiscalInvoiceService,
        private readonly factus: FactusAdapter,
        private readonly pdf: FiscalPdfService,
    ) {}

    @Get('config')
    async getConfig() {
        const config = await this.config.getConfig();
        return { success: true, data: config };
    }

    @Put('config')
    async updateConfig(@Body() body: FiscalConfigDto, @Req() req: any) {
        const current = await this.config.getConfig();

        // Guard: never let Parallly end up unable to issue anything. To turn on
        // US_REMOTE the US issuer (legal name) must be configured (current or in
        // this same request).
        if (body.mode === 'US_REMOTE' && current.mode !== 'US_REMOTE') {
            const legalName = body.usIssuer?.legalName ?? current.usIssuer?.legalName;
            if (!legalName) {
                throw new BadRequestException({
                    error: 'us_issuer_required',
                    message: 'Configura la razón social de la LLC (usIssuer.legalName) antes de activar el modo total (US_REMOTE).',
                });
            }
        }
        // NOTE: no exigimos numbering_range_id para GUARDAR. La config se llena de
        // forma incremental (emisor, IVA, rango…) y la guarda isProviderReady
        // mantiene la capa fiscal dormida hasta que TODO esté configurado, así que
        // bloquear el guardado aquí solo estorba. La falta de rango se ve en la
        // pestaña Factus / panel de facturas, no impidiendo guardar.

        const patch: Partial<FiscalConfig> = { ...body };
        await this.config.updateConfig(patch);

        // Audit the mode change explicitly (compliance-sensitive).
        if (body.mode && body.mode !== current.mode) {
            await this.prisma.auditLog
                .create({
                    data: {
                        userId: req?.user?.userId ?? req?.user?.sub ?? req?.user?.id ?? null,
                        action: 'fiscal.mode_changed',
                        resource: 'fiscal_config',
                        details: { from: current.mode, to: body.mode },
                    },
                })
                .catch(() => undefined);
        }

        const updated = await this.config.getConfig();
        return { success: true, data: updated };
    }

    // ── Global invoice management ───────────────────────────────

    @Get('invoices')
    async listInvoices(
        @Query('status') status?: string,
        @Query('tenantId') tenantId?: string,
        @Query('page') page?: string,
    ) {
        const where: any = {};
        if (status) where.status = status;
        if (tenantId) where.tenantId = tenantId;
        const take = 50;
        const skip = page && Number(page) > 1 ? (Number(page) - 1) * take : 0;

        const rows: any[] = await this.prisma.fiscalInvoice.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip });
        const total: number = await this.prisma.fiscalInvoice.count({ where });
        const tenantIds = [...new Set(rows.map((r: any) => r.tenantId))];
        const tenants: any[] = await this.prisma.tenant.findMany({
            where: { id: { in: tenantIds } },
            select: { id: true, name: true },
        });
        const nameMap: Record<string, string> = Object.fromEntries(tenants.map((t: any) => [t.id, t.name]));
        return {
            success: true,
            total,
            data: rows.map((r: any) => ({ ...r, tenantName: nameMap[r.tenantId] || r.tenantId })),
        };
    }

    @Post('invoices/:id/retry')
    async retryInvoice(@Param('id') id: string) {
        const ok = await this.fiscalService.requeue(id);
        if (!ok) {
            throw new BadRequestException({ error: 'cannot_retry', message: 'La factura no existe o ya está emitida.' });
        }
        return { success: true };
    }

    /**
     * Force a full re-emission of a fiscal invoice (super admin, testing/recovery).
     * A DIAN-validated invoice (has CUFE) is immutable and cannot be re-emitted.
     * For a not-yet-validated Factus bill: delete it at Factus (frees the
     * reference_code so it doesn't 409), reset the local row, and re-queue —
     * producing a brand-new document with the same fiscal data.
     */
    @Post('invoices/:id/reissue')
    async reissueInvoice(@Param('id') id: string) {
        const inv = await this.prisma.fiscalInvoice.findUnique({ where: { id } });
        if (!inv) throw new BadRequestException({ error: 'not_found', message: 'Factura no encontrada.' });
        if (inv.cufe) {
            throw new BadRequestException({
                error: 'already_validated',
                message: 'La factura ya fue validada por la DIAN (CUFE) y es inmutable: no se puede re-emitir.',
            });
        }
        // Free the reference at Factus (only works while unvalidated) so the fresh
        // issue doesn't 409 on the existing bill.
        if (inv.provider === 'factus') {
            await this.factus.deleteByReference(inv.id);
        }
        await this.prisma.fiscalInvoice.update({
            where: { id },
            data: {
                status: 'pending',
                providerRef: null,
                invoiceNumber: null,
                cufe: null,
                qrUrl: null,
                pdfUrl: null,
                failureReason: null,
                attempts: 0,
            },
        });
        await this.fiscalService.requeue(id);
        return { success: true };
    }

    // ── Validación: preview de generación (sin Factus) + emisión de prueba ──

    /** Genera el PDF branded con datos de ejemplo + el emisor configurado. No usa Factus. */
    @Get('preview-invoice')
    async previewInvoice(@Query('type') type: string, @Res() res: Response): Promise<void> {
        const cfg = await this.config.getConfig();
        const co = (cfg.coIssuer || {}) as any;
        const us = (cfg.usIssuer || {}) as any;
        const isCo = cfg.mode !== 'US_REMOTE';
        const gross = 5950000; // $59.500 de ejemplo (centavos)
        const tax = cfg.coIvaTreatment === 'gravado_19' ? gross - Math.round(gross / 1.19) : 0;
        const sample: BrandedInvoiceData = {
            type: type === 'credit_note' ? 'credit_note' : 'invoice',
            invoiceNumber: 'SETP990000001',
            prefix: 'SETP',
            consecutive: '990000001',
            cufe: 'EJEMPLO' + 'a'.repeat(89),
            qrUrl: 'https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=ejemplo',
            issuedAt: new Date(),
            amountCents: gross,
            taxCents: tax,
            currency: 'COP',
            amountInWords: copAmountInWords(gross),
            itemDescription: `${cfg.itemDescription} — Plan Pro (mensual)`,
            itemCode: cfg.itemCodeReference || 'PARALLLY-SUB',
            unitMeasure: 'Unidad',
            issuerName: isCo ? co.legalName || 'Parallly' : us.legalName || 'Parallly',
            issuerNit: isCo ? co.nit || null : us.taxId || null,
            issuerAddress: isCo ? co.address || null : us.address || null,
            issuerEmail: isCo ? co.email || null : us.email || null,
            issuerPhone: isCo ? co.phone || null : null,
            issuerRegime: isCo ? co.regime || 'Responsable de IVA' : null,
            dianResolution: isCo ? co.dianResolution || null : null,
            authRange: isCo ? co.authRange || null : null,
            resolutionValidUntil: isCo ? co.resolutionValidUntil || null : null,
            acquirerName: 'Cliente de Ejemplo SAS',
            acquirerDoc: 'NIT 900123456-3',
            acquirerEmail: 'cliente@ejemplo.com',
            paymentMethod: 'Contado',
            paymentMeans: 'Tarjeta de crédito',
        };
        const buffer = await this.pdf.render(sample);
        res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="factura-ejemplo.pdf"' });
        res.send(buffer);
    }

    /** Emite una factura de PRUEBA real contra Factus (sandbox) sin persistir. Devuelve CUFE/links o el error de DIAN. */
    @Post('test-invoice')
    async testInvoice() {
        const cfg = await this.config.getConfig();
        if (!cfg.factusNumberingRangeId) {
            return {
                success: false,
                error: 'numbering_range_required',
                message: 'Configura el numbering_range_id en la pestaña Factus antes de emitir una prueba.',
            };
        }
        const acquirer: FiscalAcquirer = {
            documentType: '3', // cédula de ciudadanía
            documentId: '222222222222', // consumidor final
            legalOrganizationId: '2',
            names: 'Consumidor Final',
            tributeId: '21',
        };
        const data: FiscalInvoiceData = {
            referenceCode: `TEST-${Date.now()}`,
            tenantId: 'preview',
            amountCents: 5950000,
            currency: 'COP',
            description: `${cfg.itemDescription} — FACTURA DE PRUEBA`,
            acquirer,
            ivaTreatment: cfg.coIvaTreatment,
        };
        try {
            const result = await this.factus.issue(data);
            // Render the DIAN QR inline so a super admin can visually validate it
            // without opening the PDF. Only present once validated (CUFE + qr URL).
            const qrPng = result.qrUrl ? await this.pdf.renderQrPng(result.qrUrl) : null;
            return { success: result.status === 'issued', data: { ...result, qrPng } };
        } catch (err: any) {
            return { success: false, error: err?.message || 'error' };
        }
    }

    // ── Factus connection helpers ───────────────────────────────

    @Get('factus/health')
    async factusHealth() {
        const result = await this.factus.testConnection();
        return { success: true, data: result };
    }

    @Get('factus/numbering-ranges')
    async numberingRanges() {
        try {
            const ranges = await this.factus.listNumberingRanges();
            return { success: true, data: ranges };
        } catch (err: any) {
            return { success: false, error: err?.message || 'failed' };
        }
    }
}
