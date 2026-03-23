import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class WhatsappConnectionService {
  private readonly logger = new Logger(WhatsappConnectionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getChannelStatus(schemaName: string) {
    const channels = await this.prisma.executeInTenantSchema<any[]>(
      schemaName,
      `SELECT id, provider_type, display_phone_number, display_name, display_name_status, 
              quality_rating, messaging_limit_tier, channel_status, connected_at 
       FROM whatsapp_channels 
       LIMIT 1`
    );

    if (!channels || channels.length === 0) {
      return { status: 'disconnected', channel: null };
    }

    return { status: channels[0].channel_status, channel: channels[0] };
  }

  async saveConnection(schemaName: string, data: any) {
    const { phoneNumberId, wabaId, accessToken } = data;

    if (!phoneNumberId || !wabaId || !accessToken) {
      throw new BadRequestException('Faltan datos de conexión de WhatsApp');
    }

    // Usamos UPSERT para que si ya hay un canal, lo actualice en lugar de duplicarlo
    // Pero asumiendo 1 canal por tenant para MVP, borramos existentes
    await this.prisma.executeInTenantSchema(schemaName, 'DELETE FROM whatsapp_channels');

    const rows = await this.prisma.executeInTenantSchema<any[]>(
      schemaName,
      `INSERT INTO whatsapp_channels (
        provider_type, meta_waba_id, phone_number_id, access_token_ref, channel_status, connected_at
      ) VALUES (
        'meta_cloud', $1, $2, $3, 'connected', NOW()
      ) RETURNING id`,
      [wabaId, phoneNumberId, accessToken]
    );

    this.logger.log(`WhatsApp channel connected for schema ${schemaName}`);
    return { success: true, channelId: rows[0].id };
  }
}
