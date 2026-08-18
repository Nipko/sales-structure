import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { RedisService } from '../redis/redis.service';

interface TenantPaymentValidationFailedEvent {
    tenantId: string;
    provider: string;
    providerPaymentId?: string;
    providerLinkId?: string;
    canonicalReference?: string;
    reason?: string;
}

/**
 * The webhooks emit `tenant_payment.validation_failed` whenever the ledger
 * refuses to settle a payment — the amount changed between the link and the
 * charge, a second distinct charge arrived, the reference no longer resolves.
 *
 * Until now that event had ZERO subscribers anywhere in the repo. The system
 * was doing the right thing (refusing to credit) and then telling nobody, so a
 * customer could be charged and the order sit unresolved with nothing surfacing
 * it. This listener is the missing half: it makes each occurrence loud and
 * countable, so it is findable in the logs and can drive an alert.
 */
@Injectable()
export class TenantPaymentEventsListener {
    private readonly logger = new Logger(TenantPaymentEventsListener.name);

    constructor(private readonly redis: RedisService) {}

    @OnEvent('tenant_payment.validation_failed')
    async onValidationFailed(event: TenantPaymentValidationFailedEvent): Promise<void> {
        // Error level on purpose: real money moved at the provider and did not
        // get credited here. Someone has to look at it.
        this.logger.error(
            `[TenantPayments] Payment validation FAILED for tenant ${event.tenantId} `
            + `(${event.provider}) reference=${event.canonicalReference || 'unknown'} `
            + `providerPaymentId=${event.providerPaymentId || 'none'} reason=${event.reason || 'unspecified'}. `
            + 'The charge was NOT credited and the reference is parked for review.',
        );

        // Per-tenant, per-day counter so a systematically broken rail is
        // distinguishable from a one-off. Telemetry only; never throws.
        try {
            const day = new Date().toISOString().slice(0, 10);
            const key = `tenant_payments:validation_failed:${event.tenantId}:${event.provider}:${day}`;
            const total = await this.redis.incr(key);
            if (total === 1) await this.redis.expire(key, 30 * 24 * 3600);
        } catch {
            /* telemetry only */
        }
    }
}
