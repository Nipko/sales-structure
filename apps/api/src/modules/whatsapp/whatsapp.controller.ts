import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Request,
  BadRequestException,
  Headers,
  Req,
  UnauthorizedException,
  RawBodyRequest,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { WhatsappConnectionService } from './services/whatsapp-connection.service';
import { WhatsappWebhookService } from './services/whatsapp-webhook.service';
import { WhatsappTemplateService } from './services/whatsapp-template.service';
import { WhatsappMessagingService } from './services/whatsapp-messaging.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { Request as ExpressRequest } from 'express';
import { ChannelTokenService } from '../channels/channel-token.service';

@ApiTags('whatsapp')
@Controller('channels/whatsapp')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(
    private readonly connectionService: WhatsappConnectionService,
    private readonly webhookService: WhatsappWebhookService,
    private readonly templateService: WhatsappTemplateService,
    private readonly messagingService: WhatsappMessagingService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly channelToken: ChannelTokenService,
  ) {}

  private async resolveSchema(req: any): Promise<string | null> {
    if (req.user?.schemaName) return req.user.schemaName;
    const tenantId = req.user?.tenantId;
    if (!tenantId) return null;
    try {
      return await this.prisma.getTenantSchemaName(tenantId);
    } catch { return null; }
  }

  // ======================== CONNECTION ========================

  @Get('status')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get WhatsApp channel status' })
  async getStatus(@Request() req: any) {
    const schemaName = await this.resolveSchema(req);
    if (!schemaName) {
      return { status: 'disconnected', channel: null };
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
    const schemaName = await this.resolveSchema(req);
    const tenantId = req.user?.tenantId;
    if (!schemaName || !tenantId) {
      throw new BadRequestException('User does not belong to a tenant');
    }
    const result = await this.connectionService.saveConnection(schemaName, tenantId, data);

    // Fire-and-forget: auto-submit the 3 pre-vetted seed templates so the
    // tenant doesn't have to go to Meta Business Manager to create them.
    // Idempotency is handled inside seedTemplates via whatsapp_channels.seeds_submitted.
    this.templateService.seedTemplates(tenantId).catch((err) => {
        // Seeding failures should never block a successful connection — the
        // tenant can retry from the dashboard later.
        // eslint-disable-next-line no-console
        console.error(`[seedTemplates] Failed for tenant ${tenantId}:`, err?.message || err);
    });

    return result;
  }

  // ======================== DISCONNECT ========================

  @Post('disconnect')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'tenant_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Disconnect WhatsApp channel — calls Meta to unsubscribe the app from the WABA, then marks BD inactive' })
  async disconnect(@Request() req: any) {
    const tenantId = req.user?.tenantId;
    if (!tenantId) throw new BadRequestException('Tenant ID required');

    // Resolve tenant schema to read whatsapp_channels (waba_id lives there).
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { schemaName: true },
    });

    let metaUnsubscribed = false;
    let metaError: string | null = null;

    if (tenant?.schemaName) {
      try {
        // Get the access token + waba_id from the tenant's WhatsApp channel.
        const creds = await this.connectionService.getValidAccessToken(tenant.schemaName);
        const graphVersion = this.configService.get<string>('META_GRAPH_VERSION', 'v21.0');

        // Tell Meta to remove our app's webhook subscription on this WABA.
        // After this, Meta stops sending webhooks for this account to us.
        const res = await fetch(
          `https://graph.facebook.com/${graphVersion}/${creds.wabaId}/subscribed_apps?access_token=${creds.accessToken}`,
          { method: 'DELETE' },
        );

        if (res.ok) {
          metaUnsubscribed = true;
          this.logger.log(`Meta WABA ${creds.wabaId} unsubscribed for tenant ${tenantId}`);
        } else {
          const body = await res.text().catch(() => '');
          metaError = `Meta returned ${res.status}: ${body.substring(0, 200)}`;
          this.logger.warn(`Failed to unsubscribe WABA for tenant ${tenantId}: ${metaError}`);
        }
      } catch (err: any) {
        // No credentials, no waba_id, or fetch threw. We still proceed with
        // the BD-level disconnect — but flag this to the user so they know
        // Meta might still be sending webhooks until a manual cleanup.
        metaError = err?.message || 'unknown error resolving WhatsApp credentials';
        this.logger.warn(`Could not call Meta unsubscribe for tenant ${tenantId}: ${metaError}`);
      }
    }

    // Mark every WhatsApp channel_account inactive AND record what happened
    // in metadata so a future "reactivate" knows whether Meta needs to be
    // re-linked or the local toggle is enough.
    await this.prisma.$queryRawUnsafe(
      `UPDATE channel_accounts
         SET is_active = false,
             metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
                 'disconnected_at', NOW()::text,
                 'disconnected_at_provider', $2::boolean,
                 'disconnect_error', $3::text
             ),
             updated_at = NOW()
         WHERE tenant_id = $1::uuid AND channel_type = 'whatsapp'`,
      tenantId,
      metaUnsubscribed,
      metaError,
    );

    // Revoke the credentials so a stale token can't accidentally be reused.
    if (metaUnsubscribed) {
      // Use the typed client — whatsapp_credentials.tenant_id may be text in
      // some Prisma deployments and the raw ::uuid cast crashes there with
      // "operator does not exist: text = uuid". Prisma's updateMany handles
      // the column type transparently.
      try {
        await this.prisma.whatsappCredential.updateMany({
          where: { tenantId, rotationState: 'active' },
          data: { rotationState: 'revoked' },
        });
      } catch (e: any) {
        this.logger.warn(`Failed to revoke whatsapp_credentials for tenant ${tenantId}: ${e?.message}`);
      }
    }

    // Audit row so this disconnect is traceable later.
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId,
          action: 'channel_disconnected',
          resource: 'whatsapp',
          details: {
            metaUnsubscribed,
            metaError,
            triggeredBy: req.user?.sub || 'unknown',
          },
        },
      });
    } catch { /* non-blocking */ }

    this.logger.log(`WhatsApp disconnected for tenant ${tenantId} (meta=${metaUnsubscribed})`);
    return {
      success: true,
      message: metaUnsubscribed
        ? 'WhatsApp desconectado de Meta y de la plataforma'
        : 'WhatsApp marcado como desconectado en la plataforma. ATENCIÓN: la app sigue suscrita en Meta — revisar manualmente.',
      metaUnsubscribed,
      metaError,
    };
  }

  // ======================== BUSINESS PROFILE ========================

  @Get('business-profile')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'tenant_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get WhatsApp Business profile and phone number details from Meta' })
  async getBusinessProfile(@Request() req: any) {
    const schemaName = await this.resolveSchema(req);
    if (!schemaName) throw new BadRequestException('User does not belong to a tenant');
    const result = await this.connectionService.getBusinessProfile(schemaName);
    return { success: true, data: result };
  }

  @Post('business-profile')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'tenant_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update WhatsApp Business profile fields on Meta' })
  async updateBusinessProfile(@Request() req: any, @Body() body: {
    about?: string;
    address?: string;
    description?: string;
    email?: string;
    websites?: string[];
    vertical?: string;
  }) {
    const schemaName = await this.resolveSchema(req);
    if (!schemaName) throw new BadRequestException('User does not belong to a tenant');
    return this.connectionService.updateBusinessProfile(schemaName, body);
  }

  @Post('business-profile/photo')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'tenant_admin')
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }))
  @ApiOperation({ summary: 'Upload WhatsApp Business profile photo to Meta' })
  async uploadProfilePhoto(@Request() req: any, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file received');
    const schemaName = await this.resolveSchema(req);
    if (!schemaName) throw new BadRequestException('User does not belong to a tenant');
    return this.connectionService.uploadProfilePhoto(schemaName, file);
  }

  @Post('business-profile/photo/delete')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'tenant_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete WhatsApp Business profile photo' })
  async deleteProfilePhoto(@Request() req: any) {
    const schemaName = await this.resolveSchema(req);
    if (!schemaName) throw new BadRequestException('User does not belong to a tenant');
    return this.connectionService.deleteProfilePhoto(schemaName);
  }

  // ======================== TEMPLATES ========================

  @Get('templates')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get synced WhatsApp templates' })
  async getTemplates(@Request() req: any) {
    const schemaName = await this.resolveSchema(req);
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
    const schemaName = await this.resolveSchema(req);
    if (!schemaName) {
      throw new BadRequestException('User does not belong to a tenant');
    }
    return this.templateService.syncTemplatesFromMeta(schemaName);
  }

  @Post('templates/create')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'tenant_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new WhatsApp template and submit to Meta for approval' })
  async createTemplate(
    @Request() req: any,
    @Body() body: {
      name: string;
      language: string;
      category: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';
      components: Array<{
        type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
        format?: string;
        text?: string;
        example?: any;
        buttons?: any[];
      }>;
      // Multi-number: which number/WABA to create the template on. Defaults to the
      // oldest active channel when omitted.
      phoneNumberId?: string;
    },
  ) {
    const schemaName = await this.resolveSchema(req);
    const tenantId = req.user?.tenantId;
    if (!schemaName || !tenantId) {
      throw new BadRequestException('User does not belong to a tenant');
    }

    if (!body.name || !body.language || !body.category || !body.components?.length) {
      throw new BadRequestException('name, language, category, and components are required');
    }

    // Las tres columnas que esta consulta pedía NO EXISTEN: la tabla
    // `whatsapp_channels` tiene `meta_waba_id`, `access_token_ref` y
    // `channel_status`, nunca tuvo `waba_id`, `access_token` ni `is_active`. O
    // sea que crear una plantilla desde la app fallaba SIEMPRE con un 42703
    // (columna inexistente) — y las plantillas son el requisito para iniciar
    // conversación fuera de la ventana de 24h, así que el tenant quedaba
    // obligado a ir a Meta Business Manager a mano.
    //
    // Se resuelve por ChannelTokenService, que ya sabe hacerlo bien: prefiere el
    // `system_user_token` cifrado de la tabla global y cae al ref de la fila
    // sólo si no lo hay. Copiar la consulta con los nombres corregidos habría
    // dejado el token sin descifrar.
    let creds: { accessToken: string; wabaId?: string; channelId?: string };
    try {
      const wa = await this.channelToken.getWhatsAppToken(tenantId, body.phoneNumberId);
      creds = { accessToken: wa.accessToken, wabaId: wa.wabaId, channelId: wa.channelId };
    } catch {
      throw new BadRequestException('No active WhatsApp channel. Complete Embedded Signup first.');
    }

    const { channelId, wabaId, accessToken } = creds;
    if (!wabaId || !accessToken || !channelId) {
      throw new BadRequestException('WhatsApp channel missing WABA ID or access token');
    }

    const result = await this.templateService.createTemplate(
      schemaName,
      channelId,
      wabaId,
      accessToken,
      {
        name: body.name,
        language: body.language as any,
        category: body.category,
        components: body.components as any,
      },
    );

    return { success: true, data: result };
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
    const schemaName = await this.resolveSchema(req);
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
    const schemaName = await this.resolveSchema(req);
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
    const schemaName = await this.resolveSchema(req);
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
    const schemaName = await this.resolveSchema(req);
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
    const schemaName = await this.resolveSchema(req);
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

    // Encolar ANTES de confirmar. Ver el comentario extenso en
    // channels.controller (webhook/whatsapp): un 200 antes del `queue.add`
    // convierte un reinicio en un mensaje perdido, porque Meta no reintenta lo
    // confirmado. Al fallar se deja propagar el error → 500 → Meta reintenta.
    await this.webhookService.handleWebhookPayload(payload);
    return 'EVENT_RECEIVED';
  }
}

