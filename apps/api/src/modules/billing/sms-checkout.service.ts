import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SmsCreditsService } from '../sms-credits/sms-credits.service';
import { MercadoPagoAdapter } from './adapters/mercadopago.adapter';

/**
 * Creates one-time MercadoPago checkouts for SMS credit packages. The order row
 * is the source of truth for the purchase; its id is the MP external_reference,
 * which the payment webhook resolves (BillingService.creditSmsPackageOrder) to
 * grant credits. Kept in the billing module because it needs the MP adapter.
 */
@Injectable()
export class SmsCheckoutService {
    private readonly logger = new Logger(SmsCheckoutService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly smsCredits: SmsCreditsService,
        private readonly mp: MercadoPagoAdapter,
    ) { }

    /** Create a pending order + MP preference. Returns the hosted checkout URL. */
    async createCheckout(tenantId: string, packageId: string): Promise<{ orderId: string; initPoint: string }> {
        // Server-side gate — hiding the button is not enough; a direct POST must fail too.
        if (!(await this.smsCredits.isEnabled())) {
            throw new BadRequestException({
                error: 'sms_monetization_disabled',
                message: 'La compra de paquetes SMS no está habilitada',
            });
        }
        const pkg = await this.smsCredits.getPackage(packageId);
        if (!pkg || !pkg.active) {
            throw new BadRequestException({ error: 'sms_package_unavailable', message: 'El paquete no está disponible' });
        }

        const order = await this.prisma.smsPackageOrder.create({
            data: {
                tenantId,
                packageId: pkg.id,
                credits: pkg.credits,
                priceCents: pkg.priceCents,
                currency: pkg.currency,
                status: 'pending',
                provider: 'mercadopago',
            },
        });

        try {
            const { preferenceId, initPoint } = await this.mp.createPaymentPreference({
                orderId: order.id,
                tenantId,
                title: `Paquete SMS ${pkg.name} — ${pkg.credits} mensajes`,
                unitPrice: pkg.priceCents / 100, // minor units → currency main unit
                currency: pkg.currency,
                metadata: { credits: pkg.credits, packageId: pkg.id },
            });
            await this.prisma.smsPackageOrder.update({
                where: { id: order.id },
                data: { providerRef: preferenceId, initPoint },
            });
            this.logger.log(`SMS checkout created order=${order.id} tenant=${tenantId} package=${pkg.id}`);
            return { orderId: order.id, initPoint };
        } catch (e: any) {
            await this.prisma.smsPackageOrder
                .update({ where: { id: order.id }, data: { status: 'failed' } })
                .catch(() => { });
            throw e;
        }
    }

    async listOrders(tenantId: string, limit = 20): Promise<any[]> {
        return this.prisma.smsPackageOrder.findMany({
            where: { tenantId },
            orderBy: { createdAt: 'desc' },
            take: Math.min(Math.max(limit, 1), 100),
        });
    }

    /**
     * Rescata las compras que MercadoPago cobró y cuyo webhook nunca llegó.
     *
     * Acreditar dependía EXCLUSIVAMENTE del webhook, y el propio adaptador de MP
     * advierte que "Webhooks are unreliable in production". Sin este barrido, un
     * webhook perdido dejaba la orden en 'pending' para siempre: el tenant
     * pagaba, veía el mismo saldo de antes, y ni él ni el super admin tenían una
     * pantalla donde enterarse. Es el peor modo de falla de un producto prepago
     * — cobro sin entrega, y silencioso.
     *
     * Le pregunta a MP por `external_reference` (= id de la orden) y acredita
     * reusando el mismo camino del webhook, que es idempotente por
     * (reason='purchase', ref=order.id) y corta si la orden ya está 'paid'. Un
     * webhook que llegue tarde, después de esto, no acredita dos veces.
     *
     * Se saltean los primeros 10 minutos: el webhook normal llega en segundos y
     * no tiene sentido interrogar a MP por una orden que el usuario recién abrió
     * y todavía está pagando.
     */
    async sweepPendingOrders(): Promise<{ checked: number; credited: number }> {
        const cutoff = new Date(Date.now() - 10 * 60 * 1000);
        const pending = await this.prisma.smsPackageOrder.findMany({
            where: {
                status: 'pending',
                provider: 'mercadopago',
                createdAt: {
                    lt: cutoff,
                    // Más allá de una semana, si MP no cobró no va a cobrar: seguir
                    // preguntando por órdenes viejas es gastar cuota de API para
                    // siempre.
                    gt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
                },
            },
            orderBy: { createdAt: 'asc' },
            take: 100,
        });

        let credited = 0;
        for (const order of pending) {
            try {
                const payment = await this.mp.findApprovedPaymentByReference(order.id);
                if (!payment) continue;
                await this.creditFromSweep(order, payment);
                credited++;
                this.logger.warn(
                    `[SMS] Orden ${order.id} estaba paga en MercadoPago sin acreditar (webhook perdido). ` +
                    `Acreditados ${order.credits} créditos a tenant=${order.tenantId}.`,
                );
            } catch (e: any) {
                this.logger.warn(`[SMS] Rescate de la orden ${order.id} falló: ${e.message}`);
            }
        }

        return { checked: pending.length, credited };
    }

    /**
     * Acredita una orden rescatada por el barrido.
     *
     * Reusa `addCredits` con el MISMO `ref` que usa el webhook (el id de la
     * orden), que es de donde sale la idempotencia: si el webhook llega después,
     * ve la orden en 'paid' y no hace nada; y si ambos corrieran a la vez, el
     * índice único del ledger deja pasar uno solo.
     */
    private async creditFromSweep(
        order: { id: string; tenantId: string; credits: number; priceCents: number; currency: string; packageId: string; providerRef: string | null },
        payment: { providerPaymentId: string; paidAt?: Date },
    ): Promise<void> {
        await this.smsCredits.addCredits(order.tenantId, order.credits, 'purchase', order.id, {
            packageId: order.packageId,
            paymentId: payment.providerPaymentId,
            amountCents: order.priceCents,
            currency: order.currency,
            recoveredBySweep: true,
        });
        await this.prisma.smsPackageOrder.update({
            where: { id: order.id },
            data: {
                status: 'paid',
                paidAt: payment.paidAt ?? new Date(),
                providerRef: payment.providerPaymentId ?? order.providerRef,
            },
        });
    }
}
