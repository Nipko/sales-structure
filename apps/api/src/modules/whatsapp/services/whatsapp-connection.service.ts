import { Injectable, Logger, BadRequestException, NotFoundException, Optional, UnauthorizedException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { OUTBOUND_CONTRACT_VERSION, type OutboundCredentialRef } from '@parallext/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappCryptoService } from './whatsapp-crypto.service';
import { TenantThrottleService } from '../../throttle/tenant-throttle.service';
import { AGENT_QUALITY_DEPENDENCIES_UPDATED } from '../../quality/agent-quality-events';
import { ConnectionRefusedError } from '../../channels/connection-refusal';
import type { ResolvedConnection, SendContextRequest } from '../../channels/channel-token.service';
// Validated by the very function that will price with it: a zone this cannot
// format is a zone every later charge would refuse, so accepting one here would
// only move the failure to the first message somebody tries to send.
import { wabaLocalDate } from '../../billing/whatsapp-rates';

const META_GRAPH = 'https://graph.facebook.com/v21.0';

/**
 * One WhatsApp connection, with the credential that belongs to IT.
 *
 * The pairing is the point. The previous shape returned four loose fields, and
 * three of them came from the row the caller asked for while the fourth — the
 * token — was fetched by a separate query that ordered by `connected_at` and
 * took the first. Nothing in the type could notice.
 */
interface ResolvedWhatsappConnection {
  readonly tenantId: string;
  readonly channelId: string;
  readonly phoneNumberId: string;
  readonly wabaId: string;
  readonly businessId: string | null;
  readonly displayPhoneNumber: string | null;
  readonly accessToken: string;
  readonly credentialId: string;
  readonly credentialSource: OutboundCredentialRef['source'];
}

/**
 * A phone number id, or nothing.
 *
 * `''` reaches this resolver from producers that build an outbound message with
 * no connection bound — the field is typed as a required `string`, so `tsc`
 * never saw it. An empty string is not a connection and it is not a request for
 * a particular one either, so it is treated exactly like an omission: resolved
 * on a single-number tenant, refused as ambiguous on any other. The old code
 * agreed by accident for `''` (falsy) and disagreed for `'  '` (truthy), which
 * it then looked up as a phone number id and refused as not found.
 */
function normalizePhoneNumberId(phoneNumberId?: string | null): string | null {
  const trimmed = typeof phoneNumberId === 'string' ? phoneNumberId.trim() : '';
  return trimmed.length ? trimmed : null;
}

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
    @Optional() private readonly events?: EventEmitter2,
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

    // A tenant-wide credential must cover every connected WABA. Validate this
    // BEFORE replacing channel rows, so a token from a second Business Manager
    // cannot silently break the first number. Never downgrade a permanent token
    // to an unclassified/expiring user token.
    const connectedWabas = await this.prisma.executeInTenantSchema<any[]>(
      schemaName,
      `SELECT DISTINCT meta_waba_id FROM whatsapp_channels WHERE meta_waba_id IS NOT NULL`,
    );
    const requiredWabas = [...new Set([
      ...connectedWabas.map((row: any) => String(row.meta_waba_id)),
      String(wabaId),
    ])];
    const existingCredential = await this.prisma.whatsappCredential.findFirst({
      where: { tenantId, credentialType: 'system_user_token' },
    });
    const candidateIsPermanent = data.tokenType === 'system_user' || data.expiresInSeconds === 0;
    let credentialToken = accessToken;
    let credentialExpiresAt = candidateIsPermanent
      ? null
      : new Date(Date.now() + Math.max(Number(data.expiresInSeconds) || 60 * 24 * 60 * 60, 60) * 1000);
    let replaceCredential = true;

    if (existingCredential?.expiresAt === null) {
      const permanentToken = this.cryptoService.decryptToken(existingCredential.encryptedValue);
      try {
        await this.assertTokenCoversWabas(permanentToken, requiredWabas);
        credentialToken = permanentToken;
        credentialExpiresAt = null;
        replaceCredential = false;
      } catch {
        if (!candidateIsPermanent) {
          throw new BadRequestException({
            error: 'whatsapp_token_coverage_required',
            message: 'El token permanente actual no cubre la nueva WABA y no se reemplazará por un token temporal. Reconecta mediante Embedded Signup para autorizar todas las cuentas.',
            wabaId,
          });
        }
        await this.assertTokenCoversWabas(accessToken, requiredWabas);
      }
    } else {
      await this.assertTokenCoversWabas(accessToken, requiredWabas);
    }

    const encryptedToken = this.cryptoService.encryptToken(credentialToken);

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
            // Meta's own timezone id, kept as EVIDENCE and never as a zone: it is
            // a numeric Facebook id (`12`), not IANA, and the CHECK on
            // `waba_timezone` refuses one. Storing it means the mapping can be
            // done later without asking Meta again for every connection.
            ...(data.timezoneId ? { metaTimezoneId: String(data.timezoneId) } : {}),
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
            // Meta's own timezone id, kept as EVIDENCE and never as a zone: it is
            // a numeric Facebook id (`12`), not IANA, and the CHECK on
            // `waba_timezone` refuses one. Storing it means the mapping can be
            // done later without asking Meta again for every connection.
            ...(data.timezoneId ? { metaTimezoneId: String(data.timezoneId) } : {}),
          },
        },
      });
    }

    // Activación (TTFV): marca el primer canal conectado del tenant. Idempotente
    // (guard IS NULL), fire-and-forget — nunca debe romper la conexión.
    void this.markFirstChannelConnected(tenantId);

    // Upsert credencial cifrada.
    if (existingCredential) {
      if (replaceCredential) {
        await this.prisma.whatsappCredential.update({
          where: { id: existingCredential.id },
          data: { encryptedValue: encryptedToken, expiresAt: credentialExpiresAt, rotationState: 'active' },
        });
      }
    } else {
      await this.prisma.whatsappCredential.create({
        data: {
          tenantId,
          credentialType: 'system_user_token',
          encryptedValue: encryptedToken,
          expiresAt: credentialExpiresAt,
          rotationState: 'active',
        },
      });
    }

    this.logger.log(`WhatsApp channel connected for schema ${schemaName}`);
    this.events?.emit(AGENT_QUALITY_DEPENDENCIES_UPDATED, {
      tenantId,
      source: 'channel_credential',
    });
    return { success: true, channelId: rows[0].id };
  }

  private async assertTokenCoversWabas(accessToken: string, wabaIds: string[]): Promise<void> {
    for (const wabaId of wabaIds) {
      const response = await fetch(`${META_GRAPH}/${encodeURIComponent(wabaId)}?fields=id`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
      });
      const body = await response.json().catch(() => ({})) as any;
      if (!response.ok || body.error || String(body.id || '') !== String(wabaId)) {
        this.logger.warn(`WhatsApp credential does not cover WABA ${wabaId}`);
        throw new BadRequestException({
          error: 'whatsapp_token_missing_waba_scope',
          message: 'El token no tiene permiso sobre todas las cuentas de WhatsApp conectadas.',
          wabaId,
        });
      }
    }
  }

  /**
   * El token real desencriptado y los identificadores de Meta del número emisor.
   *
   * ── THE ONE RULE, THE SECOND TIME ─────────────────────────────────────────
   *
   * `ChannelTokenService` resolves this same question for every channel and was
   * fixed first: a named connection resolves to itself or to a refusal, an
   * unnamed one only while the tenant has exactly one, and the credential has to
   * belong to the account it comes back for. This method is a SECOND, older
   * implementation of the same question, reached by a different route — the
   * WhatsApp service's messaging and template surfaces — and it still had the
   * rule broken in two places. The vocabulary is `connection-refusal.ts`, the
   * same one; there is no second set of reasons for the same refusals.
   *
   * 1 · The explicit path already refused correctly. The UNNAMED one ran
   *     `ORDER BY connected_at ASC NULLS LAST LIMIT 1` and answered with the
   *     tenant's oldest connection. Four billable template senders reach this
   *     without naming a number — appointment reminders, attendance checks,
   *     lead-capture automations and drip sequences — so on a two-number tenant
   *     every one of those went out on, and from 1 October is billed to, whichever
   *     number happened to connect first. Now: `connection_ambiguous`, because
   *     there is no defensible way to pick which of a business's WhatsApp
   *     Business Accounts pays.
   *
   * 2 · The credential fallback read `access_token_ref` with its OWN query,
   *     ordered the same way, and returned that token together with the
   *     REQUESTED row's `phone_number_id`, `meta_waba_id` and `channelId`. Number
   *     B's identity travelled with number A's token: a message that claims to
   *     be from B, presented to Meta with A's credential, billed to A's account.
   *     Now the token comes off the row that was resolved, or it is
   *     `credential_missing` — never off a sibling.
   *
   * The tenant-wide `system_user_token` stays the deliberate exception and is
   * still preferred: under the Tech Provider model it really does cover every
   * WABA of the tenant, so presenting it for any of that tenant's numbers is not
   * a substitution. WHICH number sends — the thing Meta bills — is still exact.
   */
  async getValidAccessToken(schemaName: string, phoneNumberId?: string): Promise<{ accessToken: string, phoneNumberId: string, wabaId: string, channelId: string }> {
    const resolved = await this.resolveConnection(schemaName, phoneNumberId);
    return {
      accessToken: resolved.accessToken,
      phoneNumberId: resolved.phoneNumberId,
      wabaId: resolved.wabaId,
      channelId: resolved.channelId,
    };
  }

  /**
   * The connection, the account Meta will bill and the credential, as the one
   * immutable record a retry can compare itself against.
   *
   * Same shape and same contract version as `ChannelTokenService.resolveSendContext`,
   * and deliberately the same `SendContextRequest` type rather than a parallel
   * one — a second description of the same fact is how the two resolvers drifted
   * apart in the first place. Handing a bare token to a transport loses the only
   * facts that make an outbound effect legitimate after 1 October: which number
   * it goes out from and whose WABA pays for it.
   *
   * `payer.kind` is `unknown` even when the WABA id is known. Knowing WHICH
   * account Meta bills is a different fact from knowing HOW it is funded, and
   * nothing here has asked Meta; `business_direct` would be a claim about
   * somebody's card.
   */
  async resolveSendContext(request: SendContextRequest): Promise<ResolvedConnection> {
    const schemaName = await this.prisma.getTenantSchemaName(request.tenantId);
    const resolved = await this.resolveConnection(schemaName, request.channelAccountId);
    return {
      accessToken: resolved.accessToken,
      context: {
        version: OUTBOUND_CONTRACT_VERSION,
        tenantId: resolved.tenantId,
        channelType: 'whatsapp',
        channelAccountId: resolved.phoneNumberId,
        channelAddress: resolved.displayPhoneNumber,
        payer: { kind: 'unknown', wabaId: resolved.wabaId ?? null, businessId: resolved.businessId },
        credential: { id: resolved.credentialId, source: resolved.credentialSource },
        recipient: request.recipient,
      },
    };
  }

  /** The connection and its own credential, or a refusal. Never another number. */
  private async resolveConnection(
    schemaName: string, phoneNumberId?: string | null,
  ): Promise<ResolvedWhatsappConnection> {
    // The tenant is resolved FIRST so a refusal can name it. Only its id is
    // read: selecting the whole model to use one column is a read of every
    // column of a table this method has no other business in.
    const tenant = await this.prisma.tenant.findUnique({
      where: { schemaName },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Tenant no válido');

    const channel = await this.findChannel(schemaName, tenant.id, normalizePhoneNumberId(phoneNumberId));
    return this.credentialFor(tenant.id, channel);
  }

  /** The channel row, or a refusal. Never another number of the same tenant. */
  private async findChannel(schemaName: string, tenantId: string, phoneNumberId: string | null): Promise<any> {
    // `access_token_ref` is selected HERE, with the row's identity, so the
    // credential fallback below cannot read it from a different row.
    const columns = `id, phone_number_id, meta_waba_id, meta_business_id,
        display_phone_number, access_token_ref`;

    if (phoneNumberId) {
      const rows = await this.prisma.executeInTenantSchema<any[]>(
        schemaName,
        `SELECT ${columns} FROM whatsapp_channels WHERE phone_number_id = $1 LIMIT 1`,
        [phoneNumberId],
      );
      if (!rows?.length) {
        // An explicit choice of sender. The tenant's other numbers are not an
        // answer to this question, and answering with one would send the message
        // from a different business number than the one that was chosen.
        throw new ConnectionRefusedError('connection_not_found',
          { tenantId, channelType: 'whatsapp', requestedAccountId: phoneNumberId });
      }
      return rows[0];
    }

    // Nothing named. Two rows are enough to know the question has no answer, so
    // `LIMIT 2` — counting every number of a large tenant buys nothing. Rows with
    // no phone_number_id cannot send at all (onboarding leaves them while Meta
    // has not issued one), so they neither answer this request nor make it
    // ambiguous.
    const rows = await this.prisma.executeInTenantSchema<any[]>(
      schemaName,
      `SELECT ${columns} FROM whatsapp_channels
        WHERE phone_number_id IS NOT NULL AND phone_number_id <> ''
        ORDER BY connected_at ASC NULLS LAST LIMIT 2`,
    );
    if (!rows?.length) {
      throw new ConnectionRefusedError('connection_absent', { tenantId, channelType: 'whatsapp' });
    }
    if (rows.length > 1) {
      this.logger.warn(`WhatsApp number not named for tenant ${tenantId}, which has more than one; `
        + 'refusing rather than choosing which account pays');
      throw new ConnectionRefusedError('connection_ambiguous', { tenantId, channelType: 'whatsapp' });
    }
    return rows[0];
  }

  /** The credential of THIS connection, or a refusal. Never a sibling's. */
  private async credentialFor(tenantId: string, channel: any): Promise<ResolvedWhatsappConnection> {
    const base = {
      tenantId,
      channelId: String(channel.id),
      phoneNumberId: String(channel.phone_number_id),
      wabaId: channel.meta_waba_id,
      businessId: channel.meta_business_id ?? null,
      displayPhoneNumber: channel.display_phone_number ?? null,
    };

    const cred = await this.prisma.whatsappCredential.findFirst({
      where: { tenantId, credentialType: 'system_user_token' },
      orderBy: { createdAt: 'desc' },
    });

    if (cred?.encryptedValue) {
      let accessToken: string;
      try {
        accessToken = this.cryptoService.decryptToken(cred.encryptedValue);
      } catch (e: any) {
        // A credential that cannot be decrypted is not an absent credential:
        // falling through to the channel row would present a DIFFERENT secret
        // than the one the tenant last authorised, and hide a rotation failure.
        throw new ConnectionRefusedError('credential_undecryptable', {
          tenantId, channelType: 'whatsapp',
          requestedAccountId: base.phoneNumberId, detail: e?.message,
        });
      }
      return { ...base, accessToken, credentialId: String(cred.id), credentialSource: 'system_user' };
    }

    // A token stored on the channel row itself — legacy connections, and what
    // survives from before the credential table. `credential_ref` is the
    // placeholder `saveConnection` writes, and it is not a token. The row is the
    // one that was resolved, so the credential's identity is that row and a swap
    // between numbers is visible in the record instead of silently survived.
    if (channel.access_token_ref && channel.access_token_ref !== 'credential_ref') {
      return {
        ...base, accessToken: String(channel.access_token_ref),
        credentialId: base.channelId, credentialSource: 'channel_account',
      };
    }

    throw new ConnectionRefusedError('credential_missing',
      { tenantId, channelType: 'whatsapp', requestedAccountId: base.phoneNumberId });
  }

  // ======================== BILLING TIME ZONE ========================

  /**
   * The IANA zone Meta's charges for this number are dated in.
   *
   * From 1 October 2026 the rate depends on the effective date and the free
   * thousand resets per number per calendar month. Both questions are "what day,
   * and what month, is it for THIS account?" and only the WABA's own zone
   * answers them: a tenant can hold numbers in two countries, and 23:30 on
   * 30 September in Bogotá is already October in UTC.
   *
   * It is set by hand on purpose. Meta returns `timezone_id`, which is a NUMERIC
   * Facebook id and not a zone; mapping it would mean shipping Facebook's table
   * from memory, and a wrong entry silently dates charges in the wrong month —
   * exactly the kind of thing that must not be guessed. The number Meta gave is
   * kept in `metadata.metaTimezoneId` so the mapping can be done later against
   * the real table, without asking Meta again for every connection.
   *
   * Until a zone is set the resolver refuses to price rather than defaulting.
   */
  async setBillingTimeZone(tenantId: string, phoneNumberId: string, timeZone: string): Promise<{
    phoneNumberId: string; timeZone: string;
  }> {
    const zone = String(timeZone ?? '').trim();
    // Validated against the runtime that will USE it, not against a list of
    // shapes: a zone this rejects is one every price would then refuse.
    if (!zone || wabaLocalDate(new Date(), zone) === null) {
      throw new BadRequestException(
        `"${zone}" no es una zona horaria IANA (ej. America/Bogota). Meta devuelve un id numérico, que no sirve acá.`);
    }
    const account = await this.prisma.channelAccount.findFirst({
      where: { tenantId, channelType: 'whatsapp', accountId: phoneNumberId },
      select: { id: true },
    });
    // The same refusal vocabulary as every other "that connection is not this
    // tenant's" answer, so a caller reads one set of codes.
    if (!account) {
      throw new ConnectionRefusedError('connection_not_found',
        { tenantId, channelType: 'whatsapp', requestedAccountId: phoneNumberId });
    }
    await this.prisma.channelAccount.update({
      where: { id: account.id }, data: { wabaTimezone: zone },
    });
    this.logger.log(`WhatsApp ${phoneNumberId} of tenant ${tenantId} is now billed in ${zone}`);
    return { phoneNumberId, timeZone: zone };
  }

  // ======================== BUSINESS PROFILE ========================

  async getBusinessProfile(schemaName: string, requestedPhoneNumberId?: string) {
    const { accessToken, phoneNumberId } = await this.getValidAccessToken(schemaName, requestedPhoneNumberId);

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
      `SELECT messaging_limit_tier FROM whatsapp_channels WHERE phone_number_id = $1 LIMIT 1`,
      [phoneNumberId],
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
  }, requestedPhoneNumberId?: string) {
    const { accessToken, phoneNumberId } = await this.getValidAccessToken(schemaName, requestedPhoneNumberId);

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

  async uploadProfilePhoto(schemaName: string, file: Express.Multer.File, requestedPhoneNumberId?: string) {
    if (!file.mimetype.match(/^image\/(jpeg|png)$/)) {
      throw new BadRequestException('Only JPEG and PNG images are accepted');
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new BadRequestException('Image exceeds 5MB limit');
    }

    const { accessToken, phoneNumberId } = await this.getValidAccessToken(schemaName, requestedPhoneNumberId);
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

  async deleteProfilePhoto(schemaName: string, requestedPhoneNumberId?: string) {
    const { accessToken, phoneNumberId } = await this.getValidAccessToken(schemaName, requestedPhoneNumberId);

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
