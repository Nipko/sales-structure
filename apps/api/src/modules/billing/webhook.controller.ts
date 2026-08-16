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
    ServiceUnavailableException,
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
 *  3. Take a short ownership-token processing lock. Durable idempotency lives
 *     in billing_events' UNIQUE(provider,event_id), never in an expiring Redis
 *     marker that could survive a process crash before the DB insert.
 *  4. Delegate parsing + dispatch to the adapter + BillingService.
 *  5. Return 200 only after durable ingestion (or for a permanently ignored
 *     signed update). Transient parse/dispatch failures return 503 so the
 *     provider's retry schedule remains our recovery path.
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
        // Normalize provider name — the factory only accepts known values.
        // 'mock' is a test-only provider whose signature check always returns
        // true; exposing its public webhook route in production would let an
        // unauthenticated POST forge PAYMENT_SUCCEEDED events and activate a
        // subscription for free. Never allow it in production.
        // Note: this allowlist is deliberately NOT gated on the runtime provider
        // kill switch. Disabling a provider stops NEW acquisitions; subscriptions
        // already living there keep charging, and refusing their webhooks would
        // silently drop real payments.
        // MercadoPago fue retirado como PSP de plataforma: su ruta de webhook
        // sale del allowlist. Como nunca llegó a cobrar una suscripción
        // (collector_non_compliant), no existen eventos legados que perder; los
        // webhooks del enlace-de-pago del TENANT llegan a su propia ruta
        // (/tenant-payments/webhook/:tenantId) y no pasan por acá.
        const allowed: PaymentProviderName[] =
            process.env.NODE_ENV === 'production'
                ? ['stripe', 'wompi']
                : ['stripe', 'wompi', 'mock'];
        if (!allowed.includes(providerName as PaymentProviderName)) {
            throw new NotImplementedException({ error: 'unknown_provider', provider: providerName });
        }
        const providerKey = providerName as PaymentProviderName;
        const provider = this.providerFactory.getByName(providerKey);

        const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body ?? {});
        const queryDataId = req.query?.['data.id'];
        const dataId = typeof queryDataId === 'string'
            ? queryDataId
            : (Array.isArray(queryDataId) && typeof queryDataId[0] === 'string'
                ? queryDataId[0]
                : undefined);

        // 1. Signature verification
        const verified = provider.verifyWebhookSignature(rawBody, headers, { dataId });
        if (!verified) {
            this.logger.warn(`[Webhook] ${providerName} signature rejected — request-id=${headers['x-request-id'] ?? 'n/a'}`);
            await this.recordWebhookFailure(providerKey, 'signature');
            throw new UnauthorizedException({ error: 'invalid_signature' });
        }

        // 2. Parse — async because MP needs to fetch the full resource
        let normalized;
        try {
            normalized = await provider.parseWebhookEvent(rawBody, headers);
        } catch (err: any) {
            this.logger.error(`[Webhook] ${providerName} parseWebhookEvent failed: ${err?.message}`);
            await this.recordWebhookFailure(providerKey, 'parse');
            // A verified but unsupported/informational provider update is a
            // permanent no-op. Network/provider/unknown failures have not been
            // durably recorded and MUST stay retryable.
            if (err instanceof BadRequestException) {
                return { received: true, status: 'ignored', reason: this.errorCode(err) };
            }
            throw new ServiceUnavailableException({
                error: 'webhook_parse_retryable',
                provider: providerName,
            });
        }

        // 3. Short processing lock only. A 48h Redis "done" marker was unsafe:
        // if the process died after SET NX but before billing_events INSERT, all
        // Wompi retries were acknowledged as duplicates and the payment was lost.
        const lockKey = `lock:billing:webhook:${providerName}:${normalized.providerEventId}`;
        const lockToken = await this.redis.acquireLockToken(lockKey, 60);
        if (!lockToken) {
            throw new ServiceUnavailableException({
                error: 'webhook_event_in_progress',
                provider: providerName,
            });
        }

        // 4. Dispatch
        try {
            const result = await this.billingService.handleBillingEvent(normalized);
            return { received: true, status: result.processed ? 'processed' : 'skipped', reason: result.reason };
        } catch (err: any) {
            this.logger.error(`[Webhook] ${providerName} handleBillingEvent failed: ${err?.message}`, err?.stack);
            await this.recordWebhookFailure(providerKey, 'dispatch');
            throw new ServiceUnavailableException({
                error: 'webhook_dispatch_retryable',
                provider: providerName,
            });
        } finally {
            // Ownership token prevents an expired lock holder deleting a lock
            // that another process has since acquired. TTL remains the crash
            // recovery path if Redis is unavailable during release.
            await this.redis.releaseLockToken(lockKey, lockToken).catch((err: any) => {
                this.logger.warn(`[Webhook] Could not release ${lockKey}: ${err?.message}`);
            });
        }
    }

    private errorCode(err: BadRequestException): string {
        const response = err.getResponse();
        if (typeof response === 'string') return response;
        const code = (response as any)?.error ?? (response as any)?.message;
        return typeof code === 'string' ? code : 'permanent_parse_error';
    }

    /**
     * Best-effort failure counter read by PlatformMonitorService.checkWebhookFailures().
     * Per-provider, per-day Redis key with a 3-day TTL — cheap, self-expiring, no new table.
     *   'signature' — bad/forged signature (usually a secret mismatch after a
     *                 credential rotation → every billing event is being dropped)
     *   'parse'     — provider API hiccup while fetching the full resource
     *   'dispatch'  — handleBillingEvent threw
     * The provider is part of the key: with several providers live, a rotation gone
     * wrong in one would otherwise be diluted by the healthy traffic of the others
     * and never cross the alert threshold.
     * Never throws: telemetry must not break webhook ingestion.
     */
    private async recordWebhookFailure(
        provider: PaymentProviderName,
        kind: 'signature' | 'parse' | 'dispatch',
    ): Promise<void> {
        try {
            const day = new Date().toISOString().slice(0, 10);
            const key = `billing:webhook:fail:${provider}:${kind}:${day}`;
            const n = await this.redis.incr(key);
            if (n === 1) await this.redis.expire(key, 3 * 24 * 3600);
        } catch {
            /* telemetry only — ignore */
        }
    }
}
