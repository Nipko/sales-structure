import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { VerticalsService } from './verticals.service';
import { VERTICAL_REGISTRY } from './vertical-definitions';

@ApiTags('verticals')
@Controller('verticals')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@ApiBearerAuth()
export class VerticalsController {
    constructor(private readonly verticalsService: VerticalsService) {}

    @Get(':tenantId')
    @ApiOperation({ summary: 'Get vertical config for a tenant' })
    async getConfig(@Param('tenantId') tenantId: string) {
        const config = await this.verticalsService.getVerticalConfig(tenantId);
        return { success: true, data: config };
    }

    @Get('definitions/all')
    @ApiOperation({ summary: 'Get all vertical definitions (for onboarding sub-types)' })
    async getDefinitions() {
        const subtypes: Record<string, any[]> = {};
        for (const [key, def] of Object.entries(VERTICAL_REGISTRY)) {
            if (def.subTypes.length > 0) {
                subtypes[key] = def.subTypes;
            }
        }
        return { success: true, data: subtypes };
    }
}
