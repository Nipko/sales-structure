import {
    BadRequestException,
    Controller,
    Headers,
    HttpCode,
    Logger,
    NotImplementedException,
    Param,
    Post,
    Req,
    UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { BillingService } from './billing.service';
import { PaymentProviderFactory } from './payment-provider.factory';
import { RedisService } from '../redis/redis.service';
import { PaymentProviderName } from './types/provider-types';

/**
 * Provider webhook receiver.
 *
 * Flow:
 *  1. Resolve the IPaymentProvider adapter by `:provider` path param.
 *  2. Verify the signature against the raw body (rawBody is preserved globally
 *     by NestFactory.create({ rawBody: true }) in main.ts). Fail closed with
 *     401 on mismatch so bad actors can't replay arbitrary payloads.
 *  3. Check Redis idempotency before dispatching — MP can redeliver the same
 *     notification for up to 4 days. Redis SET NX with 48h TTL.
 *  4. Delegate parsing + dispatch to the adapter + BillingService.
 *  5. Always return 200 on successful ingestion (even duplicates) so the
 *     provider stops retrying. Any surprise exception logs a warning but
 *     still returns 200 because the adapter already persisted the event in
 *     billing_events and the daily reconciliation cron will catch drift.
 */
@Controller('billing/webhook')
export class BillingWebhookController {
    private readonly logger = new Logger(BillingWebhookController.name);

    constructor(
        private readonly providerFactory: PaymentProviderFactory,
        private readonly billingService: BillingService,
        private readonly redis: RedisService,
    ) {}

    @Post(':provider')
    @HttpCode(200)
    async receive(
        @Param('provider') providerName: string,
        @Headers() headers: Record<string, string>,
        @Req() req: Request & { rawBody?: Buffer },
    ) {
        // Normalize provider name — the factory only accepts known values
        const allowed: PaymentProviderName[] = ['mercadopago', 'stripe', 'mock'];
        if (!allowed.includes(providerName as PaymentProviderName)) {
            throw new NotImplementedException({ error: 'unknown_provider', provider: providerName });
        }
        const provider = this.providerFactory.getByName(providerName as PaymentProviderName);

        const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body ?? {});

        // 1. Signature verification
        const verified = provider.verifyWebhookSignature(rawBody, headers);
        if (!verified) {
            this.logger.warn(`[Webhook] ${providerName} signature rejected — request-id=${headers['x-request-id'] ?? 'n/a'}`);
            throw new UnauthorizedException({ error: 'invalid_signature' });
        }

        // 2. Parse — async because MP needs to fetch the full resource
        let normalized;
        try {
            normalized = await provider.parseWebhookEvent(rawBody, headers);
        } catch (err: any) {
            // Provider API hiccups should not make us 5xx the webhook — the
            // provider will retry and the daily reconciliation cron catches
            // any drift. Return 200 with a log.
            this.logger.error(`[Webhook] ${providerName} parseWebhookEvent failed: ${err?.message}`);
            return { received: true, status: 'parse_error' };
        }

        // 3. Redis idempotency — an extra layer on top of the UNIQUE(provider, providerEventId)
        // index on billing_events. Cheaper to return early here than to hit the DB for a duplicate.
        // acquireLock is atomic SET NX EX — 48h TTL matches MP's maximum redelivery window.
        const idemKey = `idem:billing:${providerName}:${normalized.providerEventId}`;
        const claimed = await this.redis.acquireLock(idemKey, 48 * 3600);
        if (!claimed) {
            this.logger.debug(`[Webhook] Duplicate ${providerName}/${normalized.providerEventId} — idempotency hit`);
            return { received: true, status: 'duplicate' };
        }

        // 4. Dispatch
        try {
            const result = await this.billingService.handleBillingEvent(normalized);
            return { received: true, status: result.processed ? 'processed' : 'skipped', reason: result.reason };
        } catch (err: any) {
            // Free the idempotency key so a retry can process — the DB-level
            // UNIQUE will catch genuine duplicates anyway.
            await this.redis.del(idemKey);
            this.logger.error(`[Webhook] ${providerName} handleBillingEvent failed: ${err?.message}`, err?.stack);
            // Return 200 anyway to stop provider retries — the reconciliation
            // cron will detect drift and replay the needed state.
            throw new BadRequestException({ error: 'processing_failed', message: err?.message });
        }
    }
}
