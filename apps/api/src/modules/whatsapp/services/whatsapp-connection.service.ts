import { Injectable, Logger, BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappCryptoService } from './whatsapp-crypto.service';
import { TenantThrottleService } from '../../throttle/tenant-throttle.service';

const META_GRAPH = 'https://graph.facebook.com/v21.0';

const VALID_VERTICALS = [
  'UNDEFINED', 'OTHER', 'AUTO', 'BEAUTY', 'APPAREL', 'EDU', 'ENTERTAIN',
  'EVENT_PLAN', 'FINANCE', 'GROCERY', 'GOVT', 'HOTEL', 'HEALTH',
  'NONPROFIT', 'PROF_SERVICES', 'RETAIL', 'TRAVEL', 'RESTAURANT', 'NOT_A_BIZ',
];

@Injectable()
export class WhatsappConnectionService {
  private readonly logger = new Logger(WhatsappConnectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cryptoService: WhatsappCryptoService,
    private readonly configService: ConfigService,
    private readonly throttle: TenantThrottleService,
  ) {}

  /**
   * Activación (TTFV): marca el instante del PRIMER canal conectado del tenant.
   * Idempotente (guard IS NULL) y fire-and-forget — nunca rompe la conexión.
   */
  private async markFirstChannelConnected(tenantId: string): Promise<void> {
    try {
      await this.prisma.tenant.updateMany({
        where: { id: tenantId, firstChannelConnectedAt: null },
        data: { firstChannelConnectedAt: new Date() },
      });
    } catch (e: any) {
      this.logger.warn(`markFirstChannelConnected failed for ${tenantId}: ${e?.message}`);
    }
  }

  async getChannelStatus(schemaName: string) {
    // Multi-number aware: return ALL connected numbers. `channel` stays as the
    // first (oldest) for backward compatibility with existing single-number UI.
    const channels = await this.prisma.executeInTenantSchema<any[]>(
      schemaName,
      `SELECT id, provider_type, display_phone_number, display_name, display_name_status,
              quality_rating, messaging_limit_tier, channel_status, connected_at,
              phone_number_id, meta_waba_id
       FROM whatsapp_channels
       ORDER BY connected_at ASC NULLS LAST`
    );

    if (!channels || channels.length === 0) {
      return { status: 'disconnected', channel: null, channels: [] };
    }

    return { status: channels[0].channel_status, channel: channels[0], channels };
  }

  async saveConnection(schemaName: string, tenantId: string, data: any) {
    const { phoneNumberId, wabaId, accessToken } = data;

    if (!phoneNumberId || !wabaId || !accessToken) {
      throw new BadRequestException('Faltan datos de conexión de WhatsApp');
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, schemaName: true },
    });
    if (!tenant || tenant.schemaName !== schemaName) {
      throw new BadRequestException('Tenant inválido para este usuario');
    }

    // Enforce the plan's per-type account limit. Reconnecting the same number
    // never blocks (excluded from the count); a NEW number consumes a slot.
    const existingActive = await this.prisma.channelAccount.count({
      where: { tenantId, channelType: 'whatsapp', isActive: true, accountId: { not: phoneNumberId } },
    });
    await this.throttle.enforceChannelAccountLimit(tenantId, 'whatsapp', existingActive);

    const encryptedToken = this.cryptoService.encryptToken(accessToken);

    // Upsert del canal en schema tenant.
    await this.prisma.executeInTenantSchema(
      schemaName,
      `DELETE FROM whatsapp_channels WHERE phone_number_id = $1`,
      [phoneNumberId],
    );

    const rows = await this.prisma.executeInTenantSchema<any[]>(
      schemaName,
      `INSERT INTO whatsapp_channels (
        provider_type, meta_waba_id, phone_number_id, access_token_ref,
        display_phone_number, display_name, channel_status, connected_at
      ) VALUES (
        'meta_cloud', $1, $2, 'credential_ref', $3, $4, 'connected', NOW()
      ) RETURNING id`,
      [
        wabaId,
        phoneNumberId,
        data.displayPhoneNumber || phoneNumberId,
        data.verifiedName || data.displayName || null,
      ],
    );

    // Upsert routing account (public schema) para que webhooks inbound resuelvan tenant.
    const existingAccount = await this.prisma.channelAccount.findFirst({
      where: { channelType: 'whatsapp', accountId: phoneNumberId },
    });
    if (existingAccount) {
      await this.prisma.channelAccount.update({
        where: { id: existingAccount.id },
        data: {
          tenantId,
          displayName: data.verifiedName || data.displayName || data.displayPhoneNumber || phoneNumberId,
          accessToken: 'encrypted_ref',
          isActive: true,
          metadata: {
            ...(existingAccount.metadata as Record<string, unknown>),
            wabaId,
            phoneNumberId,
            source: 'manual_connect',
          },
        },
      });
    } else {
      await this.prisma.channelAccount.create({
        data: {
          tenantId,
          channelType: 'whatsapp',
          accountId: phoneNumberId,
          displayName: data.verifiedName || data.displayName || data.displayPhoneNumber || phoneNumberId,
          accessToken: 'encrypted_ref',
          isActive: true,
          metadata: {
            wabaId,
            phoneNumberId,
            source: 'manual_connect',
          },
        },
      });
    }

    // Activación (TTFV): marca el primer canal conectado del tenant. Idempotente
    // (guard IS NULL), fire-and-forget — nunca debe romper la conexión.
    void this.markFirstChannelConnected(tenantId);

    // Upsert credencial cifrada.
    const existingCredential = await this.prisma.whatsappCredential.findFirst({
      where: { tenantId, credentialType: 'system_user_token' },
    });
    if (existingCredential) {
      await this.prisma.whatsappCredential.update({
        where: { id: existingCredential.id },
        data: { encryptedValue: encryptedToken, rotationState: 'active' },
      });
    } else {
      await this.prisma.whatsappCredential.create({
        data: {
          tenantId,
          credentialType: 'system_user_token',
          encryptedValue: encryptedToken,
          rotationState: 'active',
        },
      });
    }

    this.logger.log(`WhatsApp channel connected for schema ${schemaName}`);
    return { success: true, channelId: rows[0].id };
  }

  /**
   * Obtiene el token real desencriptado y los identificadores de Meta.
   */
  async getValidAccessToken(schemaName: string, phoneNumberId?: string): Promise<{ accessToken: string, phoneNumberId: string, wabaId: string, channelId: string }> {
    // 1. Info del canal — el número específico si se pide (multi-número), si no el
    //    más antiguo (determinístico). El system_user_token es tenant-wide; solo
    //    cambia el phone_number_id de origen.
    let channels: any[] = [];
    if (phoneNumberId) {
      channels = await this.prisma.executeInTenantSchema<any[]>(
        schemaName,
        `SELECT id, phone_number_id, meta_waba_id FROM whatsapp_channels WHERE phone_number_id = $1 LIMIT 1`,
        [phoneNumberId],
      );
    }
    if (!channels || channels.length === 0) {
      channels = await this.prisma.executeInTenantSchema<any[]>(
        schemaName,
        `SELECT id, phone_number_id, meta_waba_id FROM whatsapp_channels ORDER BY connected_at ASC NULLS LAST LIMIT 1`
      );
    }

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
        `SELECT access_token_ref FROM whatsapp_channels ORDER BY connected_at ASC NULLS LAST LIMIT 1`
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

  // ======================== BUSINESS PROFILE ========================

  async getBusinessProfile(schemaName: string) {
    const { accessToken, phoneNumberId } = await this.getValidAccessToken(schemaName);

    const [profileRes, phoneRes] = await Promise.all([
      fetch(
        `${META_GRAPH}/${phoneNumberId}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      ),
      fetch(
        `${META_GRAPH}/${phoneNumberId}?fields=verified_name,name_status,quality_rating,is_official_business_account,account_mode,code_verification_status,display_phone_number`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      ),
    ]);

    const profileBody = await profileRes.json();
    const phoneBody = await phoneRes.json();

    if (profileBody.error) this.handleMetaError(profileBody, 'getBusinessProfile');
    if (phoneBody.error) this.handleMetaError(phoneBody, 'getPhoneDetails');

    const profile = profileBody.data?.[0] || profileBody.data || {};

    const channels = await this.prisma.executeInTenantSchema<any[]>(
      schemaName,
      `SELECT messaging_limit_tier FROM whatsapp_channels LIMIT 1`,
    );
    const messagingLimit = channels?.[0]?.messaging_limit_tier || null;

    return { profile, phoneDetails: { ...phoneBody, messaging_limit_tier: messagingLimit } };
  }

  async updateBusinessProfile(schemaName: string, data: {
    about?: string;
    address?: string;
    description?: string;
    email?: string;
    websites?: string[];
    vertical?: string;
  }) {
    const { accessToken, phoneNumberId } = await this.getValidAccessToken(schemaName);

    const payload: Record<string, any> = { messaging_product: 'whatsapp' };

    if (data.about !== undefined) {
      if (data.about.length > 139) throw new BadRequestException('About exceeds 139 characters');
      payload.about = data.about;
    }
    if (data.description !== undefined) {
      if (data.description.length > 512) throw new BadRequestException('Description exceeds 512 characters');
      payload.description = data.description;
    }
    if (data.address !== undefined) {
      if (data.address.length > 256) throw new BadRequestException('Address exceeds 256 characters');
      payload.address = data.address;
    }
    if (data.email !== undefined) {
      if (data.email.length > 128) throw new BadRequestException('Email exceeds 128 characters');
      payload.email = data.email;
    }
    if (data.websites !== undefined) {
      if (data.websites.length > 2) throw new BadRequestException('Maximum 2 websites allowed');
      payload.websites = data.websites;
    }
    if (data.vertical !== undefined) {
      if (!VALID_VERTICALS.includes(data.vertical)) throw new BadRequestException(`Invalid vertical: ${data.vertical}`);
      payload.vertical = data.vertical;
    }

    const res = await fetch(`${META_GRAPH}/${phoneNumberId}/whatsapp_business_profile`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const body = await res.json();
    if (body.error) this.handleMetaError(body, 'updateBusinessProfile');

    return { success: true };
  }

  async uploadProfilePhoto(schemaName: string, file: Express.Multer.File) {
    if (!file.mimetype.match(/^image\/(jpeg|png)$/)) {
      throw new BadRequestException('Only JPEG and PNG images are accepted');
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('Image exceeds 5MB limit');
    }

    const { accessToken, phoneNumberId } = await this.getValidAccessToken(schemaName);
    const appId = this.configService.get<string>('META_APP_ID');
    if (!appId) throw new BadRequestException('META_APP_ID not configured');

    // Step 1: Create upload session
    const sessionRes = await fetch(
      `${META_GRAPH}/${appId}/uploads?file_length=${file.size}&file_type=${file.mimetype}&access_token=${accessToken}`,
      { method: 'POST' },
    );
    const sessionBody = await sessionRes.json();
    if (sessionBody.error) this.handleMetaError(sessionBody, 'uploadProfilePhoto.createSession');

    const uploadSessionId = sessionBody.id;
    if (!uploadSessionId) throw new BadRequestException('Failed to create upload session');

    // Step 2: Upload file bytes
    const uploadRes = await fetch(`${META_GRAPH}/${uploadSessionId}`, {
      method: 'POST',
      headers: {
        Authorization: `OAuth ${accessToken}`,
        file_offset: '0',
        'Content-Type': file.mimetype,
      },
      body: new Uint8Array(file.buffer),
    });
    const uploadBody = await uploadRes.json();
    if (uploadBody.error) this.handleMetaError(uploadBody, 'uploadProfilePhoto.uploadBytes');

    const handle = uploadBody.h;
    if (!handle) throw new BadRequestException('Failed to get file handle from Meta');

    // Step 3: Set profile picture
    const profileRes = await fetch(`${META_GRAPH}/${phoneNumberId}/whatsapp_business_profile`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', profile_picture_handle: handle }),
    });
    const profileBody = await profileRes.json();
    if (profileBody.error) this.handleMetaError(profileBody, 'uploadProfilePhoto.setProfile');

    return { success: true };
  }

  async deleteProfilePhoto(schemaName: string) {
    const { accessToken, phoneNumberId } = await this.getValidAccessToken(schemaName);

    const res = await fetch(`${META_GRAPH}/${phoneNumberId}/whatsapp_business_profile`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', profile_picture_url: '' }),
    });
    const body = await res.json();
    if (body.error) this.handleMetaError(body, 'deleteProfilePhoto');

    return { success: true };
  }

  private handleMetaError(response: any, context: string): never {
    const err = response.error;
    const message = err?.message || 'Unknown Meta API error';
    const code = err?.code;

    this.logger.error(`Meta API error in ${context}: code=${code}, message=${message}`);

    if (code === 4 || code === 80007) {
      throw new BadRequestException('Meta API rate limit reached. Please wait a few minutes and try again.');
    }
    if (code === 190) {
      throw new UnauthorizedException('WhatsApp access token has expired. Please reconnect your WhatsApp account.');
    }
    if (code === 10 || code === 200) {
      throw new BadRequestException('Insufficient permissions. Ensure your token has whatsapp_business_management permission.');
    }
    throw new BadRequestException(`Meta API error: ${message}`);
  }
}
