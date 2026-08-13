import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { PaymentProviderFactory } from '../payment-provider.factory';
import { PaymentRoutingService } from '../payment-routing.service';
import { PaymentSourceKind } from '../adapters/provider-capabilities';
import { AcceptanceContracts } from '../adapters/charging-provider.interface';
import { PaymentProviderName } from '../types/provider-types';
import { SubscriptionStatus } from '../types/subscription-status.enum';
import { SubscriptionEngineService } from './subscription-engine.service';
import { RENEWAL_QUEUE } from './renewal-scheduler.service';
import { anchorDayOf, chargeTimeFor } from './period.util';

/** Methods that can be charged without the customer present. */
const UNATTENDED_KINDS: PaymentSourceKind[] = ['card', 'nequi', 'bancolombia_transfer', 'daviplata'];

/**
 * Stored payment instruments, and the conversion from "a tenant on a trial" to
 * "a tenant we can charge".
 *
 * The card itself never reaches this service: the browser tokenizes it directly
 * with the provider and we only ever see a single-use token. Storing a PAN here
 * would put the whole platform in PCI scope, and Wompi forbids it outright.
 */
@Injectable()
export class PaymentSourceService {
    private readonly logger = new Logger(PaymentSourceService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly eventEmitter: EventEmitter2,
        private readonly providerFactory: PaymentProviderFactory,
        private readonly routing: PaymentRoutingService,
        private readonly engine: SubscriptionEngineService,
        @InjectQueue(RENEWAL_QUEUE) private readonly renewalQueue: Queue,
    ) {}

    /** The contracts the checkout must display before it may store anything. */
    async getAcceptanceContracts(tenantId: string): Promise<AcceptanceContracts & { provider: PaymentProviderName }> {
        const provider = await this.resolveProvider(tenantId);
        const charging = this.providerFactory.getCharging(provider);
        const contracts = await charging.getAcceptanceContracts();
        return { ...contracts, provider };
    }

    /**
     * Store a tokenized instrument for later charges.
     *
     * Consent evidence is persisted alongside — but only the token IDENTIFIERS
     * and when/where it was given. The acceptance JWTs themselves expire within
     * minutes and prove nothing afterwards, so keeping them would be storing a
     * secret with no evidentiary value.
     */
    async addPaymentSource(input: {
        tenantId: string;
        kind: PaymentSourceKind;
        token: string;
        customerEmail: string;
        acceptedIp?: string;
        makeDefault?: boolean;
    }): Promise<{ id: string; status: string; requiresAuthorization: boolean; authorizationUrl?: string }> {
        const provider = await this.resolveProvider(input.tenantId);
        const capabilities = this.providerFactory.capabilitiesOf(provider);

        if (!capabilities.storedPaymentSources) {
            throw new BadRequestException({
                error: 'stored_sources_unsupported',
                message: `${provider} does not support reusable payment sources.`,
            });
        }
        if (!capabilities.unattendedMethods.includes(input.kind)) {
            throw new BadRequestException({
                error: 'method_not_chargeable',
                message: `${provider} cannot charge a stored '${input.kind}' without the customer present.`,
            });
        }

        const routingConfig = await this.routing.getConfig();
        if (provider === 'wompi' && !this.isWompiMethodEnabled(input.kind, routingConfig.wompiMethods)) {
            throw new BadRequestException({
                error: 'method_disabled',
                message: `The '${input.kind}' payment method is not enabled.`,
            });
        }

        const charging = this.providerFactory.getCharging(provider);
        const acceptance = await charging.getAcceptanceContracts();

        const source = await charging.startPaymentSource({
            tenantId: input.tenantId,
            kind: input.kind,
            token: input.token,
            customerEmail: input.customerEmail,
            acceptance,
        });

        const stored = await this.prisma.billingPaymentSource.upsert({
            where: {
                provider_providerSourceId: {
                    provider,
                    providerSourceId: source.providerSourceId,
                },
            },
            create: {
                tenantId: input.tenantId,
                provider,
                providerSourceId: source.providerSourceId,
                kind: input.kind,
                status: source.status,
                supportsUnattended: UNATTENDED_KINDS.includes(input.kind),
                brand: source.brand,
                last4: source.last4,
                expMonth: source.expMonth,
                expYear: source.expYear,
                phoneMasked: source.phoneMasked,
                authTokenId: source.authTokenId,
                authUrl: source.authorizationUrl,
                acceptedAt: new Date(),
                acceptedIp: input.acceptedIp,
                acceptanceJti: this.jtiOf(acceptance.endUserPolicy.token),
            },
            update: { status: source.status },
        });

        // Only a source that can actually be charged becomes the default.
        if (source.status === 'available' && (input.makeDefault ?? true)) {
            await this.setDefault(input.tenantId, stored.id);
        }

        if (source.status === 'available') {
            this.eventEmitter.emit('billing.payment_source.added', {
                tenantId: input.tenantId,
                subscriptionId: (await this.subscriptionOf(input.tenantId))?.id,
                paymentSourceId: stored.id,
            });
        }

        return {
            id: stored.id,
            status: source.status,
            // Wallets authorize out of band: the customer approves in their bank
            // app, and until then there is nothing chargeable.
            requiresAuthorization: source.status === 'pending_auth',
            authorizationUrl: source.authorizationUrl,
        };
    }

    /** Re-read a source whose authorization was still pending. */
    async pollAuthorization(tenantId: string, sourceId: string) {
        const stored = await this.requireSource(tenantId, sourceId);
        if (stored.status !== 'pending_auth') return { status: stored.status };

        const charging = this.providerFactory.getCharging(stored.provider as PaymentProviderName);
        const fresh = await charging.pollPaymentSourceAuth(stored.providerSourceId, stored.authTokenId ?? undefined);

        if (fresh.status !== stored.status) {
            await this.prisma.billingPaymentSource.update({
                where: { id: stored.id },
                data: { status: fresh.status, brand: fresh.brand, last4: fresh.last4 },
            });
            if (fresh.status === 'available') {
                await this.setDefault(tenantId, stored.id);
                this.eventEmitter.emit('billing.payment_source.added', {
                    tenantId,
                    subscriptionId: (await this.subscriptionOf(tenantId))?.id,
                    paymentSourceId: stored.id,
                });
            }
        }
        return { status: fresh.status };
    }

    async listPaymentSources(tenantId: string) {
        const sources = await this.prisma.billingPaymentSource.findMany({
            where: { tenantId, status: { in: ['available', 'pending_auth'] } },
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
        });
        // Never expose provider ids or consent tokens to the dashboard.
        return sources.map((s) => ({
            id: s.id,
            kind: s.kind,
            status: s.status,
            brand: s.brand,
            last4: s.last4,
            expMonth: s.expMonth,
            expYear: s.expYear,
            phoneMasked: s.phoneMasked,
            isDefault: s.isDefault,
            createdAt: s.createdAt,
        }));
    }

    async setDefault(tenantId: string, sourceId: string): Promise<void> {
        const source = await this.requireSource(tenantId, sourceId);
        if (source.status !== 'available') {
            throw new BadRequestException({
                error: 'source_not_available',
                message: 'That payment method is not ready to be charged yet.',
            });
        }
        await this.prisma.$transaction([
            this.prisma.billingPaymentSource.updateMany({
                where: { tenantId, isDefault: true },
                data: { isDefault: false },
            }),
            this.prisma.billingPaymentSource.update({
                where: { id: sourceId },
                data: { isDefault: true },
            }),
        ]);
        await this.prisma.billingSubscription.updateMany({
            where: { tenantId },
            data: { defaultPaymentSourceId: sourceId, unattendedCapable: source.supportsUnattended },
        });
    }

    async removePaymentSource(tenantId: string, sourceId: string): Promise<void> {
        const source = await this.requireSource(tenantId, sourceId);
        const charging = this.providerFactory.getCharging(source.provider as PaymentProviderName);
        await charging.voidPaymentSource(source.providerSourceId).catch((err: any) => {
            // The local record must be removed either way: a source the provider
            // already dropped would otherwise keep failing every renewal.
            this.logger.warn(`[PaymentSource] Provider refused to void ${source.providerSourceId}: ${err?.message}`);
        });
        await this.prisma.billingPaymentSource.update({
            where: { id: sourceId },
            data: { status: 'voided', isDefault: false, voidedAt: new Date() },
        });
    }

    // -------------------------------------------------------------------------
    // Activation
    // -------------------------------------------------------------------------

    /**
     * Turn a subscription into one our engine bills, and charge it now.
     *
     * This is the conversion moment: a tenant on a local trial hands us a
     * payment method and starts paying. The subscription is switched to the
     * internal engine, its price is FROZEN for the cycle, and the first charge
     * is queued immediately — the plan only becomes active once that charge
     * settles, never on the promise of one.
     */
    async activateWithEngine(input: {
        tenantId: string;
        amountCents: number;
        currency: string;
        periodEnd: Date;
        timezone?: string;
    }): Promise<{ attemptId: string | null }> {
        const sub = await this.subscriptionOf(input.tenantId);
        if (!sub) throw new NotFoundException({ error: 'subscription_not_found' });

        const source = await this.prisma.billingPaymentSource.findFirst({
            where: { tenantId: input.tenantId, isDefault: true, status: 'available' },
        });
        if (!source) {
            throw new BadRequestException({
                error: 'no_payment_method',
                message: 'Add a payment method before activating the subscription.',
            });
        }

        const now = new Date();
        const timezone = input.timezone || sub.billingTimezone || 'America/Bogota';

        await this.prisma.billingSubscription.update({
            where: { id: sub.id },
            data: {
                engine: 'internal',
                // PENDING_AUTH is the honest state between "has a method" and
                // "has paid": the tenant is not entitled to the plan until money
                // actually moves.
                status: SubscriptionStatus.PENDING_AUTH,
                billingAnchorDay: sub.billingAnchorDay ?? anchorDayOf(now),
                billingTimezone: timezone,
                chargeAmountCents: input.amountCents,
                chargeCurrency: input.currency,
                defaultPaymentSourceId: source.id,
                unattendedCapable: source.supportsUnattended,
                nextChargeAt: chargeTimeFor(input.periodEnd, timezone),
            },
        });

        const claim = await this.engine.claimAttempt({
            subscriptionId: sub.id,
            tenantId: input.tenantId,
            provider: sub.provider as PaymentProviderName,
            purpose: 'initial',
            periodStart: now,
            periodEnd: input.periodEnd,
            amountCents: input.amountCents,
            currency: input.currency,
            scheduledAt: now,
            paymentSourceId: source.id,
        });
        if (!claim) return { attemptId: null };

        await this.renewalQueue.add(
            'charge',
            { attemptId: claim.id },
            { jobId: claim.id, attempts: 1, removeOnComplete: { age: 604_800 } },
        );

        this.logger.log(`[PaymentSource] Tenant ${input.tenantId} activated on the internal engine — charging now`);
        return { attemptId: claim.id };
    }

    // -------------------------------------------------------------------------

    private async resolveProvider(tenantId: string): Promise<PaymentProviderName> {
        const sub = await this.subscriptionOf(tenantId);
        // A live subscription keeps the provider it was created with.
        if (sub?.provider) return this.routing.resolveForSubscription(sub.provider);

        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { billingCountry: true, paymentProvider: true },
        });
        const resolution = await this.routing.resolveForNewSubscription({
            tenantId,
            tenantProvider: tenant?.paymentProvider,
            billingCountry: tenant?.billingCountry,
        });
        return resolution.provider;
    }

    private subscriptionOf(tenantId: string) {
        return this.prisma.billingSubscription.findUnique({ where: { tenantId } });
    }

    private async requireSource(tenantId: string, sourceId: string) {
        const source = await this.prisma.billingPaymentSource.findFirst({
            where: { id: sourceId, tenantId },
        });
        if (!source) throw new NotFoundException({ error: 'payment_source_not_found' });
        return source;
    }

    private isWompiMethodEnabled(kind: PaymentSourceKind, flags: { card: boolean; nequi: boolean; bancolombiaTransfer: boolean }): boolean {
        if (kind === 'card') return flags.card;
        if (kind === 'nequi') return flags.nequi;
        if (kind === 'bancolombia_transfer') return flags.bancolombiaTransfer;
        return false;
    }

    /** Consent token identifier, for the audit trail — never the token itself. */
    private jtiOf(jwt: string): string | undefined {
        try {
            const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString('utf8'));
            return payload?.jti ?? payload?.jit ?? undefined;
        } catch {
            return undefined;
        }
    }
}
