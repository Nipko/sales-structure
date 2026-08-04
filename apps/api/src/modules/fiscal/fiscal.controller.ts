import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { SUPPORTED_BILLING_COUNTRIES } from '../../common/utils/billing-country.util';
import type { Response } from 'express';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PrismaService } from '../prisma/prisma.service';
import { FiscalStorageService } from './fiscal-storage.service';
import { FiscalPdfService } from './fiscal-pdf.service';
import { FiscalConfigService } from './fiscal-config.service';
import { FiscalInvoiceService } from './fiscal-invoice.service';
import { FactusAdapter } from './adapters/factus.adapter';
import { computeNitDv } from './nit.util';
import { buildBrandedInvoiceData } from './fiscal-branded.util';
import { billingCountryRequiresFiscalData, isFiscalDataComplete } from './fiscal-data.util';

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
/*
 * Todo este controller es tenant_admin, y va a nivel de CLASE a propósito.
 *
 * `RolesGuard` permite por defecto: sin metadata `@Roles` devuelve `true`
 * (roles.guard.ts:17), así que declararlo en `@UseGuards` sin decorar las rutas
 * lo dejaba de adorno — cualquier usuario autenticado del tenant entraba.
 *
 * Lo que estaba abierto no era menor: reescribir razón social, NIT y DV, que
 * son los datos que salen impresos en facturas electrónicas legalmente
 * vinculantes ante la DIAN; cambiar el país de facturación, que decide si el
 * gate fiscal dispara, qué proveedor DIAN se usa y qué precio por país aplica
 * en billing; y listar y descargar el PDF y el XML de todas las facturas del
 * tenant.
 *
 * El dashboard ya lo escondía (`_settings-config.ts:64`, `canManageBilling`),
 * pero un POST directo pasaba igual: el gate de UI sin el del backend es
 * fachada. Es la misma clase de hueco que se cerró en las otras 237 rutas.
 */
@Controller('fiscal')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@Roles('tenant_admin')
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
        // `required` is TRUE only when the gate is ENABLED *and* the country needs
        // it — this mirrors assertFiscalDataReady, which no-ops when the gate is off.
        // The dashboard's pre-check and reminder banner key off `required`, so with
        // the gate off (default) the front neither blocks checkout nor nags (soft
        // mode) — matching the backend instead of enforcing a gate that isn't on.
        // `complete` uses the same helper as the gate (no client-side DV drift).
        const gateEnabled = (await this.config.getConfig()).fiscalGateEnabled;
        return {
            success: true,
            data: {
                fiscalData,
                billingCountry: tenant.billingCountry,
                // La lista la manda el servidor para que el selector del dashboard y la
                // validación del PATCH no puedan divergir (y para no duplicar el mapa
                // de países en el front).
                supportedCountries: SUPPORTED_BILLING_COUNTRIES,
                required: gateEnabled && billingCountryRequiresFiscalData(tenant.billingCountry),
                complete: isFiscalDataComplete(tenant.settings),
            },
        };
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

    /**
     * Correct the billing country.
     *
     * Everything about the fiscal profile keys off `tenant.billingCountry`: whether
     * the gate fires, whether the banner nags, whether the billing page even renders
     * the DIAN section. Until now that value was only ever written once, at
     * onboarding, inferred from the timezone the user picked in a dropdown — and
     * nothing anywhere could change it. A Colombian tenant whose browser reported a
     * foreign zone was silently never asked for a NIT, with no way to fix it.
     */
    @Patch(':tenantId/billing-country')
    async setBillingCountry(@Param('tenantId') tenantId: string, @Body() body: { billingCountry?: string }) {
        const code = (body?.billingCountry || '').trim().toUpperCase();
        if (!SUPPORTED_BILLING_COUNTRIES.includes(code)) {
            throw new BadRequestException({ error: 'invalid_country', message: 'País de facturación no soportado.' });
        }

        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
        if (!tenant) throw new NotFoundException({ error: 'tenant_not_found' });

        await this.prisma.tenant.update({ where: { id: tenantId }, data: { billingCountry: code } });

        const gateEnabled = (await this.config.getConfig()).fiscalGateEnabled;
        return {
            success: true,
            data: {
                billingCountry: code,
                required: gateEnabled && billingCountryRequiresFiscalData(code),
            },
        };
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
            buffer = await this.pdf.render(buildBrandedInvoiceData(inv, cfg, acquirerFallback, relatedInvoiceNumber));
        } else {
            // Official: stored copy → fetch from Factus on demand → branded fallback.
            buffer = this.storage.read(tenantId, inv.id, 'pdf');
            if (!buffer && inv.provider === 'factus' && inv.invoiceNumber) {
                buffer = await this.factus.downloadPdf(inv.invoiceNumber).catch(() => null);
                if (buffer) this.storage.save(tenantId, inv.id, 'pdf', buffer);
            }
            if (!buffer) {
                const cfg = await this.config.getConfig();
                buffer = await this.pdf.render(buildBrandedInvoiceData(inv, cfg, acquirerFallback, relatedInvoiceNumber));
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

}
