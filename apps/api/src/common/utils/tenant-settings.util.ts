import type { PrismaService } from '../../modules/prisma/prisma.service';

/**
 * Keys owned by a dedicated persistence/API boundary. They must never be
 * writable or serializable through the generic `tenants.settings` contract.
 *
 * This is deliberately an ownership registry, not only a list of fields that
 * happen to contain a password today. Every branch below has a dedicated API
 * which applies validation, plan/role gates, compare-and-swap semantics or
 * secret masking. Letting the generic tenant endpoint read or replace one of
 * them either discloses credentials/PII or bypasses that dedicated contract.
 *
 * `verticalConfig` stays visible because the tenant list needs the canonical
 * vertical identity. Its mutation is still rejected by `TenantsService` and
 * can only happen through the explicit vertical migration workflow.
 */
export const RESERVED_TENANT_SETTING_KEYS = [
    'tenantPayments',
    'channelManager',
    'verticalIntegrations',
    'verticalIntegrationHealth',
    'mcpServers',
    'mcpToolApprovals',
    'ecommerce',
    'slack',
    'googleBusiness',
    'biApiKey',
    'saml',
    'whiteLabel',
    'managed',
    'quotaOverrides',
    'featureFlags',
    'featureFlagsMeta',
    'fiscalData',
    'appointmentReminders',
    'bookingFlows',
    'publicBooking',
    'brandColor',
    'nurturing',
    'pipeline',
    'smsNotifications',
    'recallConfig',
    'businessInfoDraft',
    'purgeSaga',
    'provisioning',
    'verticalProvisioning',
    'verticalConfigPending',
] as const;

/**
 * The generic PATCH is intentionally small and fail-closed. A new product
 * setting must get a typed, dedicated owner instead of silently becoming
 * writable through `settings: any` and bypassing validation added later.
 */
export const GENERIC_WRITABLE_TENANT_SETTING_KEYS = [
    'timezone',
    'currency',
    'dateFormat',
    'timeFormat',
    'weekStart',
    'businessHours',
    'chatReasons',
    'customerTypes',
] as const;

export function firstUnsupportedGenericTenantSetting(settings: unknown): string | null {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
    const allowed = new Set<string>(GENERIC_WRITABLE_TENANT_SETTING_KEYS);
    return Object.keys(settings as Record<string, unknown>)
        .find((key) => !allowed.has(key)) ?? null;
}

export function hasOnlyGenericWritableTenantSettings(settings: unknown): boolean {
    return firstUnsupportedGenericTenantSetting(settings) === null;
}

/** La primera clave reservada presente, para nombrarla en el error. */
export function firstReservedTenantSetting(settings: unknown): string | null {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
    return RESERVED_TENANT_SETTING_KEYS.find((key) => (
        Object.prototype.hasOwnProperty.call(settings, key)
    )) ?? null;
}

export function hasReservedTenantSetting(settings: unknown): boolean {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return false;
    return RESERVED_TENANT_SETTING_KEYS.some((key) => (
        Object.prototype.hasOwnProperty.call(settings, key)
    ));
}

/**
 * Return a copy suitable for generic tenant responses. Never mutate the
 * Prisma record or cached DTO supplied by the caller.
 */
export function redactReservedTenantSettings(settings: unknown): unknown {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return settings;

    const safe = { ...(settings as Record<string, unknown>) };
    for (const key of RESERVED_TENANT_SETTING_KEYS) delete safe[key];
    return safe;
}

export function redactReservedTenantSettingsFromRecord<T>(record: T): T {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return record;
    if (!Object.prototype.hasOwnProperty.call(record, 'settings')) return record;

    return {
        ...(record as Record<string, unknown>),
        settings: redactReservedTenantSettings((record as Record<string, unknown>).settings),
    } as T;
}

export interface TenantSettingsMergeOptions {
    industry?: string;
    isActive?: boolean;
    onboardingCompletedAt?: Date;
}

/**
 * Merge top-level tenant settings in PostgreSQL instead of doing a
 * read-modify-write in application memory. This preserves unrelated keys
 * written concurrently by billing, onboarding, SAML, or vertical bootstrap.
 */
export async function mergeTenantSettingsAtomic(
    prisma: PrismaService,
    tenantId: string,
    patch: Record<string, unknown>,
    options: TenantSettingsMergeOptions = {},
): Promise<void> {
    const affected = await prisma.$executeRawUnsafe(
        `UPDATE public.tenants
            SET settings = COALESCE(settings, '{}'::jsonb) || $2::jsonb,
                industry = COALESCE($3::text, industry),
                is_active = COALESCE($4::boolean, is_active),
                onboarding_completed_at = CASE
                    WHEN $5::boolean THEN $6::timestamptz
                    ELSE onboarding_completed_at
                END,
                updated_at = NOW()
          WHERE id = $1::uuid`,
        tenantId,
        JSON.stringify(patch),
        options.industry ?? null,
        options.isActive ?? null,
        options.onboardingCompletedAt !== undefined,
        options.onboardingCompletedAt?.toISOString() ?? null,
    );
    if (affected !== 1) {
        throw new Error(`Tenant ${tenantId} not found while merging settings`);
    }
}

/**
 * Atomically transform several related top-level settings keys.
 *
 * Use the narrower branch helper when one branch is enough. This variant is
 * reserved for invariants spanning multiple keys (for example feature flags +
 * their audit metadata, or public-booking copy + brand colour). The row lock
 * makes replacing the complete JSON document safe: all concurrent UPDATEs wait
 * and then operate on the version written here.
 */
export async function mutateTenantSettingsAtomic(
    prisma: PrismaService,
    tenantId: string,
    transform: (current: Readonly<Record<string, unknown>>) => Record<string, unknown>,
): Promise<Record<string, unknown>> {
    return prisma.$transaction(async (tx: any) => {
        const rows = await tx.$queryRawUnsafe(
            `SELECT COALESCE(settings, '{}'::jsonb) AS settings
               FROM public.tenants
              WHERE id = $1::uuid
              FOR UPDATE`,
            tenantId,
        ) as Array<{ settings: Record<string, unknown> | null }>;
        if (!rows.length) throw new Error(`Tenant ${tenantId} not found while mutating settings`);

        const current = { ...(rows[0].settings || {}) };
        const next = transform(Object.freeze(current));
        if (!next || typeof next !== 'object' || Array.isArray(next)) {
            throw new Error('Tenant settings transformer must return an object');
        }
        // Returning the selected object is the transformer's explicit no-op
        // signal. This matters for idempotent health observations and stale
        // CAS results: taking the lock is required, rewriting identical JSON is
        // not (and would create misleading updated_at churn).
        if (next === current) return current;
        const affected = await tx.$executeRawUnsafe(
            `UPDATE public.tenants
                SET settings = $2::jsonb,
                    updated_at = NOW()
              WHERE id = $1::uuid`,
            tenantId,
            JSON.stringify(next),
        );
        if (Number(affected) !== 1) {
            throw new Error(`Tenant ${tenantId} not found while mutating settings`);
        }
        return next;
    });
}
