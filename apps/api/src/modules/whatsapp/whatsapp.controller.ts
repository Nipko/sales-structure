import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Request,
  BadRequestException,
  Headers,
  Req,
  UnauthorizedException,
  RawBodyRequest,
} from '@nestjs/common';
import { WhatsappConnectionService } from './services/whatsapp-connection.service';
import { WhatsappWebhookService } from './services/whatsapp-webhook.service';
import { WhatsappTemplateService } from './services/whatsapp-template.service';
import { WhatsappMessagingService } from './services/whatsapp-messaging.service';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Request as ExpressRequest } from 'express';

@ApiTags('whatsapp')
@Controller('channels/whatsapp')
export class WhatsappController {
  constructor(
    private readonly connectionService: WhatsappConnectionService,
    private readonly webhookService: WhatsappWebhookService,
    private readonly templateService: WhatsappTemplateService,
    private readonly messagingService: WhatsappMessagingService,
  ) {}

  // ======================== CONNECTION ========================

  @Get('status')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get WhatsApp channel status' })
  async getStatus(@Request() req: any) {
    const { schemaName } = req.user;
    if (!schemaName) {
      return { status: 'disconnected', channel: null, error: 'User does not belong to a tenant' };
    }
    return this.connectionService.getChannelStatus(schemaName);
  }

  @Get('config')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'tenant_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get WhatsApp webhook configuration' })
  async getConfig() {
    const apiBase = (process.env.API_URL || 'https://api.parallly-chat.cloud').replace(/\/$/, '');
    const apiBaseWithPrefix = apiBase.endsWith('/api/v1') ? apiBase : `${apiBase}/api/v1`;

    return {
      success: true,
      data: {
        webhookUrl: `${apiBaseWithPrefix}/channels/webhook/whatsapp`,
        verifyToken: this.webhookService.getVerifyToken()
          || process.env.META_VERIFY_TOKEN
          || 'Token no configurado en backend',
      },
    };
  }

  @Post('connect/start')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'tenant_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Start WhatsApp connection onboarding' })
  async startConnection() {
    return {
      status: 'ready',
      provider: 'meta_cloud',
      onboarding: {
        mode: 'embedded_signup',
        metaAppIdConfigured: Boolean(process.env.META_APP_ID),
        metaConfigIdConfigured: Boolean(process.env.META_CONFIG_ID),
      },
    };
  }

  @Post('connect/complete')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'tenant_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Complete WhatsApp connection onboarding' })
  async completeConnection(@Request() req: any, @Body() data: any) {
    const { schemaName, tenantId } = req.user;
    if (!schemaName || !tenantId) {
      throw new BadRequestException('User does not belong to a tenant');
    }
    return this.connectionService.saveConnection(schemaName, tenantId, data);
  }

  // ======================== TEMPLATES ========================

  @Get('templates')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get synced WhatsApp templates' })
  async getTemplates(@Request() req: any) {
    const { schemaName } = req.user;
    if (!schemaName) {
      return { success: true, data: [] };
    }
    return this.templateService.getTemplates(schemaName);
  }

  @Post('templates/sync')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'tenant_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Force sync templates from Meta' })
  async syncTemplates(@Request() req: any) {
    const { schemaName } = req.user;
    if (!schemaName) {
      throw new BadRequestException('User does not belong to a tenant');
    }
    return this.templateService.syncTemplatesFromMeta(schemaName);
  }

  // ======================== MESSAGING ========================

  @Post('send/template')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'tenant_admin', 'tenant_agent')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enviar mensaje de plantilla pre-aprobada' })
  async sendTemplate(@Request() req: any, @Body() body: {
    toPhone: string;
    templateName: string;
    language: string;
    components?: any[];
  }) {
    const { schemaName } = req.user;
    if (!schemaName) throw new BadRequestException('User does not belong to a tenant');
    return this.messagingService.sendTemplate(
      schemaName, body.toPhone, body.templateName, body.language, body.components || []
    );
  }

  @Post('send/text')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'tenant_admin', 'tenant_agent')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enviar mensaje de texto simple' })
  async sendText(@Request() req: any, @Body() body: {
    toPhone: string;
    text: string;
    conversationId?: string;
  }) {
    const { schemaName } = req.user;
    if (!schemaName) throw new BadRequestException('User does not belong to a tenant');
    return this.messagingService.sendTextMessage(
      schemaName, body.toPhone, body.text, body.conversationId
    );
  }

  @Post('send/interactive')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'tenant_admin', 'tenant_agent')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enviar mensaje interactivo (botones / listas)' })
  async sendInteractive(@Request() req: any, @Body() body: {
    toPhone: string;
    interactive: any;
    conversationId?: string;
  }) {
    const { schemaName } = req.user;
    if (!schemaName) throw new BadRequestException('User does not belong to a tenant');
    return this.messagingService.sendInteractiveMessage(
      schemaName, body.toPhone, body.interactive, body.conversationId
    );
  }

  @Post('send/media')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'tenant_admin', 'tenant_agent')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enviar multimedia (imagen, audio, documento, video)' })
  async sendMedia(@Request() req: any, @Body() body: {
    toPhone: string;
    mediaType: 'image' | 'audio' | 'document' | 'video';
    mediaUrl: string;
    caption?: string;
    filename?: string;
    conversationId?: string;
  }) {
    const { schemaName } = req.user;
    if (!schemaName) throw new BadRequestException('User does not belong to a tenant');
    return this.messagingService.sendMediaMessage(
      schemaName, body.toPhone, body.mediaType, body.mediaUrl, body.caption, body.filename, body.conversationId
    );
  }

  @Post('send/location')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'tenant_admin', 'tenant_agent')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enviar ubicación' })
  async sendLocation(@Request() req: any, @Body() body: {
    toPhone: string;
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
    conversationId?: string;
  }) {
    const { schemaName } = req.user;
    if (!schemaName) throw new BadRequestException('User does not belong to a tenant');
    return this.messagingService.sendLocationMessage(
      schemaName, body.toPhone, body.latitude, body.longitude, body.name, body.address, body.conversationId
    );
  }

  // ======================== WEBHOOKS ========================

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
  async handleWebhook(
    @Body() payload: any,
    @Headers('x-hub-signature-256') signature: string,
    @Req() req: RawBodyRequest<ExpressRequest>,
  ) {
    if (!this.webhookService.validateSignature(req.rawBody, signature)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    this.webhookService.handleWebhookPayload(payload).catch(console.error);
    return 'EVENT_RECEIVED';
  }
}

