import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { BillingEventType } from './types/billing-event.enum';
import {
    trialEndingSoonEmail,
    trialEndedEmail,
    paymentFailedEmail,
    softLockEmail,
    accountSuspendedEmail,
    paymentSucceededEmail,
} from '../email/email-layouts';

@Injectable()
export class BillingEmailService {
    private readonly logger = new Logger(BillingEmailService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly emailService: EmailService,
    ) {}

    @OnEvent(BillingEventType.TRIAL_ENDING_SOON)
    async onTrialEndingSoon(payload: { tenantId: string; subscriptionId: string; trialEndsAt?: Date }) {
        const ctx = await this.resolveContext(payload.tenantId, payload.subscriptionId);
        if (!ctx) return;
        const daysLeft = payload.trialEndsAt
            ? Math.max(0, Math.ceil((new Date(payload.trialEndsAt).getTime() - Date.now()) / 86_400_000))
            : 3;
        await this.send(ctx.email, 'Tu prueba gratuita termina pronto', trialEndingSoonEmail(ctx.firstName, daysLeft, ctx.planName));
    }

    @OnEvent(BillingEventType.TRIAL_ENDED)
    async onTrialEnded(payload: { tenantId: string; subscriptionId?: string }) {
        const ctx = await this.resolveContext(payload.tenantId, payload.subscriptionId);
        if (!ctx) return;
        await this.send(ctx.email, 'Tu prueba gratuita ha terminado', trialEndedEmail(ctx.firstName, ctx.planName));
    }

    @OnEvent(BillingEventType.PAYMENT_FAILED)
    async onPaymentFailed(payload: { tenantId: string; subscriptionId?: string }) {
        const ctx = await this.resolveContext(payload.tenantId, payload.subscriptionId);
        if (!ctx) return;
        await this.send(ctx.email, 'Tu pago no pudo procesarse', paymentFailedEmail(ctx.firstName, ctx.planName));
    }

    @OnEvent('billing.subscription.soft_locked')
    async onSoftLocked(payload: { tenantId: string; daysRemaining: number }) {
        const ctx = await this.resolveContext(payload.tenantId);
        if (!ctx) return;
        await this.send(ctx.email, 'Tu cuenta ha sido restringida', softLockEmail(ctx.firstName, payload.daysRemaining));
    }

    @OnEvent(BillingEventType.SUBSCRIPTION_EXPIRED)
    async onExpired(payload: { tenantId: string }) {
        const ctx = await this.resolveContext(payload.tenantId);
        if (!ctx) return;
        await this.send(ctx.email, 'Tu cuenta ha sido suspendida', accountSuspendedEmail(ctx.firstName));
    }

    @OnEvent(BillingEventType.PAYMENT_SUCCEEDED)
    async onPaymentSucceeded(payload: { tenantId: string; subscriptionId?: string; event?: any }) {
        const ctx = await this.resolveContext(payload.tenantId, payload.subscriptionId);
        if (!ctx) return;
        const payment = payload.event?.payment;
        const amount = payment
            ? `${(payment.amountCents / 100).toFixed(2)} ${payment.currency || 'USD'}`
            : '';
        await this.send(ctx.email, 'Pago recibido exitosamente', paymentSucceededEmail(ctx.firstName, ctx.planName, amount));
    }

    private async resolveContext(tenantId: string, subscriptionId?: string): Promise<{
        email: string;
        firstName: string;
        planName: string;
    } | null> {
        if (!tenantId) return null;

        const [tenant, sub] = await Promise.all([
            this.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: {
                    billingEmail: true,
                    name: true,
                    users: { select: { email: true, firstName: true, role: true }, take: 5 },
                },
            }),
            subscriptionId
                ? this.prisma.billingSubscription.findUnique({ where: { id: subscriptionId }, include: { plan: true } })
                : this.prisma.billingSubscription.findUnique({ where: { tenantId }, include: { plan: true } }),
        ]);

        if (!tenant) {
            this.logger.warn(`[BillingEmail] Tenant ${tenantId} not found`);
            return null;
        }

        const admin = tenant.users.find((u: { role: string }) => u.role === 'tenant_admin') ?? tenant.users[0];
        const email = tenant.billingEmail ?? admin?.email;
        if (!email) {
            this.logger.warn(`[BillingEmail] Tenant ${tenantId} has no email recipient`);
            return null;
        }

        return {
            email,
            firstName: admin?.firstName || tenant.name,
            planName: (sub as any)?.plan?.name || 'Parallly',
        };
    }

    private async send(to: string, subject: string, html: string): Promise<void> {
        try {
            await this.emailService.send({ to, subject, html });
            this.logger.log(`[BillingEmail] Sent "${subject}" to ${to}`);
        } catch (err: any) {
            this.logger.error(`[BillingEmail] Failed "${subject}" to ${to}: ${err?.message}`);
        }
    }
}
