import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { FiscalConfigService, FiscalConfig } from './fiscal-config.service';
import { FiscalInvoiceService } from './fiscal-invoice.service';
import { FactusAdapter } from './adapters/factus.adapter';

class FiscalConfigDto {
    @IsOptional() @IsIn(['CO_LOCAL', 'US_REMOTE']) mode?: 'CO_LOCAL' | 'US_REMOTE';
    @IsOptional() @IsIn(['excluido', 'gravado_19']) coIvaTreatment?: 'excluido' | 'gravado_19';
    @IsOptional() @IsIn(['sandbox', 'production']) factusEnvironment?: string;
    @IsOptional() @IsString() factusNumberingRangeId?: string;
    @IsOptional() @IsString() factusCreditNumberingRangeId?: string;
    @IsOptional() @IsString() defaultUnitMeasureId?: string;
    @IsOptional() @IsString() defaultStandardCodeId?: string;
    @IsOptional() @IsString() defaultProductTributeId?: string;
    @IsOptional() @IsString() defaultMunicipalityId?: string;
    @IsOptional() @IsObject() usIssuer?: { legalName?: string; taxId?: string; address?: string; email?: string };
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
        // Guard: CO_LOCAL needs a Factus numbering range to actually issue.
        if (body.mode === 'CO_LOCAL' && !(body.factusNumberingRangeId ?? current.factusNumberingRangeId)) {
            throw new BadRequestException({
                error: 'numbering_range_required',
                message: 'Configura el numbering_range_id de Factus antes de operar en modo CO_LOCAL.',
            });
        }

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
        const where: Record<string, unknown> = {};
        if (status) where.status = status;
        if (tenantId) where.tenantId = tenantId;
        const take = 50;
        const skip = page && Number(page) > 1 ? (Number(page) - 1) * take : 0;

        const [rows, total] = await Promise.all([
            this.prisma.fiscalInvoice.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip }),
            this.prisma.fiscalInvoice.count({ where }),
        ]);
        const tenantIds = [...new Set(rows.map((r) => r.tenantId))];
        const tenants = await this.prisma.tenant.findMany({
            where: { id: { in: tenantIds } },
            select: { id: true, name: true },
        });
        const nameMap = Object.fromEntries(tenants.map((t) => [t.id, t.name]));
        return {
            success: true,
            total,
            data: rows.map((r) => ({ ...r, tenantName: nameMap[r.tenantId] || r.tenantId })),
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
