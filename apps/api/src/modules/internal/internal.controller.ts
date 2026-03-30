import { Controller, Post, Body, UseGuards, Logger } from '@nestjs/common';
import { ConversationsService } from '../conversations/conversations.service';
import { NormalizedMessage } from '@parallext/shared';
import { InternalAuthGuard } from '../../common/guards/internal-auth.guard';

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

  constructor(private readonly conversationsService: ConversationsService) {}

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
}
