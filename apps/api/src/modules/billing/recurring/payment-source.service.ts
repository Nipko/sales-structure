import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Cron } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { PaymentProviderFactory } from '../payment-provider.factory';
import { PaymentRoutingService } from '../payment-routing.service';
import { PaymentSourceKind } from '../adapters/provider-capabilities';
import { AcceptanceContract, AcceptanceContracts } from '../adapters/charging-provider.interface';
import { NormalizedBillingEvent, PaymentProviderName, isPaymentProviderName } from '../types/provider-types';
import { BillingEventType } from '../types/billing-event.enum';
import { SubscriptionStatus } from '../types/subscription-status.enum';
import { SubscriptionEngineService } from './subscription-engine.service';
import { RENEWAL_QUEUE } from './renewal-scheduler.service';
import { anchorDayOf, chargeTimeFor, nextPeriodEnd } from './period.util';
import { resolveLocalPlanPrice } from '../plan-local-price.util';
import { FiscalConfigService } from '../../fiscal/fiscal-config.service';
import { billingCountryRequiresFiscalData, isFiscalDataComplete } from '../../fiscal/fiscal-data.util';
import { wompiTransactionLimitViolation } from './renewal-scheduler.service';

/** Methods that can be charged without the customer present. */
const UNATTENDED_KINDS: PaymentSourceKind[] = ['card', 'nequi', 'bancolombia_transfer'];
const ACCEPTANCE_CHALLENGE_TTL_SECONDS = 10 * 60;
const PAYMENT_SOURCE_AUTH_LOCK_SECONDS = 30;
const PAYMENT_SOURCE_SWEEP_LOCK_SECONDS = 4 * 60;
const DEFAULT_PAYMENT_DESCRIPTION = 'Suscripción Parallly';

type ContractEvidence = {
    type: string;
    permalink: string;
    version: string;
    jti?: string;
    fileHash?: string;
};

type AcceptanceChallenge = {
    provider: PaymentProviderName;
    acceptance: AcceptanceContracts;
    endUserPolicy: ContractEvidence;
    personalDataAuth: ContractEvidence;
    issuedAt: string;
};

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
        private readonly fiscalConfig: FiscalConfigService,
        @InjectQueue(RENEWAL_QUEUE) private readonly renewalQueue: Queue,
    ) {}

    /**
     * Issue a one-use consent challenge tied to the exact contract versions
     * shown to this tenant. Merely fetching fresh provider tokens during POST is
     * not consent: without this nonce an API caller could bypass the checkboxes
     * while we falsely recorded `acceptedAt`.
     */
    async issueAcceptanceChallenge(tenantId: string): Promise<{
        provider: PaymentProviderName;
        consentId: string;
        expiresAt: string;
        endUserPolicy: ContractEvidence;
        personalDataAuth: ContractEvidence;
    }> {
        const provider = await this.resolveProvider(tenantId);
        const charging = this.providerFactory.getCharging(provider);
        const acceptance = await charging.getAcceptanceContracts();
        if (!acceptance.personalDataAuth?.token) {
            throw new BadRequestException({
                error: 'personal_data_acceptance_unavailable',
                message: 'The provider did not return the mandatory personal-data contract.',
            });
        }

        const consentId = randomUUID();
        const issuedAt = new Date();
        const endUserPolicy = this.contractEvidence(acceptance.endUserPolicy);
        const personalDataAuth = this.contractEvidence(acceptance.personalDataAuth);
        const challenge: AcceptanceChallenge = {
            provider,
            acceptance,
            endUserPolicy,
            personalDataAuth,
            issuedAt: issuedAt.toISOString(),
        };
        await this.redis.setJson(
            this.acceptanceKey(tenantId, consentId),
            challenge,
            ACCEPTANCE_CHALLENGE_TTL_SECONDS,
        );
        return {
            provider,
            consentId,
            expiresAt: new Date(issuedAt.getTime() + ACCEPTANCE_CHALLENGE_TTL_SECONDS * 1000).toISOString(),
            endUserPolicy,
            personalDataAuth,
        };
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
        consentId: string;
        acceptEndUserPolicy: boolean;
        acceptPersonalDataAuth: boolean;
        acceptedIp?: string;
        acceptedByUserId?: string;
        acceptedByEmail?: string;
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

        if (!input.acceptEndUserPolicy || !input.acceptPersonalDataAuth) {
            throw new BadRequestException({
                error: 'explicit_acceptance_required',
                message: 'Both Wompi contracts must be explicitly accepted.',
            });
        }
        const challengeRaw = await this.redis.getDel(this.acceptanceKey(input.tenantId, input.consentId));
        if (!challengeRaw) {
            throw new BadRequestException({
                error: 'acceptance_challenge_invalid',
                message: 'The acceptance challenge is invalid, expired, or was already used.',
            });
        }
        let challenge: AcceptanceChallenge;
        try {
            challenge = JSON.parse(challengeRaw) as AcceptanceChallenge;
        } catch {
            throw new BadRequestException({ error: 'acceptance_challenge_invalid' });
        }
        if (challenge.provider !== provider || !challenge.acceptance?.personalDataAuth?.token) {
            throw new BadRequestException({
                error: 'acceptance_challenge_mismatch',
                message: 'The accepted contracts do not belong to the selected payment provider.',
            });
        }

        const charging = this.providerFactory.getCharging(provider);
        const acceptance = challenge.acceptance;
        const paymentDescription = DEFAULT_PAYMENT_DESCRIPTION;

        const source = await charging.startPaymentSource({
            tenantId: input.tenantId,
            kind: input.kind,
            token: input.token,
            customerEmail: input.customerEmail,
            acceptance,
            paymentDescription,
        });

        const acceptedAt = new Date();
        const consentMetadata = {
            consentId: input.consentId,
            endUserPolicy: { ...challenge.endUserPolicy, accepted: true },
            personalDataAuth: { ...challenge.personalDataAuth, accepted: true },
            acceptedAt: acceptedAt.toISOString(),
            acceptedByUserId: input.acceptedByUserId,
            acceptedByEmail: input.acceptedByEmail,
        };
        const uniqueWhere = {
            provider_providerSourceId: {
                provider,
                providerSourceId: source.providerSourceId,
            },
        };
        const createData = {
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
            acceptedAt,
            acceptedIp: input.acceptedIp,
            acceptanceJti: challenge.endUserPolicy.jti,
            acceptanceFileHash: challenge.endUserPolicy.fileHash,
            metadata: {
                customerEmail: input.customerEmail,
                paymentDescription,
                consent: consentMetadata,
            },
        };
        const updateData = {
            status: source.status,
            brand: source.brand,
            last4: source.last4,
            expMonth: source.expMonth,
            expYear: source.expYear,
            phoneMasked: source.phoneMasked,
            authTokenId: source.authTokenId,
            authUrl: source.authorizationUrl,
            acceptedAt,
            acceptedIp: input.acceptedIp,
            acceptanceJti: challenge.endUserPolicy.jti,
            acceptanceFileHash: challenge.endUserPolicy.fileHash,
            metadata: createData.metadata,
        };

        // Never use a global upsert here: its UPDATE branch is selected by the
        // provider id alone and previously let tenant B overwrite tenant A's
        // status/consent metadata before the later setDefault ownership check.
        let existing = await this.prisma.billingPaymentSource.findUnique({ where: uniqueWhere });
        this.assertSourceOwner(existing, input.tenantId);
        let stored;
        if (existing) {
            stored = await this.prisma.billingPaymentSource.update({
                where: { id: existing.id },
                data: updateData,
            });
        } else {
            try {
                stored = await this.prisma.billingPaymentSource.create({ data: createData });
            } catch (err: any) {
                // Close the concurrent-create race. Whoever won the unique
                // (provider,source) key is re-read and ownership is checked
                // before any update is attempted.
                if (err?.code !== 'P2002') throw err;
                existing = await this.prisma.billingPaymentSource.findUnique({ where: uniqueWhere });
                if (!existing) throw err;
                this.assertSourceOwner(existing, input.tenantId);
                stored = await this.prisma.billingPaymentSource.update({
                    where: { id: existing.id },
                    data: updateData,
                });
            }
        }

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
            await this.armEngineForNewSource(input.tenantId, stored.id);
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

    /**
     * Poner una suscripción bajo nuestro motor en cuanto tiene con qué cobrarse.
     *
     * Es el eslabón que faltaba del ciclo. Con un operador sin suscripciones
     * nativas, NADIE cobra si el motor no está encendido: el trial vencía en
     * silencio, con la tarjeta del cliente guardada y sin un solo intento de
     * cobro. El scheduler ya sabía qué hacer; nunca veía estas suscripciones
     * porque seguían en `engine='provider'`.
     *
     * Cuándo se cobra:
     *   · trial vigente → al vencer. El cliente tiene días prometidos y cargarle
     *     por adelantado por haber guardado la tarjeta rompería el trato.
     *   · sin trial (o vencido) → en el próximo barrido.
     *
     * No toca una suscripción que ya tiene motor: de esos reintentos se ocupa
     * el dunning, que sabe en qué escalón va.
     */
    private async armEngineForNewSource(
        tenantId: string,
        sourceId: string,
        propagateUnexpected = false,
    ): Promise<'armed' | 'noop' | 'pending'> {
        try {
            const sub = await this.subscriptionOf(tenantId);
            if (!sub || sub.engine === 'internal') return 'noop';

            const capabilities = this.providerFactory.capabilitiesOf(sub.provider as PaymentProviderName);
            if (capabilities.nativeSubscriptions) return 'noop'; // lo cobra el proveedor

            const startsNormalActivation = [
                SubscriptionStatus.TRIALING,
                SubscriptionStatus.PENDING_AUTH,
            ].includes(sub.status as any);
            // Cohort migrated away from the retired MercadoPago rail: these
            // rows can say ACTIVE/PAST_DUE even though no provider mandate ever
            // existed.  A newly stored Wompi source is their recovery path, but
            // they must first lose entitlement (PENDING_AUTH) and only return
            // ACTIVE after the initial charge is APPROVED.
            const isLegacyUnbacked = [
                SubscriptionStatus.ACTIVE,
                SubscriptionStatus.PAST_DUE,
            ].includes(sub.status as any)
                && !sub.providerSubscriptionId
                && !String(sub.cancellationReason ?? '').startsWith('comp:');
            if (!startsNormalActivation && !isLegacyUnbacked) return 'noop';

            // Precio congelado. Una suscripción nacida ANTES del motor no lo
            // tiene, y dejarla sin armar la condenaba a vencer sin un solo
            // intento de cobro. Derivarlo del plan y el país del tenant no es
            // inventar plata: es exactamente el precio que el catálogo le mostró
            // al contratar, el mismo que usa el alta.
            let amountCents = sub.chargeAmountCents;
            let currency = sub.chargeCurrency;

            if (!amountCents || !currency) {
                const [plan, tenant] = await Promise.all([
                    this.prisma.billingPlan.findUnique({ where: { id: sub.planId } }),
                    this.prisma.tenant.findUnique({
                        where: { id: tenantId },
                        select: { billingCountry: true },
                    }),
                ]);
                const cycle = (sub.metadata as any)?.billingCycle === 'annual' ? 'annual' : 'monthly';
                const derived = plan
                    ? resolveLocalPlanPrice(plan.priceLocalOverrides, tenant?.billingCountry, cycle)
                    : null;
                if (!derived) {
                    // Sin precio configurado para ese país no hay nada honesto que
                    // cobrar. Queda registrado para que el Ops Center lo vea.
                    this.logger.warn(
                        `[PaymentSource] Subscription ${sub.id} has a payment method but no price configured `
                        + `for its plan/country — engine not armed.`,
                    );
                    if (typeof (this.prisma.billingSubscription as any).updateMany === 'function') {
                        await this.prisma.billingSubscription.updateMany({
                            where: { tenantId },
                            data: { dunningState: 'activation_pending' },
                        });
                    }
                    return 'pending';
                }
                amountCents = derived.amountCents;
                currency = derived.currency;
            }

            const source = await this.prisma.billingPaymentSource.findFirst({
                where: { id: sourceId, tenantId, provider: sub.provider, status: 'available' },
            });
            if (!source) return 'pending';

            const tenantFiscal = await this.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { billingCountry: true, settings: true, isInternal: true },
            });
            const fiscal = await this.fiscalConfig.getConfig();
            if (isLegacyUnbacked && tenantFiscal?.isInternal) return 'noop';
            if (fiscal.fiscalGateEnabled
                && !tenantFiscal?.isInternal
                && billingCountryRequiresFiscalData(tenantFiscal?.billingCountry)
                && !isFiscalDataComplete(tenantFiscal?.settings)) {
                throw new BadRequestException({
                    error: 'fiscal_data_required',
                    message: 'Completa tus datos fiscales antes de activar el cobro de la suscripción.',
                });
            }

            if (sub.provider === 'wompi') {
                const limitViolation = wompiTransactionLimitViolation(amountCents, currency);
                if (limitViolation) {
                    throw new BadRequestException({
                        error: limitViolation.error,
                        amountCents,
                        limitCents: limitViolation.limitCents,
                        message: limitViolation.limitCents
                            ? 'El valor del plan supera el tope contractual configurado para una transacción Wompi.'
                            : 'Configura el tope contractual de Wompi antes de activar cobros.',
                    });
                }
            }

            const now = new Date();
            const pendingTrialDays = Number((sub.metadata as any)?.trialDaysPending ?? 0);
            const startsCardBackedTrial = sub.status === SubscriptionStatus.PENDING_AUTH
                && Number.isSafeInteger(pendingTrialDays)
                && pendingTrialDays > 0;
            const trialEndsAt = isLegacyUnbacked
                ? null
                : startsCardBackedTrial
                ? new Date(now.getTime() + pendingTrialDays * 86_400_000)
                : sub.trialEndsAt;
            const trialAlive = !!trialEndsAt && trialEndsAt.getTime() > now.getTime();
            const timezone = sub.billingTimezone || 'America/Bogota';
            const chargeAt = trialAlive ? trialEndsAt! : now;
            const cycle = (sub.metadata as any)?.billingCycle === 'annual' ? 'annual' : 'monthly';
            const anchorDay = sub.billingAnchorDay ?? anchorDayOf(chargeAt);
            const initialPeriodEnd = trialAlive
                ? trialEndsAt!
                : nextPeriodEnd(now, cycle, anchorDay);

            const subscriptionUpdate = {
                    engine: 'internal',
                    ...(startsCardBackedTrial
                        ? {
                            status: SubscriptionStatus.TRIALING,
                            trialStartedAt: now,
                            trialEndsAt,
                            currentPeriodStart: now,
                            currentPeriodEnd: trialEndsAt,
                            metadata: {
                                ...(sub.metadata as any ?? {}),
                                trialDaysPending: null,
                            } as any,
                        }
                        : !trialAlive
                            ? {
                                ...(isLegacyUnbacked ? { status: SubscriptionStatus.PENDING_AUTH } : {}),
                                ...(isLegacyUnbacked ? { trialStartedAt: null, trialEndsAt: null } : {}),
                                currentPeriodStart: now,
                                currentPeriodEnd: initialPeriodEnd,
                            }
                            : {}),
                    // El precio queda congelado acá si la suscripción no lo traía:
                    // el cobro del vencimiento será por el importe que el catálogo
                    // mostró, no por el que haya ese día.
                    chargeAmountCents: amountCents,
                    chargeCurrency: currency,
                    defaultPaymentSourceId: source.id,
                    unattendedCapable: source.supportsUnattended,
                    billingAnchorDay: anchorDay,
                    billingTimezone: timezone,
                    // A no-trial activation is pre-claimed below. Null keeps a
                    // concurrent scheduler from manufacturing another initial
                    // period before APPROVED advances the subscription.
                    nextChargeAt: trialAlive ? chargeAt : null,
                    dunningState: 'none',
                } as const;

            const plan = startsCardBackedTrial || isLegacyUnbacked
                ? await this.prisma.billingPlan.findUnique({
                    where: { id: sub.planId },
                    select: { slug: true },
                })
                : null;
            const tenantUpdate = startsCardBackedTrial
                ? {
                    subscriptionStatus: SubscriptionStatus.TRIALING,
                    trialEndsAt,
                    currentPeriodEnd: trialEndsAt,
                    ...(plan ? { plan: plan.slug } : {}),
                }
                : isLegacyUnbacked
                    ? {
                        subscriptionStatus: SubscriptionStatus.PENDING_AUTH,
                        trialEndsAt: null,
                        currentPeriodEnd: initialPeriodEnd,
                    }
                    : null;

            // Authorization callbacks and the activation sweeper can race. The
            // subscription row is the durable mutex: the winner flips the
            // engine and claims the first charge in the same transaction; a
            // callback that waited on the lock observes engine=internal and is
            // a no-op, even if the calls straddled UTC midnight.
            const activation = await this.prisma.$transaction(async (tx: any) => {
                await tx.$queryRawUnsafe(
                    'SELECT id FROM billing_subscriptions WHERE id = $1::uuid FOR UPDATE',
                    sub.id,
                );
                const liveSub = await tx.billingSubscription.findUnique({ where: { id: sub.id } });
                if (!liveSub || liveSub.engine === 'internal') {
                    return { armed: false as const, claim: null };
                }
                if (liveSub.provider !== sub.provider) {
                    throw new Error('subscription_provider_changed_during_activation');
                }
                const liveSource = await tx.billingPaymentSource.findFirst({
                    where: {
                        id: source.id,
                        tenantId,
                        provider: liveSub.provider,
                        status: 'available',
                    },
                });
                if (!liveSource) return { armed: false as const, claim: null };
                await tx.billingSubscription.update({
                    where: { id: liveSub.id },
                    data: {
                        ...subscriptionUpdate,
                        defaultPaymentSourceId: liveSource.id,
                        unattendedCapable: liveSource.supportsUnattended,
                    },
                });
                if (tenantUpdate) {
                    await tx.tenant.update({ where: { id: tenantId }, data: tenantUpdate });
                }
                const claim = !trialAlive
                    ? await this.engine.claimAttempt({
                        subscriptionId: liveSub.id,
                        tenantId,
                        provider: liveSub.provider as PaymentProviderName,
                        purpose: 'initial',
                        periodStart: now,
                        periodEnd: initialPeriodEnd,
                        amountCents,
                        currency,
                        scheduledAt: now,
                        paymentSourceId: liveSource.id,
                        operationKey: `initial-activation:${liveSub.id}`,
                        metadata: { operationKey: `initial-activation:${liveSub.id}` },
                    }, tx)
                    : null;
                return { armed: true as const, claim };
            });
            if (!activation.armed) return 'noop';

            if (tenantUpdate) {
                await Promise.allSettled([
                    this.redis.del(`tenant_plan:${tenantId}`),
                    this.redis.del(`sub_status:${tenantId}`),
                    this.redis.del(`plan_features:${tenantId}`),
                ]);
            }

            if (startsCardBackedTrial) {
                this.eventEmitter.emit(BillingEventType.TRIAL_STARTED, {
                    tenantId,
                    subscriptionId: sub.id,
                    trialStartedAt: now,
                    trialEndsAt,
                });
            }

            // A zero-day plan must not wait for a scheduler sweep after the
            // customer has completed checkout. Claim and enqueue the first
            // charge now; UNIQUE(cycle,attempt) keeps a concurrent sweep safe.
            if (!trialAlive) {
                if (activation.claim) {
                    await this.renewalQueue.add(
                        'charge',
                        { attemptId: activation.claim.id },
                        { jobId: activation.claim.id, attempts: 1, removeOnComplete: { age: 604_800 } },
                    );
                }
            }

            this.logger.log(
                `[PaymentSource] Subscription ${sub.id} armed on the internal engine — first charge ${chargeAt.toISOString()}`,
            );
            return 'armed';
        } catch (err: any) {
            if (err instanceof BadRequestException) throw err;
            if (typeof (this.prisma.billingSubscription as any).updateMany === 'function') {
                await this.prisma.billingSubscription.updateMany({
                    where: { tenantId },
                    data: { dunningState: 'activation_pending', nextChargeAt: new Date() },
                }).catch(() => undefined);
            }
            this.logger.error(`[PaymentSource] Could not arm the engine for tenant ${tenantId}: ${err?.message}`);
            if (propagateUnexpected) throw err;
            return 'pending';
        }
    }

    /** Re-read a source whose authorization was still pending. */
    async pollAuthorization(tenantId: string, sourceId: string) {
        let stored = await this.requireSource(tenantId, sourceId);
        if (stored.status !== 'pending_auth') return { status: stored.status };

        const lockKey = `lock:billing:source-auth:${stored.id}`;
        const lockToken = await this.redis.acquireLockToken(lockKey, PAYMENT_SOURCE_AUTH_LOCK_SECONDS);
        if (!lockToken) {
            // Another request is finishing the same one-use provider token.
            stored = await this.requireSource(tenantId, sourceId);
            return { status: stored.status };
        }

        try {
            // Re-read under the lock: the request that held it immediately
            // before us may already have completed the source.
            stored = await this.requireSource(tenantId, sourceId);
            if (stored.status !== 'pending_auth') return { status: stored.status };

            const charging = this.providerFactory.getCharging(stored.provider as PaymentProviderName);
            const metadata = (stored.metadata as any) ?? {};
            const acceptedConsent = metadata.consent;
            const freshAcceptance = await charging.getAcceptanceContracts();
            if (
                !acceptedConsent?.endUserPolicy
                || !acceptedConsent?.personalDataAuth
                || !this.sameContractVersion(acceptedConsent.endUserPolicy, freshAcceptance.endUserPolicy)
                || !this.sameContractVersion(acceptedConsent.personalDataAuth, freshAcceptance.personalDataAuth)
            ) {
                throw new BadRequestException({
                    error: 'acceptance_contract_changed',
                    message: 'Wompi contract versions changed while authorization was pending; accept them again.',
                });
            }

            const fresh = await charging.pollPaymentSourceAuth(
                stored.providerSourceId,
                stored.authTokenId ?? undefined,
                {
                    kind: stored.kind as PaymentSourceKind,
                    customerEmail: metadata.customerEmail || '',
                    paymentDescription: metadata.paymentDescription || DEFAULT_PAYMENT_DESCRIPTION,
                    acceptance: freshAcceptance,
                },
            );

            if (fresh.status !== stored.status || fresh.providerSourceId !== stored.providerSourceId) {
                await this.prisma.billingPaymentSource.update({
                    where: { id: stored.id },
                    data: {
                        providerSourceId: fresh.providerSourceId,
                        status: fresh.status,
                        brand: fresh.brand,
                        last4: fresh.last4,
                        expMonth: fresh.expMonth,
                        expYear: fresh.expYear,
                        phoneMasked: fresh.phoneMasked,
                        authTokenId: fresh.status === 'pending_auth' ? fresh.authTokenId : null,
                        authUrl: fresh.status === 'pending_auth' ? fresh.authorizationUrl : null,
                    },
                });
                if (fresh.status === 'available') {
                    await this.setDefault(tenantId, stored.id);
                    this.eventEmitter.emit('billing.payment_source.added', {
                        tenantId,
                        subscriptionId: (await this.subscriptionOf(tenantId))?.id,
                        paymentSourceId: stored.id,
                    });
                    await this.armEngineForNewSource(tenantId, stored.id);
                }
            }
            return { status: fresh.status, authorizationUrl: fresh.authorizationUrl };
        } finally {
            await this.redis.releaseLockToken(lockKey, lockToken);
        }
    }

    /** Idempotent recovery after fiscal/profile configuration was completed. */
    async activatePendingSubscription(tenantId: string): Promise<any> {
        const sub = await this.subscriptionOf(tenantId);
        if (!sub) throw new NotFoundException({ error: 'subscription_not_found' });
        if (sub.engine === 'internal') return sub;
        const source = await this.prisma.billingPaymentSource.findFirst({
            where: { tenantId, provider: sub.provider, status: 'available' },
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
        });
        if (!source) throw new BadRequestException({ error: 'no_payment_method' });
        await this.armEngineForNewSource(tenantId, source.id, true);
        return this.subscriptionOf(tenantId);
    }

    /**
     * The customer may close the redirect/push screen before the dashboard
     * polls our status endpoint. A signed Wompi token webhook therefore runs
     * the same locked finalizer and makes authorization independent of the UI.
     */
    @OnEvent(BillingEventType.PAYMENT_METHOD_AUTHORIZED, { async: true })
    async onPaymentMethodAuthorized(payload: { event?: NormalizedBillingEvent }): Promise<void> {
        await this.finishPaymentSourceFromEvent(payload?.event, false);
    }

    @OnEvent(BillingEventType.PAYMENT_METHOD_DECLINED, { async: true })
    async onPaymentMethodDeclined(payload: { event?: NormalizedBillingEvent }): Promise<void> {
        await this.finishPaymentSourceFromEvent(payload?.event, true);
    }

    /**
     * Durable recovery for wallet/bank authorizations. EventEmitter listeners
     * run after billing_events commits, so their failure cannot make Wompi retry
     * the already-durable event. This sweep makes the webhook an accelerator,
     * not the sole completion path.
     */
    @Cron('*/5 * * * *')
    async reconcilePendingAuthorizationsCron(): Promise<void> {
        const lockKey = 'lock:cron:billing:payment-source-authorization';
        const lockToken = await this.redis.acquireLockToken(lockKey, PAYMENT_SOURCE_SWEEP_LOCK_SECONDS);
        if (!lockToken) return;
        try {
            const [result, activations] = await Promise.all([
                this.reconcilePendingAuthorizations(),
                this.reconcilePendingActivations(),
            ]);
            if (result.completed || result.failed || activations.armed || activations.failed) {
                this.logger.log(
                    `[PaymentSource] Pending auth sweep scanned=${result.scanned} completed=${result.completed} failed=${result.failed}; `
                    + `activation sweep scanned=${activations.scanned} armed=${activations.armed} failed=${activations.failed}`,
                );
            }
        } finally {
            await this.redis.releaseLockToken(lockKey, lockToken).catch(() => undefined);
        }
    }

    /**
     * Retry engine arming after the source was persisted but a transient DB or
     * queue failure interrupted activation.  `activation_pending` is durable;
     * this makes the explicit activation endpoint an accelerator rather than
     * the only recovery path.
     */
    async reconcilePendingActivations(): Promise<{ scanned: number; armed: number; failed: number }> {
        let scanned = 0;
        let armed = 0;
        let failed = 0;
        for (let page = 0; page < 10; page++) {
            const eligible = await this.prisma.$queryRawUnsafe(
                `SELECT s.id
                   FROM billing_subscriptions s
                  WHERE s.engine = 'provider'
                    AND s.provider_subscription_id IS NULL
                    AND s.dunning_state = 'activation_pending'
                    AND s.status IN ('trialing', 'pending_auth', 'active', 'past_due')
                    AND COALESCE(
                            NULLIF(s.metadata->>'activationNextCheckAt', '')::timestamptz,
                            '-infinity'::timestamptz
                        ) <= NOW()
                    AND EXISTS (
                        SELECT 1
                          FROM billing_payment_sources ps
                         WHERE ps.tenant_id = s.tenant_id
                           AND ps.provider = s.provider
                           AND ps.status = 'available'
                    )
                  ORDER BY s.created_at ASC, s.id ASC
                  LIMIT 50`,
            ) as Array<{ id: string }>;
            if (!eligible.length) break;
            const subscriptions = await this.prisma.billingSubscription.findMany({
                where: {
                    id: { in: eligible.map((row) => row.id) },
                    engine: 'provider',
                    providerSubscriptionId: null,
                    dunningState: 'activation_pending',
                    status: {
                        in: [
                            SubscriptionStatus.TRIALING,
                            SubscriptionStatus.PENDING_AUTH,
                            SubscriptionStatus.ACTIVE,
                            SubscriptionStatus.PAST_DUE,
                        ],
                    },
                },
                orderBy: { createdAt: 'asc' },
                take: 50,
            });
            scanned += subscriptions.length;
            for (const sub of subscriptions) {
                const source = await this.prisma.billingPaymentSource.findFirst({
                    where: {
                        tenantId: sub.tenantId,
                        provider: sub.provider,
                        status: 'available',
                    },
                    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
                });
                if (!source) {
                    await this.deferPendingActivation(sub, 'available_source_disappeared');
                    continue;
                }
                try {
                    const result = await this.armEngineForNewSource(sub.tenantId, source.id, true);
                    if (result === 'armed') {
                        armed++;
                    } else if (result === 'pending') {
                        await this.deferPendingActivation(sub, 'activation_still_pending');
                    } else {
                        // A concurrent callback may already have armed it. If the
                        // row is still pending for some other reason, moving it to
                        // the back of the durable queue avoids hot-loop starvation.
                        await this.deferPendingActivation(sub, 'activation_noop');
                    }
                } catch (error: any) {
                    failed++;
                    await this.deferPendingActivation(sub, error?.message ?? 'activation_failed').catch(() => undefined);
                    this.logger.error(
                        `[PaymentSource] Activation recovery failed for subscription ${sub.id}: ${error?.message ?? error}`,
                    );
                }
            }
            if (eligible.length < 50) break;
        }
        return { scanned, armed, failed };
    }

    private async deferPendingActivation(sub: any, reason: string): Promise<void> {
        const metadata = sub.metadata && typeof sub.metadata === 'object' ? sub.metadata : {};
        const count = Math.max(0, Number(metadata.activationCheckCount) || 0) + 1;
        const delayMs = Math.min(24 * 60 * 60_000, 5 * 60_000 * (2 ** Math.min(count - 1, 8)));
        await this.prisma.billingSubscription.updateMany({
            where: { id: sub.id, engine: 'provider', dunningState: 'activation_pending' },
            data: {
                metadata: {
                    ...metadata,
                    activationCheckCount: count,
                    activationNextCheckAt: new Date(Date.now() + delayMs).toISOString(),
                    activationLastError: String(reason).slice(0, 300),
                } as any,
            },
        });
    }

    async reconcilePendingAuthorizations(): Promise<{ scanned: number; completed: number; failed: number }> {
        const now = new Date();
        // Provider redirects/tokens that carry an explicit expiry must not stay
        // pending forever. Null remains supported because not every Wompi token
        // response exposes a contractual expiry.
        await this.prisma.billingPaymentSource.updateMany({
            where: {
                provider: 'wompi',
                status: 'pending_auth',
                authExpiresAt: { lt: now },
            },
            data: { status: 'expired', authUrl: null, lastFailureAt: now },
        });
        type PendingAuthRow = {
            id: string;
            tenantId: string;
            metadata: any;
            pendingCheckCount: number;
        };
        let scanned = 0;
        let completed = 0;
        let failed = 0;
        // Once a row remains pending it receives a durable next-check timestamp,
        // then the query advances to another page. This prevents the oldest 20
        // wallet pushes from starving every newer authorization indefinitely.
        for (let page = 0; page < 10; page++) {
            const pending = await this.prisma.$queryRawUnsafe(
                `SELECT id,
                        tenant_id AS "tenantId",
                        metadata,
                        COALESCE((metadata->>'authPollCount')::int, 0) AS "pendingCheckCount"
                   FROM billing_payment_sources
                  WHERE provider = 'wompi'
                    AND status = 'pending_auth'
                    AND auth_token_id IS NOT NULL
                    AND kind IN ('nequi', 'bancolombia_transfer')
                    AND (auth_expires_at IS NULL OR auth_expires_at > NOW())
                    AND COALESCE(
                            NULLIF(metadata->>'authPollNextAt', '')::timestamptz,
                            '-infinity'::timestamptz
                        ) <= NOW()
                  ORDER BY created_at ASC, id ASC
                  LIMIT 20`,
            ) as PendingAuthRow[];
            if (!pending.length) break;
            scanned += pending.length;

            // Four concurrent public token reads keep each page bounded without
            // creating a burst large enough to trip Wompi's rate limits.
            for (let index = 0; index < pending.length; index += 4) {
                const batch = pending.slice(index, index + 4);
                const results = await Promise.allSettled(
                    batch.map((source) => this.pollAuthorization(source.tenantId, source.id)),
                );
                for (let resultIndex = 0; resultIndex < results.length; resultIndex++) {
                    const result = results[resultIndex];
                    const source = batch[resultIndex];
                    if (result.status === 'fulfilled') {
                        if (result.value?.status !== 'pending_auth') {
                            completed++;
                        } else {
                            await this.deferAuthorizationPoll(source);
                        }
                    } else {
                        failed++;
                        await this.deferAuthorizationPoll(source).catch(() => undefined);
                    }
                }
            }

            if (pending.length < 20) break;
        }
        return { scanned, completed, failed };
    }

    private async deferAuthorizationPoll(source: {
        id: string;
        metadata?: any;
        pendingCheckCount?: number;
    }): Promise<void> {
        const count = Math.max(0, Number(source.pendingCheckCount) || 0) + 1;
        const delayMs = Math.min(60 * 60_000, 5 * 60_000 * (2 ** Math.min(count - 1, 4)));
        const metadata = source.metadata && typeof source.metadata === 'object'
            ? source.metadata
            : {};
        await this.prisma.billingPaymentSource.updateMany({
            where: { id: source.id, status: 'pending_auth' },
            data: {
                metadata: {
                    ...metadata,
                    authPollCount: count,
                    authPollNextAt: new Date(Date.now() + delayMs).toISOString(),
                } as any,
            },
        });
    }

    async listPaymentSources(tenantId: string) {
        const sources = await this.prisma.billingPaymentSource.findMany({
            where: { tenantId, status: { in: ['available', 'pending_auth'] } },
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
        });
        // Never expose provider ids or consent tokens to the dashboard.
        // The callback parameter is annotated explicitly: integration builds do
        // not always have the generated Prisma client at hand, and then infer it
        // as implicit `any` — passing locally and failing there.
        return sources.map((s: typeof sources[number]) => ({
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
        const sub = await this.subscriptionOf(tenantId);
        if (!sub) throw new NotFoundException({ error: 'subscription_not_found' });
        if (source.provider !== sub.provider) {
            throw new BadRequestException({ error: 'payment_source_provider_mismatch' });
        }
        if (source.status !== 'available') {
            throw new BadRequestException({
                error: 'source_not_available',
                message: 'That payment method is not ready to be charged yet.',
            });
        }
        await this.prisma.$transaction([
            this.prisma.billingPaymentSource.updateMany({
                where: { tenantId, provider: sub.provider, isDefault: true },
                data: { isDefault: false },
            }),
            this.prisma.billingPaymentSource.update({
                where: { id: sourceId },
                data: { isDefault: true },
            }),
            this.prisma.billingSubscription.updateMany({
                where: { tenantId, provider: sub.provider },
                data: { defaultPaymentSourceId: sourceId, unattendedCapable: source.supportsUnattended },
            }),
            this.prisma.billingChargeAttempt.updateMany({
                where: { tenantId, provider: sub.provider, status: 'scheduled' },
                data: { paymentSourceId: sourceId },
            }),
        ]);
    }

    async removePaymentSource(tenantId: string, sourceId: string): Promise<void> {
        const source = await this.requireSource(tenantId, sourceId);
        const liveAttempt = await this.prisma.billingChargeAttempt.findFirst({
            where: {
                tenantId,
                provider: source.provider,
                paymentSourceId: sourceId,
                status: { in: ['in_flight', 'pending_provider'] },
            },
            select: { id: true, reference: true },
        });
        if (liveAttempt) {
            throw new BadRequestException({
                error: 'payment_source_in_use',
                message: 'Este medio participa en un cobro pendiente; espera su resolución antes de eliminarlo.',
                attemptId: liveAttempt.id,
                reference: liveAttempt.reference,
            });
        }
        const charging = this.providerFactory.getCharging(source.provider as PaymentProviderName);
        // Fail closed: reporting success while Wompi still holds an active debit
        // mandate is both a privacy and a money-movement bug. The local source is
        // only marked voided after the provider confirms PUT /void.
        await charging.voidPaymentSource(source.providerSourceId);
        const replacement = await this.prisma.billingPaymentSource.findFirst({
            where: { tenantId, provider: source.provider, id: { not: sourceId }, status: 'available' },
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
        });
        await this.prisma.$transaction([
            this.prisma.billingPaymentSource.update({
                where: { id: sourceId },
                data: { status: 'voided', isDefault: false, voidedAt: new Date() },
            }),
            ...(replacement
                ? [this.prisma.billingPaymentSource.update({
                    where: { id: replacement.id },
                    data: { isDefault: true },
                })]
                : []),
            this.prisma.billingSubscription.updateMany({
                where: { tenantId, provider: source.provider, defaultPaymentSourceId: sourceId },
                data: {
                    defaultPaymentSourceId: replacement?.id ?? null,
                    unattendedCapable: replacement?.supportsUnattended ?? false,
                },
            }),
            this.prisma.billingChargeAttempt.updateMany({
                where: { tenantId, provider: source.provider, paymentSourceId: sourceId, status: 'scheduled' },
                data: { paymentSourceId: replacement?.id ?? null },
            }),
        ]);
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
            where: {
                tenantId: input.tenantId,
                provider: sub.provider,
                isDefault: true,
                status: 'available',
            },
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
        // Una suscripción viva conserva su proveedor — CON UNA EXCEPCIÓN: si el
        // nombre congelado quedó retirado (mercadopago) y no hay ningún mandato
        // del otro lado (providerSubscriptionId nulo = trial local, nada que
        // esos ids signifiquen), congelarlo por el nombre dejaba al tenant
        // varado: el checkout le mostraba Wompi y esta resolución le devolvía
        // un proveedor sin adapter que no puede guardar instrumentos. En ese
        // caso, y solo en ese, se re-resuelve como alta nueva.
        if (sub?.provider) {
            const frozen = this.routing.resolveForSubscription(sub.provider);
            if (sub.providerSubscriptionId || isPaymentProviderName(frozen)) return frozen;
        }

        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { billingCountry: true, paymentProviderOverride: true },
        });
        const resolution = await this.routing.resolveForNewSubscription({
            tenantId,
            tenantOverride: tenant?.paymentProviderOverride,
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

    private assertSourceOwner(source: { tenantId: string } | null, tenantId: string): void {
        if (source && source.tenantId !== tenantId) {
            throw new ConflictException({
                error: 'payment_source_owner_conflict',
                message: 'That provider payment source is already bound to another tenant.',
            });
        }
    }

    private isWompiMethodEnabled(kind: PaymentSourceKind, flags: { card: boolean; nequi: boolean; bancolombiaTransfer: boolean }): boolean {
        if (kind === 'card') return flags.card;
        if (kind === 'nequi') return flags.nequi;
        if (kind === 'bancolombia_transfer') return flags.bancolombiaTransfer;
        return false;
    }

    private acceptanceKey(tenantId: string, consentId: string): string {
        return `billing:acceptance:${tenantId}:${consentId}`;
    }

    /** Decode only non-secret claims needed to identify the shown contract. */
    private claimsOf(jwt: string): Record<string, unknown> {
        try {
            const encoded = jwt.split('.')[1];
            if (!encoded) return {};
            return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
        } catch {
            return {};
        }
    }

    /**
     * `file_hash` is Wompi's stable contract version. JTI/JIT identifies a
     * short-lived token and changes when refreshed, so it is audit evidence but
     * deliberately not the version comparison key.
     */
    private contractEvidence(contract: AcceptanceContract): ContractEvidence {
        if (!contract?.token || !contract?.permalink || !contract?.type) {
            throw new BadRequestException({
                error: 'acceptance_contract_incomplete',
                message: 'The provider returned an incomplete acceptance contract.',
            });
        }
        const claims = this.claimsOf(contract.token);
        const jti = typeof claims.jti === 'string'
            ? claims.jti
            : typeof claims.jit === 'string'
                ? claims.jit
                : undefined;
        const fileHash = typeof claims.file_hash === 'string'
            ? claims.file_hash
            : typeof claims.fileHash === 'string'
                ? claims.fileHash
                : undefined;
        const fallbackVersion = createHash('sha256')
            .update(`${contract.type}\0${contract.permalink}`)
            .digest('hex');
        return {
            type: contract.type,
            permalink: contract.permalink,
            version: fileHash || fallbackVersion,
            jti,
            fileHash,
        };
    }

    private sameContractVersion(accepted: ContractEvidence, current: AcceptanceContract): boolean {
        const currentEvidence = this.contractEvidence(current);
        return accepted.type === currentEvidence.type
            && accepted.permalink === currentEvidence.permalink
            && accepted.version === currentEvidence.version;
    }

    private async finishPaymentSourceFromEvent(
        event: NormalizedBillingEvent | undefined,
        declined: boolean,
    ): Promise<void> {
        if (!event || event.provider !== 'wompi') return;
        const raw = event.rawPayload as any;
        const token = raw?.data?.nequi_token ?? raw?.data?.bancolombia_transfer_token;
        const tokenId = token?.id ?? token?.token;
        if (!tokenId) return;

        const sources = await this.prisma.billingPaymentSource.findMany({
            where: {
                provider: 'wompi',
                authTokenId: String(tokenId),
                status: 'pending_auth',
            },
            take: 2,
        });
        if (sources.length > 1) {
            const tokenFingerprint = createHash('sha256').update(String(tokenId)).digest('hex').slice(0, 12);
            this.logger.error(
                `[PaymentSource] Ambiguous Wompi auth token ${tokenFingerprint}: multiple pending tenants; refusing automatic completion`,
            );
            throw new Error('ambiguous_payment_source_auth_token');
        }
        const source = sources[0];
        if (!source) return;

        if (declined) {
            await this.prisma.billingPaymentSource.updateMany({
                where: { id: source.id, status: 'pending_auth' },
                data: { status: 'declined', authUrl: null },
            });
            return;
        }
        await this.pollAuthorization(source.tenantId, source.id);
    }
}
