import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';

@Processor('webhooks')
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    super();
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
    const secret = this.configService.get<string>('INTERNAL_JWT_SECRET');

    if (!secret) {
      this.logger.warn('INTERNAL_JWT_SECRET not set — skipping AI forwarding');
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
              'x-internal-secret': secret,
            },
            timeout: 5000,
          },
        ),
      );
      this.logger.log(`Forwarded message from ${normalizedMsg.contactId} to ConversationsService`);
    } catch (err: any) {
      // No re-throw — la auditoría ya fue guardada; si la IA falla, no perdemos el mensaje
      this.logger.error(`Failed to forward message to API: ${err.message}`);
    }
  }

  /**
   * Procesar status update (sent, delivered, read, failed)
   */
  private async processStatus(data: any) {
    const { schemaName, status } = data;
    this.logger.debug(`Processing status update: ${status.status} for message ${status.id}`);

    try {
      await this.prisma.executeInTenantSchema(
        schemaName,
        `UPDATE messages SET status = $1, updated_at = NOW()
         WHERE external_id = $2`,
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
        } catch (e) {
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
        } catch (e) {
          // Tenant may not have this WABA, ignore
        }
      }
    } catch (error: any) {
      this.logger.warn(`Account update processing failed: ${error.message}`);
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
