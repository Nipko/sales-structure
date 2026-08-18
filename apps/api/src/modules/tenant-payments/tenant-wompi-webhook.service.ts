import {
    Injectable,
    Logger,
    ServiceUnavailableException,
    UnauthorizedException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TenantPaymentStoreService } from './tenant-payment-store.service';
import { TenantPaymentsService } from './tenant-payments.service';
import { TenantWompiClient } from './tenant-wompi.client';
import { verifyWompiEventSignature } from './wompi-event-signature.util';

@Injectable()
export class TenantWompiWebhookService {
    private readonly logger = new Logger(TenantWompiWebhookService.name);

    constructor(
        private readonly tenantPayments: TenantPaymentsService,
        private readonly wompi: TenantWompiClient,
        private readonly store: TenantPaymentStoreService,
        private readonly events: EventEmitter2,
    ) {}

    async process(
        tenantId: string,
        callbackToken: string,
        body: any,
        headerChecksum?: string,
    ): Promise<void> {
        const { credentials, decryptionFailed } = await this.tenantPayments
            .getWompiCredentialsDetailed(tenantId, callbackToken);
        if (!credentials) {
            // Our own stored envelope would not open. The caller may well be
            // Wompi delivering a real approved payment, so this must be a
            // RETRYABLE 503 — a 401 here tells the provider to give up and the
            // payment is lost for good. 401 stays reserved for a token that
            // genuinely matches nothing.
            if (decryptionFailed) {
                throw new ServiceUnavailableException('tenant_payment_credential_decryption_unavailable');
            }
            throw new UnauthorizedException('invalid_wompi_callback_token');
        }

        // The commerce event URL may receive future Wompi event families. They
        // cannot mutate this ledger and are acknowledged only after the opaque
        // callback token has selected the tenant account.
        if (String(body?.event || '') !== 'transaction.updated') return;
        const expectedEnvironment = credentials.environment === 'production' ? 'prod' : 'test';
        if (String(body?.environment || '') !== expectedEnvironment) {
            throw new UnauthorizedException('wompi_event_environment_mismatch');
        }
        const signature = verifyWompiEventSignature({
            body,
            eventsSecret: credentials.eventsSecret,
            headerChecksum,
        });
        if (!signature.valid || !signature.eventKey) {
            throw new UnauthorizedException(`invalid_wompi_event_signature:${signature.reason || 'unknown'}`);
        }

        // Provider evidence that the events URL really reaches us. Recorded as
        // soon as the signature verifies — before any settlement outcome —
        // because "the delivery arrived and authenticated" is exactly the fact
        // the owner needs, independently of what this particular event decided.
        await this.tenantPayments.recordWebhookHeartbeat(tenantId, 'wompi');
        const transactionId = String(body?.data?.transaction?.id || '').trim();
        // eslint-disable-next-line no-control-regex
        if (!transactionId || transactionId.length > 255 || /[/?#\u0000-\u001f\\]/.test(transactionId)) {
            throw new UnauthorizedException('invalid_wompi_transaction_id');
        }

        let transaction;
        try {
            transaction = await this.wompi.getTransaction({
                transactionId,
                publicKey: credentials.publicKey,
                environment: credentials.environment,
            });
        } catch (error: any) {
            this.logger.warn(`Canonical Wompi transaction read failed for ${transactionId}: ${error.message}`);
            throw new ServiceUnavailableException('wompi_transaction_lookup_failed');
        }
        if (!transaction.paymentLinkId) {
            this.logger.debug(`Ignoring Wompi transaction ${transaction.id} without payment_link_id`);
            return;
        }

        let result;
        try {
            result = await this.store.settleWompiTransaction({
                tenantId,
                transaction,
                eventKey: signature.eventKey,
                source: 'webhook',
            });
        } catch (error: any) {
            this.logger.warn(`Wompi settlement persistence failed for ${transactionId}: ${error.message}`);
            throw new ServiceUnavailableException('tenant_payment_persistence_failed');
        }

        // The attempt uniqueness constraint is the durable delivery boundary.
        // Do not re-emit fulfillment or review events for a provider retry;
        // current domain state may legitimately differ after the first event.
        if (result.duplicate) return;
        if (result.validationError) {
            this.events.emit('tenant_payment.validation_failed', {
                tenantId,
                provider: 'wompi',
                providerPaymentId: transaction.id,
                providerLinkId: transaction.paymentLinkId,
                canonicalReference: result.intent?.canonicalReference,
                reason: result.validationError,
            });
            return;
        }
        if (!result.transitioned) return;
        if (result.status === 'paid') {
            this.events.emit('tenant_payment.succeeded', {
                tenantId,
                provider: 'wompi',
                kind: result.kind,
                entityId: result.entityId,
                canonicalReference: result.intent?.canonicalReference,
                amountCents: transaction.amountCents,
                currency: transaction.currency,
                providerPaymentId: transaction.id,
                providerLinkId: transaction.paymentLinkId,
            });
        } else if (result.status === 'refunded') {
            this.events.emit('tenant_payment.refunded', {
                tenantId,
                provider: 'wompi',
                kind: result.kind,
                entityId: result.entityId,
                canonicalReference: result.intent?.canonicalReference,
                amountCents: transaction.amountCents,
                currency: transaction.currency,
                providerPaymentId: transaction.id,
                providerLinkId: transaction.paymentLinkId,
            });
        }
    }
}
