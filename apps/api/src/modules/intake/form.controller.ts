import { Controller, Post, Param, Body, Headers, Req, HttpCode, HttpStatus, Logger, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IntakeService } from './intake.service';
import { Request } from 'express';

@ApiTags('public-forms')
@Controller('public/forms')
export class FormController {
    private readonly logger = new Logger(FormController.name);

    constructor(private readonly intakeService: IntakeService) {}

    @Post(':id/submit')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Submit form data for a specific form definition' })
    @ApiResponse({ status: 200, description: 'Form submitted successfully' })
    async submitForm(
        @Param('id') formDefinitionId: string,
        @Body() payload: any,
        @Req() req: Request,
        @Headers('x-tenant-id') tenantId?: string,
        @Headers('x-tenant-slug') tenantSlug?: string
    ) {
        if (!tenantId && !tenantSlug) {
            this.logger.warn(`Missing tenant header for form submission: ${formDefinitionId}`);
            return { ok: true }; // return OK to avoid leaking info
        }

        const schemaName = `tenant_${(tenantId || tenantSlug || '').replace(/-/g, '_')}`;
        
        const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
            ?? req.socket?.remoteAddress
            ?? 'unknown';
        const userAgent = req.headers['user-agent'] ?? '';
        const originUrl = req.headers['referer'] ?? req.headers['origin'] ?? '';

        try {
            await this.intakeService.processFormSubmission(formDefinitionId, payload, {
                ip,
                userAgent,
                originUrl,
                tenantId: tenantId || tenantSlug || '',
                schemaName,
            });
            return { ok: true, message: 'Gracias por registrarte!' };
        } catch (error) {
            this.logger.error(`Error processing form submission for ${formDefinitionId}`, error);
            if (error instanceof NotFoundException) {
                return { ok: false, error: error.message };
            }
            // By default, do not leak error specifics, but mark ok: false
            return { ok: false, error: 'Se produjo un error al procesar el formulario.' };
        }
    }
}
