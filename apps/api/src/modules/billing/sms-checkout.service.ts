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
}
