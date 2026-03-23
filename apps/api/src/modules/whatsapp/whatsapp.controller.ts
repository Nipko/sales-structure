import { Controller, Get, Post, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { WhatsappConnectionService } from './services/whatsapp-connection.service';
import { WhatsappWebhookService } from './services/whatsapp-webhook.service';
import { WhatsappTemplateService } from './services/whatsapp-template.service';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

@ApiTags('whatsapp')
@Controller('channels/whatsapp')
export class WhatsappController {
  constructor(
    private readonly connectionService: WhatsappConnectionService,
    private readonly webhookService: WhatsappWebhookService,
    private readonly templateService: WhatsappTemplateService
  ) {}

  @Get('status')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get WhatsApp channel status' })
  async getStatus(@Request() req: any) {
    const { schemaName } = req.user;
    return this.connectionService.getChannelStatus(schemaName);
  }

  @Get('config')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'tenant_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get WhatsApp webhook configuration' })
  async getConfig() {
    return {
      webhookUrl: `${process.env.API_URL || 'https://api.parallly-chat.cloud/api/v1'}/channels/whatsapp/webhook`,
      verifyToken: process.env.META_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN || 'Token no configurado en backend',
    };
  }

  @Post('connect/start')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'tenant_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Start WhatsApp connection onboarding' })
  async startConnection() {
    return { status: 'pending_onboarding' };
  }

  @Post('connect/complete')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'tenant_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Complete WhatsApp connection onboarding' })
  async completeConnection(@Request() req: any, @Body() data: any) {
    const { schemaName } = req.user;
    return this.connectionService.saveConnection(schemaName, data);
  }

  @Get('templates')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get synced WhatsApp templates' })
  async getTemplates(@Request() req: any) {
    const { schemaName } = req.user;
    return this.templateService.getTemplates(schemaName);
  }

  @Post('templates/sync')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'tenant_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Force sync templates from Meta' })
  async syncTemplates(@Request() req: any) {
    const { schemaName } = req.user;
    return this.templateService.syncTemplatesFromMeta(schemaName);
  }

  @Get('webhook')
  @ApiOperation({ summary: 'Verify Meta webhook' })
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    return this.webhookService.verifyWebhook(mode, token, challenge);
  }

  @Post('webhook')
  @ApiOperation({ summary: 'Receive messages and status from Meta' })
  async handleWebhook(@Body() payload: any) {
    // Process async (fire & forget for HTTP response speed)
    this.webhookService.handleWebhookPayload(payload).catch(console.error);
    return 'EVENT_RECEIVED'; // Explicitly exact what Meta expects usually
  }
}
