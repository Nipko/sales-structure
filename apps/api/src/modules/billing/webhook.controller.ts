import { Controller, Headers, HttpCode, Logger, NotImplementedException, Param, Post, Req } from '@nestjs/common';
import { Request } from 'express';

/**
 * Provider webhook receiver.
 *
 * IMPORTANT for Sprint 2+: webhook signature verification requires the raw
 * request body, not the JSON-parsed one. Configure a raw-body route in
 * main.ts (or use a global rawBody middleware scoped to /billing/webhook/*)
 * before MercadoPago/Stripe adapters start verifying signatures in prod.
 *
 * Scope of this file during Sprint 1.2: route stub only. Signature verification
 * + idempotency check + BillingService.handleBillingEvent dispatch land in
 * Sprint 2.
 */
@Controller('billing/webhook')
export class BillingWebhookController {
    private readonly logger = new Logger(BillingWebhookController.name);

    @Post(':provider')
    @HttpCode(200)
    async receive(
        @Param('provider') provider: string,
        @Headers() headers: Record<string, string>,
        @Req() req: Request,
    ) {
        this.logger.warn(`[Webhook] Received ${provider} webhook — handler not wired yet (Sprint 2)`);
        // Intentionally 200 so providers don't retry into a black hole while
        // the handler is unimplemented. The adapter contract (Sprint 2) will
        // replace this with verify → idempotency check → dispatch.
        if (!['mercadopago', 'stripe', 'mock'].includes(provider)) {
            throw new NotImplementedException({ error: 'unknown_provider', provider });
        }
        return { received: true };
    }
}
