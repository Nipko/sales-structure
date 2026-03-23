import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';

@Processor('webhooks')
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(private readonly prisma: PrismaService) {
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
   * Procesar un mensaje entrante
   * Persiste en el tenant schema (whatsapp_webhook_events + upsert contacto)
   */
  private async processMessage(data: any) {
    const { tenantId, schemaName, phoneNumberId, message, contacts } = data;
    this.logger.log(`Processing message ${message.id} for tenant ${tenantId}`);

    try {
      // Guardar evento de webhook para auditoría (matches real table schema)
      await this.prisma.executeInTenantSchema(
        schemaName,
        `INSERT INTO whatsapp_webhook_events (event_type, payload_json, dedupe_key, processing_status, processed_at)
         VALUES ($1, $2, $3, 'processed', NOW())
         ON CONFLICT (dedupe_key) DO NOTHING`,
        ['message', JSON.stringify({ phoneNumberId, message, contacts }), `msg:${message.id}`],
      );

      // Extraer contacto
      const contact = contacts?.[0] || {};
      const fromPhone = message.from;

      // Upsert contacto
      await this.prisma.executeInTenantSchema(
        schemaName,
        `INSERT INTO contacts (external_id, channel_type, name, phone, first_contact_at, last_contact_at, updated_at)
         VALUES ($1, 'whatsapp', $2, $3, NOW(), NOW(), NOW())
         ON CONFLICT (channel_type, external_id)
         DO UPDATE SET name = COALESCE(EXCLUDED.name, contacts.name), last_contact_at = NOW(), updated_at = NOW()`,
        [fromPhone, contact.profile?.name || null, fromPhone],
      );

      this.logger.debug(`Message ${message.id} processed for tenant ${tenantId}`);
    } catch (error: any) {
      this.logger.error(`Failed to process message ${message.id}: ${error.message}`);
      throw error; // Re-throw para que BullMQ haga retry
    }
  }

  /**
   * Procesar status update (sent, delivered, read, failed)
   */
  private async processStatus(data: any) {
    const { tenantId, schemaName, status } = data;
    this.logger.debug(`Processing status update: ${status.status} for message ${status.id}`);

    try {
      // Actualizar estado del mensaje en la BD del tenant
      await this.prisma.executeInTenantSchema(
        schemaName,
        `UPDATE messages SET status = $1, updated_at = NOW()
         WHERE external_id = $2`,
        [status.status, status.id],
      );

      // Log como webhook event
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
   * Template status update (APPROVED, REJECTED, etc.)
   */
  private async processTemplateUpdate(data: any) {
    this.logger.log(`Template status update: ${data.messageTemplateName} → ${data.newStatus}`);

    // Actualizar en todos los tenant schemas que tengan este template
    // En v1 solo loguea — en futuras versiones se buscan los tenants afectados
    try {
      // Podrían ser múltiples tenants con el mismo template name
      // Por ahora solo loguear para visibilidad
      this.logger.log(`Template ${data.messageTemplateName} status: ${data.newStatus}`);
    } catch (error: any) {
      this.logger.warn(`Template update processing failed: ${error.message}`);
    }
  }

  /**
   * Account update (ban, restrict, etc.)
   */
  private async processAccountUpdate(data: any) {
    this.logger.log(`Account update for WABA ${data.wabaId}: ${data.event}`);

    // En v1 solo loguear — en futuras versiones actualizar channel_status
    try {
      this.logger.log(`Account event: ${JSON.stringify(data.payload)}`);
    } catch (error: any) {
      this.logger.warn(`Account update processing failed: ${error.message}`);
    }
  }
}
