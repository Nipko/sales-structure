import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { WhatsappConnectionService } from './whatsapp-connection.service';

const META_GRAPH_VERSION = 'v20.0';

@Injectable()
export class WhatsappTemplateService {
  private readonly logger = new Logger(WhatsappTemplateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
    private readonly connectionService: WhatsappConnectionService,
  ) {}

  async getTemplates(schemaName: string) {
    return this.prisma.executeInTenantSchema(
      schemaName,
      `SELECT * FROM whatsapp_templates ORDER BY created_at DESC`
    );
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
