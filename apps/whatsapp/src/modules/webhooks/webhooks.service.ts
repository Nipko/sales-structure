import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly redis: Redis;
  private readonly tenantCache = new Map<string, { tenantId: string; schemaName: string; expiresAt: number }>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutos

  constructor(
    @InjectQueue('webhooks') private readonly webhookQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.redis = new Redis({
      host: config.get<string>('redis.host'),
      port: config.get<number>('redis.port'),
      password: config.get<string>('redis.password') || undefined,
    });
  }

  /**
   * Procesar un cambio individual de webhook
   */
  async processChange(wabaId: string, change: any) {
    const field = change?.field;
    const value = change?.value;

    if (!field || !value) return;

    this.logger.debug(`Processing webhook: field=${field}, wabaId=${wabaId}`);

    switch (field) {
      case 'messages':
        await this.handleMessageEvent(wabaId, value);
        break;
      case 'message_template_status_update':
        await this.handleTemplateStatusUpdate(wabaId, value);
        break;
      case 'account_update':
        await this.handleAccountUpdate(wabaId, value);
        break;
      default:
        this.logger.debug(`Unhandled webhook field: ${field}`);
    }
  }

  /**
   * Procesar eventos de mensaje — enqueue para procesamiento async
   */
  private async handleMessageEvent(wabaId: string, value: any) {
    const metadata = value?.metadata;
    const phoneNumberId = metadata?.phone_number_id;

    if (!phoneNumberId) {
      this.logger.warn('Message event without phone_number_id');
      return;
    }

    // Resolver el tenant basado en phone_number_id
    const tenantInfo = await this.resolveTenant(phoneNumberId);
    if (!tenantInfo) {
      this.logger.warn(`No tenant found for phoneNumberId: ${phoneNumberId}`);
      return;
    }

    // Generar dedupe key para idempotencia
    const messages = value?.messages || [];
    for (const msg of messages) {
      const dedupeKey = `wa:msg:${msg.id}`;

      // Check idempotencia en Redis
      const exists = await this.redis.get(dedupeKey);
      if (exists) {
        this.logger.debug(`Duplicate message ignored: ${msg.id}`);
        continue;
      }

      // Marcar como procesando (TTL 24h)
      await this.redis.setex(dedupeKey, 86400, '1');

      // Encolar para procesamiento
      await this.webhookQueue.add('process-message', {
        tenantId: tenantInfo.tenantId,
        schemaName: tenantInfo.schemaName,
        wabaId,
        phoneNumberId,
        message: msg,
        contacts: value?.contacts || [],
        statuses: value?.statuses || [],
        timestamp: new Date().toISOString(),
      }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 1000,
      });
    }

    // También procesar status updates (delivered, read, etc.)
    const statuses = value?.statuses || [];
    for (const status of statuses) {
      const dedupeKey = `wa:status:${status.id}:${status.status}`;
      const exists = await this.redis.get(dedupeKey);
      if (exists) continue;

      await this.redis.setex(dedupeKey, 86400, '1');

      await this.webhookQueue.add('process-status', {
        tenantId: tenantInfo.tenantId,
        schemaName: tenantInfo.schemaName,
        phoneNumberId,
        status,
        timestamp: new Date().toISOString(),
      }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 100,
      });
    }
  }

  /**
   * Template status update — actualiza el estado del template en el tenant schema
   */
  private async handleTemplateStatusUpdate(wabaId: string, value: any) {
    this.logger.log(`Template status update for WABA ${wabaId}: ${value?.event}`);

    // Encolar para procesamiento async
    await this.webhookQueue.add('template-status-update', {
      wabaId,
      event: value?.event,
      messageTemplateName: value?.message_template_name,
      messageTemplateId: value?.message_template_id,
      newStatus: value?.event, // APPROVED, REJECTED, etc.
      timestamp: new Date().toISOString(),
    }, {
      attempts: 2,
      removeOnComplete: 50,
    });
  }

  /**
   * Account update — cambios en la configuración de la WABA
   */
  private async handleAccountUpdate(wabaId: string, value: any) {
    this.logger.log(`Account update for WABA ${wabaId}: ${JSON.stringify(value)}`);

    await this.webhookQueue.add('account-update', {
      wabaId,
      event: value?.event,
      payload: value,
      timestamp: new Date().toISOString(),
    }, {
      attempts: 2,
      removeOnComplete: 50,
    });
  }

  /**
   * Resolver tenant desde phoneNumberId con cache en memoria + Redis
   */
  private async resolveTenant(phoneNumberId: string): Promise<{ tenantId: string; schemaName: string } | null> {
    // 1. Cache en memoria
    const cached = this.tenantCache.get(phoneNumberId);
    if (cached && cached.expiresAt > Date.now()) {
      return { tenantId: cached.tenantId, schemaName: cached.schemaName };
    }

    // 2. Cache en Redis
    const redisKey = `wa:tenant:${phoneNumberId}`;
    const redisCached = await this.redis.get(redisKey);
    if (redisCached) {
      const parsed = JSON.parse(redisCached);
      this.tenantCache.set(phoneNumberId, { ...parsed, expiresAt: Date.now() + this.CACHE_TTL });
      return parsed;
    }

    // 3. Consulta a BD
    const result = await this.prisma.getTenantByPhoneNumberId(phoneNumberId);
    if (result) {
      // Guardar en ambos caches
      this.tenantCache.set(phoneNumberId, { ...result, expiresAt: Date.now() + this.CACHE_TTL });
      await this.redis.setex(redisKey, 300, JSON.stringify(result)); // 5 min en Redis
    }

    return result;
  }
}
