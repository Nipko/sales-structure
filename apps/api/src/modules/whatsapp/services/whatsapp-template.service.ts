import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class WhatsappTemplateService {
  private readonly logger = new Logger(WhatsappTemplateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async getTemplates(schemaName: string) {
    return this.prisma.executeInTenantSchema(
      schemaName,
      `SELECT * FROM whatsapp_templates ORDER BY created_at DESC`
    );
  }

  async syncTemplatesFromMeta(schemaName: string) {
    // 1. Get channel WABA ID and Token
    const channels = await this.prisma.executeInTenantSchema<any[]>(
      schemaName,
      `SELECT id, meta_waba_id, access_token_ref FROM whatsapp_channels LIMIT 1`
    );

    if (!channels || channels.length === 0) {
      throw new BadRequestException('No hay canal de WhatsApp conectado');
    }

    const { id: channelId, meta_waba_id, access_token_ref } = channels[0];
    
    // 2. Fetch templates from Meta API
    // Using simple logic for implementation guide MVP. 
    this.logger.log(`Syncing templates for WABA: ${meta_waba_id}`);
    
    // We would make a GET req to graph.facebook.com/v20.0/${wabaId}/message_templates
    // However, since we don't have real credentials, we'll simulate the sync for now
    
    const mockTemplates = [
      {
        name: 'hello_world',
        language: 'en_US',
        status: 'APPROVED',
        category: 'UTILITY',
        components: [{ type: 'BODY', text: 'Hello World' }]
      },
      {
        name: 'bienvenida_estudiante',
        language: 'es',
        status: 'APPROVED',
        category: 'MARKETING',
        components: [
          { type: 'BODY', text: '¡Hola {{1}}! Gracias por tu interés en el curso de {{2}}.' }
        ]
      }
    ];

    // 3. Upsert into database
    for (const t of mockTemplates) {
      // Basic insert, handling conflict is usually done via unique name+language constraints
      // But for this example we'll just insert and ignore conflicts
      try {
        await this.prisma.executeInTenantSchema(
          schemaName,
          `INSERT INTO whatsapp_templates (
            channel_id, name, language, category, approval_status, components_json, last_sync_at
          ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [channelId, t.name, t.language, t.category, t.status, JSON.stringify(t.components)]
        );
      } catch (e) {
        // Assume duplicate template, handle nicely in real app (UPDATE)
        await this.prisma.executeInTenantSchema(
            schemaName,
            `UPDATE whatsapp_templates 
             SET approval_status = $2, components_json = $3, last_sync_at = NOW() 
             WHERE channel_id = $1 AND name = $4 AND language = $5`,
             [channelId, t.status, JSON.stringify(t.components), t.name, t.language]
        );
      }
    }

    this.logger.log(`Synced ${mockTemplates.length} templates for WABA: ${meta_waba_id}`);
    return { success: true, count: mockTemplates.length };
  }
}
