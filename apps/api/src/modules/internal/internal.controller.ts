import {
  BadRequestException,
  Body,
  Optional,
  Controller,
  ForbiddenException,
  Logger,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { NormalizedMessage } from '@parallext/shared';
import { InternalAuthGuard } from '../../common/guards/internal-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { InboundQueueService } from '../inbound/inbound-queue.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AGENT_QUALITY_DEPENDENCIES_UPDATED } from '../quality/agent-quality-events';
import { resolveTenantSubscriptionAccess } from '../../common/utils/subscription-entitlement.util';
import {
  isDeliveryStatus,
  namespaceProviderErrorCode,
  parseProviderPricing,
  recordChannelDeliveryStatuses,
} from '../channels/channel-delivery-status';
import { WhatsappSpendService } from '../billing/whatsapp-spend/whatsapp-spend.service';
import { DISPATCH_PROVIDER_STATUSES } from '../channels/agent-dispatch-outbox';
import { recordChannelConnected } from '../channels/bind-default-agent.util';

/**
 * Internal endpoints — callable only by trusted internal microservices via
 * x-internal-key. Dashboard JWTs are rejected at the guard and asserted again
 * at each handler as defense in depth.
 *
 * Protected by InternalAuthGuard (internal API key only).
 */
@Controller('internal')
@UseGuards(InternalAuthGuard)
export class InternalController {
  private readonly logger = new Logger(InternalController.name);
  private readonly tenantIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  constructor(
    private readonly prisma: PrismaService,
    private readonly throttle: TenantThrottleService,
    private readonly inboundQueue: InboundQueueService,
    private readonly events: EventEmitter2,
    // The deployed `whatsapp` service posts its receipts here, so this ingress
    // reaches the same ledger as the API's own webhook. One rule, one place —
    // and a receipt that arrives by this road settles the same reservation.
    private readonly spendLedger: WhatsappSpendService,
  ) {}

  /**
   * Receives a normalized message from the WhatsApp microservice and
   * routes it through the full AI conversation pipeline.
   *
   * Called by: apps/whatsapp/src/modules/jobs/webhook.processor.ts
   */
  @Post('inbound-message')
  async receiveInboundMessage(
    @Req() request: { user?: { isInternalService?: boolean } },
    @Body() payload: NormalizedMessage,
    ) {
    this.assertInternalService(request);
    this.assertTenantId(payload?.tenantId);
    // La coexistencia reenvía por acá los SALIENTES de solo-guardado: los echos
    // del celular del negocio (`waba_echo`) y el backfill histórico
    // (`historical`), que processIncomingMessage ya desvía a storeOnlyMessage.
    // Exigir direction==='inbound' los rechazaba con 400 → 8 reintentos → failed:
    // los mensajes que el dueño manda desde su teléfono nunca aparecían en el
    // inbox, y la mitad saliente del histórico tampoco. El destino ya existía y
    // estaba probado; lo único que faltaba era dejarlos entrar.
    const storeOnlySource = (payload?.metadata as any)?.source;
    const isStoreOnly = storeOnlySource === 'waba_echo' || storeOnlySource === 'historical';
    const directionOk = payload?.direction === 'inbound'
      || (payload?.direction === 'outbound' && isStoreOnly);
    if (
      !directionOk
      || typeof payload.id !== 'string'
      || typeof payload.contactId !== 'string'
      || typeof payload.conversationId !== 'string'
      || typeof payload.channelAccountId !== 'string'
      || !['whatsapp', 'instagram', 'messenger'].includes(payload.channelType)
      || !payload.content
      || typeof payload.content !== 'object'
    ) {
      throw new BadRequestException('Invalid normalized inbound message');
    }
    await this.assertSubscriptionWriteAccess(payload.tenantId);
    this.logger.log(
      `[Internal] Received inbound message for tenant ${payload.tenantId} from ${payload.contactId}`,
    );

    // Enqueue, THEN ack. This used to be a floating promise behind an immediate
    // {received:true}: an API restart mid-turn killed the AI reply with nothing
    // left to retry, and the WhatsApp service — already ACKed — considered the
    // message delivered. Now the job is durable in Redis before we answer, and
    // a failing add() returns 500 so the caller's BullMQ job retries (it
    // re-throws on non-2xx, with 8 attempts of exponential backoff).
    await this.inboundQueue.enqueue(payload);

    return { received: true };
  }

  /**
   * Plan gate for connecting an additional account of a channel type — used by
   * the WhatsApp microservice's Embedded Signup so ESU honors the same
   * maxChannelAccounts limit as the dashboard connect flows. Reuses the single
   * source of truth (TenantThrottleService), including per-tenant overrides.
   *
   * Throws 403 { error: 'plan_limit_reached', ... } when over quota.
   *
   * Called by: apps/whatsapp onboarding.service (before registering the number).
   */
  @Post('channel-account-quota-check')
  async channelAccountQuotaCheck(
    @Req() request: { user?: { isInternalService?: boolean } },
    @Body() body: { tenantId: string; channelType: string; excludeAccountId?: string },
  ) {
    this.assertInternalService(request);
    const { tenantId, channelType, excludeAccountId } = body;
    this.assertTenantId(tenantId);
    if (!['whatsapp', 'instagram', 'messenger', 'telegram', 'web_widget'].includes(channelType)) {
      throw new BadRequestException('Unsupported conversational channel type');
    }
    if (excludeAccountId !== undefined && (typeof excludeAccountId !== 'string' || excludeAccountId.length > 255)) {
      throw new BadRequestException('Invalid excludeAccountId');
    }
    await this.assertSubscriptionWriteAccess(tenantId);
    const existingActive = await this.prisma.channelAccount.count({
      where: {
        tenantId,
        channelType,
        isActive: true,
        ...(excludeAccountId ? { accountId: { not: excludeAccountId } } : {}),
      },
    });
    // Throws 403 plan_limit_reached when the additional account would exceed the plan.
    await this.throttle.enforceChannelAccountLimit(tenantId, channelType, existingActive);
    return { allowed: true };
  }

  /**
   * What the provider later said about one outbound message.
   *
   * The deployed WhatsApp ingress is the `whatsapp` service, not this API, and
   * it was deciding these events with its own SQL: it looked the receipt up in
   * `messages.external_id` (our deduplication identity, never the wamid), it
   * ranked `failed` above `delivered`, and it set an `updated_at` column
   * `messages` has never had — so every write raised 42703 into a catch and no
   * status was ever recorded, for any producer. The worker now hands the event
   * here and this side owns the rule, keyed on the connection plus the receipt.
   *
   * Deliberately not gated on the subscription: this records an effect that has
   * already happened. Refusing it would freeze a lapsed tenant's inbox on
   * "Sent" and make the caller's job retry something that can never succeed.
   *
   * Called by: apps/whatsapp/src/modules/jobs/webhook.processor.ts
   */
  @Post('channel-delivery-status')
  async channelDeliveryStatus(
    @Req() request: { user?: { isInternalService?: boolean } },
    @Body() body: {
      tenantId: string;
      channelType: string;
      channelAccountId: string;
      providerMessageId: string;
      status: string;
      errorCode?: string | number | null;
      errorDetail?: string | null;
      recipient?: string | null;
      pricing?: unknown;
    },
  ) {
    this.assertInternalService(request);
    this.assertTenantId(body?.tenantId);
    if (!['whatsapp', 'instagram', 'messenger', 'telegram', 'web_widget'].includes(body?.channelType)) {
      throw new BadRequestException('Unsupported conversational channel type');
    }
    if (typeof body.channelAccountId !== 'string' || !body.channelAccountId.trim()
      || body.channelAccountId.length > 255) {
      throw new BadRequestException('A valid channelAccountId is required');
    }
    // 300 is the receipt ceiling the outbox itself enforces; refusing here keeps
    // the caller's job from retrying a value that can never resolve.
    if (typeof body.providerMessageId !== 'string' || !body.providerMessageId.trim()
      || body.providerMessageId.length > 300) {
      throw new BadRequestException('A valid providerMessageId is required');
    }
    if (!isDeliveryStatus(body.status)) {
      throw new BadRequestException(
        `Unsupported delivery status — expected one of ${DISPATCH_PROVIDER_STATUSES.join(', ')}`,
      );
    }
    if (body.errorCode !== undefined && body.errorCode !== null
      && !['string', 'number'].includes(typeof body.errorCode)) {
      throw new BadRequestException('Invalid errorCode');
    }

    const report = await recordChannelDeliveryStatuses(
      [{
        providerMessageId: body.providerMessageId.trim(),
        status: body.status,
        recipient: typeof body.recipient === 'string' ? body.recipient : null,
        errorCode: namespaceProviderErrorCode(body.channelType, body.errorCode ?? null),
        // Meta's own words behind a generic code — the payment problem is
        // sometimes explained in prose and numbered generically.
        errorDetail: typeof body.errorDetail === 'string' ? body.errorDetail.slice(0, 400) : null,
        // Meta's own `pricing` block, forwarded verbatim by the worker when it
        // has one. `billable: false` is the single authority that can settle a
        // delivered message at zero, so it must survive the hop.
        pricing: parseProviderPricing(body.pricing),
      }],
      {
        channelType: body.channelType,
        channelAccountId: body.channelAccountId,
        tenantId: body.tenantId,
      },
      {
        store: this.prisma,
        logger: this.logger,
        resolveSchema: async () => {
          const tenant = await this.prisma.tenant.findUnique({
            where: { id: body.tenantId },
            select: { schemaName: true },
          });
          return tenant?.schemaName || null;
        },
        // ── THE HALF THAT WAS NEVER CONNECTED ───────────────────────────────
        //
        // `wa.parallly-chat.cloud` is what Meta posts to, so this endpoint —
        // not the API's own webhook — is where the platform's receipts actually
        // land. It was injected into the constructor and never handed to the
        // writer, so on the deployed road `delivered` settled nothing, `failed`
        // released nothing, and a late `131042` paused no number. The test that
        // was supposed to catch it searched this FILE for the word.
        spendLedger: this.spendLedger,
      },
    );
    const [result] = report.results;
    // The caller owns a retryable BullMQ job, so an unreadable record must come
    // back as a failure. A record that refused the event is a decision, not one.
    if (report.unavailable) {
      throw new ServiceUnavailableException({
        error: 'delivery_status_unavailable',
        message: 'The conversation record could not be read for this receipt.',
      });
    }
    return { applied: result.applied, reason: result.reason };
  }

  /**
   * Cross-process bridge used after WhatsApp Embedded Signup commits.
   *
   * Embedded Signup runs in the `whatsapp` service and writes `channel_accounts`
   * itself, so none of the API's connect paths ever ran for the connection the
   * dashboard actually uses. This bridge only emitted a quality event, and the
   * result was the 14-sep recording: WhatsApp "conectado", the default agent
   * (born with no channels) never assigned to it, `channel_assignment` still a
   * critical failure and the setup card still asking to "asignar un canal".
   *
   * So the connection is recorded here — first-connection instant, default
   * agent assignment, onboarding stage — BEFORE the quality event, so the
   * reconcile it triggers reads the assignment instead of the state before it.
   *
   * Never fails because of that: the number is already connected when this is
   * called, and a 5xx here would only be logged by the caller.
   */
  @Post('agent-quality-channel-updated')
  async agentQualityChannelUpdated(
    @Req() request: { user?: { isInternalService?: boolean } },
    @Body() body: { tenantId: string; channelType?: string; accountId?: string },
  ) {
    // Keep a handler-level assertion as defense in depth in case guard wiring
    // changes in the future.
    this.assertInternalService(request);
    this.assertTenantId(body?.tenantId);
    await this.recordEmbeddedSignupConnection(body.tenantId, body);
    this.events.emit(AGENT_QUALITY_DEPENDENCIES_UPDATED, {
      tenantId: body.tenantId,
      source: 'channel_credential',
    });
    return { accepted: true };
  }

  /**
   * Record a WhatsApp connection the `whatsapp` service just committed.
   *
   * "Now connected" is READ, never taken on the caller's word: the bridge is
   * also a generic "something about a channel changed" signal, and binding an
   * agent to a number that is not live would be the platform claiming a
   * connection nobody has. An active `channel_accounts` row is the same fact
   * setup-status counts as "a channel exists".
   *
   * `channelType` absent means an older `whatsapp` build that posts only the
   * tenant id; this bridge has only ever carried WhatsApp, so that is what it
   * means. Anything else is not this bridge's to record.
   */
  private async recordEmbeddedSignupConnection(
    tenantId: string,
    body: { channelType?: unknown; accountId?: unknown },
  ): Promise<void> {
    try {
      const channelType = typeof body?.channelType === 'string' && body.channelType.trim()
        ? body.channelType.trim()
        : 'whatsapp';
      if (channelType !== 'whatsapp') return;
      const accountId = typeof body?.accountId === 'string' && body.accountId.trim()
        ? body.accountId.trim()
        : null;
      const live = await this.prisma.channelAccount.findFirst({
        where: {
          tenantId,
          channelType: 'whatsapp',
          isActive: true,
          ...(accountId ? { accountId } : {}),
        },
        select: { id: true },
      });
      if (!live) {
        this.logger.warn(`[ESU] No active WhatsApp connection for tenant=${tenantId}`
          + `${accountId ? ` account=${accountId}` : ''}; nothing recorded`);
        return;
      }
      const { bound } = await recordChannelConnected(this.prisma, tenantId, 'whatsapp');
      this.logger.log(`[ESU] WhatsApp connection recorded for tenant=${tenantId}`
        + (bound ? ' (default agent assigned)' : ''));
    } catch (error: any) {
      // `recordChannelConnected` does not throw; the read above can. Either
      // way the connection already exists and the next one repairs this.
      this.logger.warn(`[ESU] Could not record the WhatsApp connection for tenant=${tenantId}: `
        + `${error?.message}`);
    }
  }

  private assertInternalService(request: { user?: { isInternalService?: boolean } }): void {
    if (request.user?.isInternalService !== true) {
      throw new ForbiddenException('Internal service authentication required');
    }
  }

  private async assertSubscriptionWriteAccess(tenantId: string): Promise<void> {
    const access = await resolveTenantSubscriptionAccess(this.prisma, tenantId, 'write');
    if (access.allowed) return;
    const response = {
      error: access.error,
      restrictionLevel: access.restrictionLevel,
      message: 'Tenant subscription does not allow operational channel work.',
    };
    if (access.restrictionLevel === 'unavailable') {
      throw new ServiceUnavailableException(response);
    }
    throw new ForbiddenException(response);
  }

  private assertTenantId(tenantId: unknown): asserts tenantId is string {
    if (typeof tenantId !== 'string' || !this.tenantIdPattern.test(tenantId)) {
      throw new BadRequestException('A valid tenantId is required');
    }
  }
}
