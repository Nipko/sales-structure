import { Controller, Post, Body, UseGuards, Logger } from '@nestjs/common';
import { ConversationsService } from '../conversations/conversations.service';
import { NormalizedMessage } from '@parallext/shared';
import { InternalAuthGuard } from '../../common/guards/internal-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';

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
    private readonly conversationsService: ConversationsService,
    private readonly prisma: PrismaService,
    private readonly throttle: TenantThrottleService,
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

    // Fire-and-forget — respond 200 immediately, process async
    this.conversationsService
      .processIncomingMessage(payload)
      .catch((err) =>
        this.logger.error(
          `[Internal] Error processing inbound message: ${err.message}`,
        ),
      );

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
