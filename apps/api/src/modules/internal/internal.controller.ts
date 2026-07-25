import { Controller, Post, Body, UseGuards, Logger } from '@nestjs/common';
import { NormalizedMessage } from '@parallext/shared';
import { InternalAuthGuard } from '../../common/guards/internal-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { InboundQueueService } from '../inbound/inbound-queue.service';

/**
 * Internal endpoints — callable by trusted internal microservices (via
 * x-internal-key) **or** by authenticated dashboard users (via JWT).
 *
 * Protected by InternalAuthGuard (dual-auth: API key OR JWT).
 */
@Controller('internal')
@UseGuards(InternalAuthGuard)
export class InternalController {
  private readonly logger = new Logger(InternalController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly throttle: TenantThrottleService,
    private readonly inboundQueue: InboundQueueService,
  ) {}

  /**
   * Receives a normalized message from the WhatsApp microservice and
   * routes it through the full AI conversation pipeline.
   *
   * Called by: apps/whatsapp/src/modules/jobs/webhook.processor.ts
   */
  @Post('inbound-message')
  async receiveInboundMessage(@Body() payload: NormalizedMessage) {
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
    @Body() body: { tenantId: string; channelType: string; excludeAccountId?: string },
  ) {
    const { tenantId, channelType, excludeAccountId } = body;
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
}
