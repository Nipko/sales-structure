import { readFundingFromGraph } from '../../channels/whatsapp-funding-readiness';
import { Inject, Injectable, Logger, BadRequestException, NotFoundException, Optional, UnauthorizedException, forwardRef } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { OUTBOUND_CONTRACT_VERSION, type OutboundCredentialRef } from '@parallext/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappCryptoService } from './whatsapp-crypto.service';
import { TenantThrottleService } from '../../throttle/tenant-throttle.service';
import { AGENT_QUALITY_DEPENDENCIES_UPDATED } from '../../quality/agent-quality-events';
import { ConnectionRefusedError } from '../../channels/connection-refusal';
// One place decides whether a connection may send and whether its credential
// may sign, so this resolver and `ChannelTokenService` cannot drift apart
// again — which is exactly how one of them started answering with a revoked
// token for a number the tenant had disconnected.
import { assertUsable, assessConnection, assessCredential, sendableChannelSql }
    from '../../channels/connection-usability';
import { ChannelTokenService, type ResolvedConnection, type SendContextRequest }
    from '../../channels/channel-token.service';
// Validated by the very function that will price with it: a zone this cannot
// format is a zone every later charge would refuse, so accepting one here would
// only move the failure to the first message somebody tries to send.
import { wabaLocalDate } from '../../billing/whatsapp-rates';
import {
    contradictoryWabas, describeResolution, resolveZone,
    type NumberZone, type ZoneEvidence, type ZoneResolution,
} from '../waba-timezone-authority';
import {
    currencyFromMeta, describeCurrency, resolveCurrency,
} from '../waba-currency-authority';

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
    // Optional and injected late on purpose:  and this one
    // are a forwardRef pair, and a required dependency here would make the
    // graph resolution order matter. What it buys is that a connect or a
    // rotation can clear the cached secret it just replaced.
    @Optional() @Inject(forwardRef(() => ChannelTokenService))
    private readonly channelToken?: ChannelTokenService,
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
            // Meta's own billing currency for this WABA, with provenance.
            // A bare code with no source and no date cannot be used to price:
            // it is indistinguishable from something somebody typed, and a
            // confident amount in the wrong money is worse than no amount.
            ...(currencyFromMeta(data.currency, wabaId)
                ? { billingCurrencyEvidence: { ...currencyFromMeta(data.currency, wabaId)! } }
                : {}),
            // Meta's own billing currency for this WABA, with provenance.
            // A bare code with no source and no date cannot be used to price:
            // it is indistinguishable from something somebody typed, and a
            // confident amount in the wrong money is worse than no amount.
            ...(currencyFromMeta(data.currency, wabaId)
                ? { billingCurrencyEvidence: { ...currencyFromMeta(data.currency, wabaId)! } }
                : {}),
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
          data: {
            encryptedValue: encryptedToken, expiresAt: credentialExpiresAt, rotationState: 'active',
            // ── PROVENANCE DESCRIBES A SECRET, NOT A ROW ──────────────────
            //
            // These four columns say what the STORED TOKEN is: a Business
            // Integration System User minted for one client, or the provider's
            // own System User. Replacing the secret and leaving them behind
            // makes them describe a token that is no longer there — and the
            // reader treats them as established, so a pasted credential
            // inherits the last one's verification and `maySignForClient`
            // answers `usable, established` about something nobody checked.
            //
            // Cleared rather than guessed. An operator pasting a token here
            // supplies no portfolio, so `not_established` is the truth: the
            // credential still sends, and it is honestly marked unverified
            // until Embedded Signup establishes whose it is.
            credentialKind: null,
            ownerBusinessId: null,
            metaAppId: null,
            grantedScopes: null,
            provenanceVerifiedAt: null,
          },
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

    // Connect, reconnect and rotation all land here, and all three replace a
    // secret that is TENANT-WIDE: under the Tech Provider model one System User
    // token signs for every number the tenant has. Clearing only this number's
    // key left the siblings holding the outgoing half of a rotation for five
    // more minutes — sending with a credential that had just been replaced.
    //
    // `invalidateCache` now bumps the tenant's revocation epoch as well as
    // deleting this key, so the siblings re-resolve once from the database
    // instead. That is three queries each, not an outage: the connection they
    // read is perfectly good, it simply has to be read again.
    //
    // After the writes, never before: an invalidation that runs first races the
    // entry it is removing.
    await this.channelToken?.invalidateCache('whatsapp', tenantId, String(phoneNumberId))
      .catch((e: any) => this.logger.error(
        `Connection saved but the token cache for ${phoneNumberId} was not cleared: ${e?.message}`));

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

  // ══ THE SECOND `resolveSendContext` IS GONE, AND ITS ABSENCE IS THE POINT ══
  //
  // This file used to carry its own copy. It had the same name, the same
  // request type and the same contract version as
  // `ChannelTokenService.resolveSendContext`, and it disagreed about the one
  // field that decides who is billed: it answered `payer.kind: 'unknown'` even
  // when the WABA id was right there in the row.
  //
  // Under `enforce` that is a refusal — `payer_unknown` — so any sink that had
  // ever been pointed at this copy would have gone silent while the queue lane,
  // which asks the other resolver, kept working. It had no production callers,
  // which is exactly what made it dangerous: a second implementation nobody
  // exercises is a trap for the next person who needs one and finds this file
  // first.
  //
  // There is one resolver. `channel-token.service.ts` owns it, and
  // `one-send-context-resolver.spec.ts` fails if a second one appears.

  /** Read-only Meta check. Card data is entered exclusively in Meta's own interface. */
  async checkFunding(schemaName: string, phoneNumberId: string) {
    if (!/^[0-9]{5,30}$/.test(phoneNumberId)) throw new BadRequestException('invalid_phone_number_id');
    const connection = await this.resolveConnection(schemaName, phoneNumberId);
    if (!/^[0-9]{5,30}$/.test(connection.wabaId ?? '')) throw new BadRequestException('waba_identity_unknown');
    let answer: { status: number; body: unknown } = { status: 0, body: null };
    try {
      const response = await fetch(`${META_GRAPH}/${connection.wabaId}?fields=id,primary_funding_id`, {
        headers: { Authorization: `Bearer ${connection.accessToken}` }, signal: AbortSignal.timeout(10000),
      });
      const body = await response.json();
      answer = response.ok && String(body?.id ?? '') !== connection.wabaId
        ? { status: 0, body: null } : { status: response.status, body };
    } catch { /* Transport uncertainty is unknown, never no-card. */ }
    const reading = readFundingFromGraph({ ...answer, requestedFundingField: true }, new Date());
    const evidence = { state: reading.state, source: reading.source,
      checkedAt: reading.checkedAt!.toISOString(), wabaId: connection.wabaId };
    const changed = await this.prisma.$executeRawUnsafe(`UPDATE public.channel_accounts
      SET metadata=jsonb_set(COALESCE(metadata,'{}'::jsonb),'{fundingReadiness}',$4::jsonb), updated_at=clock_timestamp()
      WHERE tenant_id::uuid=$1::uuid AND channel_type='whatsapp' AND account_id=$2 AND is_active=true
        AND metadata->>'wabaId'=$3`, connection.tenantId, phoneNumberId, connection.wabaId, JSON.stringify(evidence));
    if (!changed) throw new BadRequestException('funding_connection_changed');
    return { phoneNumberId, ...evidence };
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
        display_phone_number, access_token_ref, channel_status`;

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
      // Exists is not the same as may send. A named number that is
      // disconnected is told so, rather than reported missing.
      assertUsable(await this.connectionUsable(tenantId, rows[0]),
        { tenantId, channelType: 'whatsapp', requestedAccountId: phoneNumberId });
      return rows[0];
    }

    // Nothing named. Two rows are enough to know the question has no answer, so
    // `LIMIT 2` — counting every number of a large tenant buys nothing. Rows with
    // no phone_number_id cannot send at all (onboarding leaves them while Meta
    // has not issued one), so they neither answer this request nor make it
    // ambiguous.
    // Only rows that may send are candidates, so a disconnected sibling
    // neither answers this request nor makes it ambiguous.
    const rows = await this.prisma.executeInTenantSchema<any[]>(
      schemaName,
      `SELECT ${columns} FROM whatsapp_channels
        WHERE phone_number_id IS NOT NULL AND phone_number_id <> ''
          AND ${sendableChannelSql()}
        ORDER BY connected_at ASC NULLS LAST LIMIT 2`,
    );
    if (!rows?.length) {
      const [existing] = await this.prisma.executeInTenantSchema<any[]>(
        schemaName,
        `SELECT channel_status FROM whatsapp_channels
          WHERE phone_number_id IS NOT NULL AND phone_number_id <> '' LIMIT 1`,
      );
      // Nothing connected, versus something present and not connected. The
      // fix is different for each, so the code has to be different too.
      if (existing) {
        throw new ConnectionRefusedError('connection_disconnected', {
          tenantId, channelType: 'whatsapp',
          detail: `channel_status=${existing.channel_status ?? 'unset'}`,
        });
      }
      throw new ConnectionRefusedError('connection_absent', { tenantId, channelType: 'whatsapp' });
    }
    if (rows.length > 1) {
      this.logger.warn(`WhatsApp number not named for tenant ${tenantId}, which has more than one; `
        + 'refusing rather than choosing which account pays');
      throw new ConnectionRefusedError('connection_ambiguous', { tenantId, channelType: 'whatsapp' });
    }
    assertUsable(await this.connectionUsable(tenantId, rows[0]),
      { tenantId, channelType: 'whatsapp', requestedAccountId: String(rows[0].phone_number_id) });
    return rows[0];
  }

  /**
   * The tenant's channel row AND the global account row, asked together.
   *
   * Disconnect writes `channel_accounts.is_active = false` and, since this
   * batch, `whatsapp_channels.channel_status = 'disconnected'`. Asking only
   * one of them is how a disconnected number kept sending.
   */
  private async connectionUsable(tenantId: string, channel: any) {
    const phoneNumberId = String(channel?.phone_number_id ?? '');
    let accountActive: boolean | undefined;
    try {
      const account = await this.prisma.channelAccount.findFirst({
        where: { tenantId, channelType: 'whatsapp', accountId: phoneNumberId },
        select: { isActive: true },
      });
      // Absent is not inactive: a tenant provisioned before that table was
      // populated has no row, and reading absence as `false` would
      // disconnect every one of them at once.
      accountActive = account ? account.isActive !== false : undefined;
    } catch (error: any) {
      this.logger.warn(`channel_accounts unreadable for ${tenantId}/${phoneNumberId}: ${error?.message}`);
    }
    return assessConnection({ channelStatus: channel?.channel_status, accountActive });
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
      // Revoked on disconnect, mid-rotation, or past its own expiry. None of
      // those may sign a request, and falling through to the channel row
      // would present a different secret than the one last authorised.
      assertUsable(assessCredential(cred), {
        tenantId, channelType: 'whatsapp', requestedAccountId: base.phoneNumberId,
      });
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
    phoneNumberId: string; timeZone: string; alsoApplied: readonly string[];
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
      select: { id: true, metadata: true },
    });
    // The same refusal vocabulary as every other "that connection is not this
    // tenant's" answer, so a caller reads one set of codes.
    if (!account) {
      throw new ConnectionRefusedError('connection_not_found',
        { tenantId, channelType: 'whatsapp', requestedAccountId: phoneNumberId });
    }
    await this.prisma.channelAccount.update({
      where: { id: account.id },
      data: {
        wabaTimezone: zone,
        metadata: {
          ...((account.metadata ?? {}) as object),
          // The evidence, beside the answer. Without it the platform can say
          // WHAT the zone is and not WHY, and "why" is the difference between a
          // fact somebody confirmed and a value that appeared.
          wabaTimezoneEvidence: {
            source: 'human_confirmed', at: new Date().toISOString(),
            timezoneId: Number((account.metadata as any)?.metaTimezoneId) || null,
            wabaId: (account.metadata as any)?.wabaId ?? null,
          },
        } as any,
      },
    });
    this.logger.log(`WhatsApp ${phoneNumberId} of tenant ${tenantId} is now billed in ${zone}`);

    // One confirmation answers for every number that reports the SAME numeric
    // id on the SAME business account. Meta's zone belongs to the WABA, so this
    // reads one fact twice rather than guessing a second one — and it is what
    // turns "six numbers, six forms" into "six numbers, one form".
    const alsoApplied = await this.propagateZone(tenantId, account, zone);
    return { phoneNumberId, timeZone: zone, alsoApplied };
  }

  /**
   * Carry a just-confirmed zone to its siblings, and to nobody else.
   *
   * Same business account, same numeric id, and no zone of their own. A number
   * that already has one is left alone: overwriting somebody's explicit choice
   * because a sibling was set later would be the platform deciding it knows
   * better, silently, about money.
   *
   * Best-effort. A propagation that fails leaves the other numbers exactly as
   * they were — unmapped, blocked with a named diagnosis, and fixable by the
   * same one-field form.
   */
  private async propagateZone(tenantId: string, source: { id: string; metadata: unknown },
    zone: string): Promise<readonly string[]> {
    const wabaId = (source.metadata as any)?.wabaId ?? null;
    const timezoneId = (source.metadata as any)?.metaTimezoneId ?? null;
    if (!wabaId || !timezoneId) return [];
    try {
      const siblings = await this.prisma.channelAccount.findMany({
        where: { tenantId, channelType: 'whatsapp', wabaTimezone: null },
        select: { id: true, accountId: true, metadata: true },
      });
      const applied: string[] = [];
      for (const sibling of siblings) {
        if (sibling.id === source.id) continue;
        const metadata = (sibling.metadata ?? {}) as Record<string, unknown>;
        if (metadata.wabaId !== wabaId || String(metadata.metaTimezoneId ?? '') !== String(timezoneId)) {
          continue;
        }
        await this.prisma.channelAccount.update({
          where: { id: sibling.id },
          data: {
            wabaTimezone: zone,
            metadata: {
              ...metadata,
              wabaTimezoneEvidence: {
                source: 'same_waba_same_id', at: new Date().toISOString(),
                timezoneId: Number(timezoneId) || null, wabaId,
                from: String((source.metadata as any)?.phoneNumberId ?? ''),
              },
            } as any,
          },
        });
        applied.push(sibling.accountId);
      }
      if (applied.length) {
        this.logger.log(`The same zone ${zone} now applies to ${applied.length} more number(s) `
          + `on WABA ${wabaId}, which report the same Meta time zone`);
      }
      return applied;
    } catch (error: any) {
      this.logger.warn(`Could not carry the zone to the rest of WABA ${wabaId}: ${error?.message}`);
      return [];
    }
  }

  /**
   * What every WhatsApp number of this tenant knows about its own billing zone.
   *
   * The readiness answer, in one read: the zone, where it came from, and — the
   * question no single number can answer — whether two numbers on one business
   * account disagree about what month it is.
   */
  async billingZoneReadiness(tenantId: string): Promise<{
    numbers: readonly {
      channelAccountId: string; wabaId: string | null; timezoneId: number | null;
      zone: string | null; evidence: ZoneEvidence | null; resolution: ZoneResolution;
      guidance: string; currency: string | null; currencyStale: boolean;
      currencyGuidance: string;
    }[];
    contradictions: ReturnType<typeof contradictoryWabas>;
  }> {
    const accounts = await this.prisma.channelAccount.findMany({
      where: { tenantId, channelType: 'whatsapp' },
      select: { accountId: true, wabaTimezone: true, metadata: true },
    });
    const numbers: (NumberZone & { metadata: Record<string, any> })[] = accounts.map(account => {
      const metadata = (account.metadata ?? {}) as Record<string, any>;
      return {
        channelAccountId: account.accountId,
        wabaId: metadata.wabaId ?? null,
        timezoneId: Number(metadata.metaTimezoneId) || null,
        zone: account.wabaTimezone ?? null,
        evidence: (metadata.wabaTimezoneEvidence ?? null) as ZoneEvidence | null,
        metadata,
      };
    });
    return {
      numbers: numbers.map(number => {
        const resolution = resolveZone(number, numbers);
        const currency = resolveCurrency(number.metadata);
        return {
          ...number, resolution, guidance: describeResolution(number, resolution),
          // Both halves of "can this number price anything": the zone dates the
          // rate, and the currency chooses the card. A screen that showed one
          // would send somebody to fix a field that was not the problem.
          currency: currency.kind === 'established' ? currency.currency : null,
          currencyStale: currency.kind === 'established' ? currency.stale : false,
          currencyGuidance: describeCurrency(currency),
        };
      }),
      contradictions: contradictoryWabas(numbers),
    };
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
