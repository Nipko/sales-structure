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
      // 1. Guardar evento de webhook para auditoría. Entra como 'received' y
      // solo pasa a 'processed' cuando el forward a la API tuvo éxito — antes
      // se estampaba 'processed' aquí mismo, así que la tabla no servía para
      // detectar mensajes persistidos cuyo turno de IA nunca corrió.
      await this.prisma.executeInTenantSchema(
        schemaName,
        `INSERT INTO whatsapp_webhook_events (event_type, payload_json, dedupe_key, processing_status)
         VALUES ($1, $2, $3, 'received')
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

      // 4. Marcar como procesado — el turno de IA quedó disparado de verdad.
      await this.prisma.executeInTenantSchema(
        schemaName,
        `UPDATE whatsapp_webhook_events
            SET processing_status = 'processed', processed_at = NOW()
          WHERE dedupe_key = $1`,
        [`msg:${message.id}`],
      ).catch(() => { /* best-effort: no reprocesar un forward exitoso por el stamp */ });

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
      // Antes esto retornaba "en verde": el mensaje quedaba persistido, el job
      // completaba, y la IA jamás corría — un drop total silencioso si el
      // secret se pierde en una regeneración del .env. Fallar hace el problema
      // visible: el job cae al failed set (monitoreado) y es re-ejecutable.
      throw new Error('INTERNAL_API_KEY/INTERNAL_JWT_SECRET not configured — cannot forward inbound message to the API');
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
   *
   * This worker decided the status with its own SQL and never applied a single
   * one: it looked the wamid up in `messages.external_id` — which holds OUR
   * deduplication identity, not the provider's — and it set `updated_at`, a
   * column `messages` has never had, so every UPDATE raised 42703 inside a
   * catch that only warned. It also ranked `failed` above `delivered`/`read`,
   * so it could have told a customer's history that a message never arrived
   * after Meta confirmed it did. The rule now lives in the API, next to the
   * outbox that owns the receipt; what is left here is the forward.
   */
  private async processStatus(data: any) {
    const { tenantId, schemaName, phoneNumberId, status } = data;
    this.logger.debug(`Processing status update: ${status.status} for message ${status.id}`);

    const dedupeKey = `status:${status.id}:${status.status}`;
    // What Meta said is on record BEFORE we try to apply it, so an event stays
    // auditable through an API outage. It becomes 'processed' only once the
    // status was really delivered, the same way processMessage does it.
    await this.prisma.executeInTenantSchema(
      schemaName,
      `INSERT INTO whatsapp_webhook_events (event_type, payload_json, dedupe_key, processing_status)
       VALUES ($1, $2, $3, 'received')
       ON CONFLICT (dedupe_key) DO NOTHING`,
      ['status_update', JSON.stringify(status), dedupeKey],
    );

    const error = status.errors?.[0] ?? null;
    await this.forwardDeliveryStatus({
      tenantId,
      channelType: 'whatsapp',
      channelAccountId: phoneNumberId,
      providerMessageId: status.id,
      status: status.status,
      errorCode: error?.code ?? null,
      recipient: status.recipient_id ?? null,
      // ── THE TWO FIELDS THAT DECIDE MONEY ──────────────────────────────────
      //
      // This worker is the road Meta's receipts actually travel, and for months
      // it forwarded a receipt with the money stripped out of it:
      //
      //   · `pricing` is Meta's own block, and `billable:false` in it is the
      //     ONE authority that can settle a delivered message at zero. Dropped
      //     here, every free delivery was billed at the reserved amount;
      //   · `errorDetail` is where Meta explains in words what the numeric code
      //     leaves generic — including the payment problem that must pause the
      //     number instead of retrying it forever.
      //
      // Forwarded verbatim and unjudged: this service keeps no opinion about a
      // receipt, and deciding what `pricing` means here would be a second copy
      // of a rule that already has an owner.
      pricing: status.pricing ?? null,
      errorDetail: error
        ? `title="${error.title ?? ''}" details="${error.error_data?.details ?? error.message ?? ''}"`
        : null,
    });

    await this.prisma.executeInTenantSchema(
      schemaName,
      `UPDATE whatsapp_webhook_events
          SET processing_status = 'processed', processed_at = NOW()
        WHERE dedupe_key = $1`,
      [dedupeKey],
    ).catch(() => { /* best-effort: no reprocesar un forward exitoso por el stamp */ });
  }

  /**
   * Hand the status to the API, which resolves it by
   * `(tenant, channel, account, receipt)` against the outbox.
   *
   * Same contract as `forwardToConversationsService`: with no internal key, or
   * with the API down, the job FAILS instead of completing green. A status lost
   * in silence is exactly how the "Sent" lie held up for months.
   */
  private async forwardDeliveryStatus(payload: Record<string, unknown>): Promise<void> {
    const apiUrl = this.configService.get<string>('API_INTERNAL_URL') || 'http://api:3000/api/v1';
    const internalKey = this.configService.get<string>('INTERNAL_API_KEY')
      || this.configService.get<string>('INTERNAL_JWT_SECRET');

    if (!internalKey) {
      throw new Error('INTERNAL_API_KEY/INTERNAL_JWT_SECRET not configured — cannot apply delivery status');
    }

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${apiUrl}/internal/channel-delivery-status`,
          payload,
          {
            headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
            timeout: 5000,
          },
        ),
      );
      this.logger.debug(
        `Delivery status ${payload.status} for ${payload.providerMessageId}: ${response.data?.reason}`,
      );
    } catch (err: any) {
      // Meta also emits statuses the history does not model (`deleted`). A 400
      // is a definitive refusal of the body: retrying it only burns the three
      // attempts and litters the failed set. Everything else — including a 401
      // from a misconfigured key — is retried: applying a status is idempotent
      // by rank (it only moves forward) and cannot corrupt the history.
      if (err.response?.status === 400) {
        this.logger.warn(
          `Delivery status ${payload.status} for ${payload.providerMessageId} refused by the API — not retrying`,
        );
        return;
      }
      this.logger.error(`Failed to apply delivery status via API: ${err.message} — will retry`);
      throw err;
    }
  }

  /**
   * ═══ A TEMPLATE BELONGS TO ONE WABA, AND ONLY ONE ═══
   *
   * Meta approves or rejects a template FOR a WhatsApp Business Account. This
   * used to take the name out of the webhook, walk EVERY tenant schema on the
   * platform, and stamp the new status on every row with that name.
   *
   * Template names are ordinary words — `recordatorio_cita`, `confirmacion`,
   * `bienvenida` — so collisions across unrelated businesses are the norm, not
   * the exception. The consequences run both ways and both are silent:
   *
   *   · a rejection on one business's WABA marked another business's approved
   *     template REJECTED, so their reminders stopped going out and their panel
   *     said Meta had refused something Meta had never seen;
   *   · an approval elsewhere marked a REJECTED template APPROVED, so the
   *     business kept sending a template Meta refuses at the door — each
   *     attempt a failure, and after October each failure a number closer to
   *     whatever Meta does about it.
   *
   * The webhook already carries the WABA id. It was simply not used. Now the
   * update is scoped by it, through the channel the template belongs to, and a
   * WABA that matches no channel changes nothing rather than everything.
   */
  private async processTemplateUpdate(data: any) {
    const wabaId = String(data?.wabaId ?? '').trim();
    this.logger.log(`Template status update for WABA ${wabaId || '(none)'}: `
      + `${data.messageTemplateName} → ${data.newStatus}`);

    if (!wabaId) {
      // Without it there is no way to know whose template this is, and
      // guessing is what the whole fix is about. Meta always sends it; a
      // payload without one is a shape we do not model.
      this.logger.warn(`Template status update with no WABA id — ignored `
        + `(${data.messageTemplateName} → ${data.newStatus})`);
      return;
    }

    try {
      // Only the tenants that actually hold this WABA. The scan is over
      // `channel_accounts`, which is global and indexed, rather than over every
      // schema in the platform.
      const tenants = await this.prisma.$queryRaw<{ schema_name: string }[]>`
        SELECT DISTINCT t.schema_name
          FROM public.tenants t
         WHERE t.schema_name IS NOT NULL
      `;

      let updated = 0;
      const unreachable: string[] = [];
      for (const tenant of tenants) {
        try {
          const rows = await this.prisma.executeInTenantSchema<any[]>(
            tenant.schema_name,
            // The join is the fix. A template is reachable only through the
            // channel that owns it, and that channel names exactly one WABA.
            `UPDATE whatsapp_templates t
                SET approval_status = $1, last_sync_at = NOW()
               FROM whatsapp_channels c
              WHERE t.channel_id = c.id
                AND c.meta_waba_id = $3
                AND t.name = $2
            RETURNING t.id`,
            [data.newStatus, data.messageTemplateName, wabaId],
          );
          updated += rows?.length ?? 0;
        } catch (error: any) {
          // ── A MISSING TABLE AND A BROKEN DATABASE ARE NOT THE SAME ──────
          //
          // This used to swallow everything with "tenant may not have this
          // template". Most tenants genuinely do not — the loop visits every
          // schema — but the same catch hid a PgBouncer timeout, and the job
          // then COMPLETED. Meta does not redeliver a template status, so the
          // catalogue kept saying PENDING for a template that had been
          // approved, or APPROVED for one Meta had rejected — and every send
          // of it failed at the door until somebody resynced by hand.
          //
          // `42P01` is "relation does not exist": that schema has no template
          // table, which is the ordinary case and really is nothing. Anything
          // else is ours, and the job must fail so BullMQ tries again.
          const code = String(error?.code ?? error?.meta?.code ?? '');
          if (code !== '42P01' && !/does not exist/i.test(String(error?.message ?? ''))) {
            unreachable.push(`${tenant.schema_name}:${error?.message}`);
          }
        }
      }

      if (unreachable.length) {
        // Thrown AFTER the loop, so one unreachable tenant does not stop the
        // other ninety-nine from being corrected. The retry re-runs all of
        // them, which is safe: the statement is idempotent by value.
        throw new Error(`template status not applied in ${unreachable.length} schema(s): `
          + unreachable.slice(0, 3).join('; '));
      }
      this.logger.log(`Updated ${updated} row(s) of template ${data.messageTemplateName} `
        + `to ${data.newStatus} on WABA ${wabaId}`);
    } catch (error: any) {
      // Re-raised, not logged away. A status update that silently did not
      // happen leaves the catalogue disagreeing with Meta, and every send of
      // that template fails at the door until somebody notices.
      this.logger.error(`Template update processing failed: ${error.message} — will retry`);
      throw error;
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
          if (action === 'add') added++;
          else updated++;
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
        // WhatsApp Flow completion (opt-in one-step booking): forward the submitted
        // fields so the booking engine can fast-forward to confirm. Mirrors the API's
        // whatsapp.adapter parseMessageContent — sentinel text + interactiveReply.data.
        if (message.interactive?.type === 'nfm_reply') {
          let flowData: Record<string, unknown> = {};
          try {
            flowData = JSON.parse(message.interactive.nfm_reply?.response_json || '{}');
          } catch { /* malformed Flow payload → empty → text fallback downstream */ }
          return {
            type: 'text',
            text: '__flow_response__',
            interactiveReply: {
              type: 'flow_response',
              flowToken: (flowData as any)?.flow_token || message.interactive.nfm_reply?.flow_token,
              data: flowData,
            },
          };
        }
        return { type: 'text', text: message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || '' };
      default:
        return { type: 'text', text: `[${message.type}]` };
    }
  }
}
