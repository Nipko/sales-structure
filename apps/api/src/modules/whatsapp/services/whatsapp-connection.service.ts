import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappCryptoService } from './whatsapp-crypto.service';

@Injectable()
export class WhatsappConnectionService {
  private readonly logger = new Logger(WhatsappConnectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cryptoService: WhatsappCryptoService
  ) {}

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

  /**
   * Obtiene el token real desencriptado y los identificadores de Meta.
   */
  async getValidAccessToken(schemaName: string): Promise<{ accessToken: string, phoneNumberId: string, wabaId: string, channelId: string }> {
    // 1. Info del canal
    const channels = await this.prisma.executeInTenantSchema<any[]>(
      schemaName,
      `SELECT id, phone_number_id, meta_waba_id FROM whatsapp_channels LIMIT 1`
    );

    if (!channels || channels.length === 0) {
      throw new NotFoundException('No hay canal de WhatsApp configurado');
    }

    const channel = channels[0];

    // 2. Mapear schemaName -> tenantId
    const tenant = await this.prisma.tenant.findUnique({
      where: { schemaName }
    });

    if (!tenant) throw new NotFoundException('Tenant no válido');

    // 3. Buscar credencial cifrada
    const cred = await this.prisma.whatsappCredential.findFirst({
      where: { tenantId: tenant.id, credentialType: 'system_user_token' },
      orderBy: { createdAt: 'desc' },
    });

    if (!cred || !cred.encryptedValue) {
      // Fallback temporal si guardaron el token direcamente en el channel en una prueba previa
      const fallbackChannels = await this.prisma.executeInTenantSchema<any[]>(
        schemaName,
        `SELECT access_token_ref FROM whatsapp_channels LIMIT 1`
      );
      if (fallbackChannels?.[0]?.access_token_ref && fallbackChannels[0].access_token_ref !== 'credential_ref') {
         return {
           accessToken: fallbackChannels[0].access_token_ref,
           phoneNumberId: channel.phone_number_id,
           wabaId: channel.meta_waba_id,
           channelId: channel.id
         };
      }
      throw new NotFoundException('Credenciales de WhatsApp no encontradas para este tenant');
    }

    // 4. Descifrar
    const accessToken = this.cryptoService.decryptToken(cred.encryptedValue);

    return {
      accessToken,
      phoneNumberId: channel.phone_number_id,
      wabaId: channel.meta_waba_id,
      channelId: channel.id
    };
  }
}
