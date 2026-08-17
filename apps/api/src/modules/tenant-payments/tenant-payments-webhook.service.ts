import { Injectable, Logger, Optional, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPaymentsService } from './tenant-payments.service';
import { TenantPaymentStoreService } from './tenant-payment-store.service';

const MP_API = 'https://api.mercadopago.com';

/**
 * Qué tabla toca cada prefijo de `external_reference`.
 *
 * El prefijo lo pone quien genera el link (`{tipo}:{uuid}`), así que el webhook
 * no tiene que adivinar de qué cobro se trata ni consultar cuatro tablas a ver
 * en cuál aparece el id.
 *
 * Son exactamente las cuatro tablas que ya tenían la columna `payment_status` y
 * en las que NADIE la escribía: existían desde el día uno como promesa de un
 * circuito de dinero que no estaba conectado.
 */
const TARGETS: Record<string, {
    table: string;
    amountExpression: string;
    currencyExpression: string;
    join?: string;
}> = {
    order: {
        table: 'orders',
        amountExpression: 'target.total_amount',
        currencyExpression: 'target.currency',
    },
    tour: {
        table: 'tour_bookings',
        amountExpression: 'target.total_price',
        currencyExpression: 'target.currency',
    },
    food: {
        table: 'food_orders',
        amountExpression: 'target.total',
        currencyExpression: 'target.currency',
    },
    enrollment: {
        table: 'enrollments',
        amountExpression: 'course.price',
        currencyExpression: 'course.currency',
        join: 'JOIN courses course ON course.id = target.course_id',
    },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class TenantPaymentsWebhookService {
    private readonly logger = new Logger(TenantPaymentsWebhookService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly eventEmitter: EventEmitter2,
        private readonly tenantPayments: TenantPaymentsService,
        @Optional() private readonly store?: TenantPaymentStoreService,
    ) {}

    /**
     * NUNCA se confía en el cuerpo del webhook.
     *
     * MercadoPago sólo manda un id de pago; el estado se le vuelve a preguntar a
     * MP con el token del propio tenant. Por eso un tercero que adivine la URL y
     * mande un id inventado no consigue nada: MP no le va a devolver un pago
     * aprobado que no existe. Además se valida la firma HMAC específica de la
     * aplicación Mercado Pago del tenant antes de consultar ese recurso.
     */
    async process(
        tenantId: string,
        body: any,
        query: any,
        signatureHeader?: string,
        requestIdHeader?: string,
    ): Promise<void> {
        const paymentId = String(
            body?.data?.id || body?.id || query?.['data.id'] || query?.id || '',
        ).trim();
        const type = String(body?.type || query?.type || body?.topic || query?.topic || '');
        if (!paymentId || (type && !type.includes('payment'))) return;

        const signedDataId = String(query?.['data.id'] || '').trim().toLowerCase();
        const candidates = await this.tenantPayments.getMercadoPagoCredentialCandidates(tenantId);
        if (!candidates.length) {
            throw new ServiceUnavailableException('tenant_payment_account_identity_missing');
        }
        if (!signedDataId || signedDataId !== paymentId.toLowerCase()) {
            throw new UnauthorizedException('invalid_mercadopago_webhook_signature');
        }
        const matchingCredentials = candidates.filter(candidate => this.verifySignature(
            signedDataId,
            signatureHeader,
            requestIdHeader,
            candidate.webhookSecret,
        ));
        if (!matchingCredentials.length) {
            throw new UnauthorizedException('invalid_mercadopago_webhook_signature');
        }
        // Mercado Pago payment ids are numeric. Rejecting a signed but malformed
        // resource id as a permanent no-op avoids turning it into a path segment
        // and avoids a retry storm for a payload that can never be looked up.
        if (!/^\d+$/.test(paymentId)) return;

        // The same webhook secret can legitimately survive an access-token
        // rotation. Probe only signature-matching generations and select the
        // first canonical payment whose collector matches that generation;
        // current credentials are ordered first by the config service.
        let token = '';
        let payment: any;
        let transientLookupFailure = false;
        for (const candidate of matchingCredentials) {
            const response = await fetch(`${MP_API}/v1/payments/${paymentId}`, {
                headers: { Authorization: `Bearer ${candidate.accessToken}` },
                signal: AbortSignal.timeout(15000),
            }).catch(() => null);
            if (!response?.ok) {
                if (!response || response.status === 429 || response.status >= 500) {
                    transientLookupFailure = true;
                }
                continue;
            }
            const canonical: any = await response.json();
            if (String(canonical?.collector_id ?? '').trim() !== candidate.accountId) continue;
            token = candidate.accessToken;
            payment = canonical;
            break;
        }
        if (!payment) {
            this.logger.warn(`[TenantPayments] no se pudo leer el pago ${paymentId} de ${tenantId}`);
            if (transientLookupFailure) {
                throw new ServiceUnavailableException('mercadopago_payment_lookup_failed');
            }
            throw new UnauthorizedException('mercadopago_account_mismatch');
        }
        const reference = String(payment?.external_reference || '');
        const [kind, entityId] = reference.split(':');
        const target = TARGETS[kind];
        if (!target || !entityId || !UUID_RE.test(entityId)) {
            this.logger.log(`[TenantPayments] pago ${paymentId} sin referencia reconocible ("${reference}")`);
            return;
        }

        const status = this.mapStatus(payment?.status);
        if (!status) return;

        const paidAmountCents = Math.round(Number(payment?.transaction_amount) * 100);
        const paidCurrency = String(payment?.currency_id || '').trim().toUpperCase();
        if (this.store) {
            const orderId = String(payment?.order?.id || '').trim();
            let preferenceId = '';
            let merchantReference = '';
            if (orderId && /^\d+$/.test(orderId)) {
                const merchantOrderResponse = await fetch(`${MP_API}/merchant_orders/${orderId}`, {
                    headers: { Authorization: `Bearer ${token}` },
                    signal: AbortSignal.timeout(15000),
                }).catch(() => null);
                if (!merchantOrderResponse?.ok) {
                    throw new ServiceUnavailableException('mercadopago_merchant_order_lookup_failed');
                }
                const merchantOrder: any = await merchantOrderResponse.json();
                preferenceId = String(merchantOrder?.preference_id || '').trim();
                merchantReference = String(merchantOrder?.external_reference || '').trim();
            }

            if (preferenceId && merchantReference === reference) {
                const eventKey = createHash('sha256')
                    .update(`mp:${paymentId}:${status}:${paidAmountCents}:${paidCurrency}`)
                    .digest('hex');
                const settled = await this.store.settleMercadoPagoPayment({
                    tenantId,
                    providerLinkId: preferenceId,
                    providerPaymentId: paymentId,
                    canonicalReference: reference,
                    status,
                    amountCents: paidAmountCents,
                    currency: paidCurrency,
                    eventKey,
                }).catch((error: any) => {
                    this.logger.warn(`MP durable settlement failed for ${paymentId}: ${error.message}`);
                    throw new ServiceUnavailableException('tenant_payment_persistence_failed');
                });
                if (settled) {
                    if (settled.validationError) {
                        this.eventEmitter.emit('tenant_payment.validation_failed', {
                            tenantId,
                            provider: 'mercadopago',
                            providerPaymentId: paymentId,
                            providerLinkId: preferenceId,
                            canonicalReference: reference,
                            reason: settled.validationError,
                        });
                    } else if (settled.transitioned && settled.status === 'paid') {
                        this.eventEmitter.emit('tenant_payment.succeeded', {
                            tenantId,
                            provider: 'mercadopago',
                            kind: settled.kind,
                            entityId: settled.entityId,
                            amountCents: paidAmountCents,
                            currency: paidCurrency,
                            providerPaymentId: paymentId,
                            providerLinkId: preferenceId,
                        });
                    } else if (settled.transitioned && settled.status === 'refunded') {
                        this.eventEmitter.emit('tenant_payment.refunded', {
                            tenantId,
                            provider: 'mercadopago',
                            kind: settled.kind,
                            entityId: settled.entityId,
                            amountCents: paidAmountCents,
                            currency: paidCurrency,
                            providerPaymentId: paymentId,
                            providerLinkId: preferenceId,
                        });
                    }
                    return;
                }
            }

            const linked = preferenceId
                ? await this.store.findByProviderLink(tenantId, 'mercadopago', preferenceId)
                : await this.store.findUnresolvedByReference(tenantId, 'mercadopago', reference);
            if (linked) {
                await this.store.markCreationState(
                    tenantId,
                    linked.id,
                    'requires_review',
                    preferenceId ? 'mercadopago_reference_mismatch' : 'mercadopago_preference_unresolved',
                    preferenceId || linked.providerLinkId,
                );
                this.eventEmitter.emit('tenant_payment.validation_failed', {
                    tenantId,
                    provider: 'mercadopago',
                    providerPaymentId: paymentId,
                    providerLinkId: preferenceId || linked.providerLinkId,
                    canonicalReference: reference,
                    reason: preferenceId ? 'mercadopago_reference_mismatch' : 'mercadopago_preference_unresolved',
                });
                return;
            }
            // No durable intent means this is a pre-ledger preference. Preserve
            // the exact legacy external_reference/money fallback below.
            if (status === 'pending') return;
        } else if (status === 'pending') {
            return;
        }

        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        if (!schemaName) {
            throw new ServiceUnavailableException('tenant_schema_unavailable');
        }

        try {
            // The external_reference came from the preference, but it is not an
            // authorization to settle an arbitrary amount. Re-read the purchase
            // owned by this tenant and require exact money equality before any
            // state transition. This also catches an order edited after its link
            // was issued and sends it to manual reconciliation instead of
            // silently accepting an underpayment.
            const canonical = await this.prisma.executeInTenantSchema<Array<{
                amount: unknown;
                currency: string | null;
            }>>(
                schemaName,
                `SELECT ${target.amountExpression} AS amount,
                        ${target.currencyExpression} AS currency
                   FROM ${target.table} target
                   ${target.join ?? ''}
                  WHERE target.id = $1::uuid
                  LIMIT 1`,
                [entityId],
            );
            const expectedAmountCents = Math.round(Number(canonical[0]?.amount) * 100);
            const paidAmountCents = Math.round(Number(payment?.transaction_amount) * 100);
            const expectedCurrency = String(canonical[0]?.currency || '').trim().toUpperCase();
            const paidCurrency = String(payment?.currency_id || '').trim().toUpperCase();
            if (!canonical[0]
                || !Number.isSafeInteger(expectedAmountCents)
                || !Number.isSafeInteger(paidAmountCents)
                || expectedAmountCents <= 0
                || paidAmountCents !== expectedAmountCents
                || paidCurrency !== expectedCurrency) {
                this.logger.error(
                    `[TenantPayments] pago ${paymentId} no coincide con ${reference}: `
                    + `${paidAmountCents || 0} ${paidCurrency || '?'} != ${expectedAmountCents || 0} ${expectedCurrency || '?'}`,
                );
                this.eventEmitter.emit('tenant_payment.validation_failed', {
                    tenantId,
                    kind,
                    entityId,
                    providerPaymentId: paymentId,
                    reason: 'amount_or_currency_mismatch',
                });
                return;
            }

            // The row itself is the durable idempotency boundary. The monotonic
            // predicate lets failed→paid→refunded advance, but a late approved
            // delivery can never roll a refund back to paid. A Redis TTL marker
            // here used to re-fire automations after it expired and could also
            // lose a transition if the process died after SET NX.
            const updated = await this.prisma.executeInTenantSchema<Array<{ id: string }>>(
                schemaName,
                `UPDATE ${target.table}
                    SET payment_status = $2, updated_at = NOW()
                  WHERE id = $1::uuid
                    AND payment_status IS DISTINCT FROM $2
                    AND (
                        $2 = 'refunded'
                        OR ($2 = 'paid' AND COALESCE(payment_status, 'pending') <> 'refunded')
                        OR ($2 = 'failed' AND COALESCE(payment_status, 'pending') NOT IN ('paid', 'refunded'))
                    )
                  RETURNING id`,
                [entityId, status],
            );
            if (!updated[0]) {
                return;
            }
            this.logger.log(`[TenantPayments] ${target.table}/${entityId} → ${status} (pago ${paymentId}, tenant ${tenantId})`);
        } catch (e: any) {
            this.logger.warn(`[TenantPayments] no se pudo marcar ${target.table}/${entityId}: ${e.message}`);
            throw new ServiceUnavailableException('tenant_payment_persistence_failed');
        }

        if (status === 'paid') {
            // El evento es lo que permite que otra cosa reaccione —confirmar la
            // reserva, avisarle al dueño, disparar una automatización— sin que
            // este servicio tenga que conocer a ninguna de ellas.
            this.eventEmitter.emit('tenant_payment.succeeded', {
                tenantId,
                kind,
                entityId,
                amountCents: Math.round((payment?.transaction_amount ?? 0) * 100),
                currency: payment?.currency_id,
                providerPaymentId: paymentId,
            });
        }
    }

    /** Mercado Pago Webhooks: HMAC-SHA256 sobre id/request-id/timestamp. */
    private verifySignature(
        dataId: string,
        signatureHeader: string | undefined,
        requestIdHeader: string | undefined,
        secret: string,
    ): boolean {
        if (!signatureHeader || !requestIdHeader) return false;
        const parts = Object.fromEntries(signatureHeader.split(',').map(part => {
            const [key, ...rest] = part.trim().split('=');
            return [key, rest.join('=')];
        }));
        const ts = parts.ts;
        const supplied = parts.v1;
        if (!ts || !/^\d+$/.test(ts) || !supplied || !/^[a-f0-9]{64}$/i.test(supplied)) return false;
        const manifest = `id:${dataId};request-id:${requestIdHeader};ts:${ts};`;
        const expected = createHmac('sha256', secret).update(manifest).digest('hex');
        const left = Buffer.from(expected, 'hex');
        const right = Buffer.from(supplied.toLowerCase(), 'hex');
        return left.length === right.length && timingSafeEqual(left, right);
    }

    private mapStatus(mpStatus?: string): 'pending' | 'paid' | 'failed' | 'refunded' | null {
        switch (mpStatus) {
            case 'approved': return 'paid';
            case 'refunded':
            case 'charged_back': return 'refunded';
            case 'rejected':
            case 'cancelled': return 'failed';
            case 'pending':
            case 'in_process':
            case 'in_mediation': return 'pending';
            default: return null;
        }
    }
}
