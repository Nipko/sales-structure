import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Headers,
  Req,
  Res,
  Logger,
  RawBodyRequest,
  HttpCode,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { WebhooksService } from './webhooks.service';
import * as crypto from 'crypto';

@ApiTags('webhooks')
@Controller('webhooks/whatsapp')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly config: ConfigService,
  ) {}

  /**
   * GET — Meta webhook verification (challenge/response)
   */
  @Get()
  @ApiOperation({ summary: 'Meta webhook verification endpoint' })
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const verifyToken = this.config.get<string>('meta.verifyToken')
      || this.config.get<string>('WHATSAPP_VERIFY_TOKEN');

    if (mode === 'subscribe' && token === verifyToken) {
      this.logger.log('Webhook verification successful');
      return res.status(200).send(challenge);
    }

    this.logger.warn(`Webhook verification failed: mode=${mode}, token_match=${token === verifyToken}`);
    return res.status(403).send('Forbidden');
  }

  /**
   * POST — Recibir webhooks de Meta
   * DEBE responder 200 en <5s (procesamiento async via BullMQ)
   */
  @Post()
  @HttpCode(200)
  @ApiExcludeEndpoint() // No mostrar en Swagger (es para Meta, no para humanos)
  async handleWebhook(
    @Headers('x-hub-signature-256') signature: string,
    @Body() body: any,
    @Req() req: RawBodyRequest<Request>,
  ) {
    // 1. Validar firma HMAC-SHA256
    if (!this.validateSignature(req, signature)) {
      this.logger.warn('Invalid webhook signature — rejecting');
      throw new UnauthorizedException('invalid_signature');
    }

    // 2. Responder 200 inmediatamente y procesar en background
    // Meta requiere <5s de response time
    this.processWebhookAsync(body).catch(err => {
      this.logger.error(`Webhook processing error: ${err.message}`);
    });

    return { status: 'received' };
  }

  /**
   * Validar firma HMAC-SHA256 del webhook
   */
  private validateSignature(req: RawBodyRequest<Request>, signature: string): boolean {
    if (!signature) return false;

    const appSecret = this.config.get<string>('meta.appSecret')
      || this.config.get<string>('WHATSAPP_APP_SECRET');
    if (!appSecret) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.error('WHATSAPP_APP_SECRET is required in production for webhook signature validation');
        return false;
      }
      this.logger.warn('WHATSAPP_APP_SECRET not configured — skipping signature validation (DEV ONLY)');
      return true;
    }

    try {
      const rawBody = req.rawBody;
      if (!rawBody) {
        this.logger.warn('Raw body not available for signature validation');
        return false;
      }

      const expectedSignature = 'sha256=' + crypto
        .createHmac('sha256', appSecret)
        .update(rawBody)
        .digest('hex');

      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature),
      );
    } catch (error: any) {
      this.logger.error(`Signature validation error: ${error.message}`);
      return false;
    }
  }

  /**
   * Procesamiento asíncrono del webhook
   */
  private async processWebhookAsync(body: any) {
    const object = body?.object;
    if (object !== 'whatsapp_business_account') {
      this.logger.debug(`Ignoring webhook for object type: ${object}`);
      return;
    }

    const entries = body?.entry || [];
    for (const entry of entries) {
      const changes = entry?.changes || [];
      for (const change of changes) {
        await this.webhooksService.processChange(entry.id, change);
      }
    }
  }
}
