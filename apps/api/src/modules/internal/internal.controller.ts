import { Controller, Post, Body, Headers, UnauthorizedException, Logger } from '@nestjs/common';
import { ConversationsService } from '../conversations/conversations.service';
import { NormalizedMessage } from '@parallext/shared';

/**
 * Internal endpoints — only callable by trusted internal microservices.
 * Protected by INTERNAL_JWT_SECRET shared header.
 */
@Controller('internal')
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
  async receiveInboundMessage(
    @Body() payload: NormalizedMessage,
    @Headers('x-internal-secret') secret: string,
  ) {
    const expectedSecret = process.env.INTERNAL_JWT_SECRET;
    if (!expectedSecret || secret !== expectedSecret) {
      throw new UnauthorizedException('Invalid internal secret');
    }

    this.logger.log(`[Internal] Received inbound message for tenant ${payload.tenantId} from ${payload.contactId}`);

    // Fire-and-forget — respond 200 immediately, process async
    this.conversationsService.processIncomingMessage(payload).catch((err) =>
      this.logger.error(`[Internal] Error processing inbound message: ${err.message}`)
    );

    return { received: true };
  }
}
