import { Controller, Get, Param, Headers, NotFoundException, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IntakeService } from './intake.service';

@ApiTags('public-landing')
@Controller('public/landing')
export class LandingController {
    private readonly logger = new Logger(LandingController.name);

    constructor(private readonly intakeService: IntakeService) {}

    @Get(':slug')
    @ApiOperation({ summary: 'Get published landing page details by slug' })
    @ApiResponse({ status: 200, description: 'Landing page data including form definition' })
    @ApiResponse({ status: 404, description: 'Landing page not found' })
    async getLandingPage(
        @Param('slug') slug: string,
        @Headers('x-tenant-id') tenantId?: string,
        @Headers('x-tenant-slug') tenantSlug?: string
    ) {
        if (!tenantId && !tenantSlug) {
            this.logger.warn(`Missing tenant header for landing request: ${slug}`);
            throw new NotFoundException('Página no encontrada.');
        }

        try {
            const tenant = await this.intakeService.resolvePublicTenant(
                tenantId || tenantSlug || '',
                'read',
            );
            if (!tenant) throw new NotFoundException('Página no encontrada.');
            const landing = await this.intakeService.getLandingPageBySlug(tenant.schemaName, slug);
            if (!landing) {
                throw new NotFoundException('Página no encontrada o no publicada.');
            }
            return { ok: true, data: landing };
        } catch (error) {
            if (error instanceof NotFoundException) throw error;
            this.logger.error(`Error fetching landing slug: ${slug}`, error);
            throw new NotFoundException('Página no encontrada.');
        }
    }
}
