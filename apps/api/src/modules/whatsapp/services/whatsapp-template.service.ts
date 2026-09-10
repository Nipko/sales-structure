import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantsService } from '../../tenants/tenants.service';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { WhatsappConnectionService } from './whatsapp-connection.service';
import {
    buildSeedTemplatePayloads,
    MetaTemplatePayload,
    SEED_TEMPLATE_NAMES,
} from '../seed-templates.config';

const META_GRAPH_VERSION = 'v21.0';

@Injectable()
export class WhatsappTemplateService {
    private readonly logger = new Logger(WhatsappTemplateService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly tenantsService: TenantsService,
        private readonly httpService: HttpService,
        private readonly connectionService: WhatsappConnectionService,
    ) {}

    async getTemplates(schemaName: string) {
        // phone_number_id: con multi-número, una plantilla pertenece al WABA de SU
        // canal — enviarla desde otro número falla en Meta. El join permite al
        // cliente filtrar/atribuir por número emisor.
        return this.prisma.executeInTenantSchema(
            schemaName,
            `SELECT t.*, wc.phone_number_id
               FROM whatsapp_templates t
               LEFT JOIN whatsapp_channels wc ON wc.id = t.channel_id
              ORDER BY t.created_at DESC`
        );
    }

    /**
     * Create a single message template in Meta and persist it locally with
     * approval_status='PENDING'. Called both by the seed flow and by any
     * future manual-create UI.
     */
    async createTemplate(
        schemaName: string,
        channelId: string,
        wabaId: string,
        accessToken: string,
        payload: MetaTemplatePayload,
        options: { isSeed?: boolean } = {},
    ): Promise<{ metaTemplateId: string; status: string; category: string }> {
        const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${wabaId}/message_templates`;
        try {
            const response = await firstValueFrom(
                this.httpService.post(url, payload, {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        'Content-Type': 'application/json',
                    },
                }),
            );
            const data = response.data || {};
            const metaTemplateId = data.id as string;
            const status = (data.status as string) || 'PENDING';
            const category = (data.category as string) || payload.category;

            await this.prisma.executeInTenantSchema(
                schemaName,
                `INSERT INTO whatsapp_templates (
                    channel_id, name, language, category, approval_status,
                    components_json, meta_template_id, is_seed, submitted_at, last_sync_at
                ) VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb, $7, $8, NOW(), NOW())
                ON CONFLICT (channel_id, name, language)
                DO UPDATE SET
                    category = EXCLUDED.category,
                    approval_status = EXCLUDED.approval_status,
                    components_json = EXCLUDED.components_json,
                    meta_template_id = EXCLUDED.meta_template_id,
                    is_seed = whatsapp_templates.is_seed OR EXCLUDED.is_seed,
                    submitted_at = NOW(),
                    last_sync_at = NOW()`,
                [
                    channelId,
                    payload.name,
                    payload.language,
                    category,
                    status,
                    JSON.stringify(payload.components),
                    metaTemplateId,
                    !!options.isSeed,
                ],
            );

            this.logger.log(`Template "${payload.name}" created for WABA ${wabaId} (meta id ${metaTemplateId}, status ${status})`);
            return { metaTemplateId, status, category };
        } catch (error: any) {
            const metaError = error?.response?.data?.error;
            this.logger.error(
                `Meta API rejected template "${payload.name}" for WABA ${wabaId}: ${metaError?.message || error.message}`,
            );
            throw new BadRequestException(
                `Meta rejected template "${payload.name}": ${metaError?.message || error.message}`,
            );
        }
    }

    /**
     * Auto-submit the 3 pre-vetted seed templates right after a tenant
     * completes Embedded Signup. Idempotent: guarded by
     * `whatsapp_channels.seeds_submitted`.
     */
    async seedTemplates(tenantId: string): Promise<{ submitted: number; skipped: boolean }> {
        const schemaName = await this.tenantsService.getSchemaName(tenantId);

        // Every connection, not the oldest one.
        //
        // Templates live on a WABA, and a tenant with two numbers on two WABAs
        // has two catalogues. Seeding only the first left the second number
        // without the approved templates the reminders send — so a reminder
        // from it failed at Meta with "template does not exist", months after
        // the number was connected and with nothing pointing back here. And
        // asking unnamed now refuses, so the whole seed had become a quiet
        // no-op for exactly those tenants.
        const numbers = await this.sendableNumbers(schemaName);
        if (!numbers.length) {
            this.logger.warn(`[seedTemplates] No active WhatsApp channel for tenant ${tenantId}`);
            return { submitted: 0, skipped: true };
        }
        if (numbers.length > 1) {
            let submitted = 0, everySkipped = true;
            for (const phoneNumberId of numbers) {
                const one = await this.seedTemplatesForNumber(tenantId, schemaName, phoneNumberId);
                submitted += one.submitted;
                everySkipped = everySkipped && one.skipped;
            }
            return { submitted, skipped: everySkipped };
        }
        return this.seedTemplatesForNumber(tenantId, schemaName, numbers[0]);
    }

    /**
     * The numbers of a tenant that can actually send, oldest first.
     *
     * A row with no `phone_number_id` is an onboarding that Meta has not
     * finished; it has no catalogue to seed and cannot send.
     */
    private async sendableNumbers(schemaName: string): Promise<string[]> {
        const status = await this.connectionService.getChannelStatus(schemaName);
        return (status.channels || [])
            .map((channel: any) => String(channel.phone_number_id || '').trim())
            .filter((phoneNumberId: string) => phoneNumberId.length > 0);
    }

    private async seedTemplatesForNumber(tenantId: string, schemaName: string, phoneNumberId: string):
        Promise<{ submitted: number; skipped: boolean }> {
        let accessToken: string;
        let wabaId: string;
        let channelId: string;
        try {
            const creds = await this.connectionService.getValidAccessToken(schemaName, phoneNumberId);
            accessToken = creds.accessToken;
            wabaId = creds.wabaId;
            channelId = creds.channelId;
        } catch (e: any) {
            this.logger.warn(`[seedTemplates] ${phoneNumberId} of tenant ${tenantId} is not usable: ${e.message}`);
            return { submitted: 0, skipped: true };
        }

        // Idempotency: don't re-submit if we already seeded this channel.
        const flagRows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT seeds_submitted FROM whatsapp_channels WHERE id = $1::uuid LIMIT 1`,
            [channelId],
        );
        if (flagRows[0]?.seeds_submitted === true) {
            this.logger.log(`[seedTemplates] Already seeded for channel ${channelId}, skipping`);
            return { submitted: 0, skipped: true };
        }

        // Load tenant language (normalized inside buildSeedTemplatePayloads).
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { language: true },
        });
        const payloads = buildSeedTemplatePayloads(tenant?.language || 'es-CO');

        this.logger.log(`[seedTemplates] Submitting ${payloads.length} templates for tenant ${tenantId} in ${payloads[0].language}`);

        const results = await Promise.allSettled(
            payloads.map(p => this.createTemplate(schemaName, channelId, wabaId, accessToken, p, { isSeed: true })),
        );

        const submitted = results.filter(r => r.status === 'fulfilled').length;
        results.forEach((r, i) => {
            if (r.status === 'rejected') {
                this.logger.warn(`[seedTemplates] ${payloads[i].name} failed: ${(r.reason as any)?.message}`);
            }
        });

        // Mark the channel as seeded even if some templates failed — retrying
        // would just create duplicates. A failed seed can be resubmitted
        // manually from the dashboard later.
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE whatsapp_channels SET seeds_submitted = true, seeds_submitted_at = NOW() WHERE id = $1::uuid`,
            [channelId],
        );

        this.logger.log(`[seedTemplates] Done for tenant ${tenantId}: ${submitted}/${payloads.length} submitted`);
        return { submitted, skipped: false };
    }

    /**
     * Apply a Meta webhook `message_template_status_update` event to the DB.
     * Called by the webhook handler.
     */
    async applyStatusUpdate(
        schemaName: string,
        event: {
            message_template_id: string;
            message_template_name: string;
            message_template_language: string;
            event: string;
            reason?: string;
        },
    ): Promise<void> {
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE whatsapp_templates
                SET approval_status = $1,
                    rejected_reason = $2,
                    last_sync_at = NOW(),
                    updated_at = NOW()
              WHERE meta_template_id = $3
                 OR (name = $4 AND language = $5)`,
            [
                event.event || 'PENDING',
                event.reason && event.reason !== 'NONE' ? event.reason : null,
                event.message_template_id,
                event.message_template_name,
                event.message_template_language,
            ],
        );
        this.logger.log(`Template status updated: ${event.message_template_name} → ${event.event}${event.reason ? ` (${event.reason})` : ''}`);
    }

    /**
     * Polling fallback: refresh any template that has been PENDING for more
     * than 12 hours. Catches cases where the webhook fails to arrive.
     */
    async pollPendingTemplates(schemaName: string): Promise<{ refreshed: number }> {
        // `channel_id` comes along because a template belongs to ONE channel and
        // is readable only with that channel's token. Resolving one token for
        // the whole batch asked Meta about the second WABA's templates with the
        // first WABA's credential: those rows stayed PENDING forever, which is
        // the state this polling exists to escape.
        const stale = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT t.id, t.meta_template_id, t.name, t.language, c.phone_number_id
               FROM whatsapp_templates t
               JOIN whatsapp_channels c ON c.id = t.channel_id
              WHERE t.approval_status = 'PENDING'
                AND t.meta_template_id IS NOT NULL
                AND t.submitted_at < NOW() - INTERVAL '12 hours'
              LIMIT 50`,
        );
        if (stale.length === 0) return { refreshed: 0 };

        // One resolution per channel, not per row: fifty pending templates on
        // one number are still one credential.
        const tokenOf = new Map<string, string | null>();
        const tokenFor = async (phoneNumberId: string): Promise<string | null> => {
            const key = String(phoneNumberId || '');
            if (tokenOf.has(key)) return tokenOf.get(key) ?? null;
            let token: string | null = null;
            try {
                token = (await this.connectionService.getValidAccessToken(schemaName, key || undefined)).accessToken;
            } catch (e: any) {
                this.logger.warn(`[pollPendingTemplates] no usable credential for ${key || 'the tenant'}: ${e.message}`);
            }
            tokenOf.set(key, token);
            return token;
        };

        let refreshed = 0;
        for (const row of stale) {
            try {
                const accessToken = await tokenFor(row.phone_number_id);
                if (!accessToken) continue;
                const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${row.meta_template_id}`;
                const res = await firstValueFrom(
                    this.httpService.get(url, { headers: { Authorization: `Bearer ${accessToken}` } }),
                );
                const status = res.data?.status || 'PENDING';
                const reason = res.data?.rejected_reason;
                if (status !== 'PENDING') {
                    await this.prisma.executeInTenantSchema(
                        schemaName,
                        `UPDATE whatsapp_templates
                            SET approval_status = $1,
                                rejected_reason = $2,
                                last_sync_at = NOW(),
                                updated_at = NOW()
                          WHERE id = $3::uuid`,
                        [status, reason && reason !== 'NONE' ? reason : null, row.id],
                    );
                    refreshed++;
                }
            } catch (e: any) {
                this.logger.warn(`[pollPendingTemplates] ${row.name} failed: ${e.message}`);
            }
        }
        return { refreshed };
    }

    /** Exposed so callers can check what seed templates look like. */
    isSeedName(name: string): boolean {
        return (SEED_TEMPLATE_NAMES as string[]).includes(name);
    }

  /**
   * Sincroniza el catálogo de TODOS los números del tenant, no el del primero.
   *
   * Las plantillas viven en la WABA, así que un tenant con dos números en dos
   * WABAs tiene dos catálogos. Sincronizar sólo el primero dejaba al segundo
   * mostrando plantillas que no eran suyas y ocultando las que sí; y pedir el
   * token sin nombrar número ahora se rechaza, así que en esos tenants la
   * sincronización pasó a fallar entera. Cada número se sincroniza por separado
   * y el resultado dice cuáles fueron.
   */
  async syncTemplatesFromMeta(schemaName: string) {
    const numbers = await this.sendableNumbers(schemaName);
    if (numbers.length > 1) {
      let count = 0, total = 0;
      const perNumber: { phoneNumberId: string; count: number; total: number }[] = [];
      for (const phoneNumberId of numbers) {
        const one = await this.syncTemplatesForNumber(schemaName, phoneNumberId);
        count += one.count; total += one.total;
        perNumber.push({ phoneNumberId, count: one.count, total: one.total });
      }
      return { success: true, count, total, perNumber };
    }
    return this.syncTemplatesForNumber(schemaName, numbers[0]);
  }

  private async syncTemplatesForNumber(schemaName: string, phoneNumberId?: string) {
    // 1. Obtener token real descifrado y datos del canal
    const { accessToken, wabaId, channelId } =
      await this.connectionService.getValidAccessToken(schemaName, phoneNumberId);

    this.logger.log(`Syncing templates from Meta for WABA: ${wabaId}`);

    // 2. Fetch templates reales desde Meta Graph API
    let allTemplates: any[] = [];
    let url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${wabaId}/message_templates?limit=100`;

    try {
      while (url) {
        const response = await firstValueFrom(
          this.httpService.get(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
          })
        );

        const data = response.data;
        if (data?.data) {
          allTemplates = allTemplates.concat(data.data);
        }

        // Paginación de Meta
        url = data?.paging?.next || null;
      }
    } catch (error: any) {
      const metaError = error?.response?.data?.error;
      this.logger.error(`Meta API error syncing templates: ${metaError?.message || error.message}`);
      throw new BadRequestException(
        `Error al sincronizar plantillas: ${metaError?.message || error.message}`
      );
    }

    this.logger.log(`Fetched ${allTemplates.length} templates from Meta`);

    // 3. Upsert cada template en la BD del tenant
    let synced = 0;
    for (const t of allTemplates) {
      try {
        await this.prisma.executeInTenantSchema(
          schemaName,
          `INSERT INTO whatsapp_templates (
            channel_id, name, language, category, approval_status, components_json, last_sync_at
          ) VALUES ($1::uuid, $2, $3, $4, $5, $6, NOW())
          ON CONFLICT (channel_id, name, language)
          DO UPDATE SET
            category = EXCLUDED.category,
            approval_status = EXCLUDED.approval_status,
            components_json = EXCLUDED.components_json,
            last_sync_at = NOW()`,
          [channelId, t.name, t.language, t.category, t.status, JSON.stringify(t.components)]
        );
        synced++;
      } catch (e: any) {
        // Si no hay constraint ON CONFLICT, hacemos fallback
        try {
          await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE whatsapp_templates
             SET approval_status = $2, components_json = $3, category = $4, last_sync_at = NOW()
             WHERE channel_id = $1::uuid AND name = $5 AND language = $6`,
            [channelId, t.status, JSON.stringify(t.components), t.category, t.name, t.language]
          );
          synced++;
        } catch (updateErr: any) {
          this.logger.warn(`Failed to upsert template ${t.name}: ${updateErr.message}`);
        }
      }
    }

    this.logger.log(`Synced ${synced}/${allTemplates.length} templates for WABA: ${wabaId}`);
    return { success: true, count: synced, total: allTemplates.length };
  }
}
