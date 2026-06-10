import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class WebhooksService implements OnModuleDestroy {
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

  async onModuleDestroy() {
    await this.redis.quit();
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
      case 'smb_message_echoes':
        await this.handleMessageEchoEvent(wabaId, value);
        break;
      case 'history':
        await this.handleHistoryEvent(wabaId, value);
        break;
      case 'smb_app_state_sync':
        await this.handleContactSyncEvent(wabaId, value);
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

      // Claim atomically (SET NX EX) — a GET-then-SET let two simultaneous
      // deliveries of the same message both pass the check and enqueue twice.
      const claimed = await this.redis.set(dedupeKey, '1', 'EX', 86400, 'NX');
      if (claimed !== 'OK') {
        this.logger.debug(`Duplicate message ignored: ${msg.id}`);
        continue;
      }

      // Encolar para procesamiento
      try {
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
          jobId: `process-message-${msg.id}`,
          removeOnComplete: 100,
          removeOnFail: 1000,
        });
      } catch (err) {
        // Release the claim so Meta's retry re-processes (we never enqueued).
        await this.redis.del(dedupeKey).catch(() => {});
        throw err;
      }
    }

    // También procesar status updates (delivered, read, etc.)
    const statuses = value?.statuses || [];
    for (const status of statuses) {
      const dedupeKey = `wa:status:${status.id}:${status.status}`;
      const claimed = await this.redis.set(dedupeKey, '1', 'EX', 86400, 'NX');
      if (claimed !== 'OK') continue;

      await this.webhookQueue.add('process-status', {
        tenantId: tenantInfo.tenantId,
        schemaName: tenantInfo.schemaName,
        phoneNumberId,
        status,
        timestamp: new Date().toISOString(),
      }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        jobId: `process-status-${status.id}-${status.status}`,
        removeOnComplete: 100,
      });
      // (dedupe key already claimed atomically above)
    }
  }

  /**
   * Coexistence: message echoes — messages sent from the WhatsApp Business App
   * after coexistence is activated. These are outbound messages from the business
   * that should appear in the platform inbox but NOT trigger AI or automations.
   */
  private async handleMessageEchoEvent(wabaId: string, value: any) {
    const metadata = value?.metadata;
    const phoneNumberId = metadata?.phone_number_id;
    if (!phoneNumberId) return;

    const tenantInfo = await this.resolveTenant(phoneNumberId);
    if (!tenantInfo) {
      this.logger.warn(`[CoexEcho] No tenant for phoneNumberId: ${phoneNumberId}`);
      return;
    }

    const echoes = value?.message_echoes || [];
    for (const echo of echoes) {
      const dedupeKey = `wa:echo:${echo.id}`;
      const exists = await this.redis.get(dedupeKey);
      if (exists) continue;

      await this.webhookQueue.add('process-coex-echo', {
        tenantId: tenantInfo.tenantId,
        schemaName: tenantInfo.schemaName,
        wabaId,
        phoneNumberId,
        echo,
        timestamp: new Date().toISOString(),
      }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        jobId: `coex-echo-${echo.id}`,
        removeOnComplete: 100,
        removeOnFail: 500,
      });

      await this.redis.setex(dedupeKey, 86400, '1');
    }

    this.logger.log(`[CoexEcho] Enqueued ${echoes.length} echo(es) for tenant ${tenantInfo.tenantId}`);
  }

  /**
   * Coexistence: history sync — up to 6 months of past chat history.
   * Arrives in phases (0=24h, 1=1-90d, 2=90-180d) with chunked delivery.
   * Text messages cover 180 days; media only available for last 14 days.
   * Chunks may arrive out of order — use chunk_order to reassemble.
   */
  private async handleHistoryEvent(wabaId: string, value: any) {
    const metadata = value?.metadata;
    const phoneNumberId = metadata?.phone_number_id;
    if (!phoneNumberId) return;

    const tenantInfo = await this.resolveTenant(phoneNumberId);
    if (!tenantInfo) {
      this.logger.warn(`[CoexHistory] No tenant for phoneNumberId: ${phoneNumberId}`);
      return;
    }

    const historyEntries = value?.history || [];
    for (const entry of historyEntries) {
      const phase = entry?.metadata?.phase || '0';
      const chunkOrder = entry?.metadata?.chunk_order || '0';
      const progress = entry?.metadata?.progress || '0';
      const threads = entry?.threads || [];

      const dedupeKey = `wa:hist:${phoneNumberId}:p${phase}:c${chunkOrder}`;
      const exists = await this.redis.get(dedupeKey);
      if (exists) continue;

      await this.webhookQueue.add('process-coex-history', {
        tenantId: tenantInfo.tenantId,
        schemaName: tenantInfo.schemaName,
        wabaId,
        phoneNumberId,
        phase,
        chunkOrder: parseInt(chunkOrder, 10),
        progress: parseInt(progress, 10),
        threads,
        timestamp: new Date().toISOString(),
      }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 3000 },
        jobId: `coex-hist-${phoneNumberId}-${phase}-${chunkOrder}`,
        removeOnComplete: 200,
        removeOnFail: 1000,
      });

      await this.redis.setex(dedupeKey, 86400, '1');

      // Track sync progress in Redis for dashboard visibility
      await this.redis.setex(
        `coex:sync:${tenantInfo.tenantId}:${phoneNumberId}`,
        3600,
        JSON.stringify({ phase, chunkOrder, progress, updatedAt: new Date().toISOString() }),
      );

      this.logger.log(
        `[CoexHistory] Enqueued phase=${phase} chunk=${chunkOrder} progress=${progress}% ` +
        `(${threads.length} threads) for tenant ${tenantInfo.tenantId}`,
      );
    }
  }

  /**
   * Coexistence: contact sync — contacts from the WhatsApp Business App.
   * Initial batch arrives after onboarding; incremental updates follow.
   * Actions: 'add', 'update', 'remove'.
   */
  private async handleContactSyncEvent(wabaId: string, value: any) {
    const metadata = value?.metadata;
    const phoneNumberId = metadata?.phone_number_id;
    if (!phoneNumberId) return;

    const tenantInfo = await this.resolveTenant(phoneNumberId);
    if (!tenantInfo) {
      this.logger.warn(`[CoexContacts] No tenant for phoneNumberId: ${phoneNumberId}`);
      return;
    }

    const contacts = value?.state_sync || [];
    if (contacts.length === 0) return;

    await this.webhookQueue.add('process-coex-contacts', {
      tenantId: tenantInfo.tenantId,
      schemaName: tenantInfo.schemaName,
      wabaId,
      phoneNumberId,
      contacts,
      timestamp: new Date().toISOString(),
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      jobId: `coex-contacts-${phoneNumberId}-${Date.now()}`,
      removeOnComplete: 100,
      removeOnFail: 500,
    });

    this.logger.log(`[CoexContacts] Enqueued ${contacts.length} contact(s) for tenant ${tenantInfo.tenantId}`);
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
