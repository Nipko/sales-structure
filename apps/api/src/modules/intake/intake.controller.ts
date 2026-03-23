import {
    Controller,
    Post,
    Body,
    Req,
    HttpCode,
    HttpStatus,
    Logger,
} from '@nestjs/common';
import { IntakeService } from './intake.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

/**
 * Intake Controller — PUBLIC endpoint (no JWT required).
 *
 * Receives lead submissions from landing pages / external forms.
 * Always returns 200 to avoid leaking existence of leads.
 *
 * The tenantId is resolved from the `x-tenant-id` header or a
 * configurable query param. For simplicity, we require the header.
 */
@ApiTags('intake')
@Controller('intake')
export class IntakeController {
    private readonly logger = new Logger(IntakeController.name);

    constructor(private readonly intakeService: IntakeService) { }

    /**
     * Public lead capture endpoint.
     * Called by landing pages after form submission.
     */
    @Post('lead')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Capture a lead from a public form (no auth required)' })
    @ApiResponse({ status: 200, description: 'Lead captured or updated successfully' })
    async captureLead(
        @Body() dto: CreateLeadDto,
        @Req() req: any,
    ) {
        // Resolve tenant from header (landing pages must send this)
        const tenantId = req.headers['x-tenant-id'] as string;
        const tenantSlug = req.headers['x-tenant-slug'] as string;

        if (!tenantId && !tenantSlug) {
            // Return 200 anyway so bots/scrapers can't enumerate tenants
            this.logger.warn('[Intake] Missing x-tenant-id header — ignoring submission');
            return { ok: true };
        }

        // Derive schema name (matches createTenantSchema convention)
        const schemaName = `tenant_${(tenantId || tenantSlug).replace(/-/g, '_')}`;

        const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
            ?? req.socket?.remoteAddress
            ?? 'unknown';
        const userAgent = req.headers['user-agent'] ?? '';
        const originUrl = req.headers['referer'] ?? req.headers['origin'] ?? '';

        try {
            const result = await this.intakeService.captureFromForm(dto, {
                ip,
                userAgent,
                originUrl,
                tenantId: tenantId || tenantSlug,
                schemaName,
            });

            this.logger.log(
                `[Intake] Lead ${result.isNew ? 'created' : 'updated'}: ${result.leadId} ` +
                `| phone: ${result.phone} | tenant: ${schemaName}`
            );

            // Always return 200 OK — never reveal lead existence status
            return { ok: true };
        } catch (error) {
            // Log internally but don't expose error details to the caller
            this.logger.error('[Intake] Error capturing lead:', error);
            return { ok: true };
        }
    }
}
