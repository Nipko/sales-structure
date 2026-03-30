import { Controller, Get, Post, Body, Param, Delete, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { OnboardingService } from './onboarding.service';
import { StartOnboardingDto } from './dto/start-onboarding.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('onboarding')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Post('start')
  @Roles('super_admin', 'tenant_admin')
  @ApiOperation({ summary: 'Iniciar onboarding WhatsApp Embedded Signup' })
  async start(@Body() dto: StartOnboardingDto, @Request() req: any) {
    return this.onboardingService.startOnboarding(dto, req.user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener detalle completo de un onboarding' })
  async getOnboarding(@Param('id') id: string, @Request() req: any) {
    return this.onboardingService.getOnboarding(id, req.user);
  }

  @Get(':id/status')
  @ApiOperation({ summary: 'Obtener solo el estado (polling desde frontend)' })
  async getStatus(@Param('id') id: string, @Request() req: any) {
    return this.onboardingService.getOnboardingStatus(id, req.user);
  }

  @Post(':id/retry')
  @Roles('super_admin', 'tenant_admin')
  @ApiOperation({ summary: 'Reintentar un onboarding fallido' })
  async retry(@Param('id') id: string, @Request() req: any) {
    return this.onboardingService.retryOnboarding(id, req.user);
  }

  @Post(':id/resync')
  @Roles('super_admin', 'tenant_admin')
  @ApiOperation({ summary: 'Re-sincronizar assets (templates, números) de un onboarding completado' })
  async resync(@Param('id') id: string, @Request() req: any) {
    return this.onboardingService.resyncAssets(id, req.user);
  }

  @Delete(':id')
  @Roles('super_admin', 'tenant_admin')
  @ApiOperation({ summary: 'Cancelar un onboarding en progreso' })
  async cancel(@Param('id') id: string, @Request() req: any) {
    return this.onboardingService.cancelOnboarding(id, req.user);
  }

  @Get()
  @Roles('super_admin')
  @ApiOperation({ summary: 'Listar todos los onboardings (admin)' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'tenantId', required: false, type: String })
  async list(
    @Request() req: any,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('tenantId') tenantId?: string,
  ) {
    return this.onboardingService.listOnboardings(
      req.user,
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
      tenantId,
    );
  }
}
