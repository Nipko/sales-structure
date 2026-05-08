import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { VerticalAnalyticsService } from './vertical-analytics.service';

@ApiTags('vertical-analytics')
@Controller('vertical-analytics')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@ApiBearerAuth()
export class VerticalAnalyticsController {
    constructor(private readonly service: VerticalAnalyticsService) {}

    @Get('overview')
    @Roles('super_admin')
    @ApiOperation({ summary: 'Cross-vertical platform overview — distribution + activation gaps' })
    async overview(@Query('refresh') refresh?: string) {
        const data = await this.service.getOverview(refresh === 'true');
        return { success: true, data };
    }

    @Get('industry/:industry')
    @Roles('super_admin')
    @ApiOperation({ summary: 'Per-industry drilldown — top tenants + platform totals' })
    async industry(
        @Param('industry') industry: string,
        @Query('refresh') refresh?: string,
    ) {
        const data = await this.service.getIndustryDrilldown(industry, refresh === 'true');
        return { success: true, data };
    }

    @Get('tenant/:tenantId')
    @Roles('super_admin')
    @ApiOperation({ summary: 'Single tenant vertical KPIs — used by tenant detail card' })
    async tenant(
        @Param('tenantId') tenantId: string,
        @Query('refresh') refresh?: string,
    ) {
        const data = await this.service.getTenantSnapshot(tenantId, refresh === 'true');
        return { success: !!data, data };
    }
}
