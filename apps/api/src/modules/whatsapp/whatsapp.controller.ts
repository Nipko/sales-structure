import { TenantGuard } from '../../common/guards/tenant.guard';
import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Request,
  BadRequestException,
  Headers,
  Req,
  UnauthorizedException,
  RawBodyRequest,
  Logger,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { WhatsappConnectionService } from './services/whatsapp-connection.service';
import { WhatsappWebhookService } from './services/whatsapp-webhook.service';
import { WhatsappTemplateService } from './services/whatsapp-template.service';
import { WhatsappMessagingService } from './services/whatsapp-messaging.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { Request as ExpressRequest } from 'express';
import { ChannelTokenService } from '../channels/channel-token.service';
import {
  ProactiveDispatchService, effectIsDurable, type ProactiveSendResult,
} from '../channels/proactive-dispatch.service';
import type { DispatchItem } from '../channels/agent-dispatch-outbox';
import { AGENT_QUALITY_DEPENDENCIES_UPDATED } from '../quality/agent-quality-events';
import { RequiresVerifiedEmail } from '../../common/decorators/requires-verified-email.decorator';
import { createHash } from 'crypto';

/**
 * ═══ WHAT A REST SEND IS, ONCE IT HAS TO SURVIVE A RESTART ═══
 *
 * These five routes used to POST to Meta on the request's own stack. There was
 * no row, no lease and no receipt: a restart between the decision and the call
 * lost the message, and a caller retrying a request whose answer never arrived
 * sent it twice. Nothing could refuse the spend before it happened, and from
 * 1 October 2026 every one of those is a separate charge.
 *
 * They now commit a row on the durable lane and answer with what happened to
 * it. Three things had to be decided to make that possible, and each is a rule
 * rather than a default:
 *
 * ── 1. WHAT MAKES THIS SEND *THIS* SEND ─────────────────────────────────────
 *
 * The lane identifies an effect by a key the producer can recompute, so two
 * attempts at the same effect collide on one row instead of arriving twice. A
 * REST caller has two ways to give one:
 *
 *   · `Idempotency-Key` (header) or `idempotencyKey` (body) — CANONICAL. The
 *     caller states what makes this send distinct, so two DELIBERATE identical
 *     messages ("¿seguís ahí?" twice) stay two effects.
 *   · absent — DERIVED from the request's own durable content: the tenant, the
 *     paying number, the recipient, the item kind and the payload. A client
 *     that timed out and retried sends the identical bytes, so the retry finds
 *     the first row and is told `already_present` instead of charging twice.
 *
 * The derived form has a cost, and it is stated rather than hidden: with no
 * key, two deliberate identical sends to the same person from the same number
 * collapse into one, and the answer says so (`duplicate: true`). That is the
 * honest trade — a caller who needs both sends says so with a key. The
 * alternative, a random id, turns every retry into a second charge, which is
 * the precise failure this lane exists to end.
 *
 * ── 2. WHICH NUMBER PAYS ────────────────────────────────────────────────────
 *
 * Explicit, never implicit. `phoneNumberId` names it; omitted, the resolver
 * answers only while the tenant has exactly one sendable number and REFUSES
 * (`connection_ambiguous`) otherwise. Nobody chooses which WhatsApp Business
 * Account is billed by row order.
 *
 * ── 3. WHO IS SENDING, AND WHETHER THEY STILL MAY ───────────────────────────
 *
 * A `HumanOperatorAuthority` over the REAL acting user — during impersonation
 * the super_admin, not the tenant admin they are acting as. Authentication at
 * the edge proves who ASKED; the authority is re-read inside the transaction
 * that authorises the POST, so an account deactivated in between sends nothing.
 *
 * ── AND WHAT THE ANSWER MEANS NOW ───────────────────────────────────────────
 *
 * `messageId` is gone and is not replaced by a fake. Delivery happens on the
 * lane, so at the moment this returns there is no provider receipt to report,
 * and inventing one would be the defect this programme exists to remove.
 * `success` is true only when a durable effect exists.
 */
export type WhatsappRestItemKind = 'template' | 'text' | 'interactive' | 'media' | 'location';

/** What a send route answers. `success` is true only for a committed effect. */
export interface WhatsappRestSendResult {
  readonly success: boolean;
  /** The lane's own word: `prepared` or `already_present`. */
  readonly status: ProactiveSendResult['kind'];
  /** This effect's durable identity, stable across retries of the same send. */
  readonly originId: string;
  /** True when this request found an effect a previous attempt already owned. */
  readonly duplicate: boolean;
  /** The number that will be billed. Echoed so a caller can see what it chose. */
  readonly phoneNumberId: string;
  /** The thread the effect was recorded in, for a caller that wants to follow it. */
  readonly conversationId: string;
}

/**
 * The same question `effectIsDurable` answers, phrased so the compiler can use
 * it. It DELEGATES rather than re-deciding: a second copy of the rule here is
 * how two places end up disagreeing about whether a message was committed.
 */
function committed(result: ProactiveSendResult):
result is Extract<ProactiveSendResult, { readonly originId: string }> {
  return effectIsDurable(result);
}

/** The recipient as Meta wants it, or empty when the caller named nobody. */
export function restRecipient(toPhone: unknown): string {
  return String(toPhone ?? '').replace(/[+\s-]/g, '').trim();
}

/**
 * A key that is a function of the request, for a caller that supplied none.
 *
 * The payload is serialised with its keys SORTED, so two encodings of one
 * request produce one key: a client library that reorders JSON fields must not
 * turn a retry into a second charge. Hashed rather than concatenated because a
 * payload can be large and this is an identity, not a record.
 */
export function derivedRestIdempotencyKey(input: {
  readonly tenantId: string;
  readonly channelAccountId: string;
  readonly recipient: string;
  readonly kind: WhatsappRestItemKind;
  readonly payload: Record<string, any>;
}): string {
  const stable = (value: any): any => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
    }
    return value;
  };
  const digest = createHash('sha256')
    .update(JSON.stringify(stable(input.payload) ?? null)).digest('hex');
  return `wa_rest:${input.tenantId}:${input.channelAccountId}:${input.recipient}:`
    + `${input.kind}:${digest}`;
}

/**
 * The real person behind the request.
 *
 * During impersonation `req.user` IS the tenant user being impersonated, and
 * attributing a customer-facing message to them would record the customer's own
 * admin as the sender of something a platform operator sent. The delegation
 * claim carries the real super_admin; `audit-actor.util.ts` follows the same
 * rule for audit rows, for the same reason.
 */
export function realActingUserId(user: any): string {
  const impersonator = user?.isImpersonation ? String(user?.impersonatedBy ?? '').trim() : '';
  return impersonator || String(user?.id ?? user?.sub ?? '').trim();
}

/** The lane's `interactive` payload, from the Graph-shaped body these routes take. */
export function interactiveDispatchPayload(interactive: any): Record<string, any> {
  const shape = interactive ?? {};
  return {
    type: String(shape.type ?? ''),
    body: String(shape.body?.text ?? shape.body ?? ''),
    action: shape.action,
    ...(shape.header?.text ? { headerText: String(shape.header.text) } : {}),
    ...(shape.footer?.text ? { footerText: String(shape.footer.text) } : {}),
  };
}

@ApiTags('whatsapp')
@Controller('channels/whatsapp')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(
    private readonly connectionService: WhatsappConnectionService,
    private readonly webhookService: WhatsappWebhookService,
    private readonly templateService: WhatsappTemplateService,
    private readonly messagingService: WhatsappMessagingService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly channelToken: ChannelTokenService,
    @Optional() private readonly events?: EventEmitter2,
    /**
     * The durable lane. Not optional in the module graph; declared after the
     * optional `events` only because a required parameter cannot precede it
     * without changing every existing construction site.
     */
    @Optional() private readonly dispatch?: ProactiveDispatchService,
  ) {}

  private async resolveSchema(req: any): Promise<string | null> {
    if (req.user?.schemaName) return req.user.schemaName;
    const tenantId = req.user?.tenantId;
    if (!tenantId) return null;
    try {
      return await this.prisma.getTenantSchemaName(tenantId);
    } catch { return null; }
  }

  // ======================== CONNECTION ========================

  @Get('status')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get WhatsApp channel status' })
  async getStatus(@Request() req: any) {
    const schemaName = await this.resolveSchema(req);
    if (!schemaName) {
      return { status: 'disconnected', channel: null };
    }
    return this.connectionService.getChannelStatus(schemaName);
  }

  @Get('config')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'tenant_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get WhatsApp webhook configuration' })
  async getConfig() {
    const apiBase = (process.env.API_URL || 'https://api.parallly-chat.cloud').replace(/\/$/, '');
    const apiBaseWithPrefix = apiBase.endsWith('/api/v1') ? apiBase : `${apiBase}/api/v1`;

    return {
      success: true,
      data: {
        webhookUrl: `${apiBaseWithPrefix}/channels/webhook/whatsapp`,
        verifyToken: this.webhookService.getVerifyToken()
          || process.env.META_VERIFY_TOKEN
          || 'Token no configurado en backend',
      },
    };
  }

  @Post('connect/start')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @RequiresVerifiedEmail('activate_channel')
  @Roles('tenant_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Start WhatsApp connection onboarding' })
  async startConnection() {
    return {
      status: 'ready',
      provider: 'meta_cloud',
      onboarding: {
        mode: 'embedded_signup',
        metaAppIdConfigured: Boolean(process.env.META_APP_ID),
        metaConfigIdConfigured: Boolean(process.env.META_CONFIG_ID),
      },
    };
  }

  @Post('connect/complete')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @RequiresVerifiedEmail('activate_channel')
  @Roles('tenant_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Complete WhatsApp connection onboarding' })
  async completeConnection(@Request() req: any, @Body() data: any) {
    const schemaName = await this.resolveSchema(req);
    const tenantId = req.user?.tenantId;
    if (!schemaName || !tenantId) {
      throw new BadRequestException('User does not belong to a tenant');
    }
    const result = await this.connectionService.saveConnection(schemaName, tenantId, data);

    // Fire-and-forget: auto-submit the 3 pre-vetted seed templates so the
    // tenant doesn't have to go to Meta Business Manager to create them.
    // Idempotency is handled inside seedTemplates via whatsapp_channels.seeds_submitted.
    this.templateService.seedTemplates(tenantId).catch((err) => {
        // Seeding failures should never block a successful connection — the
        // tenant can retry from the dashboard later.
        // eslint-disable-next-line no-console
        console.error(`[seedTemplates] Failed for tenant ${tenantId}:`, err?.message || err);
    });

    return result;
  }

  // ======================== DISCONNECT ========================

  @Post('disconnect')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('tenant_admin')
  @RequiresVerifiedEmail('sensitive_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Disconnect WhatsApp channel — calls Meta to unsubscribe the app from the WABA, then marks BD inactive' })
  async disconnect(@Request() req: any) {
    const tenantId = req.user?.tenantId;
    if (!tenantId) throw new BadRequestException('Tenant ID required');

    // Resolve tenant schema to read whatsapp_channels (waba_id lives there).
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { schemaName: true },
    });

    let metaUnsubscribed = false;
    let metaError: string | null = null;

    if (tenant?.schemaName) {
      try {
        // Get the access token + waba_id from the tenant's WhatsApp channel.
        const creds = await this.connectionService.getValidAccessToken(tenant.schemaName);
        const graphVersion = this.configService.get<string>('META_GRAPH_VERSION', 'v21.0');

        // Tell Meta to remove our app's webhook subscription on this WABA.
        // After this, Meta stops sending webhooks for this account to us.
        const res = await fetch(
          `https://graph.facebook.com/${graphVersion}/${creds.wabaId}/subscribed_apps?access_token=${creds.accessToken}`,
          { method: 'DELETE' },
        );

        if (res.ok) {
          metaUnsubscribed = true;
          this.logger.log(`Meta WABA ${creds.wabaId} unsubscribed for tenant ${tenantId}`);
        } else {
          const body = await res.text().catch(() => '');
          metaError = `Meta returned ${res.status}: ${body.substring(0, 200)}`;
          this.logger.warn(`Failed to unsubscribe WABA for tenant ${tenantId}: ${metaError}`);
        }
      } catch (err: any) {
        // No credentials, no waba_id, or fetch threw. We still proceed with
        // the BD-level disconnect — but flag this to the user so they know
        // Meta might still be sending webhooks until a manual cleanup.
        metaError = err?.message || 'unknown error resolving WhatsApp credentials';
        this.logger.warn(`Could not call Meta unsubscribe for tenant ${tenantId}: ${metaError}`);
      }
    }

    // Mark every WhatsApp channel_account inactive AND record what happened
    // in metadata so a future "reactivate" knows whether Meta needs to be
    // re-linked or the local toggle is enough.
    await this.prisma.$queryRawUnsafe(
      `UPDATE channel_accounts
         SET is_active = false,
             metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
                 'disconnected_at', NOW()::text,
                 'disconnected_at_provider', $2::boolean,
                 'disconnect_error', $3::text
             ),
             updated_at = NOW()
         WHERE tenant_id = $1::uuid AND channel_type = 'whatsapp'`,
      tenantId,
      metaUnsubscribed,
      metaError,
    );

    // Revoke the credentials so a stale token can't accidentally be reused.
    if (metaUnsubscribed) {
      // Use the typed client — whatsapp_credentials.tenant_id may be text in
      // some Prisma deployments and the raw ::uuid cast crashes there with
      // "operator does not exist: text = uuid". Prisma's updateMany handles
      // the column type transparently.
      try {
        await this.prisma.whatsappCredential.updateMany({
          where: { tenantId, rotationState: 'active' },
          data: { rotationState: 'revoked' },
        });
      } catch (e: any) {
        this.logger.warn(`Failed to revoke whatsapp_credentials for tenant ${tenantId}: ${e?.message}`);
      }
    }

    // The tenant's OWN authority, which this endpoint used to leave saying
    // `connected` while the global row said inactive. Both resolvers read
    // the tenant row first, so leaving it alone was the difference between
    // a disconnect and a disconnect that still sent.
    if (tenant?.schemaName) {
      try {
        await this.prisma.executeInTenantSchema(tenant.schemaName,
          `UPDATE whatsapp_channels SET channel_status = 'disconnected', updated_at = NOW()
            WHERE channel_status <> 'disconnected'`);
      } catch (e: any) {
        // Loud, and not swallowed into the success path: a tenant row still
        // saying `connected` is a number that can still spend money.
        this.logger.error(`Disconnect could not mark whatsapp_channels for ${tenantId}: ${e?.message}`);
        metaError = metaError ?? `local_channel_not_marked: ${e?.message}`;
      }
    }

    // AFTER both authorities are written, never before: an invalidation that
    // runs first races the five-minute entry it is trying to remove, and the
    // revoked token answers by name until it expires on its own.
    await this.channelToken.invalidateCache('whatsapp', tenantId)
      .catch((e: any) => this.logger.error(
        `Disconnect could not clear the WhatsApp token cache for ${tenantId}: ${e?.message}`));

    this.events?.emit(AGENT_QUALITY_DEPENDENCIES_UPDATED, {
      tenantId,
      source: 'channel_connection',
    });

    // Audit row so this disconnect is traceable later.
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId,
          action: 'channel_disconnected',
          resource: 'whatsapp',
          details: {
            metaUnsubscribed,
            metaError,
            triggeredBy: req.user?.sub || 'unknown',
          },
        },
      });
    } catch { /* non-blocking */ }

    this.logger.log(`WhatsApp disconnected for tenant ${tenantId} (meta=${metaUnsubscribed})`);
    return {
      success: true,
      message: metaUnsubscribed
        ? 'WhatsApp desconectado de Meta y de la plataforma'
        : 'WhatsApp marcado como desconectado en la plataforma. ATENCIÓN: la app sigue suscrita en Meta — revisar manualmente.',
      metaUnsubscribed,
      metaError,
    };
  }

  // ======================== BILLING TIME ZONE ========================

  @Post('connection/billing-timezone')
  @RequiresVerifiedEmail('sensitive_admin')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'tenant_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set the IANA time zone Meta\'s charges for a number are dated in' })
  async setBillingTimeZone(@Request() req: any, @Body() body: {
    phoneNumberId: string;
    /** An IANA zone, e.g. `America/Bogota`. Never Meta's numeric `timezone_id`. */
    timeZone: string;
  }) {
    const tenantId = req.user?.tenantId;
    if (!tenantId) throw new BadRequestException('User does not belong to a tenant');
    // The number is named explicitly rather than resolved: this is a decision
    // about WHICH account pays, so choosing one on the caller's behalf would be
    // the very substitution the resolvers were fixed to stop making.
    if (!body?.phoneNumberId?.trim()) {
      throw new BadRequestException('phoneNumberId es obligatorio: la zona es de un número, no del tenant');
    }
    const result = await this.connectionService.setBillingTimeZone(
      tenantId, body.phoneNumberId.trim(), body.timeZone);
    return { success: true, data: result };
  }

  /**
   * What every number of this tenant knows about its own billing.
   *
   * One read rather than a field on a form, because the two questions a person
   * actually has are not about one number: "which of my numbers cannot price
   * anything yet", and "do two of my numbers disagree about what month it is".
   * The second cannot be answered by looking at a number at all — Meta's time
   * zone belongs to the business account — so it is answered here or nowhere.
   *
   * Returns guidance, not codes: each number carries the exact sentence
   * somebody has to act on, and nothing in it is a credential or a card.
   */
  @Get('connection/billing-readiness')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'tenant_admin', 'tenant_supervisor')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Billing time zone readiness for every WhatsApp number of the tenant' })
  async billingReadiness(@Request() req: any) {
    const tenantId = req.user?.tenantId;
    if (!tenantId) throw new BadRequestException('User does not belong to a tenant');
    const readiness = await this.connectionService.billingZoneReadiness(tenantId);
    return {
      success: true,
      data: {
        ...readiness,
        // The summary a screen needs without re-deriving it, and the one number
        // that decides whether the agent can price anything at all.
        pending: readiness.numbers.filter(number => number.resolution.kind === 'unmapped').length,
        contradictory: readiness.contradictions.length,
      },
    };
  }

  @Post('connection/check-funding')
  @UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
  @Roles('super_admin', 'tenant_admin')
  async checkFunding(@Request() req: any, @Body() body: { phoneNumberId?: string }) {
    if (!req.tenantId) throw new BadRequestException('tenant_required');
    if (typeof body?.phoneNumberId !== 'string') throw new BadRequestException('invalid_phone_number_id');
    const schema = await this.prisma.getTenantSchemaName(req.tenantId);
    return { success: true, data: await this.connectionService.checkFunding(schema, body.phoneNumberId) };
  }

  // ======================== BUSINESS PROFILE ========================

  @Get('business-profile')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'tenant_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get WhatsApp Business profile and phone number details from Meta' })
  async getBusinessProfile(@Request() req: any, @Query('phoneNumberId') phoneNumberId?: string) {
    const schemaName = await this.resolveSchema(req);
    if (!schemaName) throw new BadRequestException('User does not belong to a tenant');
    const result = await this.connectionService.getBusinessProfile(schemaName, phoneNumberId);
    return { success: true, data: result };
  }

  @Post('business-profile')
  @RequiresVerifiedEmail('sensitive_admin')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'tenant_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update WhatsApp Business profile fields on Meta' })
  async updateBusinessProfile(@Request() req: any, @Body() body: {
    about?: string;
    address?: string;
    description?: string;
    email?: string;
    websites?: string[];
    vertical?: string;
    phoneNumberId?: string;
  }) {
    const schemaName = await this.resolveSchema(req);
    if (!schemaName) throw new BadRequestException('User does not belong to a tenant');
    const { phoneNumberId, ...profile } = body;
    return this.connectionService.updateBusinessProfile(schemaName, profile, phoneNumberId);
  }

  @Post('business-profile/photo')
  @RequiresVerifiedEmail('sensitive_admin')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'tenant_admin')
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }))
  @ApiOperation({ summary: 'Upload WhatsApp Business profile photo to Meta' })
  async uploadProfilePhoto(
    @Request() req: any,
    @UploadedFile() file: Express.Multer.File,
    @Query('phoneNumberId') phoneNumberId?: string,
  ) {
    if (!file) throw new BadRequestException('No file received');
    const schemaName = await this.resolveSchema(req);
    if (!schemaName) throw new BadRequestException('User does not belong to a tenant');
    return this.connectionService.uploadProfilePhoto(schemaName, file, phoneNumberId);
  }

  @Post('business-profile/photo/delete')
  @RequiresVerifiedEmail('sensitive_admin')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'tenant_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete WhatsApp Business profile photo' })
  async deleteProfilePhoto(@Request() req: any, @Body() body: { phoneNumberId?: string }) {
    const schemaName = await this.resolveSchema(req);
    if (!schemaName) throw new BadRequestException('User does not belong to a tenant');
    return this.connectionService.deleteProfilePhoto(schemaName, body?.phoneNumberId);
  }

  // ======================== TEMPLATES ========================

  @Get('templates')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get synced WhatsApp templates' })
  async getTemplates(@Request() req: any) {
    const schemaName = await this.resolveSchema(req);
    if (!schemaName) {
      return { success: true, data: [] };
    }
    return this.templateService.getTemplates(schemaName);
  }

  @Post('templates/sync')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'tenant_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Force sync templates from Meta' })
  async syncTemplates(@Request() req: any) {
    const schemaName = await this.resolveSchema(req);
    if (!schemaName) {
      throw new BadRequestException('User does not belong to a tenant');
    }
    return this.templateService.syncTemplatesFromMeta(schemaName);
  }

  @Post('templates/create')
  @RequiresVerifiedEmail('send_outbound')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'tenant_admin')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new WhatsApp template and submit to Meta for approval' })
  async createTemplate(
    @Request() req: any,
    @Body() body: {
      name: string;
      language: string;
      category: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';
      components: Array<{
        type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
        format?: string;
        text?: string;
        example?: any;
        buttons?: any[];
      }>;
      // Multi-number: which number/WABA to create the template on. Defaults to the
      // oldest active channel when omitted.
      phoneNumberId?: string;
    },
  ) {
    const schemaName = await this.resolveSchema(req);
    const tenantId = req.user?.tenantId;
    if (!schemaName || !tenantId) {
      throw new BadRequestException('User does not belong to a tenant');
    }

    if (!body.name || !body.language || !body.category || !body.components?.length) {
      throw new BadRequestException('name, language, category, and components are required');
    }

    // Las tres columnas que esta consulta pedía NO EXISTEN: la tabla
    // `whatsapp_channels` tiene `meta_waba_id`, `access_token_ref` y
    // `channel_status`, nunca tuvo `waba_id`, `access_token` ni `is_active`. O
    // sea que crear una plantilla desde la app fallaba SIEMPRE con un 42703
    // (columna inexistente) — y las plantillas son el requisito para iniciar
    // conversación fuera de la ventana de 24h, así que el tenant quedaba
    // obligado a ir a Meta Business Manager a mano.
    //
    // Se resuelve por ChannelTokenService, que ya sabe hacerlo bien: prefiere el
    // `system_user_token` cifrado de la tabla global y cae al ref de la fila
    // sólo si no lo hay. Copiar la consulta con los nombres corregidos habría
    // dejado el token sin descifrar.
    let creds: { accessToken: string; wabaId?: string; channelId?: string };
    try {
      const wa = await this.channelToken.getWhatsAppToken(tenantId, body.phoneNumberId);
      creds = { accessToken: wa.accessToken, wabaId: wa.wabaId, channelId: wa.channelId };
    } catch {
      throw new BadRequestException('No active WhatsApp channel. Complete Embedded Signup first.');
    }

    const { channelId, wabaId, accessToken } = creds;
    if (!wabaId || !accessToken || !channelId) {
      throw new BadRequestException('WhatsApp channel missing WABA ID or access token');
    }

    const result = await this.templateService.createTemplate(
      schemaName,
      channelId,
      wabaId,
      accessToken,
      {
        name: body.name,
        language: body.language as any,
        category: body.category,
        components: body.components as any,
      },
    );

    return { success: true, data: result };
  }

  // ======================== MESSAGING ========================

  @Post('send/template')
  @RequiresVerifiedEmail('send_outbound')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'tenant_admin', 'tenant_agent')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enviar mensaje de plantilla pre-aprobada' })
  async sendTemplate(@Request() req: any, @Body() body: {
    toPhone: string;
    templateName: string;
    language: string;
    components?: any[];
    /**
     * Which of the tenant's numbers sends, and therefore which WhatsApp
     * Business Account Meta bills.
     *
     * Optional: a tenant with one number does not have to say. With several and
     * none named, the send is REFUSED rather than charged to whichever
     * connected first — the money goes to a real account and nobody may choose
     * it by row order.
     */
    phoneNumberId?: string;
    /** @deprecated The old name on three of these five routes. See `senderOf`. */
    fromPhoneNumberId?: string;
    /** What makes this send distinct. See the header comment of this file. */
    idempotencyKey?: string;
  }, @Headers('idempotency-key') headerKey?: string) {
    return this.dispatchRest(req, body, headerKey, {
      kind: 'template',
      payload: {
        templateName: String(body.templateName ?? ''),
        language: String(body.language ?? ''),
        components: Array.isArray(body.components) ? body.components : [],
      },
    });
  }

  @Post('send/text')
  @RequiresVerifiedEmail('send_outbound')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'tenant_admin', 'tenant_agent')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enviar mensaje de texto simple' })
  async sendText(@Request() req: any, @Body() body: {
    toPhone: string;
    text: string;
    conversationId?: string;
    /**
     * Which of the tenant's numbers sends, and therefore which WhatsApp
     * Business Account Meta bills.
     *
     * Optional: a tenant with one number does not have to say. With several and
     * none named, the send is REFUSED rather than charged to whichever
     * connected first — the money goes to a real account and nobody may choose
     * it by row order.
     */
    phoneNumberId?: string;
    /** @deprecated The old name on three of these five routes. See `senderOf`. */
    fromPhoneNumberId?: string;
    /** What makes this send distinct. See the header comment of this file. */
    idempotencyKey?: string;
  }, @Headers('idempotency-key') headerKey?: string) {
    return this.dispatchRest(req, body, headerKey,
      { kind: 'text', payload: { text: String(body.text ?? '') } });
  }

  @Post('send/interactive')
  @RequiresVerifiedEmail('send_outbound')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'tenant_admin', 'tenant_agent')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enviar mensaje interactivo (botones / listas)' })
  async sendInteractive(@Request() req: any, @Body() body: {
    toPhone: string;
    interactive: any;
    conversationId?: string;
    /**
     * Which of the tenant's numbers sends, and therefore which WhatsApp
     * Business Account Meta bills.
     *
     * Optional: a tenant with one number does not have to say. With several and
     * none named, the send is REFUSED rather than charged to whichever
     * connected first — the money goes to a real account and nobody may choose
     * it by row order.
     */
    phoneNumberId?: string;
    /** @deprecated The old name on three of these five routes. See `senderOf`. */
    fromPhoneNumberId?: string;
    /** What makes this send distinct. See the header comment of this file. */
    idempotencyKey?: string;
  }, @Headers('idempotency-key') headerKey?: string) {
    // The menu is not flattened into text anywhere on this path. A list that
    // arrives as prose loses the tap, and the tap is what makes the customer's
    // next message unambiguous — so an unusable shape is refused downstream
    // rather than downgraded here.
    return this.dispatchRest(req, body, headerKey,
      { kind: 'interactive', payload: interactiveDispatchPayload(body.interactive) });
  }

  @Post('send/media')
  @RequiresVerifiedEmail('send_outbound')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'tenant_admin', 'tenant_agent')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enviar multimedia (imagen, audio, documento, video)' })
  async sendMedia(@Request() req: any, @Body() body: {
    toPhone: string;
    mediaType: 'image' | 'audio' | 'document' | 'video';
    mediaUrl: string;
    caption?: string;
    filename?: string;
    conversationId?: string;
    /**
     * Which of the tenant's numbers sends, and therefore which WhatsApp
     * Business Account Meta bills.
     *
     * Optional: a tenant with one number does not have to say. With several and
     * none named, the send is REFUSED rather than charged to whichever
     * connected first — the money goes to a real account and nobody may choose
     * it by row order.
     */
    phoneNumberId?: string;
    /** @deprecated The old name on three of these five routes. See `senderOf`. */
    fromPhoneNumberId?: string;
    /** What makes this send distinct. See the header comment of this file. */
    idempotencyKey?: string;
  }, @Headers('idempotency-key') headerKey?: string) {
    return this.dispatchRest(req, body, headerKey, {
      kind: 'media',
      payload: {
        mediaType: String(body.mediaType ?? 'image'),
        mediaUrl: String(body.mediaUrl ?? ''),
        ...(body.caption ? { caption: String(body.caption) } : {}),
        ...(body.filename ? { filename: String(body.filename) } : {}),
      },
    });
  }

  @Post('send/location')
  @RequiresVerifiedEmail('send_outbound')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('super_admin', 'tenant_admin', 'tenant_agent')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enviar ubicación' })
  async sendLocation(@Request() req: any, @Body() body: {
    toPhone: string;
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
    conversationId?: string;
    /**
     * Which of the tenant's numbers sends, and therefore which WhatsApp
     * Business Account Meta bills.
     *
     * Optional: a tenant with one number does not have to say. With several and
     * none named, the send is REFUSED rather than charged to whichever
     * connected first — the money goes to a real account and nobody may choose
     * it by row order.
     */
    phoneNumberId?: string;
    /** @deprecated The old name on three of these five routes. See `senderOf`. */
    fromPhoneNumberId?: string;
    /** What makes this send distinct. See the header comment of this file. */
    idempotencyKey?: string;
  }, @Headers('idempotency-key') headerKey?: string) {
    return this.dispatchRest(req, body, headerKey, {
      kind: 'location',
      payload: {
        latitude: Number(body.latitude),
        longitude: Number(body.longitude),
        ...(body.name ? { name: String(body.name) } : {}),
        ...(body.address ? { address: String(body.address) } : {}),
      },
    });
  }

  /**
   * Commit one REST send on the durable lane, and say what happened to it.
   *
   * The order is deliberate and every step can refuse:
   *
   *   1. the tenant, from the authenticated request;
   *   2. the PAYING NUMBER — named, or resolved only while there is exactly
   *      one and refused otherwise. This is the money, so it is never guessed;
   *   3. the recipient, cleaned the way Meta wants it;
   *   4. the thread — the exact conversation and contact the effect belongs to,
   *      because the lane records the outbound in `messages` and a message
   *      belongs to a conversation;
   *   5. the AUTHORITY of the real acting person, which is `undefined` when
   *      they may no longer send from this connection;
   *   6. the identity of the effect, so a retry collides on one row.
   *
   * Only `prepared` and `already_present` are success. Everything else is
   * reported as a failure with the lane's own reason: a route that answers 200
   * when nothing durable was written is the defect this programme exists to
   * remove.
   */
  private async dispatchRest(
    req: any,
    body: {
      toPhone?: string; conversationId?: string;
      phoneNumberId?: string; fromPhoneNumberId?: string; idempotencyKey?: string;
    },
    headerKey: string | undefined,
    item: DispatchItem & { kind: WhatsappRestItemKind },
  ): Promise<WhatsappRestSendResult> {
    const schemaName = await this.resolveSchema(req);
    const tenantId = String(req?.user?.tenantId ?? '').trim();
    if (!schemaName || !tenantId) throw new BadRequestException('User does not belong to a tenant');
    if (!this.dispatch) {
      // No silent fall back to the inline POST. A message that leaves with no
      // row is exactly what this route stopped doing, and a degraded mode that
      // quietly restores it would make the guarantee unprovable.
      throw new BadRequestException('El carril durable no está disponible; no se envió nada.');
    }
    const recipient = restRecipient(body.toPhone);
    if (!recipient) throw new BadRequestException('toPhone es obligatorio');

    // Refuses with `connection_ambiguous` when the tenant has more than one
    // sendable number and the caller named none. An HttpException, so the
    // status and the code reach the caller unchanged.
    const connection = await this.channelToken.getWhatsAppToken(tenantId, this.senderOf(body));
    const channelAccountId = String(connection.phoneNumberId);

    const thread = await this.threadFor(schemaName, recipient, channelAccountId, body.conversationId);

    const userId = realActingUserId(req?.user);
    const operationalScope = await this.dispatch.operatorAuthority(schemaName, {
      tenantId, userId, surface: 'tenant_api',
      channelType: 'whatsapp', channelAccountId,
    });
    if (!operationalScope) {
      // Deactivated, demoted, moved or gone. There is nobody to attribute the
      // message to, and a message with no attributable sender is what the
      // outbox exists to refuse — so it is refused here, before a row.
      throw new UnauthorizedException(
        'Quien pide el envío ya no puede enviar desde esta conexión.');
    }

    const supplied = String(body.idempotencyKey ?? headerKey ?? '').trim();
    const originKey = supplied
      ? `wa_rest:${tenantId}:${channelAccountId}:${supplied}`
      : derivedRestIdempotencyKey({
        tenantId, channelAccountId, recipient, kind: item.kind, payload: item.payload,
      });

    const result = await this.dispatch.send(tenantId, {
      originKey,
      conversationId: thread.conversationId,
      contactId: thread.contactId,
      channelType: 'whatsapp',
      channelAccountId,
      recipient,
      items: [item],
      operationalScope,
      // An API send answers nothing: the business started it. Billing it as a
      // reply would misprice it and let it past a ceiling meant for campaigns.
      originKind: 'proactive',
    });
    if (!committed(result)) {
      this.logger.warn(`[WA REST] ${item.kind} to ${recipient} from ${channelAccountId} was `
        + `${result.kind}: ${result.reason}`);
      throw new BadRequestException(
        `El envío no se registró (${result.kind}): ${result.reason}`);
    }
    return {
      success: true,
      status: result.kind,
      originId: result.originId,
      duplicate: result.kind === 'already_present',
      phoneNumberId: channelAccountId,
      conversationId: thread.conversationId,
    };
  }

  /**
   * The exact conversation and contact this effect belongs to.
   *
   * A caller may name the conversation, and then it is READ rather than
   * trusted: its contact is the contact, and a thread on another connection or
   * another channel is refused instead of written into. Without one, the
   * contact is found or created by the channel's own identifier — for WhatsApp
   * that is the phone number — and the lane picks the live thread on this
   * number, or opens one.
   *
   * `phone_normalized` is deliberately left null on a contact created here.
   * That column is what crosses identities between channels, and inventing a
   * country for a number written without a prefix merges two different people
   * with no way to undo it. A missed match is fixable; a merge is not.
   */
  private async threadFor(
    schemaName: string, recipient: string, channelAccountId: string, conversationId?: string,
  ): Promise<{ conversationId: string; contactId: string }> {
    if (conversationId && /^[0-9a-f-]{36}$/i.test(conversationId)) {
      const [row] = await this.prisma.executeInTenantSchema<any[]>(schemaName,
        `SELECT contact_id, channel_type, channel_account_id
           FROM conversations WHERE id = $1::uuid`, [conversationId]);
      if (!row) throw new BadRequestException('La conversación indicada no existe.');
      if (row.channel_type !== 'whatsapp' || String(row.channel_account_id) !== channelAccountId) {
        throw new BadRequestException(
          'La conversación indicada pertenece a otra conexión; no se envió nada.');
      }
      if (!row.contact_id) throw new BadRequestException('La conversación no tiene contacto.');
      return { conversationId, contactId: String(row.contact_id) };
    }
    const contactId = await this.contactFor(schemaName, recipient);
    const resolved = await this.dispatch!.conversationFor(schemaName, {
      contactId, channelType: 'whatsapp', channelAccountId,
    });
    if (!resolved) {
      throw new BadRequestException('No se pudo abrir la conversación; no se envió nada.');
    }
    return { conversationId: resolved, contactId };
  }

  /**
   * The contact behind a number, created once.
   *
   * `ON CONFLICT DO NOTHING` on the channel identity, then a read: two requests
   * for the same new customer arriving together must not become two contacts,
   * and the unique index is what decides rather than a read-then-insert that
   * both would lose.
   */
  private async contactFor(schemaName: string, recipient: string): Promise<string> {
    const [created] = await this.prisma.executeInTenantSchema<any[]>(schemaName,
      `INSERT INTO contacts (external_id, channel_type, name, phone)
       VALUES ($1, 'whatsapp', 'Unknown', $1)
       ON CONFLICT (channel_type, external_id) DO NOTHING RETURNING id`, [recipient]);
    if (created?.id) return String(created.id);
    const [existing] = await this.prisma.executeInTenantSchema<any[]>(schemaName,
      `SELECT id FROM contacts WHERE channel_type = 'whatsapp' AND external_id = $1`, [recipient]);
    if (!existing?.id) throw new BadRequestException('No se pudo resolver el contacto destino.');
    return String(existing.id);
  }

  /**
   * ═══ ONE NAME FOR THE NUMBER THAT PAYS ═══
   *
   * These five routes send the same kind of thing and named the sender two
   * different ways: `phoneNumberId` on template and text, `fromPhoneNumberId`
   * on interactive, media and location. Nothing rejected the wrong one — an
   * unknown field in a JSON body is simply ignored — so a caller that used the
   * name from the route next door sent with NO sender named. On a
   * single-number tenant that worked, which is why it survived; on a tenant
   * with two it is either a refusal or, before the resolver started refusing, a
   * message from the wrong number billed to the wrong WABA.
   *
   * `phoneNumberId` is canonical. `fromPhoneNumberId` is still accepted because
   * an integration may be using it and a silent behaviour change is exactly
   * what this is fixing, but it is deprecated and both routes now mean the same
   * thing on all five.
   *
   * Deliberately NOT a merge of the two: if a caller sends both and they
   * disagree, there is no defensible way to pick, and picking would be the
   * original defect with extra steps.
   */
  private senderOf(body: { phoneNumberId?: string; fromPhoneNumberId?: string }): string | undefined {
    const canonical = String(body?.phoneNumberId ?? '').trim();
    const legacy = String(body?.fromPhoneNumberId ?? '').trim();
    if (canonical && legacy && canonical !== legacy) {
      throw new BadRequestException(
        'phoneNumberId y fromPhoneNumberId nombran números distintos. `fromPhoneNumberId` '
        + 'está obsoleto: manda sólo `phoneNumberId`.');
    }
    return canonical || legacy || undefined;
  }

  // ======================== WEBHOOKS ========================

  @Get('webhook')
  @ApiOperation({ summary: 'Verify Meta webhook' })
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    return this.webhookService.verifyWebhook(mode, token, challenge);
  }

  @Post('webhook')
  @ApiOperation({ summary: 'Receive messages and status from Meta' })
  async handleWebhook(
    @Body() payload: any,
    @Headers('x-hub-signature-256') signature: string,
    @Req() req: RawBodyRequest<ExpressRequest>,
  ) {
    if (!this.webhookService.validateSignature(req.rawBody, signature)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    // Encolar ANTES de confirmar. Ver el comentario extenso en
    // channels.controller (webhook/whatsapp): un 200 antes del `queue.add`
    // convierte un reinicio en un mensaje perdido, porque Meta no reintenta lo
    // confirmado. Al fallar se deja propagar el error → 500 → Meta reintenta.
    await this.webhookService.handleWebhookPayload(payload);
    return 'EVENT_RECEIVED';
  }
}

