import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { WhatsappCryptoService } from '../whatsapp/services/whatsapp-crypto.service';

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
const TARGETS: Record<string, { table: string; paidExtra?: string }> = {
    order: { table: 'orders' },
    tour: { table: 'tour_bookings' },
    food: { table: 'food_orders' },
    enrollment: { table: 'enrollments' },
};

@Injectable()
export class TenantPaymentsWebhookService {
    private readonly logger = new Logger(TenantPaymentsWebhookService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly crypto: WhatsappCryptoService,
        private readonly eventEmitter: EventEmitter2,
    ) {}

    /**
     * NUNCA se confía en el cuerpo del webhook.
     *
     * MercadoPago sólo manda un id de pago; el estado se le vuelve a preguntar a
     * MP con el token del propio tenant. Por eso un tercero que adivine la URL y
     * mande un id inventado no consigue nada: MP no le va a devolver un pago
     * aprobado que no existe. Es la misma razón por la que este endpoint puede
     * ser público sin firma.
     */
    async process(tenantId: string, body: any, query: any): Promise<void> {
        const paymentId = String(
            body?.data?.id || body?.id || query?.['data.id'] || query?.id || '',
        ).trim();
        const type = String(body?.type || query?.type || body?.topic || query?.topic || '');
        if (!paymentId || (type && !type.includes('payment'))) return;

        // Idempotencia: MP redelivera. Sin esto, un pago confirmado dos veces
        // emite dos eventos de negocio y el dueño recibe dos avisos de cobro.
        const seenKey = `tp:seen:${tenantId}:${paymentId}`;
        const fresh = await this.redis.acquireLock(seenKey, 86400).catch(() => true);
        if (!fresh) return;

        const token = await this.tokenFor(tenantId);
        if (!token) {
            this.logger.warn(`[TenantPayments] webhook de ${tenantId} sin credenciales configuradas`);
            return;
        }

        const res = await fetch(`${MP_API}/v1/payments/${paymentId}`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(15000),
        }).catch(() => null);
        if (!res?.ok) {
            // Se libera el marcador para que el reintento de MP pueda volver a
            // procesarlo: si no, un hipo de red convierte un pago real en un
            // pago que nunca se registró.
            await this.redis.del(seenKey).catch(() => {});
            this.logger.warn(`[TenantPayments] no se pudo leer el pago ${paymentId} de ${tenantId}`);
            return;
        }

        const payment: any = await res.json();
        const reference = String(payment?.external_reference || '');
        const [kind, entityId] = reference.split(':');
        const target = TARGETS[kind];
        if (!target || !entityId) {
            this.logger.log(`[TenantPayments] pago ${paymentId} sin referencia reconocible ("${reference}")`);
            return;
        }

        const status = this.mapStatus(payment?.status);
        if (!status) return; // in_process / pending: todavía no hay nada que escribir

        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        if (!schemaName) return;

        try {
            await this.prisma.executeInTenantSchema(
                schemaName,
                `UPDATE ${target.table}
                    SET payment_status = $2, updated_at = NOW()
                  WHERE id = $1::uuid`,
                [entityId, status],
            );
            this.logger.log(`[TenantPayments] ${target.table}/${entityId} → ${status} (pago ${paymentId}, tenant ${tenantId})`);
        } catch (e: any) {
            // Una tabla que no existe en ese schema (vertical no habilitada) no
            // es un error del webhook.
            this.logger.warn(`[TenantPayments] no se pudo marcar ${target.table}/${entityId}: ${e.message}`);
            return;
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

    private mapStatus(mpStatus?: string): 'paid' | 'failed' | 'refunded' | null {
        switch (mpStatus) {
            case 'approved': return 'paid';
            case 'refunded':
            case 'charged_back': return 'refunded';
            case 'rejected':
            case 'cancelled': return 'failed';
            default: return null;
        }
    }

    private async tokenFor(tenantId: string): Promise<string | null> {
        const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
        const enc = (tenant?.settings as any)?.tenantPayments?.accessTokenEnc;
        if (!enc) return null;
        try { return this.crypto.decryptToken(enc); } catch { return null; }
    }
}
