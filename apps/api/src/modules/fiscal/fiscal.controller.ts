import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PrismaService } from '../prisma/prisma.service';
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
    constructor(private readonly prisma: PrismaService) {}

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
}
