import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { EmailTemplatesService } from '../email-templates/email-templates.service';
import { BillingEventType } from './types/billing-event.enum';

/**
 * Listens to BillingService's normalized events and fires the matching
 * billing_* email template. Fully decoupled from BillingService itself —
 * swapping the email provider or muting trial warnings for a specific tenant
 * is a change here, not in the billing state machine.
 *
 * Recipient is the tenant's billingEmail when set, otherwise the first
 * tenant_admin user's email. If neither exists the email is skipped with a
 * warning (tenants without an admin user shouldn't exist but we fail soft).
 *
 * Template rendering uses the auto-seeded email templates from
 * email-templates.service.ts. Missing templates are logged and skipped so
 * a freshly-created tenant that hasn't hit the templates endpoint yet
 * doesn't block the billing flow.
 */
@Injectable()
export class BillingEmailService {
    private readonly logger = new Logger(BillingEmailService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly emailTemplates: EmailTemplatesService,
    ) {}

    @OnEvent(BillingEventType.TRIAL_STARTED)
    async onTrialStarted(payload: { tenantId: string; subscriptionId: string }) {
        await this.dispatch(payload.tenantId, payload.subscriptionId, 'billing_trial_started');
    }

    @OnEvent(BillingEventType.TRIAL_ENDING_SOON)
    async onTrialEndingSoon(payload: { tenantId: string; subscriptionId: string }) {
        await this.dispatch(payload.tenantId, payload.subscriptionId, 'billing_trial_ending_soon');
    }

    @OnEvent(BillingEventType.TRIAL_ENDED)
    async onTrialEnded(payload: { tenantId: string; subscriptionId: string }) {
        await this.dispatch(payload.tenantId, payload.subscriptionId, 'billing_trial_ended');
    }

    @OnEvent(BillingEventType.PAYMENT_SUCCEEDED)
    async onPaymentSucceeded(payload: { tenantId: string; subscriptionId: string; event?: any }) {
        await this.dispatch(payload.tenantId, payload.subscriptionId, 'billing_payment_succeeded', payload.event);
    }

    @OnEvent(BillingEventType.PAYMENT_FAILED)
    async onPaymentFailed(payload: { tenantId: string; subscriptionId: string; event?: any }) {
        await this.dispatch(payload.tenantId, payload.subscriptionId, 'billing_payment_failed', payload.event);
    }

    // -------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------

    private async dispatch(
        tenantId: string | undefined,
        subscriptionId: string | undefined,
        templateSlug: string,
        normalizedEvent?: any,
    ) {
        if (!tenantId) {
            this.logger.warn(`[BillingEmail] ${templateSlug} skipped — no tenantId on event`);
            return;
        }

        const [tenant, subscription] = await Promise.all([
            this.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { id: true, name: true, billingEmail: true, schemaName: true, users: { select: { email: true, firstName: true, lastName: true, role: true }, take: 5 } },
            }),
            subscriptionId
                ? this.prisma.billingSubscription.findUnique({ where: { id: subscriptionId }, include: { plan: true } })
                : null,
        ]);

        if (!tenant) {
            this.logger.warn(`[BillingEmail] ${templateSlug} skipped — tenant ${tenantId} not found`);
            return;
        }

        const admin = tenant.users.find((u: { role: string }) => u.role === 'tenant_admin') ?? tenant.users[0];
        const recipient = tenant.billingEmail ?? admin?.email;
        if (!recipient) {
            this.logger.warn(`[BillingEmail] ${templateSlug} skipped — tenant ${tenantId} has no billingEmail nor admin user`);
            return;
        }

        const dashboardUrl = process.env.DASHBOARD_URL || 'https://admin.parallly-chat.cloud';
        const variables = this.buildVariables(tenant, admin, subscription, normalizedEvent, dashboardUrl);

        try {
            const sent = await this.emailTemplates.renderAndSend(
                tenant.schemaName,
                templateSlug,
                recipient,
                variables,
            );
            if (sent) {
                this.logger.log(`[BillingEmail] Sent ${templateSlug} to ${recipient} (tenant=${tenantId})`);
            }
        } catch (err: any) {
            // Email failure must not break billing state — log and move on.
            this.logger.error(`[BillingEmail] Failed to send ${templateSlug} to ${recipient}: ${err?.message}`, err?.stack);
        }
    }

    private buildVariables(
        tenant: any,
        admin: any,
        subscription: any,
        event: any,
        dashboardUrl: string,
    ): Record<string, string> {
        const fmt = (d: Date | string | null | undefined) => {
            if (!d) return '';
            const date = d instanceof Date ? d : new Date(d);
            return date.toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' });
        };

        const plan = subscription?.plan;
        const payment = event?.payment;

        return {
            customer_name: admin?.firstName ? `${admin.firstName} ${admin.lastName ?? ''}`.trim() : tenant.name,
            company_name: 'Parallly',
            company_logo: '', // hook for future branded logo URL
            plan_name: plan?.name ?? '',
            trial_days: String(plan?.trialDays ?? ''),
            trial_ends_at: fmt(subscription?.trialEndsAt),
            amount_charged: payment ? (payment.amountCents / 100).toFixed(2) : '',
            currency: payment?.currency ?? '',
            next_billing_date: fmt(subscription?.currentPeriodEnd),
            dashboard_url: `${dashboardUrl}/admin`,
            update_payment_url: `${dashboardUrl}/admin/settings/billing`,
            invoice_url: '', // populated by Phase 4 fiscal integration
            failure_reason: payment?.failureReason ?? '',
        };
    }
}
