import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import Redis from 'ioredis';

@Processor('webhooks')
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);
  private readonly redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    super();
    this.redis = new Redis({
      host: configService.get<string>('REDIS_HOST') || 'localhost',
      port: configService.get<number>('REDIS_PORT') || 6379,
      password: configService.get<string>('REDIS_PASSWORD') || undefined,
    });
  }

  async process(job: Job): Promise<any> {
    switch (job.name) {
      case 'process-message':
        return this.processMessage(job.data);
      case 'process-status':
        return this.processStatus(job.data);
      case 'template-status-update':
        return this.processTemplateUpdate(job.data);
      case 'account-update':
        return this.processAccountUpdate(job.data);
      case 'process-coex-echo':
        return this.processCoexEcho(job.data);
      case 'process-coex-history':
        return this.processCoexHistory(job.data);
      case 'process-coex-contacts':
        return this.processCoexContacts(job.data);
      default:
        this.logger.warn(`Unknown job type: ${job.name}`);
    }
  }

  /**
   * Procesar un mensaje entrante:
   * 1. Persiste en el tenant schema para auditoría
   * 2. Upsert contacto
   * 3. Reenvía al ConversationsService de la API para procesamiento por IA
   */
  private async processMessage(data: any) {
    const { tenantId, schemaName, phoneNumberId, message, contacts, channelAccountId } = data;
    this.logger.log(`Processing message ${message.id} for tenant ${tenantId}`);

    try {
      // 1. Guardar evento de webhook para auditoría
      await this.prisma.executeInTenantSchema(
        schemaName,
        `INSERT INTO whatsapp_webhook_events (event_type, payload_json, dedupe_key, processing_status, processed_at)
         VALUES ($1, $2, $3, 'processed', NOW())
         ON CONFLICT (dedupe_key) DO NOTHING`,
        ['message', JSON.stringify({ phoneNumberId, message, contacts }), `msg:${message.id}`],
      );

      // 2. Extraer y upsert contacto
      const contact = contacts?.[0] || {};
      const fromPhone = message.from;

      await this.prisma.executeInTenantSchema(
        schemaName,
        `INSERT INTO contacts (external_id, channel_type, name, phone, first_contact_at, last_contact_at, updated_at)
         VALUES ($1, 'whatsapp', $2, $3, NOW(), NOW(), NOW())
         ON CONFLICT (channel_type, external_id)
         DO UPDATE SET name = COALESCE(EXCLUDED.name, contacts.name), last_contact_at = NOW(), updated_at = NOW()`,
        [fromPhone, contact.profile?.name || null, fromPhone],
      );

      // 3. Construir NormalizedMessage y enviar a la API interna para procesamiento por IA
      await this.forwardToConversationsService({
        id: `wh-${message.id}`,
        tenantId,
        channelType: 'whatsapp',
        channelAccountId: channelAccountId || phoneNumberId,
        contactId: fromPhone,
        conversationId: '',
        direction: 'inbound',
        content: this.parseContent(message),
        timestamp: new Date(parseInt(message.timestamp) * 1000),
        status: 'pending',
        metadata: {
          waMessageId: message.id,
          contactName: contact.profile?.name,
          phoneNumberId,
        },
      });

      this.logger.debug(`Message ${message.id} processed and forwarded for tenant ${tenantId}`);
    } catch (error: any) {
      this.logger.error(`Failed to process message ${message.id}: ${error.message}`);
      throw error; // Re-throw para que BullMQ haga retry
    }
  }

  /**
   * Reenviar el mensaje normalizado al endpoint interno de la API
   * para que ConversationsService lo procese y genere respuesta de IA.
   */
  private async forwardToConversationsService(normalizedMsg: any): Promise<void> {
    const apiUrl = this.configService.get<string>('API_INTERNAL_URL') || 'http://api:3000/api/v1';
    const internalKey = this.configService.get<string>('INTERNAL_API_KEY')
      || this.configService.get<string>('INTERNAL_JWT_SECRET'); // fallback for backward compat

    if (!internalKey) {
      this.logger.warn('INTERNAL_API_KEY not set — skipping AI forwarding');
      return;
    }

    try {
      await firstValueFrom(
        this.httpService.post(
          `${apiUrl}/internal/inbound-message`,
          normalizedMsg,
          {
            headers: {
              'Content-Type': 'application/json',
              'x-internal-key': internalKey,
            },
            timeout: 5000,
          },
        ),
      );
      this.logger.log(`Forwarded message from ${normalizedMsg.contactId} to ConversationsService`);
    } catch (err: any) {
      // Re-throw so BullMQ retries the job: if the forward fails, the customer
      // never gets an AI reply (the message is effectively lost). The audit
      // insert + contact upsert above are idempotent (ON CONFLICT), and the
      // internal endpoint acks immediately (a 5s timeout means non-delivery),
      // so retrying is safe and won't double-process.
      this.logger.error(`Failed to forward message to API: ${err.message} — will retry`);
      throw err;
    }
  }

  /**
   * Procesar status update (sent, delivered, read, failed)
   */
  private async processStatus(data: any) {
    const { schemaName, status } = data;
    this.logger.debug(`Processing status update: ${status.status} for message ${status.id}`);

    try {
      // Apply status only if it advances the lifecycle (sent<delivered<read<failed).
      // Webhooks can arrive out of order, so a late 'delivered' must not overwrite
      // an already-recorded 'read'.
      await this.prisma.executeInTenantSchema(
        schemaName,
        `UPDATE messages SET status = $1, updated_at = NOW()
         WHERE external_id = $2
           AND (CASE COALESCE(status,'') WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 WHEN 'failed' THEN 4 ELSE 0 END)
             < (CASE $1 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 WHEN 'failed' THEN 4 ELSE 0 END)`,
        [status.status, status.id],
      );

      await this.prisma.executeInTenantSchema(
        schemaName,
        `INSERT INTO whatsapp_webhook_events (event_type, payload_json, dedupe_key, processing_status, processed_at)
         VALUES ($1, $2, $3, 'processed', NOW())
         ON CONFLICT (dedupe_key) DO NOTHING`,
        ['status_update', JSON.stringify(status), `status:${status.id}:${status.status}`],
      );
    } catch (error: any) {
      this.logger.warn(`Status update failed for message ${status.id}: ${error.message}`);
    }
  }

  /**
   * Template status update — actualiza el estado en todos los tenants afectados
   */
  private async processTemplateUpdate(data: any) {
    this.logger.log(`Template status update: ${data.messageTemplateName} → ${data.newStatus}`);

    try {
      // Buscar todos los tenants que tienen este template y actualizar su estado
      const tenants = await this.prisma.$queryRaw<{ schema_name: string }[]>`
        SELECT schema_name FROM public.tenants WHERE schema_name IS NOT NULL
      `;

      for (const tenant of tenants) {
        try {
          await this.prisma.executeInTenantSchema(
            tenant.schema_name,
            `UPDATE whatsapp_templates
             SET approval_status = $1, last_sync_at = NOW()
             WHERE name = $2`,
            [data.newStatus, data.messageTemplateName],
          );
        } catch {
          // Tenant may not have this template, ignore
        }
      }

      this.logger.log(`Updated template ${data.messageTemplateName} to ${data.newStatus} across tenants`);
    } catch (error: any) {
      this.logger.warn(`Template update processing failed: ${error.message}`);
    }
  }

  /**
   * Account update — actualiza el channel_status del tenant afectado
   */
  private async processAccountUpdate(data: any) {
    this.logger.log(`Account update for WABA ${data.wabaId}: ${data.event}`);

    try {
      // Mapear WABA ID → tenant y actualizar estado del canal
      const tenants = await this.prisma.$queryRaw<{ schema_name: string }[]>`
        SELECT schema_name FROM public.tenants WHERE schema_name IS NOT NULL
      `;

      for (const tenant of tenants) {
        try {
          await this.prisma.executeInTenantSchema(
            tenant.schema_name,
            `UPDATE whatsapp_channels
             SET channel_status = $1, updated_at = NOW()
             WHERE meta_waba_id = $2`,
            [data.event === 'FLAGGED' ? 'flagged' : data.event === 'DISABLED' ? 'disconnected' : 'connected', data.wabaId],
          );
        } catch {
          // Tenant may not have this WABA, ignore
        }
      }
    } catch (error: any) {
      this.logger.warn(`Account update processing failed: ${error.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  COEXISTENCE PROCESSORS
  //  Handle data from WhatsApp Business App ↔ Cloud API coexistence:
  //  - Echo messages (real-time outbound from the app)
  //  - History sync (up to 6 months of past chats)
  //  - Contact sync (address book from the app)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Process a message echo — a message the business sent from their
   * WhatsApp Business App AFTER coexistence was activated.
   *
   * Key behavior:
   * - Stored as outbound message with source='waba_echo'
   * - Shown in platform inbox timeline
   * - Does NOT trigger AI, automations, or 24h session window
   * - Creates contact/conversation if they don't exist
   */
  private async processCoexEcho(data: any) {
    const { tenantId, schemaName, phoneNumberId, echo } = data;
    const to = echo.to;
    const from = echo.from;

    this.logger.log(`[CoexEcho] Processing echo ${echo.id} from ${from} to ${to}`);

    try {
      await this.prisma.executeInTenantSchema(
        schemaName,
        `INSERT INTO whatsapp_webhook_events (event_type, payload_json, dedupe_key, processing_status, processed_at)
         VALUES ($1, $2, $3, 'processed', NOW())
         ON CONFLICT (dedupe_key) DO NOTHING`,
        ['coex_echo', JSON.stringify(echo), `echo:${echo.id}`],
      );

      await this.prisma.executeInTenantSchema(
        schemaName,
        `INSERT INTO contacts (external_id, channel_type, phone, first_contact_at, last_contact_at, updated_at)
         VALUES ($1, 'whatsapp', $2, NOW(), NOW(), NOW())
         ON CONFLICT (channel_type, external_id)
         DO UPDATE SET last_contact_at = NOW(), updated_at = NOW()`,
        [to, to],
      );

      // Forward as outbound echo — the API stores it in the conversation
      // timeline but skips AI processing when metadata.source = 'waba_echo'
      await this.forwardToConversationsService({
        id: `echo-${echo.id}`,
        tenantId,
        channelType: 'whatsapp',
        channelAccountId: phoneNumberId,
        contactId: to,
        conversationId: '',
        direction: 'outbound',
        content: this.parseContent(echo),
        timestamp: new Date(parseInt(echo.timestamp) * 1000),
        status: 'sent',
        metadata: {
          waMessageId: echo.id,
          phoneNumberId,
          source: 'waba_echo',
        },
      });
    } catch (error: any) {
      this.logger.error(`[CoexEcho] Failed echo ${echo.id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Process a history sync chunk from the coexistence onboarding.
   *
   * Meta delivers history in phases:
   *   Phase 0 = last 24 hours
   *   Phase 1 = days 1–90
   *   Phase 2 = days 90–180
   *
   * Each phase arrives in numbered chunks (may be out of order).
   * progress=100 means sync is complete for all phases.
   *
   * Text messages: up to 180 days.
   * Media (with media_id): only last 14 days.
   * Media older than 14d: metadata only (type, timestamp), no file.
   */
  private async processCoexHistory(data: any) {
    const { tenantId, schemaName, phoneNumberId, phase, chunkOrder, progress, threads } = data;

    this.logger.log(
      `[CoexHistory] Processing phase=${phase} chunk=${chunkOrder} progress=${progress}% ` +
      `(${threads.length} threads) for tenant ${tenantId}`,
    );

    let totalMessages = 0;

    try {
      for (const thread of threads) {
        const contactPhone = thread.id;
        const messages = thread.messages || [];

        // Upsert the contact
        await this.prisma.executeInTenantSchema(
          schemaName,
          `INSERT INTO contacts (external_id, channel_type, phone, first_contact_at, last_contact_at, updated_at)
           VALUES ($1, 'whatsapp', $2, NOW(), NOW(), NOW())
           ON CONFLICT (channel_type, external_id)
           DO UPDATE SET last_contact_at = GREATEST(contacts.last_contact_at, NOW()), updated_at = NOW()`,
          [contactPhone, contactPhone],
        );

        for (const msg of messages) {
          const isFromBusiness = msg.from === phoneNumberId || msg.from !== contactPhone;
          const direction = isFromBusiness ? 'outbound' : 'inbound';

          // Forward each historical message to API for storage.
          // metadata.source = 'historical' tells the API to store it
          // without triggering AI, automations, or session logic.
          await this.forwardToConversationsService({
            id: `hist-${msg.id || `${contactPhone}-${msg.timestamp}`}`,
            tenantId,
            channelType: 'whatsapp',
            channelAccountId: phoneNumberId,
            contactId: contactPhone,
            conversationId: '',
            direction,
            content: this.parseContent(msg),
            timestamp: new Date(parseInt(msg.timestamp) * 1000),
            status: msg.history_context?.status || 'read',
            metadata: {
              waMessageId: msg.id,
              phoneNumberId,
              source: 'historical',
              historyPhase: phase,
              historyChunk: chunkOrder,
            },
          });

          totalMessages++;
        }
      }

      // Audit log for the chunk
      await this.prisma.executeInTenantSchema(
        schemaName,
        `INSERT INTO whatsapp_webhook_events (event_type, payload_json, dedupe_key, processing_status, processed_at)
         VALUES ($1, $2, $3, 'processed', NOW())
         ON CONFLICT (dedupe_key) DO NOTHING`,
        [
          'coex_history',
          JSON.stringify({ phase, chunkOrder, progress, threadCount: threads.length, messageCount: totalMessages }),
          `hist:${phoneNumberId}:p${phase}:c${chunkOrder}`,
        ],
      );

      // Update sync progress in Redis
      if (progress === 100) {
        await this.redis.setex(
          `coex:sync:${tenantId}:${phoneNumberId}`,
          86400,
          JSON.stringify({ phase, chunkOrder, progress: 100, completedAt: new Date().toISOString() }),
        );
        this.logger.log(`[CoexHistory] Sync COMPLETE for tenant ${tenantId}`);
      }

      this.logger.log(`[CoexHistory] Stored ${totalMessages} messages from ${threads.length} threads`);
    } catch (error: any) {
      this.logger.error(`[CoexHistory] Failed phase=${phase} chunk=${chunkOrder}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Process contact sync from the WhatsApp Business App.
   *
   * Actions:
   * - 'add': New contact from the app's address book
   * - 'update': Contact name or details changed in the app
   * - 'remove': Contact deleted from the app (we keep it, mark inactive)
   *
   * After initial batch, incremental updates arrive in real-time.
   */
  private async processCoexContacts(data: any) {
    const { tenantId, schemaName, contacts } = data;
    this.logger.log(`[CoexContacts] Processing ${contacts.length} contact(s) for tenant ${tenantId}`);

    let added = 0;
    let updated = 0;

    try {
      for (const entry of contacts) {
        const contact = entry.contact || {};
        const action = entry.action;
        const phone = contact.phone_number;
        const fullName = contact.full_name || contact.first_name || null;

        if (!phone) continue;

        if (action === 'add' || action === 'update') {
          await this.prisma.executeInTenantSchema(
            schemaName,
            `INSERT INTO contacts (external_id, channel_type, name, phone, first_contact_at, last_contact_at, updated_at)
             VALUES ($1, 'whatsapp', $2, $3, NOW(), NOW(), NOW())
             ON CONFLICT (channel_type, external_id)
             DO UPDATE SET
               name = COALESCE(EXCLUDED.name, contacts.name),
               updated_at = NOW()`,
            [phone, fullName, phone],
          );
          action === 'add' ? added++ : updated++;
        }
        // 'remove': we don't delete — the contact may have conversations.
        // A future enhancement could set an is_active flag.
      }

      await this.prisma.executeInTenantSchema(
        schemaName,
        `INSERT INTO whatsapp_webhook_events (event_type, payload_json, dedupe_key, processing_status, processed_at)
         VALUES ($1, $2, $3, 'processed', NOW())
         ON CONFLICT (dedupe_key) DO NOTHING`,
        [
          'coex_contacts',
          JSON.stringify({ count: contacts.length, added, updated }),
          `contacts:${tenantId}:${Date.now()}`,
        ],
      );

      this.logger.log(`[CoexContacts] Done: ${added} added, ${updated} updated`);
    } catch (error: any) {
      this.logger.error(`[CoexContacts] Failed: ${error.message}`);
      throw error;
    }
  }

  private parseContent(message: any): any {
    switch (message.type) {
      case 'text':
        return { type: 'text', text: message.text?.body || '' };
      case 'image':
        return { type: 'image', mediaUrl: message.image?.id, caption: message.image?.caption, mimeType: message.image?.mime_type };
      case 'audio':
        return { type: 'audio', mediaUrl: message.audio?.id, mimeType: message.audio?.mime_type };
      case 'video':
        return { type: 'video', mediaUrl: message.video?.id, caption: message.video?.caption, mimeType: message.video?.mime_type };
      case 'document':
        return { type: 'document', mediaUrl: message.document?.id, filename: message.document?.filename, mimeType: message.document?.mime_type };
      case 'location':
        return { type: 'location', latitude: message.location?.latitude, longitude: message.location?.longitude, text: message.location?.name };
      case 'button':
        return { type: 'text', text: message.button?.text || '' };
      case 'interactive':
        return { type: 'text', text: message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || '' };
      default:
        return { type: 'text', text: `[${message.type}]` };
    }
  }
}
