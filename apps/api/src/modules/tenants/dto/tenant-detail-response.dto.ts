/**
 * Public channel information exposed by GET /tenants/:id.
 *
 * Credential-bearing fields intentionally do not belong to this contract:
 * accountId, accessToken, refreshToken, webhookSecret and metadata.
 */
export class TenantChannelSummaryDto {
    id!: string;
    channelType!: string;
    displayName!: string;
    isActive!: boolean;
    createdAt!: Date | string;
    updatedAt!: Date | string;
}

/** Explicit, allow-listed response contract for GET /tenants/:id. */
export class TenantDetailResponseDto {
    id!: string;
    name!: string;
    slug!: string;
    industry!: string;
    language!: string;
    isActive!: boolean;
    /** Tenant nuestro: sin factura DIAN y fuera de las métricas de ingresos. */
    isInternal!: boolean;
    /** Límites vigentes (rate limiter y features leen de acá). */
    plan!: string;
    /** Plan que se le cobra. Puede diferir de `plan`: ver override de permisos. */
    billedPlan!: string | null;
    /** Generic settings only. Dedicated tenant payment configuration is never serialized here. */
    settings!: (Record<string, unknown> & { tenantPayments?: never }) | null;
    operatingCurrency!: string | null;
    operatingCurrencyLockedAt!: Date | string | null;
    subscriptionStatus!: string | null;
    trialEndsAt!: Date | string | null;
    currentPeriodEnd!: Date | string | null;
    onboardingCompletedAt!: Date | string | null;
    firstChannelConnectedAt!: Date | string | null;
    firstMessageAt!: Date | string | null;
    createdAt!: Date | string;
    updatedAt!: Date | string;
    channelAccounts!: TenantChannelSummaryDto[];
    _count!: { users: number };
}
