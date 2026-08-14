import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SmsCreditsService } from '../sms-credits/sms-credits.service';

/**
 * Compra de paquetes de créditos SMS — NEUTRALIZADA.
 *
 * El checkout cobraba con un pago único de MercadoPago, y MercadoPago fue
 * RETIRADO como PSP de plataforma (decisión del dueño, ago 2026). SMS además
 * está apagado del todo por decisión propia, así que la compra no se re-cablea
 * a Wompi: queda este tope claro hasta que el producto SMS se reactive, y ese
 * día el checkout se reconstruye contra el riel vivo.
 *
 * Se conserva `listOrders` (historial de compras ya hechas) y el camino del
 * webhook (`BillingService.creditSmsPackageOrder`), que solo lee la base y debe
 * poder acreditar un evento histórico rezagado.
 */
@Injectable()
export class SmsCheckoutService {
    private readonly logger = new Logger(SmsCheckoutService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly smsCredits: SmsCreditsService,
    ) { }

    async createCheckout(tenantId: string, _packageId: string): Promise<{ orderId: string; initPoint: string }> {
        // La guarda de negocio (kill switch de SMS) va primero: es el motivo
        // real por el que un tenant no puede comprar hoy.
        if (!(await this.smsCredits.isEnabled())) {
            throw new BadRequestException({
                error: 'sms_monetization_disabled',
                message: 'La compra de paquetes SMS no está habilitada',
            });
        }
        // Y si alguien enciende el kill switch sin reconstruir el checkout, el
        // error dice exactamente qué falta en vez de tirar un 500 del adapter.
        this.logger.warn(`[SMS] Compra rechazada para tenant=${tenantId}: el checkout MP fue retirado sin reemplazo.`);
        throw new BadRequestException({
            error: 'sms_checkout_retired',
            message: 'La compra de paquetes SMS no está disponible: la pasarela con la que se cobraba fue retirada.',
        });
    }

    async listOrders(tenantId: string, limit = 20): Promise<any[]> {
        return this.prisma.smsPackageOrder.findMany({
            where: { tenantId },
            orderBy: { createdAt: 'desc' },
            take: Math.min(Math.max(limit, 1), 100),
        });
    }

    /**
     * El barrido rescataba compras cobradas por MP cuyo webhook se perdió. Sin
     * adapter no hay a quién preguntarle; sin ventas nuevas, no hay nada que
     * rescatar. Queda el no-op para que el cron que lo invoca no muera.
     */
    async sweepPendingOrders(): Promise<{ checked: number; credited: number }> {
        return { checked: 0, credited: 0 };
    }
}
