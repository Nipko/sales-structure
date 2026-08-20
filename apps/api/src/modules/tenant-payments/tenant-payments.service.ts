import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    Optional,
    ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { WhatsappCryptoService } from '../whatsapp/services/whatsapp-crypto.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { resolveTenantSubscriptionAccess } from '../../common/utils/subscription-entitlement.util';
import {
    TenantPaymentCredentialCryptoService,
    type TenantPaymentCredentialContext,
    type TenantPaymentCredentialEnvironment,
    type TenantPaymentCredentialField,
    type TenantPaymentCredentialReadResult,
} from './tenant-payment-credential-crypto.service';
import {
    parsePaymentReference,
    type TenantPaymentProvider,
    type TenantPaymentStatus,
} from './tenant-payment-reference';
import {
    TenantPaymentStoreService,
    type CanonicalWompiTransaction,
    type TenantPaymentIntent,
} from './tenant-payment-store.service';
import {
    TenantWompiClient,
    WompiProviderError,
    type WompiEnvironment,
} from './tenant-wompi.client';
import { PAYMENT_HOLD_MS } from '../../common/utils/payment-policy.util';

/**
 * Why the empty cases are split: "the provider says nobody paid" is evidence
 * that lets an intent be expired and the reference freed for a new link, while
 * "we could not reach the provider" proves nothing and must keep the reference
 * blocked. Collapsing them would eventually expire an order that was paid.
 */
export interface TenantPaymentRecoveryResult {
    outcome: 'settled' | 'no_transaction' | 'unavailable';
    intent: TenantPaymentIntent | null;
}

const MP_API = 'https://api.mercadopago.com';
const MASK = '***' as const;
const MAX_PROVIDER_CREDENTIAL_HISTORY = 16;
const TENANT_PAYMENT_LINK_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Lo que vende cupo se cobra contra reloj; lo que no, no.
 *
 * Una reserva o una cita retienen la fecha 20 minutos mientras el cliente paga.
 * El enlace tiene que morir con esa retención: uno que sobrevive 24 horas
 * invita a pagar algo que ya no existe, y ese pago cae en el camino de "cobrado
 * sin lugar" — plata real sin nada que entregar.
 *
 * Un pedido o una factura no retienen nada, asi que ahi las 24 horas siguen
 * siendo lo correcto: acortarlas solo obligaria al cliente a pedir el enlace de
 * nuevo sin ganar nada.
 */
const CAPACITY_HOLDING_KINDS: ReadonlySet<string> = new Set(['property', 'appointment']);

/**
 * Tipos de pago que NO pueden convivir con una retención de 15 minutos.
 *
 * `ticket` es el efectivo (Efecty, Baloto y compañía): genera un cupón que se
 * paga en un punto físico, y Mercado Pago recomienda dejarle **al menos 3 días**.
 * Con la fecha retenida un cuarto de hora eso no cierra por ningún lado, y hay
 * algo peor que la incomodidad: si el cliente paga el cupón después del
 * vencimiento, MP **le devuelve la plata al pagador**. El cliente creería haber
 * reservado, al dueño no le entró nada y las fechas ya se liberaron.
 *
 * Por eso se excluye SOLO cuando hay retención: para un pedido o una factura,
 * pagar en efectivo a los tres días es perfectamente válido y se sigue
 * ofreciendo.
 *
 * La lista es corta a propósito. `ticket` es el único tipo offline que la
 * documentación nombra; el catálogo real de cada cuenta se consulta con
 * `GET /v1/payment_methods` usando el token del tenant. Inventar ids acá sería
 * arriesgar un 400 que dejaría al tenant sin poder cobrar.
 */
const OFFLINE_PAYMENT_TYPE_IDS: readonly string[] = ['ticket'];

class MercadoPagoProviderError extends Error {
    constructor(
        public readonly code: string,
        public readonly ambiguous: boolean,
        public readonly providerLinkId?: string,
    ) {
        super(code);
    }
}

interface StoredMercadoPagoCredentialGeneration {
    revision?: number;
    disabledAt?: string;
    accountId?: string;
    accessTokenEnc?: string;
    webhookSecretEnc?: string;
    environment?: WompiEnvironment;
    publicKey?: string;
    accountEmail?: string;
    verifiedAt?: string;
}

interface StoredMercadoPagoConfig extends StoredMercadoPagoCredentialGeneration {
    history?: StoredMercadoPagoCredentialGeneration[];
}

interface StoredWompiCredentialGeneration {
    revision?: number;
    disabledAt?: string;
    publicKey?: string;
    privateKeyEnc?: string;
    eventsSecretEnc?: string;
    webhookTokenEnc?: string;
    environment?: WompiEnvironment;
    merchantId?: string;
    merchantName?: string;
    verifiedAt?: string;
    webhookAcknowledgedAt?: string;
}

interface StoredWompiConfig extends StoredWompiCredentialGeneration {
    history?: StoredWompiCredentialGeneration[];
}

interface StoredTenantPaymentConfigV2 {
    version: 2;
    documentRevision?: number;
    activeProvider: TenantPaymentProvider | null;
    providers: {
        mercadopago?: StoredMercadoPagoConfig;
        wompi?: StoredWompiConfig;
    };
}

export interface TenantPaymentProviderState {
    provider: TenantPaymentProvider;
    connected: boolean;
    ready: boolean;
    verified: boolean;
    webhookConfigured: boolean;
    publicKey?: string;
    accountEmail?: string;
    merchantName?: string;
    environment?: WompiEnvironment;
    webhookUrl?: string;
    verifiedAt?: string;
    configRevision?: number;
    activationReady?: boolean;
    /** Self-declared by the tenant clicking Activate — NOT provider evidence. */
    webhookAcknowledged?: boolean;
    /**
     * When a webhook from this provider last authenticated for this tenant.
     * Undefined with `webhookAcknowledged: true` is the dangerous combination:
     * the rail looks configured and no event has ever arrived.
     */
    lastWebhookAt?: string;
    accessToken?: typeof MASK;
    webhookSecret?: typeof MASK;
    privateKey?: typeof MASK;
    eventsSecret?: typeof MASK;
}

export interface TenantPaymentConfig extends TenantPaymentProviderState {
    version: 2;
    activeProvider: TenantPaymentProvider | null;
    providers: Record<TenantPaymentProvider, TenantPaymentProviderState>;
}

export interface PaymentLink {
    id: string;
    url: string;
    amountCents: number;
    currency: string;
    description: string;
    provider?: TenantPaymentProvider;
    providerLinkId?: string;
    paymentStatus?: 'pending';
    /** Compatibility aliases used by older conversation-operation callers. */
    preferenceId?: string;
    initPoint?: string;
}

export interface OwnedPaymentReference {
    canonicalReference: string;
    amountCents: number;
    currency: string;
    description: string;
    paymentStatus: string;
}

export interface CreateTenantPaymentLinkInput {
    tenantId: string;
    contactId: string;
    canonicalReference?: string;
    payableReference?: string;
    amountCents?: number;
    currency?: string;
    description?: string;
    payerEmail?: string;
    idempotencyKey: string;
}

export interface TenantPaymentStatusResult {
    canonicalReference: string;
    status: TenantPaymentStatus;
    amountCents: number;
    currency: string;
    description: string;
    paidAt?: string;
    provider?: TenantPaymentProvider;
    providerTransactionId?: string;
}

interface LoadedOwnedReference extends OwnedPaymentReference {
    contactId: string;
    resourceStatus: string;
    kind: string;
    entityId: string;
}

@Injectable()
export class TenantPaymentsService {
    private readonly logger = new Logger(TenantPaymentsService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
        private readonly crypto: WhatsappCryptoService,
        @Optional() private readonly store?: TenantPaymentStoreService,
        @Optional() private readonly wompi?: TenantWompiClient,
        @Optional() private readonly throttle?: TenantThrottleService,
        @Optional() private readonly credentialCrypto?: TenantPaymentCredentialCryptoService,
    ) {}

    private cacheKey(tenantId: string) { return `tenant_payments:${tenantId}`; }

    private webhookHeartbeatKey(tenantId: string, provider: TenantPaymentProvider) {
        return `tenant_payments:webhook_seen:${tenantId}:${provider}`;
    }

    /**
     * Records that a webhook delivery for this tenant actually authenticated.
     *
     * `webhookAcknowledged` is a self-declaration: it is written by the tenant
     * clicking "Activate", not by anything the provider did. So the panel could
     * read "Active and ready" over an event URL nobody ever pasted, and the
     * owner had no way to tell. This is the counterpart written only by a real
     * delivery, so the UI can say "you marked it configured, but we have never
     * received an event".
     *
     * Telemetry only: never throws, never blocks ingestion.
     */
    async recordWebhookHeartbeat(tenantId: string, provider: TenantPaymentProvider): Promise<void> {
        try {
            // 90 days: long enough that a quiet-but-working tenant is not
            // wrongly flagged, short enough that a rail abandoned months ago
            // stops claiming it is healthy.
            await this.redis.set(
                this.webhookHeartbeatKey(tenantId, provider),
                new Date().toISOString(),
                90 * 24 * 60 * 60,
            );
        } catch {
            /* telemetry only — a Redis blip must not reject a real payment */
        }
    }

    private async readWebhookHeartbeat(
        tenantId: string,
        provider: TenantPaymentProvider,
    ): Promise<string | undefined> {
        try {
            return (await this.redis.get(this.webhookHeartbeatKey(tenantId, provider))) || undefined;
        } catch {
            // Unknown is not the same as never: leave it undefined and let the
            // UI treat "no data" as no claim rather than as an alarm.
            return undefined;
        }
    }

    /** Masked, versioned config. No private credential is ever returned. */
    async getConfig(tenantId: string): Promise<TenantPaymentConfig> {
        const stored = await this.readStoredConfig(tenantId);
        const mp = stored.providers.mercadopago || {};
        const wompi = stored.providers.wompi || {};
        const mpEnvironment = this.resolveMercadoPagoEnvironment(tenantId, mp);
        const mpAccessToken = mpEnvironment
            ? this.tryDecryptCredential(
                mp.accessTokenEnc,
                this.credentialContext(tenantId, 'mercadopago', mpEnvironment, 'access_token'),
            )
            : undefined;
        const mpWebhookSecret = mpEnvironment
            ? this.tryDecryptCredential(
                mp.webhookSecretEnc,
                this.credentialContext(tenantId, 'mercadopago', mpEnvironment, 'webhook_secret'),
            )
            : undefined;
        const mpTokenEnvironment = mpAccessToken
            ? this.mercadoPagoEnvironmentForToken(mpAccessToken)
            : undefined;
        const mpCredentialsValid = !!mpEnvironment
            && !!mp.accountId
            && mpTokenEnvironment === mpEnvironment;
        const mpEnabled = !mp.disabledAt;
        const wompiPrivateKey = wompi.environment
            ? this.tryDecryptCredential(
                wompi.privateKeyEnc,
                this.credentialContext(tenantId, 'wompi', wompi.environment, 'private_key'),
            )
            : undefined;
        const wompiEventsSecret = wompi.environment
            ? this.tryDecryptCredential(
                wompi.eventsSecretEnc,
                this.credentialContext(tenantId, 'wompi', wompi.environment, 'events_secret'),
            )
            : undefined;
        const wompiCallbackToken = wompi.environment
            ? this.tryDecryptCredential(
                wompi.webhookTokenEnc,
                this.credentialContext(tenantId, 'wompi', wompi.environment, 'callback_token'),
            )
            : undefined;
        const wompiWebhookUrl = wompiCallbackToken
            ? this.safeWompiNotificationUrl(tenantId, wompiCallbackToken)
            : undefined;
        const [mpLastWebhookAt, wompiLastWebhookAt] = await Promise.all([
            this.readWebhookHeartbeat(tenantId, 'mercadopago'),
            this.readWebhookHeartbeat(tenantId, 'wompi'),
        ]);
        const mpState: TenantPaymentProviderState = {
            provider: 'mercadopago',
            connected: mpEnabled && mpCredentialsValid,
            webhookConfigured: !!mpWebhookSecret,
            ready: mpEnabled && mpCredentialsValid && !!mpWebhookSecret,
            verified: mpCredentialsValid && !!(mp.verifiedAt || mp.accountEmail),
            publicKey: mp.publicKey || undefined,
            accountEmail: mp.accountEmail || undefined,
            environment: mpEnvironment,
            verifiedAt: mp.verifiedAt || undefined,
            configRevision: mp.revision || 0,
            activationReady: mpCredentialsValid && !!mpWebhookSecret,
            webhookAcknowledged: !!mpWebhookSecret,
            lastWebhookAt: mpLastWebhookAt,
            accessToken: mpAccessToken ? MASK : undefined,
            webhookSecret: mpWebhookSecret ? MASK : undefined,
        };
        const wompiConnected = !!wompi.publicKey && !!wompiPrivateKey && !!wompiEventsSecret;
        const wompiEnabled = !wompi.disabledAt;
        const wompiState: TenantPaymentProviderState = {
            provider: 'wompi',
            connected: wompiEnabled && wompiConnected,
            webhookConfigured: !!wompi.eventsSecretEnc && !!wompi.webhookTokenEnc && !!wompiWebhookUrl,
            ready: wompiEnabled
                && wompiConnected
                && !!wompi.verifiedAt
                && !!wompi.webhookTokenEnc
                && !!wompiWebhookUrl
                && !!wompi.webhookAcknowledgedAt,
            verified: wompiConnected && !!wompi.verifiedAt,
            publicKey: wompi.publicKey || undefined,
            merchantName: wompi.merchantName || undefined,
            environment: wompi.environment,
            webhookUrl: wompiWebhookUrl,
            verifiedAt: wompi.verifiedAt || undefined,
            configRevision: wompi.revision || 0,
            activationReady: wompiConnected && !!wompi.verifiedAt && !!wompi.webhookTokenEnc && !!wompiWebhookUrl,
            webhookAcknowledged: !!wompi.webhookAcknowledgedAt,
            lastWebhookAt: wompiLastWebhookAt,
            privateKey: wompiPrivateKey ? MASK : undefined,
            eventsSecret: wompiEventsSecret ? MASK : undefined,
        };
        const providers = { mercadopago: mpState, wompi: wompiState };
        const activeProvider = stored.activeProvider && providers[stored.activeProvider].ready
            ? stored.activeProvider
            : null;
        const active = activeProvider ? providers[activeProvider] : {
            provider: 'mercadopago' as const,
            connected: false,
            ready: false,
            verified: false,
            webhookConfigured: false,
        };
        return { version: 2, activeProvider, providers, ...active };
    }

    /**
     * A body without `provider` remains a legacy Mercado Pago body. Wompi
     * secrets are accepted only when all prefixes point to one environment and
     * the public merchant can be read from that same environment.
     */
    async setConfig(
        tenantId: string,
        input: {
            provider?: TenantPaymentProvider;
            activate?: boolean;
            accessToken?: string;
            publicKey?: string;
            webhookSecret?: string;
            privateKey?: string;
            eventsSecret?: string;
            environment?: WompiEnvironment;
        },
    ): Promise<TenantPaymentConfig> {
        const provider: TenantPaymentProvider = input.provider
            || (input.privateKey || input.eventsSecret ? 'wompi' : 'mercadopago');
        if (!['mercadopago', 'wompi'].includes(provider)) {
            throw new BadRequestException({ error: 'unsupported_payment_provider' });
        }
        // `activate` is a legacy MP convenience flag. It is deliberately
        // ignored for Wompi: saving credentials must never imply that the
        // tenant already copied and configured the event URL. Wompi activation
        // happens only through activateProvider(), which records that explicit
        // acknowledgement.
        await this.assertCustomerPaymentsEntitled(tenantId);
        return this.withProviderMutationLock(
            tenantId,
            provider,
            () => this.setConfigUnderProviderLock(tenantId, input, provider),
        );
    }

    private async setConfigUnderProviderLock(
        tenantId: string,
        input: {
            provider?: TenantPaymentProvider;
            activate?: boolean;
            accessToken?: string;
            publicKey?: string;
            webhookSecret?: string;
            privateKey?: string;
            eventsSecret?: string;
            environment?: WompiEnvironment;
        },
        provider: TenantPaymentProvider,
    ): Promise<TenantPaymentConfig> {
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { id: true },
        });
        if (!tenant) throw new BadRequestException('Tenant not found');
        const stored = await this.readStoredConfig(tenantId);
        const initialProviderHash = this.providerConfigHash(stored.providers[provider]);
        let providerMaterialChange = false;

        if (provider === 'mercadopago') {
            const current = stored.providers.mercadopago || {};
            const materialChange = (input.accessToken !== undefined && input.accessToken !== MASK)
                || (input.webhookSecret !== undefined && input.webhookSecret !== MASK)
                || (input.publicKey !== undefined && input.publicKey !== current.publicKey);
            providerMaterialChange = materialChange;
            const history = this.nextMercadoPagoHistory(current, materialChange);
            const suppliedAccessToken = input.accessToken && input.accessToken !== MASK
                ? input.accessToken.trim()
                : undefined;
            const suppliedEnvironment = suppliedAccessToken
                ? this.mercadoPagoEnvironmentForToken(suppliedAccessToken)
                : undefined;
            if (suppliedAccessToken && !suppliedEnvironment) {
                throw new BadRequestException({ error: 'invalid_mp_access_token_environment' });
            }
            if (input.environment && suppliedEnvironment && input.environment !== suppliedEnvironment) {
                throw new BadRequestException({ error: 'mp_environment_mismatch' });
            }
            const currentEnvironment = this.resolveMercadoPagoEnvironment(tenantId, current);
            const targetEnvironment = suppliedEnvironment || currentEnvironment;
            const currentAccessToken = !suppliedAccessToken && current.accessTokenEnc
                ? this.decryptExistingCredential(
                    current.accessTokenEnc,
                    this.credentialContext(
                        tenantId,
                        'mercadopago',
                        currentEnvironment || targetEnvironment || 'production',
                        'access_token',
                    ),
                )
                : undefined;
            const accessToken = suppliedAccessToken || currentAccessToken;
            const derivedEnvironment = accessToken
                ? this.mercadoPagoEnvironmentForToken(accessToken)
                : undefined;
            if (accessToken && (!derivedEnvironment || derivedEnvironment !== targetEnvironment)) {
                throw new BadRequestException({ error: 'invalid_mp_access_token_environment' });
            }
            if (input.environment && derivedEnvironment && input.environment !== derivedEnvironment) {
                throw new BadRequestException({ error: 'mp_environment_mismatch' });
            }
            let accountId = current.accountId;
            let accountEmail = current.accountEmail;
            let verifiedAt = current.verifiedAt;
            if (suppliedAccessToken) {
                const check = await this.verifyMpToken(suppliedAccessToken);
                if (!check.ok || !check.accountId) {
                    throw new BadRequestException({ error: 'invalid_mp_credentials' });
                }
                accountId = check.accountId;
                accountEmail = check.email;
                verifiedAt = new Date().toISOString();
            }
            const suppliedWebhookSecret = input.webhookSecret && input.webhookSecret !== MASK
                ? input.webhookSecret.trim()
                : undefined;
            const currentWebhookSecret = !suppliedWebhookSecret && current.webhookSecretEnc
                ? this.decryptExistingCredential(
                    current.webhookSecretEnc,
                    this.credentialContext(
                        tenantId,
                        'mercadopago',
                        currentEnvironment || targetEnvironment || 'production',
                        'webhook_secret',
                    ),
                )
                : undefined;
            const webhookSecret = suppliedWebhookSecret || currentWebhookSecret;
            if (input.webhookSecret && input.webhookSecret !== MASK) {
                if (!webhookSecret || webhookSecret.length < 16 || webhookSecret.length > 512) {
                    throw new BadRequestException({ error: 'invalid_mp_webhook_secret' });
                }
            }
            if (webhookSecret && !accessToken) {
                throw new BadRequestException({ error: 'invalid_mp_credentials' });
            }
            if ((accessToken || webhookSecret) && !targetEnvironment) {
                throw new BadRequestException({ error: 'invalid_mp_access_token_environment' });
            }
            stored.providers.mercadopago = {
                ...(history.length ? { history } : {}),
                // A controlled rewrap must not reconnect an account. Supplying
                // and remotely validating material credentials is the only
                // save operation that clears a prior tombstone.
                disabledAt: materialChange ? undefined : current.disabledAt,
                accessTokenEnc: accessToken && targetEnvironment
                    ? this.encryptCredential(
                        accessToken,
                        this.credentialContext(tenantId, provider, targetEnvironment, 'access_token'),
                    )
                    : undefined,
                webhookSecretEnc: webhookSecret && targetEnvironment
                    ? this.encryptCredential(
                        webhookSecret,
                        this.credentialContext(tenantId, provider, targetEnvironment, 'webhook_secret'),
                    )
                    : undefined,
                environment: derivedEnvironment,
                publicKey: input.publicKey ?? current.publicKey,
                accountId,
                accountEmail,
                verifiedAt,
            };
        } else {
            const client = this.requireWompiClient();
            const current = stored.providers.wompi || {};
            const materialChange = (input.privateKey !== undefined && input.privateKey !== MASK)
                || (input.eventsSecret !== undefined && input.eventsSecret !== MASK)
                || (input.publicKey !== undefined && input.publicKey !== current.publicKey)
                || (input.environment !== undefined && input.environment !== current.environment);
            providerMaterialChange = materialChange;
            const history = this.nextWompiHistory(current, materialChange);
            const publicKey = String(input.publicKey || current.publicKey || '').trim();
            const currentEnvironment = current.environment;
            const privateKey = input.privateKey && input.privateKey !== MASK
                ? input.privateKey.trim()
                : current.privateKeyEnc && currentEnvironment
                    ? this.decryptExistingCredential(
                        current.privateKeyEnc,
                        this.credentialContext(tenantId, provider, currentEnvironment, 'private_key'),
                    )
                    : undefined;
            const eventsSecret = input.eventsSecret && input.eventsSecret !== MASK
                ? input.eventsSecret.trim()
                : current.eventsSecretEnc && currentEnvironment
                    ? this.decryptExistingCredential(
                        current.eventsSecretEnc,
                        this.credentialContext(tenantId, provider, currentEnvironment, 'events_secret'),
                    )
                    : undefined;
            const environment = client.environmentForKeys({
                publicKey,
                privateKey: privateKey || '',
                eventsSecret: eventsSecret || '',
                environment: input.environment,
            });
            if (!environment || !privateKey || !eventsSecret) {
                throw new BadRequestException({ error: 'invalid_wompi_key_set' });
            }
            const merchant = await client.verifyMerchant(publicKey, environment);
            if (!merchant) {
                throw new BadRequestException({ error: 'invalid_wompi_credentials' });
            }
            const webhookToken = !materialChange && current.webhookTokenEnc && currentEnvironment
                ? this.decryptExistingCredential(
                    current.webhookTokenEnc,
                    this.credentialContext(tenantId, provider, currentEnvironment, 'callback_token'),
                )
                : randomBytes(32).toString('base64url');
            if (!webhookToken) throw new ServiceUnavailableException('wompi_webhook_token_unavailable');
            // Fail closed: a provider cannot become ready if its callback URL
            // cannot be configured as HTTPS.
            this.wompiNotificationUrl(tenantId, webhookToken);
            stored.providers.wompi = {
                ...(history.length ? { history } : {}),
                disabledAt: materialChange ? undefined : current.disabledAt,
                publicKey,
                privateKeyEnc: this.encryptCredential(
                    privateKey,
                    this.credentialContext(tenantId, provider, environment, 'private_key'),
                ),
                eventsSecretEnc: this.encryptCredential(
                    eventsSecret,
                    this.credentialContext(tenantId, provider, environment, 'events_secret'),
                ),
                webhookTokenEnc: this.encryptCredential(
                    webhookToken,
                    this.credentialContext(tenantId, provider, environment, 'callback_token'),
                ),
                environment,
                merchantId: merchant.id,
                merchantName: merchant.name || merchant.legalName,
                verifiedAt: new Date().toISOString(),
                webhookAcknowledgedAt: materialChange ? undefined : current.webhookAcknowledgedAt,
            };
        }

        const preparedProvider = { ...(stored.providers[provider] as any) };
        await this.assertCustomerPaymentsEntitled(tenantId);
        await this.mutateStoredConfigLocked(tenantId, latest => {
            if (this.providerConfigHash(latest.providers[provider]) !== initialProviderHash) {
                throw new ConflictException({ error: 'tenant_payment_config_changed' });
            }
            const currentRevision = Number((latest.providers[provider] as any)?.revision || 0);
            // A cryptographic envelope refresh is not a credential-generation
            // change. Payment submissions pin this semantic revision, so a
            // pure legacy/key-rotation rewrap must not invalidate an intent.
            (preparedProvider as any).revision = currentRevision + (providerMaterialChange ? 1 : 0);
            (latest.providers as any)[provider] = preparedProvider;
            if (provider === 'mercadopago' && (
                input.activate === true
                || !input.provider
            ) && !(preparedProvider as any).disabledAt) {
                latest.activeProvider = provider;
            }
            return latest;
        }, {
            wompiPublicKey: provider === 'wompi'
                ? String((preparedProvider as any).publicKey || '')
                : undefined,
            mercadoPagoAccountId: provider === 'mercadopago'
                ? String((preparedProvider as any).accountId || '')
                : undefined,
        });
        return this.getConfig(tenantId);
    }

    /**
     * Explicit one-tenant migration primitive. It is intentionally not wired
     * to a controller or cron. It deliberately bypasses plan entitlement and
     * remote provider probes: downgraded/tombstoned accounts still need their
     * historical webhook credentials rewrapped before an old key is retired.
     * The semantic revision, activation state and credential values do not
     * change.
     */
    async rewrapProviderCredentials(
        tenantId: string,
        provider: TenantPaymentProvider,
    ): Promise<TenantPaymentConfig> {
        if (!['mercadopago', 'wompi'].includes(provider)) {
            throw new BadRequestException({ error: 'unsupported_payment_provider' });
        }
        return this.withProviderMutationLock(tenantId, provider, async () => {
            await this.mutateStoredConfigLocked(tenantId, stored => {
                if (provider === 'mercadopago') {
                    const current = stored.providers.mercadopago;
                    if (!current) throw new BadRequestException({ error: 'payment_provider_not_configured' });
                    stored.providers.mercadopago = {
                        ...this.rewrapMercadoPagoGeneration(tenantId, current),
                        history: Array.isArray(current.history)
                            ? current.history.map(generation => this.rewrapMercadoPagoGeneration(
                                tenantId,
                                generation,
                            ))
                            : undefined,
                    };
                    return stored;
                }

                const current = stored.providers.wompi;
                if (!current) {
                    throw new BadRequestException({ error: 'payment_provider_not_configured' });
                }
                stored.providers.wompi = {
                    ...this.rewrapWompiGeneration(tenantId, current),
                    history: Array.isArray(current.history)
                        ? current.history.map(generation => this.rewrapWompiGeneration(
                            tenantId,
                            generation,
                        ))
                        : undefined,
                };
                return stored;
            });
            return this.getConfig(tenantId);
        });
    }

    async activateProvider(tenantId: string, provider: TenantPaymentProvider): Promise<TenantPaymentConfig> {
        if (!['mercadopago', 'wompi'].includes(provider)) {
            throw new BadRequestException({ error: 'unsupported_payment_provider' });
        }
        await this.assertCustomerPaymentsEntitled(tenantId);
        return this.withProviderMutationLock(tenantId, provider, async () => {
            await this.assertCustomerPaymentsEntitled(tenantId);
            await this.mutateStoredConfigLocked(tenantId, stored => {
                if (!this.isStoredProviderActivationReady(stored, provider)) {
                    throw new BadRequestException({ error: 'payment_provider_not_ready', provider });
                }
                const target = stored.providers[provider];
                if (!target) {
                    throw new BadRequestException({ error: 'payment_provider_not_ready', provider });
                }
                target.disabledAt = undefined;
                if (provider === 'wompi' && stored.providers.wompi) {
                    stored.providers.wompi.webhookAcknowledgedAt = new Date().toISOString();
                }
                stored.activeProvider = provider;
                return stored;
            });
            return this.getConfig(tenantId);
        });
    }

    /** Legacy endpoint: disconnect every tenant-owned provider. */
    async disconnect(tenantId: string): Promise<void> {
        await this.withProviderMutationLock(tenantId, 'wompi', async () => {
            await this.mutateStoredConfigLocked(tenantId, stored => {
                const disabledAt = new Date().toISOString();
                for (const provider of ['mercadopago', 'wompi'] as const) {
                    const config = stored.providers[provider];
                    if (!config) continue;
                    config.disabledAt = disabledAt;
                }
                stored.activeProvider = null;
                return stored;
            });
        });
    }

    async disconnectProvider(tenantId: string, provider: TenantPaymentProvider): Promise<TenantPaymentConfig> {
        if (!['mercadopago', 'wompi'].includes(provider)) {
            throw new BadRequestException({ error: 'unsupported_payment_provider' });
        }
        return this.withProviderMutationLock(tenantId, provider, async () => {
            await this.mutateStoredConfigLocked(tenantId, stored => {
                const config = stored.providers[provider];
                if (config) {
                    // Do not erase verification authority: an already-paid
                    // intent may receive a late VOIDED/refund/chargeback event.
                    // The tombstone disables creation while webhook/status
                    // readers retain access to the encrypted credentials.
                    config.disabledAt = new Date().toISOString();
                }
                if (stored.activeProvider === provider) {
                    // Never switch money rails as a side effect of disconnect.
                    // The tenant must explicitly acknowledge and activate the
                    // other provider.
                    stored.activeProvider = null;
                }
                return stored;
            });
            return this.getConfig(tenantId);
        });
    }

    async getRuntimeCapability(tenantId: string): Promise<{
        configured: boolean;
        ready: boolean;
        statusAvailable: boolean;
        activeProvider?: TenantPaymentProvider;
    }> {
        const config = await this.getConfig(tenantId);
        const statusAvailable = this.store ? await this.store.isAvailable(tenantId) : false;
        return {
            configured: config.connected,
            ready: config.ready && statusAvailable,
            statusAvailable,
            activeProvider: config.activeProvider || undefined,
        };
    }

    async getMercadoPagoCredentialCandidates(tenantId: string): Promise<Array<{
        revision: number;
        accessToken: string;
        webhookSecret: string;
        accountId: string;
        environment: WompiEnvironment;
    }>> {
        const stored = await this.readStoredConfig(tenantId);
        const config = stored.providers.mercadopago;
        if (!config) return [];
        const generations: StoredMercadoPagoCredentialGeneration[] = [
            config,
            ...(Array.isArray(config.history) ? config.history : []),
        ];
        const candidates: Array<{
            revision: number;
            accessToken: string;
            webhookSecret: string;
            accountId: string;
            environment: WompiEnvironment;
        }> = [];
        for (const generation of generations) {
            const environment = this.resolveMercadoPagoEnvironment(
                tenantId,
                generation as StoredMercadoPagoConfig,
            );
            const accountId = String(generation.accountId || '').trim();
            if (!environment || !/^\d{1,32}$/.test(accountId)) continue;
            const accessToken = this.tryDecryptCredential(
                generation.accessTokenEnc,
                this.credentialContext(tenantId, 'mercadopago', environment, 'access_token'),
            );
            const webhookSecret = this.tryDecryptCredential(
                generation.webhookSecretEnc,
                this.credentialContext(tenantId, 'mercadopago', environment, 'webhook_secret'),
            );
            if (!accessToken || !webhookSecret
                || this.mercadoPagoEnvironmentForToken(accessToken) !== environment) continue;
            candidates.push({
                revision: Number(generation.revision || 0),
                accessToken,
                webhookSecret,
                accountId,
                environment,
            });
        }
        return candidates;
    }

    /** Historical MP secrets remain readable so outstanding links can settle after a provider switch. */
    async getWebhookSecret(tenantId: string): Promise<string | null> {
        return (await this.getMercadoPagoCredentialCandidates(tenantId))[0]?.webhookSecret || null;
    }

    async getMercadoPagoAccessToken(tenantId: string, revision?: number): Promise<string | null> {
        const candidates = await this.getMercadoPagoCredentialCandidates(tenantId);
        return (revision === undefined
            ? candidates[0]
            : candidates.find(candidate => candidate.revision === revision)
        )?.accessToken || null;
    }

    async getMercadoPagoAccountId(tenantId: string): Promise<string | null> {
        return (await this.getMercadoPagoCredentialCandidates(tenantId))[0]?.accountId || null;
    }

    async getWompiCredentials(
        tenantId: string,
        callbackToken?: string,
        revision?: number,
    ): Promise<{
        publicKey: string;
        privateKey: string;
        eventsSecret: string;
        environment: WompiEnvironment;
    } | null> {
        return (await this.getWompiCredentialsDetailed(tenantId, callbackToken, revision)).credentials;
    }

    /**
     * Same lookup, but says WHY it came back empty.
     *
     * "No credentials" has two very different causes that used to be
     * indistinguishable: the caller presented a token that matches nothing
     * (a stranger — 401 is correct and final), or our own stored envelope
     * could not be opened (a key rotation done wrong, a restore from an older
     * backup — the caller is legitimate and the event must be RETRIED, not
     * discarded). Collapsing both into a silent 401 meant a genuine approved
     * payment was thrown away with no log, no counter and no way for the owner
     * to tell a broken key from a bogus caller.
     */
    async getWompiCredentialsDetailed(
        tenantId: string,
        callbackToken?: string,
        revision?: number,
    ): Promise<{
        credentials: {
            publicKey: string;
            privateKey: string;
            eventsSecret: string;
            environment: WompiEnvironment;
        } | null;
        /** An envelope exists for this tenant but could not be decrypted. */
        decryptionFailed: boolean;
    }> {
        const result = await this.resolveWompiCredentials(tenantId, callbackToken, revision);
        if (!result.credentials && result.decryptionFailed) {
            this.logger.error(
                `[TenantPayments] Wompi credentials for tenant ${tenantId} are stored but could NOT be `
                + 'decrypted. This is an encryption-key problem (rotation or restore), not a bad caller: '
                + 'every commerce event for this tenant is being rejected and payments will not settle.',
            );
        }
        return result;
    }

    private async resolveWompiCredentials(
        tenantId: string,
        callbackToken?: string,
        revision?: number,
    ): Promise<{
        credentials: {
            publicKey: string;
            privateKey: string;
            eventsSecret: string;
            environment: WompiEnvironment;
        } | null;
        decryptionFailed: boolean;
    }> {
        let decryptionFailed = false;
        const stored = await this.readStoredConfig(tenantId);
        const config = stored.providers.wompi;
        if (!config) return { credentials: null, decryptionFailed };
        const generations: StoredWompiCredentialGeneration[] = revision === undefined && callbackToken === undefined
            ? [config]
            : [config, ...(Array.isArray(config.history) ? config.history : [])];
        for (const generation of generations) {
            if (!generation.publicKey || !generation.environment) continue;
            if (revision !== undefined && Number(generation.revision || 0) !== revision) continue;
            const privateKey = this.tryDecryptCredential(
                generation.privateKeyEnc,
                this.credentialContext(tenantId, 'wompi', generation.environment, 'private_key'),
            );
            const eventsSecret = this.tryDecryptCredential(
                generation.eventsSecretEnc,
                this.credentialContext(tenantId, 'wompi', generation.environment, 'events_secret'),
            );
            const expectedCallback = this.tryDecryptCredential(
                generation.webhookTokenEnc,
                this.credentialContext(tenantId, 'wompi', generation.environment, 'callback_token'),
            );
            if (!privateKey || !eventsSecret || !expectedCallback) {
                // The envelopes are present but at least one would not open —
                // our key is wrong, not the caller's token.
                if (generation.privateKeyEnc && generation.eventsSecretEnc && generation.webhookTokenEnc) {
                    decryptionFailed = true;
                }
                continue;
            }
            if (callbackToken !== undefined && !this.constantTimeEqual(callbackToken, expectedCallback)) continue;
            const environment = this.requireWompiClient().environmentForKeys({
                publicKey: generation.publicKey,
                privateKey,
                eventsSecret,
                environment: generation.environment,
            });
            if (!environment) continue;
            return {
                credentials: { publicKey: generation.publicKey, privateKey, eventsSecret, environment },
                decryptionFailed: false,
            };
        }
        return { credentials: null, decryptionFailed };
    }

    async isConfigured(tenantId: string): Promise<boolean> {
        return (await this.getConfig(tenantId)).ready;
    }

    async resolveOwnedPayable(
        tenantId: string,
        contactId: string,
        payableReference: string,
    ): Promise<OwnedPaymentReference | null> {
        const owned = await this.loadOwnedReference(tenantId, contactId, payableReference, false);
        if (!owned) return null;
        const stored = await this.readStoredConfig(tenantId);
        if (stored.activeProvider === 'wompi' && owned.currency !== 'COP') return null;
        return {
            canonicalReference: owned.canonicalReference,
            amountCents: owned.amountCents,
            currency: owned.currency,
            description: owned.description,
            paymentStatus: owned.paymentStatus,
        };
    }

    /** Backward compatible ownership method, now fail-closed for paid/cancelled purchases. */
    async resolveOwnedReference(
        tenantId: string,
        contactId: string,
        reference: string,
    ): Promise<OwnedPaymentReference | null> {
        return this.resolveOwnedPayable(tenantId, contactId, reference);
    }

    async createPaymentLink(tenantId: string, input: {
        amountCents: number;
        currency?: string;
        description: string;
        externalReference: string;
        payerEmail?: string;
        idempotencyKey?: string;
    }): Promise<PaymentLink>;
    async createPaymentLink(input: CreateTenantPaymentLinkInput): Promise<PaymentLink>;
    async createPaymentLink(
        tenantOrInput: string | CreateTenantPaymentLinkInput,
        legacyInput?: {
            amountCents: number;
            currency?: string;
            description: string;
            externalReference: string;
            payerEmail?: string;
            idempotencyKey?: string;
        },
    ): Promise<PaymentLink> {
        if (typeof tenantOrInput === 'string') {
            await this.assertCustomerPaymentsEntitled(tenantOrInput);
            const stored = await this.readStoredConfig(tenantOrInput);
            if (stored.activeProvider === 'wompi') {
                throw new BadRequestException({ error: 'payment_contact_required' });
            }
            return this.createMercadoPagoLink(tenantOrInput, legacyInput!);
        }

        const input = tenantOrInput;
        await this.assertCustomerPaymentsEntitled(input.tenantId);
        const reference = input.canonicalReference || input.payableReference || '';
        const owned = await this.resolveOwnedPayable(input.tenantId, input.contactId, reference);
        if (!owned) throw new BadRequestException({ error: 'payment_reference_not_chargeable' });
        if ((input.amountCents !== undefined && input.amountCents !== owned.amountCents)
            || (input.currency && input.currency.toUpperCase() !== owned.currency)) {
            throw new BadRequestException({ error: 'tenant_payment_reference_changed' });
        }
        const idempotencyKey = String(input.idempotencyKey || '').trim();
        // eslint-disable-next-line no-control-regex
        if (!idempotencyKey || idempotencyKey.length > 180 || /[\u0000-\u001f]/.test(idempotencyKey)) {
            throw new BadRequestException({ error: 'invalid_payment_idempotency_key' });
        }
        const config = await this.getConfig(input.tenantId);
        if (!config.activeProvider || !config.ready) {
            throw new BadRequestException({ error: 'payments_not_configured' });
        }
        const store = this.requireStore();
        const provider = config.activeProvider;
        if (provider === 'wompi' && owned.currency !== 'COP') {
            throw new BadRequestException({ error: 'wompi_cop_only' });
        }
        // El TTL lo decide lo que se esta vendiendo, no una constante global.
        const holdsCapacity = CAPACITY_HOLDING_KINDS.has(
            String(owned.canonicalReference || '').split(':')[0].trim().toLowerCase(),
        );
        const expiresAt = new Date(Date.now() + (holdsCapacity ? PAYMENT_HOLD_MS : TENANT_PAYMENT_LINK_TTL_MS));
        const { intent, created } = await store.createOrGetIntent({
            tenantId: input.tenantId,
            provider,
            idempotencyKey,
            canonicalReference: owned.canonicalReference,
            contactId: input.contactId,
            amountCents: owned.amountCents,
            currency: owned.currency,
            description: owned.description,
            resourceSnapshot: {
                canonicalReference: owned.canonicalReference,
                amountCents: owned.amountCents,
                currency: owned.currency,
                paymentStatus: owned.paymentStatus,
                provider,
                providerConfigRevision: config.providers[provider].configRevision || 0,
            },
            expiresAt,
        });
        if (intent.status === 'pending'
            && intent.expiresAt
            && intent.expiresAt.getTime() <= Date.now()) {
            if (intent.provider === 'wompi') {
                const reconciled = await this.reconcileExpiredWompiIntent(input.tenantId, intent) || intent;

                // The provider still considers the link usable (clock skew, or
                // a longer provider-side expiry). Hand back the link the
                // customer already has instead of refusing the sale.
                if (reconciled.status === 'pending' && reconciled.providerLinkId && reconciled.checkoutUrl) {
                    return this.intentToPaymentLink(reconciled);
                }

                // Proven unpaid and now expired: the reference is free again,
                // so a retry can mint a fresh link. Say so explicitly — the
                // generic 503 gave the agent nothing to act on and the customer
                // simply could not be charged for that order ever again.
                if (reconciled.status === 'expired') {
                    throw new ConflictException({
                        error: 'payment_link_expired_retry_with_new_link',
                        status: reconciled.status,
                    });
                }
                throw new ServiceUnavailableException({
                    error: 'payment_link_expiry_reconciliation_required',
                    status: reconciled.status,
                });
            }
            await store.markCreationState(
                input.tenantId,
                intent.id,
                'requires_review',
                'mercadopago_expired_link_requires_provider_evidence',
                intent.providerLinkId,
            );
            throw new ServiceUnavailableException({ error: 'payment_link_expiry_reconciliation_required' });
        }
        if (intent.providerLinkId && intent.checkoutUrl && intent.status === 'pending') {
            return this.intentToPaymentLink(intent);
        }
        if (!created || intent.status !== 'pending') {
            throw new ServiceUnavailableException({
                error: 'payment_link_reconciliation_required',
                status: intent.status,
            });
        }

        let providerLockToken: string | null = null;
        try {
            try {
                providerLockToken = await this.acquireProviderMutationLock(input.tenantId, provider);
            } catch (error) {
                await store.markCreationState(
                    input.tenantId,
                    intent.id,
                    'failed',
                    'tenant_payment_provider_busy_before_submission',
                );
                throw error;
            }

        try {
            // Re-check entitlement, active rail and credential revision after
            // the durable intent exists and immediately before any provider
            // effect. A concurrent downgrade/switch/rotation therefore fails
            // without using a stale credential set.
            await this.assertCustomerPaymentsEntitled(input.tenantId);
            const latest = await this.getConfig(input.tenantId);
            if (latest.activeProvider !== provider
                || !latest.ready
                || latest.providers[provider].configRevision !== config.providers[provider].configRevision) {
                throw new ConflictException({ error: 'payment_provider_changed_before_submission' });
            }
        } catch (error) {
            await store.markCreationState(
                input.tenantId,
                intent.id,
                'failed',
                'payment_provider_changed_before_submission',
            );
            throw error;
        }

        if (provider === 'wompi') {
            const credentials = await this.getWompiCredentials(input.tenantId);
            if (!credentials) {
                await store.markCreationState(
                    input.tenantId,
                    intent.id,
                    'failed',
                    'wompi_credentials_unavailable_before_submission',
                );
                throw new BadRequestException({ error: 'wompi_not_configured' });
            }
            let knownProviderLinkId: string | undefined;
            try {
                const link = await this.requireWompiClient().createAndVerifyPaymentLink({
                    publicKey: credentials.publicKey,
                    privateKey: credentials.privateKey,
                    environment: credentials.environment,
                    intentId: intent.id,
                    amountCents: intent.amountCents,
                    description: intent.description,
                    expiresAt: intent.expiresAt || expiresAt!,
                });
                knownProviderLinkId = link.id;
                let attached: TenantPaymentIntent;
                try {
                    attached = await store.attachProviderLink({
                        tenantId: input.tenantId,
                        intentId: intent.id,
                        providerLinkId: link.id,
                        checkoutUrl: link.url,
                        expiresAt: link.expiresAt,
                    });
                } catch {
                    // The remote link is canonical and its id is known. Keep
                    // that evidence so reconciliation can repair only this
                    // specific post-provider/pre-local-attach crash window.
                    throw new WompiProviderError(
                        'tenant_payment_link_attach_failed',
                        true,
                        link.id,
                    );
                }
                return this.intentToPaymentLink(attached);
            } catch (error: any) {
                const providerError = error instanceof WompiProviderError
                    ? error
                    : new WompiProviderError('wompi_link_creation_outcome_unknown', true);
                const recoverableLinkId = providerError.providerLinkId || knownProviderLinkId;
                const state = recoverableLinkId
                    ? 'requires_review'
                    : providerError.ambiguous ? 'ambiguous' : 'failed';
                await store.markCreationState(
                    input.tenantId,
                    intent.id,
                    state,
                    providerError.code,
                    recoverableLinkId,
                );
                if (providerError.ambiguous) {
                    throw new ServiceUnavailableException({ error: providerError.code });
                }
                throw new BadRequestException({ error: providerError.code });
            }
        }

        let knownMercadoPagoLinkId: string | undefined;
        try {
            // El vencimiento SÍ se reenvía cuando hay cupo retenido: sin eso el
            // enlace de MP sobrevivía a las fechas que guardaba e invitaba a
            // pagar algo que ya no existía. Para lo que no retiene nada (un
            // pedido, una factura) se sigue sin mandar vencimiento remoto: ahí
            // las 24h locales sólo alimentan el barrido de requires_review y
            // acortarlas no le sirve a nadie.
            const link = await this.createMercadoPagoLink(input.tenantId, {
                ...(holdsCapacity ? { expiresAt, excludeOfflineMethods: true } : {}),
                amountCents: owned.amountCents,
                currency: owned.currency,
                description: owned.description,
                externalReference: owned.canonicalReference,
                payerEmail: input.payerEmail,
                idempotencyKey,
            });
            knownMercadoPagoLinkId = link.id;
            const attached = await store.attachProviderLink({
                tenantId: input.tenantId,
                intentId: intent.id,
                providerLinkId: link.id,
                checkoutUrl: link.url,
                expiresAt,
            });
            return this.intentToPaymentLink(attached);
        } catch (error: any) {
            const providerError = error instanceof MercadoPagoProviderError ? error : undefined;
            const recoverableLinkId = providerError?.providerLinkId || knownMercadoPagoLinkId;
            const state = recoverableLinkId
                ? 'requires_review'
                : providerError?.ambiguous ? 'ambiguous' : 'failed';
            await store.markCreationState(
                input.tenantId,
                intent.id,
                state,
                providerError?.code || error?.message || 'mp_link_failed',
                recoverableLinkId,
            );
            throw error;
        }
        } finally {
            if (providerLockToken) {
                await this.redis.releaseLockToken(
                    this.providerMutationLockKey(input.tenantId, provider),
                    providerLockToken,
                ).catch(() => undefined);
            }
        }
    }

    async findPaymentLinkByIdempotencyKey(tenantId: string, key: string): Promise<string | null> {
        if (this.store) {
            try {
                const intent = await this.store.findByIdempotencyKey(tenantId, key);
                if (intent?.providerLinkId) return intent.providerLinkId;
            } catch (error: any) {
                this.logger.warn(`Durable payment idempotency lookup failed: ${error.message}`);
            }
        }
        return this.redis.get(this.idempotencyRedisKey(tenantId, key)).catch(() => null);
    }

    async reconcilePaymentLinkCreation(
        tenantId: string,
        providerLinkId: string,
    ): Promise<{ status: 'confirmed' | 'pending' | 'failed'; url?: string }> {
        const store = this.requireStore();
        const wompiIntent = await store.findByProviderLink(tenantId, 'wompi', providerLinkId);
        if (wompiIntent) {
            const credentials = await this.getWompiCredentials(
                tenantId,
                undefined,
                this.intentCredentialRevision(wompiIntent),
            );
            if (!credentials) return { status: 'failed' };
            const locallyExpired = !!wompiIntent.expiresAt
                && wompiIntent.expiresAt.getTime() <= Date.now();
            try {
                const link = await this.requireWompiClient().getAndValidatePaymentLink({
                    providerLinkId,
                    environment: credentials.environment,
                    expectedPublicKey: credentials.publicKey,
                    expectedIntentId: wompiIntent.id,
                    expectedAmountCents: wompiIntent.amountCents,
                    expectedExpiresAt: wompiIntent.expiresAt,
                    allowInactive: locallyExpired,
                });
                // Never re-share a URL after our signed expires_at snapshot,
                // even if the provider still reports the link as active. Time
                // alone also cannot prove that a bank redirect was not already
                // started, so reconciliation keeps the reference unresolved.
                if (locallyExpired) {
                    if (!link.active) {
                        await this.reconcileExpiredWompiIntent(tenantId, wompiIntent);
                    }
                    return { status: 'pending' };
                }
                const repairableAttachFailure = wompiIntent.status === 'requires_review'
                    && wompiIntent.lastError === 'tenant_payment_link_attach_failed';
                if (wompiIntent.status !== 'pending' && !repairableAttachFailure) {
                    return { status: 'pending' };
                }
                await store.attachProviderLink({
                    tenantId,
                    intentId: wompiIntent.id,
                    providerLinkId,
                    checkoutUrl: link.url,
                    expiresAt: link.expiresAt,
                });
                return { status: 'confirmed', url: link.url };
            } catch {
                return { status: 'pending' };
            }
        }
        return await this.verifyMercadoPagoLink(tenantId, providerLinkId)
            ? { status: 'confirmed' }
            : { status: 'pending' };
    }

    async verifyPaymentLink(tenantId: string, providerLinkId: string): Promise<boolean> {
        if (this.store) {
            try {
                const wompiIntent = await this.store.findByProviderLink(tenantId, 'wompi', providerLinkId);
                if (wompiIntent) {
                    return (await this.reconcilePaymentLinkCreation(tenantId, providerLinkId)).status === 'confirmed';
                }
            } catch {
                return false;
            }
        }
        return this.verifyMercadoPagoLink(tenantId, providerLinkId);
    }

    async getPaymentStatus(input: {
        tenantId: string;
        contactId: string;
        payableReference: string;
    }): Promise<TenantPaymentStatusResult | null> {
        const owned = await this.loadOwnedReference(
            input.tenantId,
            input.contactId,
            input.payableReference,
            true,
        );
        if (!owned) return null;
        const store = this.requireStore();
        let intent = await store.findLatestOwned(input.tenantId, input.contactId, owned.canonicalReference);
        if (intent?.provider === 'wompi'
            && intent.providerTransactionId
            && ['pending', 'failed'].includes(intent.status)) {
            const credentials = await this.getWompiCredentials(
                input.tenantId,
                undefined,
                this.intentCredentialRevision(intent),
            );
            if (credentials) {
                try {
                    const transaction = await this.requireWompiClient().getTransaction({
                        transactionId: intent.providerTransactionId,
                        publicKey: credentials.publicKey,
                        environment: credentials.environment,
                    });
                    if (!transaction.paymentLinkId) return {
                        canonicalReference: owned.canonicalReference,
                        status: intent.status,
                        amountCents: intent.amountCents,
                        currency: intent.currency,
                        description: owned.description,
                        paidAt: intent.paidAt?.toISOString(),
                        provider: intent.provider,
                        providerTransactionId: intent.providerTransactionId,
                    };
                    const eventKey = createHash('sha256')
                        .update(`poll:${transaction.id}:${transaction.status}:${transaction.amountCents}:${transaction.paymentLinkId}`)
                        .digest('hex');
                    const settled = await store.settleWompiTransaction({
                        tenantId: input.tenantId,
                        transaction,
                        eventKey,
                        source: 'poll',
                    });
                    intent = settled.intent || intent;
                } catch (error: any) {
                    this.logger.warn(`Wompi status poll failed for ${intent.providerTransactionId}: ${error.message}`);
                }
            }
        }
        // No provider_transaction_id means the commerce event never arrived —
        // previously the dead end that left a paid order unpaid forever. The
        // payment link id survives a lost event, so recover through it before
        // telling the customer their payment has not been seen.
        if (intent?.provider === 'wompi'
            && !intent.providerTransactionId
            && intent.providerLinkId
            && intent.status === 'pending') {
            const recovered = await this.recoverWompiIntentFromProvider(input.tenantId, intent, 'poll');
            intent = recovered.intent || intent;
        }
        if (intent?.provider === 'wompi'
            && intent.status === 'pending'
            && intent.expiresAt
            && intent.expiresAt.getTime() <= Date.now()) {
            intent = await this.reconcileExpiredWompiIntent(input.tenantId, intent) || intent;
        }
        const domainStatus = this.normalizeDomainStatus(owned.paymentStatus);
        // Ledger review states always win over a seemingly-terminal domain row:
        // a second distinct APPROVED charge leaves the purchase paid but must
        // be surfaced to the agent as requires_review, never as a clean success.
        // Outside review, refunded is monotonic over paid and either durable
        // side may carry the terminal transition for legacy MP compatibility.
        const authoritativeStatus = intent && ['requires_review', 'ambiguous'].includes(intent.status)
            ? intent.status
            : (intent?.status === 'refunded' || domainStatus === 'refunded')
                ? 'refunded'
                : (intent?.status === 'paid' || domainStatus === 'paid')
                    ? 'paid'
                    : intent?.status || domainStatus;
        return {
            canonicalReference: owned.canonicalReference,
            status: authoritativeStatus,
            amountCents: intent?.amountCents ?? owned.amountCents,
            currency: intent?.currency ?? owned.currency,
            description: owned.description,
            paidAt: intent?.paidAt?.toISOString(),
            provider: intent?.provider,
            providerTransactionId: intent?.providerTransactionId,
        };
    }

    private async loadOwnedReference(
        tenantId: string,
        contactId: string,
        reference: string,
        includeTerminal: boolean,
    ): Promise<LoadedOwnedReference | null> {
        const parsed = parsePaymentReference(reference);
        if (!parsed) return null;
        const schemaName = await this.prisma.getTenantSchemaName(tenantId);
        if (!schemaName) return null;
        try {
            const rows = await this.prisma.executeInTenantSchema<Array<{
                amount: unknown;
                currency: string | null;
                contact_id: string | null;
                status: string | null;
                payment_status: string | null;
            }>>(
                schemaName,
                `SELECT ${parsed.target.amountExpression} AS amount,
                        ${parsed.target.currencyExpression} AS currency,
                        target.contact_id,
                        target.status,
                        target.payment_status
                   FROM ${parsed.target.table} target
                   ${parsed.target.join ?? ''}
                  WHERE target.id = $1::uuid
                    AND target.contact_id = $2::uuid
                  LIMIT 1`,
                [parsed.entityId, contactId],
            );
            const row = rows[0];
            const amountCents = Math.round(Number(row?.amount) * 100);
            const currency = String(row?.currency || '').trim().toUpperCase();
            const paymentStatus = String(row?.payment_status || 'pending').trim().toLowerCase();
            const resourceStatus = String(row?.status || '').trim().toLowerCase();
            if (!row
                || !Number.isSafeInteger(amountCents)
                || amountCents <= 0
                || !/^[A-Z]{3}$/.test(currency)) return null;
            if (!includeTerminal && (
                !['pending', 'failed'].includes(paymentStatus)
                || parsed.target.rejectedStatuses.includes(resourceStatus)
            )) return null;
            return {
                canonicalReference: parsed.canonicalReference,
                amountCents,
                currency,
                description: parsed.target.description(parsed.entityId),
                paymentStatus,
                resourceStatus,
                contactId: String(row.contact_id),
                kind: parsed.kind,
                entityId: parsed.entityId,
            };
        } catch (error: any) {
            this.logger.warn(`Could not resolve ${reference} for tenant ${tenantId}: ${error.message}`);
            return null;
        }
    }

    private async createMercadoPagoLink(
        tenantId: string,
        input: {
            amountCents: number;
            currency?: string;
            description: string;
            externalReference: string;
            payerEmail?: string;
            idempotencyKey?: string;
            /** Sólo se mandan cuando hay cupo retenido; ver OFFLINE_PAYMENT_TYPE_IDS. */
            expiresAt?: Date;
            excludeOfflineMethods?: boolean;
        },
    ): Promise<PaymentLink> {
        const token = await this.getMercadoPagoAccessToken(tenantId);
        if (!token) throw new BadRequestException({ error: 'payments_not_configured' });
        if (!await this.getWebhookSecret(tenantId)) {
            throw new BadRequestException({ error: 'mp_webhook_not_configured' });
        }
        if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
            throw new BadRequestException({ error: 'invalid_amount' });
        }
        const currency = (input.currency || 'COP').toUpperCase();
        const zeroDecimal = ['COP', 'CLP', 'PYG', 'JPY', 'KRW', 'VND', 'ISK'].includes(currency);
        if (zeroDecimal && input.amountCents % 100 !== 0) {
            throw new BadRequestException({ error: 'invalid_zero_decimal_amount' });
        }
        const requestBody = JSON.stringify({
            items: [{
                title: input.description.slice(0, 250),
                quantity: 1,
                unit_price: input.amountCents / 100,
                currency_id: currency,
            }],
            external_reference: input.externalReference,
            ...(input.payerEmail ? { payer: { email: input.payerEmail } } : {}),
            notification_url: this.mpNotificationUrl(tenantId),
            // La preferencia vence con la retención, igual que el link de Wompi.
            // MP documenta `expires` + `expiration_date_to` en ISO 8601.
            ...(input.expiresAt
                ? { expires: true, expiration_date_to: input.expiresAt.toISOString() }
                : {}),
            ...(input.excludeOfflineMethods
                ? {
                    payment_methods: {
                        excluded_payment_types: OFFLINE_PAYMENT_TYPE_IDS.map(id => ({ id })),
                    },
                }
                : {}),
        });
        let response: Response;
        try {
            response = await fetch(`${MP_API}/checkout/preferences`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                    ...(input.idempotencyKey ? { 'X-Idempotency-Key': input.idempotencyKey } : {}),
                },
                body: requestBody,
                signal: AbortSignal.timeout(15_000),
            });
        } catch {
            throw new MercadoPagoProviderError('mercadopago_link_creation_outcome_unknown', true);
        }
        if (!response.ok) {
            throw new MercadoPagoProviderError(
                response.status >= 500 ? 'mercadopago_link_creation_outcome_unknown' : 'payment_link_failed',
                response.status >= 500,
            );
        }
        const payload: any = await response.json();
        const id = String(payload?.id || '').trim();
        const url = String(payload?.init_point || payload?.sandbox_init_point || '').trim();
        if (!id || !this.isHttpsUrl(url)) {
            throw new MercadoPagoProviderError('invalid_payment_link_response', true, id || undefined);
        }
        if (input.idempotencyKey) {
            await this.redis.set(
                this.idempotencyRedisKey(tenantId, input.idempotencyKey),
                id,
                7 * 86400,
            ).catch(() => undefined);
        }
        return {
            id,
            url,
            amountCents: input.amountCents,
            currency,
            description: input.description,
            provider: 'mercadopago',
            providerLinkId: id,
            paymentStatus: 'pending',
            preferenceId: id,
            initPoint: url,
        };
    }

    private async verifyMercadoPagoLink(tenantId: string, preferenceId: string): Promise<boolean> {
        const token = await this.getMercadoPagoAccessToken(tenantId);
        if (!token || !preferenceId) return false;
        try {
            const response = await fetch(`${MP_API}/checkout/preferences/${encodeURIComponent(preferenceId)}`, {
                headers: { Authorization: `Bearer ${token}` },
                signal: AbortSignal.timeout(15_000),
            });
            if (!response.ok) return false;
            const payload: any = await response.json();
            const url = String(payload?.init_point || payload?.sandbox_init_point || '').trim();
            return String(payload?.id || '') === preferenceId && this.isHttpsUrl(url);
        } catch {
            return false;
        }
    }

    /**
     * Settles an intent from provider evidence when the commerce event never
     * arrived (mistyped events secret, events URL never pasted in the Wompi
     * dashboard, retries exhausted during a deploy).
     *
     * The webhook used to be the ONLY writer of provider_transaction_id, and
     * the poll path required that same id — so a lost first event left the
     * customer charged and the order unpaid with nothing able to repair it.
     * The payment link id is known at creation time, so it is the identifier
     * that survives a lost event and breaks the circle.
     *
     * Returns null when the provider has no transaction for the link, which is
     * the ordinary "nobody paid yet" case and is not an error.
     */
    async recoverWompiIntentFromProvider(
        tenantId: string,
        intent: TenantPaymentIntent,
        source: 'poll' | 'reconciliation',
    ): Promise<TenantPaymentRecoveryResult> {
        if (intent.provider !== 'wompi') return { outcome: 'unavailable', intent: null };
        if (!intent.providerTransactionId && !intent.providerLinkId) {
            return { outcome: 'unavailable', intent: null };
        }
        const credentials = await this.getWompiCredentials(
            tenantId,
            undefined,
            this.intentCredentialRevision(intent),
        );
        if (!credentials) return { outcome: 'unavailable', intent: null };

        let transaction: CanonicalWompiTransaction | null = null;
        try {
            transaction = intent.providerTransactionId
                ? await this.requireWompiClient().getTransaction({
                    transactionId: intent.providerTransactionId,
                    publicKey: credentials.publicKey,
                    environment: credentials.environment,
                })
                : await this.requireWompiClient().findTransactionByPaymentLink({
                    providerLinkId: intent.providerLinkId!,
                    publicKey: credentials.publicKey,
                    privateKey: credentials.privateKey,
                    environment: credentials.environment,
                });
        } catch (error: any) {
            this.logger.warn(
                `Wompi ${source} recovery failed for intent ${intent.id}: ${error.message}`,
            );
            return { outcome: 'unavailable', intent: null };
        }
        // A successful query that found nothing is PROOF that nobody started a
        // payment on this link — the distinction that makes it safe to expire
        // the intent later. A failed query proves nothing and must never be
        // mistaken for it.
        if (!transaction) return { outcome: 'no_transaction', intent: null };
        if (!transaction.paymentLinkId) return { outcome: 'unavailable', intent: null };
        // Defence in depth: only settle evidence that belongs to THIS intent's
        // link. A provider that ignored the filter must never cross-credit.
        if (intent.providerLinkId && transaction.paymentLinkId !== intent.providerLinkId) {
            this.logger.error(
                `[TenantPayments] Wompi returned transaction ${transaction.id} for link `
                + `${transaction.paymentLinkId} while recovering intent ${intent.id} `
                + `(link ${intent.providerLinkId}); refusing to settle`,
            );
            return { outcome: 'unavailable', intent: null };
        }

        // Deliberately the same `poll:` prefix regardless of which path found
        // the transaction: the event key IS the idempotency key, so the status
        // poll and the expiry reconciliation must collapse onto one entry for
        // the same transaction rather than each recording its own.
        const eventKey = createHash('sha256')
            .update(`poll:${transaction.id}:${transaction.status}:${transaction.amountCents}:${transaction.paymentLinkId}`)
            .digest('hex');
        try {
            const settled = await this.requireStore().settleWompiTransaction({
                tenantId,
                transaction,
                eventKey,
                source: 'poll',
            });
            return { outcome: 'settled', intent: settled.intent || null };
        } catch (error: any) {
            this.logger.warn(
                `Wompi ${source} settlement failed for intent ${intent.id}: ${error.message}`,
            );
            return { outcome: 'unavailable', intent: null };
        }
    }

    /** Payments the ledger refused to settle on its own, for the operator screen. */
    async listUnresolvedIntents(tenantId: string): Promise<Array<{
        id: string;
        provider: TenantPaymentProvider;
        status: TenantPaymentStatus;
        canonicalReference: string;
        amountCents: number;
        currency: string;
        description: string;
        lastError?: string;
        providerLinkId?: string;
        providerTransactionId?: string;
        createdAt?: string;
    }>> {
        const intents = await this.requireStore().listUnresolvedIntents(tenantId);
        return intents.map((intent) => ({
            id: intent.id,
            provider: intent.provider,
            status: intent.status,
            canonicalReference: intent.canonicalReference,
            amountCents: intent.amountCents,
            currency: intent.currency,
            description: intent.description,
            lastError: intent.lastError,
            providerLinkId: intent.providerLinkId,
            providerTransactionId: intent.providerTransactionId,
            createdAt: intent.createdAt?.toISOString(),
        }));
    }

    /**
     * Closes one review state, always by asking the provider first.
     *
     * The operator cannot choose the outcome. We re-read the provider: if money
     * really arrived the intent settles as paid exactly as a webhook would, and
     * if the provider has no transaction at all the reference is released so the
     * customer can be charged again. An operator who could type "paid" would be
     * able to mark an order settled that nobody ever paid — which is precisely
     * the failure this whole module is built to prevent.
     */
    async resolveUnresolvedIntent(
        tenantId: string,
        intentId: string,
        reason: string,
    ): Promise<{ outcome: 'settled' | 'released' | 'still_unresolved'; status: TenantPaymentStatus }> {
        const trimmedReason = String(reason || '').trim();
        if (trimmedReason.length < 4 || trimmedReason.length > 300) {
            throw new BadRequestException({ error: 'resolution_reason_required' });
        }
        const store = this.requireStore();
        const intent = await store.findById(tenantId, intentId);
        if (!intent) throw new BadRequestException({ error: 'tenant_payment_intent_not_found' });
        if (!['requires_review', 'ambiguous'].includes(intent.status)) {
            throw new ConflictException({ error: 'tenant_payment_intent_not_unresolved', status: intent.status });
        }

        const recovered = await this.recoverWompiIntentFromProvider(tenantId, intent, 'reconciliation');
        if (recovered.outcome === 'settled' && recovered.intent) {
            this.logger.log(
                `[TenantPayments] Review intent ${intentId} settled from provider evidence as `
                + `'${recovered.intent.status}' (operator reason: ${trimmedReason})`,
            );
            return { outcome: 'settled', status: recovered.intent.status };
        }
        if (recovered.outcome === 'no_transaction') {
            const released = await store.discardUnresolvedIntent(
                tenantId,
                intentId,
                `operator_released: ${trimmedReason}`.slice(0, 500),
            );
            if (!released) {
                // Something settled it between our read and this write; the
                // settlement is authoritative and must not be overwritten.
                const latest = await store.findById(tenantId, intentId);
                return { outcome: 'still_unresolved', status: latest?.status || intent.status };
            }
            this.logger.warn(
                `[TenantPayments] Review intent ${intentId} released as expired — provider has no `
                + `transaction for it (operator reason: ${trimmedReason})`,
            );
            return { outcome: 'released', status: released.status };
        }

        // Provider unreachable. Refuse to guess: leaving it unresolved is the
        // only safe answer, and the operator can retry.
        throw new ServiceUnavailableException({ error: 'tenant_payment_provider_evidence_unavailable' });
    }

    private async reconcileExpiredWompiIntent(
        tenantId: string,
        intent: TenantPaymentIntent,
    ): Promise<TenantPaymentIntent | null> {
        if (!intent.providerLinkId || !intent.expiresAt || intent.expiresAt.getTime() > Date.now()) {
            return intent;
        }
        const credentials = await this.getWompiCredentials(
            tenantId,
            undefined,
            this.intentCredentialRevision(intent),
        );
        if (!credentials) return intent;
        try {
            const link = await this.requireWompiClient().getAndValidatePaymentLink({
                providerLinkId: intent.providerLinkId,
                environment: credentials.environment,
                expectedPublicKey: credentials.publicKey,
                expectedIntentId: intent.id,
                expectedAmountCents: intent.amountCents,
                expectedExpiresAt: intent.expiresAt,
                allowInactive: true,
            });
            if (link.active) return intent;

            // An inactive link does not prove nobody paid — an APPROVED event
            // may simply have been lost. Ask the provider directly BEFORE
            // blocking the reference: this is the difference between a customer
            // whose money arrived being marked paid, and being stuck behind a
            // review state that had no operator surface at all.
            const recovered = await this.recoverWompiIntentFromProvider(tenantId, intent, 'reconciliation');
            if (recovered.outcome === 'settled' && recovered.intent && recovered.intent.status !== 'pending') {
                return recovered.intent;
            }

            // The provider answered and has NO transaction for this link: the
            // link died unpaid, which is the most ordinary outcome in chat
            // commerce (the customer simply did not pay today). Expire it so
            // the reference leaves the unresolved unique index and the customer
            // can be given a fresh link. Before this, that everyday case parked
            // the order in `requires_review` FOREVER with no way to charge it.
            if (recovered.outcome === 'no_transaction') {
                await this.requireStore().markCreationState(
                    tenantId,
                    intent.id,
                    'expired',
                    'wompi_link_expired_without_payment',
                    intent.providerLinkId,
                );
                return { ...intent, status: 'expired', lastError: 'wompi_link_expired_without_payment' };
            }

            // We could not reach the provider. That proves nothing, so never
            // manufacture a terminal state from local time — an in-flight bank
            // redirect can still land.
            await this.requireStore().markCreationState(
                tenantId,
                intent.id,
                'requires_review',
                'wompi_inactive_link_requires_provider_evidence',
                intent.providerLinkId,
            );
            return { ...intent, status: 'requires_review', lastError: 'wompi_inactive_link_requires_provider_evidence' };
        } catch (error: any) {
            this.logger.warn(`Could not reconcile expired Wompi link ${intent.providerLinkId}: ${error.message}`);
            return intent;
        }
    }

    private intentToPaymentLink(intent: TenantPaymentIntent): PaymentLink {
        if (!intent.providerLinkId || !intent.checkoutUrl) {
            throw new ServiceUnavailableException('tenant_payment_link_not_shareable');
        }
        return {
            id: intent.providerLinkId,
            providerLinkId: intent.providerLinkId,
            provider: intent.provider,
            url: intent.checkoutUrl,
            initPoint: intent.checkoutUrl,
            preferenceId: intent.providerLinkId,
            amountCents: intent.amountCents,
            currency: intent.currency,
            description: intent.description,
            paymentStatus: 'pending',
        };
    }

    private async readStoredConfig(tenantId: string): Promise<StoredTenantPaymentConfigV2> {
        try {
            const rows = await this.prisma.$queryRawUnsafe(
                `SELECT config
                   FROM tenant_payment_provider_configs
                  WHERE tenant_id = $1::uuid
                  LIMIT 1`,
                tenantId,
            ) as Array<{ config: unknown }>;
            if (rows[0]) return this.normalizeStoredConfig(rows[0].config);
            // The dedicated table exists and migration has completed. A
            // missing row means genuinely unconfigured; never trust a value
            // later injected through generic tenants.settings.
            return this.normalizeStoredConfig(undefined);
        } catch (error: any) {
            // Compatibility only for the migration window and unit harnesses.
            // Production migrations create the dedicated table before the new
            // application starts; writes below never fall back to settings.
            this.logger.warn(`Dedicated tenant payment config read unavailable for ${tenantId}: ${error.message}`);
        }
        const tenant = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { settings: true },
        });
        return this.normalizeStoredConfig((tenant?.settings as any)?.tenantPayments);
    }

    private normalizeStoredConfig(raw: any): StoredTenantPaymentConfigV2 {
        if (raw?.version === 2 && raw?.providers && typeof raw.providers === 'object') {
            const active = ['mercadopago', 'wompi'].includes(raw.activeProvider)
                ? raw.activeProvider as TenantPaymentProvider
                : null;
            const mercadoPago = raw.providers.mercadopago
                ? { ...raw.providers.mercadopago }
                : undefined;
            const wompi = raw.providers.wompi
                ? { ...raw.providers.wompi }
                : undefined;
            if (mercadoPago) mercadoPago.environment = this.normalizeCredentialEnvironment(mercadoPago.environment);
            if (wompi) wompi.environment = this.normalizeCredentialEnvironment(wompi.environment);
            return {
                version: 2,
                documentRevision: Number.isSafeInteger(Number(raw.documentRevision))
                    ? Math.max(0, Number(raw.documentRevision))
                    : 0,
                activeProvider: active,
                providers: {
                    ...(mercadoPago ? { mercadopago: mercadoPago } : {}),
                    ...(wompi ? { wompi } : {}),
                },
            };
        }
        const legacy: StoredMercadoPagoConfig = {
            accessTokenEnc: raw?.accessTokenEnc,
            webhookSecretEnc: raw?.webhookSecretEnc,
            environment: this.normalizeCredentialEnvironment(raw?.environment),
            publicKey: raw?.publicKey,
            accountId: raw?.accountId,
            accountEmail: raw?.accountEmail,
            verifiedAt: raw?.verifiedAt,
        };
        const hasLegacy = Object.values(legacy).some(Boolean);
        return {
            version: 2,
            documentRevision: 0,
            activeProvider: hasLegacy ? 'mercadopago' : null,
            providers: hasLegacy ? { mercadopago: legacy } : {},
        };
    }

    private async mutateStoredConfigLocked(
        tenantId: string,
        mutate: (stored: StoredTenantPaymentConfigV2) => StoredTenantPaymentConfigV2,
        claims: {
            wompiPublicKey?: string;
            mercadoPagoAccountId?: string;
        } = {},
    ): Promise<void> {
        await this.prisma.$transaction(async (transaction: any) => {
            if (claims.wompiPublicKey) {
                await transaction.$queryRawUnsafe(
                    `SELECT pg_advisory_xact_lock(hashtext($1))::text AS lock_acquired`,
                    `tenant-wompi-merchant:${claims.wompiPublicKey}`,
                );
                const duplicate = await transaction.$queryRawUnsafe(
                    `SELECT tenant_id AS id
                       FROM tenant_payment_provider_configs
                      WHERE tenant_id <> $1::uuid
                        AND (
                            wompi_public_key = $2
                            OR EXISTS (
                                SELECT 1
                                  FROM jsonb_array_elements(
                                      CASE
                                          WHEN jsonb_typeof(config #> '{providers,wompi,history}') = 'array'
                                              THEN config #> '{providers,wompi,history}'
                                          ELSE '[]'::jsonb
                                      END
                                  ) AS generation
                                 WHERE generation ->> 'publicKey' = $2
                            )
                        )
                      LIMIT 1`,
                    tenantId,
                    claims.wompiPublicKey,
                ) as Array<{ id: string }>;
                if (duplicate[0]) {
                    throw new ConflictException({
                        error: 'wompi_merchant_already_connected',
                        provider: 'wompi',
                    });
                }
            }
            if (claims.mercadoPagoAccountId) {
                await transaction.$queryRawUnsafe(
                    `SELECT pg_advisory_xact_lock(hashtext($1))::text AS lock_acquired`,
                    `tenant-mercadopago-account:${claims.mercadoPagoAccountId}`,
                );
                const duplicate = await transaction.$queryRawUnsafe(
                    `SELECT tenant_id AS id
                       FROM tenant_payment_provider_configs
                      WHERE tenant_id <> $1::uuid
                        AND (
                            mercadopago_account_id = $2
                            OR EXISTS (
                                SELECT 1
                                  FROM jsonb_array_elements(
                                      CASE
                                          WHEN jsonb_typeof(config #> '{providers,mercadopago,history}') = 'array'
                                              THEN config #> '{providers,mercadopago,history}'
                                          ELSE '[]'::jsonb
                                      END
                                  ) AS generation
                                 WHERE generation ->> 'accountId' = $2
                            )
                        )
                      LIMIT 1`,
                    tenantId,
                    claims.mercadoPagoAccountId,
                ) as Array<{ id: string }>;
                if (duplicate[0]) {
                    throw new ConflictException({
                        error: 'mercadopago_account_already_connected',
                        provider: 'mercadopago',
                    });
                }
            }
            const rows = await transaction.$queryRawUnsafe(
                `SELECT settings FROM tenants WHERE id = $1::uuid FOR UPDATE`,
                tenantId,
            ) as Array<{ settings: Record<string, unknown> | null }>;
            if (!rows[0]) throw new BadRequestException('Tenant not found');
            const settings = { ...((rows[0].settings as any) || {}) };
            const configRows = await transaction.$queryRawUnsafe(
                `SELECT config
                   FROM tenant_payment_provider_configs
                  WHERE tenant_id = $1::uuid
                  FOR UPDATE`,
                tenantId,
            ) as Array<{ config: unknown }>;
            const current = this.normalizeStoredConfig(
                configRows[0]?.config ?? (settings as any).tenantPayments,
            );
            const next = mutate(current);
            next.documentRevision = Math.max(0, Number(current.documentRevision || 0)) + 1;
            await transaction.$executeRawUnsafe(
                `INSERT INTO tenant_payment_provider_configs
                    (tenant_id, config, wompi_public_key, mercadopago_account_id, created_at, updated_at)
                 VALUES ($1::uuid, $2::jsonb, $3, $4, NOW(), NOW())
                 ON CONFLICT (tenant_id) DO UPDATE
                    SET config = EXCLUDED.config,
                        wompi_public_key = EXCLUDED.wompi_public_key,
                        mercadopago_account_id = EXCLUDED.mercadopago_account_id,
                        updated_at = NOW()`,
                tenantId,
                JSON.stringify(next),
                next.providers.wompi?.publicKey || null,
                next.providers.mercadopago?.accountId || null,
            );
            // Expand/contract bridge for rolling deploys. Old instances still
            // read this copy; the migration's revision-aware BEFORE trigger
            // prevents an unrelated stale settings snapshot from rolling the
            // dedicated record back.
            await transaction.$executeRawUnsafe(
                `UPDATE tenants
                    SET settings = jsonb_set(
                        COALESCE(settings, '{}'::jsonb),
                        '{tenantPayments}',
                        $2::jsonb,
                        true
                    ),
                        updated_at = NOW()
                  WHERE id = $1::uuid`,
                tenantId,
                JSON.stringify(next),
            );
        });
        await this.redis.del(this.cacheKey(tenantId)).catch(() => undefined);
    }

    private providerConfigHash(config: StoredMercadoPagoConfig | StoredWompiConfig | undefined): string {
        return createHash('sha256').update(JSON.stringify(config || null)).digest('hex');
    }

    private nextMercadoPagoHistory(
        current: StoredMercadoPagoConfig,
        materialChange: boolean,
    ): StoredMercadoPagoCredentialGeneration[] {
        const history = Array.isArray(current.history) ? [...current.history] : [];
        if (!materialChange || (!current.accessTokenEnc && !current.webhookSecretEnc && !current.accountId)) {
            return history;
        }
        if (history.length >= MAX_PROVIDER_CREDENTIAL_HISTORY) {
            throw new ConflictException({
                error: 'payment_provider_credential_history_limit',
                provider: 'mercadopago',
            });
        }
        const { history: _history, ...generation } = current;
        history.push(generation);
        return history;
    }

    private nextWompiHistory(
        current: StoredWompiConfig,
        materialChange: boolean,
    ): StoredWompiCredentialGeneration[] {
        const history = Array.isArray(current.history) ? [...current.history] : [];
        if (!materialChange || (!current.publicKey && !current.privateKeyEnc && !current.eventsSecretEnc)) {
            return history;
        }
        if (history.length >= MAX_PROVIDER_CREDENTIAL_HISTORY) {
            throw new ConflictException({
                error: 'payment_provider_credential_history_limit',
                provider: 'wompi',
            });
        }
        const { history: _history, ...generation } = current;
        history.push(generation);
        return history;
    }

    private isStoredProviderReady(stored: StoredTenantPaymentConfigV2, provider: TenantPaymentProvider): boolean {
        if (provider === 'mercadopago') {
            const config = stored.providers.mercadopago;
            return !config?.disabledAt
                && !!config?.accessTokenEnc
                && !!config.webhookSecretEnc
                && !!config.environment
                && !!config.accountId;
        }
        const config = stored.providers.wompi;
        return !config?.disabledAt
            && !!config?.publicKey
            && !!config.privateKeyEnc
            && !!config.eventsSecretEnc
            && !!config.webhookTokenEnc
            && !!config.environment
            && !!config.verifiedAt
            && !!config.webhookAcknowledgedAt;
    }

    private isStoredProviderActivationReady(stored: StoredTenantPaymentConfigV2, provider: TenantPaymentProvider): boolean {
        if (provider === 'mercadopago') {
            const config = stored.providers.mercadopago;
            return !!config?.accessTokenEnc
                && !!config.webhookSecretEnc
                && !!config.environment
                && !!config.accountId;
        }
        const config = stored.providers.wompi;
        return !!config?.publicKey
            && !!config.privateKeyEnc
            && !!config.eventsSecretEnc
            && !!config.webhookTokenEnc
            && !!config.environment
            && !!config.verifiedAt;
    }

    private credentialContext(
        tenantId: string,
        provider: TenantPaymentProvider,
        environment: TenantPaymentCredentialEnvironment,
        field: TenantPaymentCredentialField,
    ): TenantPaymentCredentialContext {
        return { tenantId, provider, environment, field };
    }

    private encryptCredential(plaintext: string, context: TenantPaymentCredentialContext): string {
        try {
            return this.requireCredentialCrypto().encrypt(plaintext, context);
        } catch {
            throw new ServiceUnavailableException('tenant_payment_credential_encryption_unavailable');
        }
    }

    private rewrapEncryptedCredential(
        encrypted: string | undefined,
        context: TenantPaymentCredentialContext,
    ): string | undefined {
        if (!encrypted) return undefined;
        return this.encryptCredential(this.decryptExistingCredential(encrypted, context), context);
    }

    private rewrapMercadoPagoGeneration(
        tenantId: string,
        generation: StoredMercadoPagoCredentialGeneration,
    ): StoredMercadoPagoCredentialGeneration {
        const environment = this.resolveMercadoPagoEnvironment(
            tenantId,
            generation as StoredMercadoPagoConfig,
        );
        if (!environment) {
            throw new ServiceUnavailableException('tenant_payment_credential_decryption_unavailable');
        }
        return {
            ...generation,
            environment,
            accessTokenEnc: this.rewrapEncryptedCredential(
                generation.accessTokenEnc,
                this.credentialContext(tenantId, 'mercadopago', environment, 'access_token'),
            ),
            webhookSecretEnc: this.rewrapEncryptedCredential(
                generation.webhookSecretEnc,
                this.credentialContext(tenantId, 'mercadopago', environment, 'webhook_secret'),
            ),
        };
    }

    private rewrapWompiGeneration(
        tenantId: string,
        generation: StoredWompiCredentialGeneration,
    ): StoredWompiCredentialGeneration {
        const environment = generation.environment;
        if (!environment) {
            throw new ServiceUnavailableException('tenant_payment_credential_decryption_unavailable');
        }
        return {
            ...generation,
            privateKeyEnc: this.rewrapEncryptedCredential(
                generation.privateKeyEnc,
                this.credentialContext(tenantId, 'wompi', environment, 'private_key'),
            ),
            eventsSecretEnc: this.rewrapEncryptedCredential(
                generation.eventsSecretEnc,
                this.credentialContext(tenantId, 'wompi', environment, 'events_secret'),
            ),
            webhookTokenEnc: this.rewrapEncryptedCredential(
                generation.webhookTokenEnc,
                this.credentialContext(tenantId, 'wompi', environment, 'callback_token'),
            ),
        };
    }

    private readCredential(
        encrypted: string,
        context: TenantPaymentCredentialContext,
    ): TenantPaymentCredentialReadResult {
        return this.requireCredentialCrypto().readCompatible(
            encrypted,
            context,
            legacy => this.decryptStrictLegacyCredential(legacy),
        );
    }

    private decryptStrictLegacyCredential(encrypted: string): string {
        // WhatsappCryptoService historically falls back to plaintext/base64 in
        // development when ENCRYPTION_KEY is absent. That behavior is never
        // acceptable for money credentials, even inside the migration bridge.
        const legacyKey = process.env.ENCRYPTION_KEY;
        if (!legacyKey || !/^[a-f0-9]{64,}$/i.test(legacyKey) || legacyKey.length % 2 !== 0) {
            throw new Error('tenant_payment_legacy_key_unavailable');
        }
        return this.crypto.decryptToken(encrypted);
    }

    private decryptExistingCredential(
        encrypted: string,
        context: TenantPaymentCredentialContext,
    ): string {
        try {
            return this.readCredential(encrypted, context).plaintext;
        } catch {
            throw new ServiceUnavailableException('tenant_payment_credential_decryption_unavailable');
        }
    }

    private tryDecryptCredential(
        encrypted: string | undefined,
        context: TenantPaymentCredentialContext,
    ): string | undefined {
        if (!encrypted) return undefined;
        try {
            return this.readCredential(encrypted, context).plaintext;
        } catch {
            return undefined;
        }
    }

    /**
     * Older Mercado Pago envelopes predate authenticated environment metadata.
     * Only a strict legacy AES-GCM value may be opened provisionally to derive
     * TEST-/APP_USR-. A v2 envelope without its stored environment is unusable.
     */
    private resolveMercadoPagoEnvironment(
        tenantId: string,
        config: StoredMercadoPagoConfig,
    ): WompiEnvironment | undefined {
        const storedEnvironment = this.normalizeCredentialEnvironment(config.environment);
        if (storedEnvironment) return storedEnvironment;
        if (!config.accessTokenEnc || config.accessTokenEnc.startsWith('tpc:')) return undefined;
        try {
            const read = this.readCredential(
                config.accessTokenEnc,
                this.credentialContext(tenantId, 'mercadopago', 'production', 'access_token'),
            );
            return read.format === 'legacy-v1'
                ? this.mercadoPagoEnvironmentForToken(read.plaintext)
                : undefined;
        } catch {
            return undefined;
        }
    }

    private mercadoPagoEnvironmentForToken(token: string): WompiEnvironment | undefined {
        if (/^TEST-\S+$/.test(token)) return 'sandbox';
        if (/^APP_USR-\S+$/.test(token)) return 'production';
        return undefined;
    }

    private normalizeCredentialEnvironment(value: unknown): WompiEnvironment | undefined {
        return value === 'sandbox' || value === 'production' ? value : undefined;
    }

    private constantTimeEqual(left: string, right: string): boolean {
        const leftBuffer = Buffer.from(left);
        const rightBuffer = Buffer.from(right);
        return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
    }

    private idempotencyRedisKey(tenantId: string, key: string): string {
        return `tenant_payment_link:idem:${tenantId}:${key}`;
    }

    private mpNotificationUrl(tenantId: string): string {
        return new URL(`/api/v1/tenant-payments/webhook/${tenantId}`, this.apiPublicBase()).toString();
    }

    private wompiNotificationUrl(tenantId: string, token: string): string {
        return new URL(
            `/api/v1/tenant-payments/webhook/wompi/${tenantId}/${encodeURIComponent(token)}`,
            this.apiPublicBase(),
        ).toString();
    }

    private safeWompiNotificationUrl(tenantId: string, token: string): string | undefined {
        if (!token) return undefined;
        try { return this.wompiNotificationUrl(tenantId, token); } catch { return undefined; }
    }

    private apiPublicBase(): URL {
        const rawBase = String(process.env.API_PUBLIC_URL || process.env.NEXT_PUBLIC_API_URL || '')
            .trim()
            .replace(/\/api\/v1\/?$/, '');
        try {
            const base = new URL(rawBase);
            const local = ['localhost', '127.0.0.1', '::1'].includes(base.hostname);
            if (base.protocol !== 'https:' && !(local && base.protocol === 'http:')) throw new Error('https_required');
            return base;
        } catch {
            throw new BadRequestException({ error: 'payment_webhook_url_not_configured' });
        }
    }

    private isHttpsUrl(value: string): boolean {
        try { return new URL(value).protocol === 'https:'; } catch { return false; }
    }

    private normalizeDomainStatus(status: string): TenantPaymentStatus {
        return ['paid', 'failed', 'refunded'].includes(status)
            ? status as TenantPaymentStatus
            : 'pending';
    }

    private intentCredentialRevision(intent: TenantPaymentIntent): number | undefined {
        const revision = Number((intent.resourceSnapshot as any)?.providerConfigRevision);
        return Number.isSafeInteger(revision) && revision >= 0 ? revision : undefined;
    }

    private async verifyMpToken(accessToken: string): Promise<{
        ok: boolean;
        accountId?: string;
        email?: string;
    }> {
        try {
            const response = await fetch(`${MP_API}/users/me`, {
                headers: { Authorization: `Bearer ${accessToken}` },
                signal: AbortSignal.timeout(15_000),
            });
            if (!response.ok) return { ok: false };
            const payload: any = await response.json();
            const accountId = String(payload?.id ?? '').trim();
            if (!/^\d{1,32}$/.test(accountId)) return { ok: false };
            return { ok: true, accountId, email: payload?.email };
        } catch {
            return { ok: false };
        }
    }

    private requireStore(): TenantPaymentStoreService {
        if (!this.store) throw new ServiceUnavailableException('tenant_payment_store_unavailable');
        return this.store;
    }

    private requireWompiClient(): TenantWompiClient {
        if (!this.wompi) throw new ServiceUnavailableException('tenant_wompi_client_unavailable');
        return this.wompi;
    }

    private requireCredentialCrypto(): TenantPaymentCredentialCryptoService {
        if (!this.credentialCrypto) {
            throw new ServiceUnavailableException('tenant_payment_credential_crypto_unavailable');
        }
        return this.credentialCrypto;
    }

    private async assertCustomerPaymentsEntitled(tenantId: string): Promise<void> {
        const [featureEnabled, tenant, entitlement] = await Promise.all([
            this.throttle?.isFeatureEnabled(tenantId, 'customerPayments') ?? Promise.resolve(false),
            this.prisma.tenant.findUnique({
                where: { id: tenantId },
                select: { isActive: true },
            }),
            resolveTenantSubscriptionAccess(this.prisma, tenantId, 'write'),
        ]);
        if (!tenant?.isActive) {
            throw new BadRequestException({ error: 'tenant_not_active' });
        }
        if (!entitlement.allowed) {
            if (entitlement.restrictionLevel === 'unavailable') {
                throw new ServiceUnavailableException(entitlement.error || 'subscription_status_unavailable');
            }
            throw new BadRequestException({
                error: entitlement.error || 'subscription_restricted',
            });
        }
        if (!featureEnabled) {
            throw new BadRequestException({
                error: 'customer_payments_not_available_on_plan',
                feature: 'customerPayments',
            });
        }
    }

    private providerMutationLockKey(tenantId: string, _provider: TenantPaymentProvider): string {
        // Tenant-wide on purpose: switching the active rail must serialize with
        // a submission using the previously active rail as well as rotations of
        // either provider's webhook credentials.
        return `lock:tenant-customer-payments:${tenantId}`;
    }

    private async acquireProviderMutationLock(
        tenantId: string,
        provider: TenantPaymentProvider,
    ): Promise<string> {
        const token = await this.redis.acquireLockToken(
            this.providerMutationLockKey(tenantId, provider),
            60,
        ).catch(() => null);
        if (!token) {
            throw new ConflictException({ error: 'tenant_payment_provider_busy' });
        }
        return token;
    }

    private async withProviderMutationLock<T>(
        tenantId: string,
        provider: TenantPaymentProvider,
        callback: () => Promise<T>,
    ): Promise<T> {
        const token = await this.acquireProviderMutationLock(tenantId, provider);
        try {
            return await callback();
        } finally {
            await this.redis.releaseLockToken(
                this.providerMutationLockKey(tenantId, provider),
                token,
            ).catch(() => undefined);
        }
    }
}
