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
        return this.prisma.executeInTenantSchema(
            schemaName,
            `SELECT * FROM whatsapp_templates ORDER BY created_at DESC`
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
                ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, NOW(), NOW())
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

        // Resolve active channel + decrypted token.
        let accessToken: string;
        let wabaId: string;
        let channelId: string;
        try {
            const creds = await this.connectionService.getValidAccessToken(schemaName);
            accessToken = creds.accessToken;
            wabaId = creds.wabaId;
            channelId = creds.channelId;
        } catch (e: any) {
            this.logger.warn(`[seedTemplates] No active WhatsApp channel for tenant ${tenantId}: ${e.message}`);
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
        const stale = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, meta_template_id, name, language
               FROM whatsapp_templates
              WHERE approval_status = 'PENDING'
                AND meta_template_id IS NOT NULL
                AND submitted_at < NOW() - INTERVAL '12 hours'
              LIMIT 50`,
        );
        if (stale.length === 0) return { refreshed: 0 };

        let creds: { accessToken: string; wabaId: string; channelId: string };
        try {
            creds = await this.connectionService.getValidAccessToken(schemaName);
        } catch {
            return { refreshed: 0 };
        }

        let refreshed = 0;
        for (const row of stale) {
            try {
                const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${row.meta_template_id}`;
                const res = await firstValueFrom(
                    this.httpService.get(url, { headers: { Authorization: `Bearer ${creds.accessToken}` } }),
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

  async syncTemplatesFromMeta(schemaName: string) {
    // 1. Obtener token real descifrado y datos del canal
    const { accessToken, wabaId, channelId } = await this.connectionService.getValidAccessToken(schemaName);

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
          ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
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
             WHERE channel_id = $1 AND name = $5 AND language = $6`,
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
