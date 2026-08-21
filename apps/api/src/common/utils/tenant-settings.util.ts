import type { PrismaService } from '../../modules/prisma/prisma.service';

/**
 * Keys owned by a dedicated persistence/API boundary. They must never be
 * writable or serializable through the generic `tenants.settings` contract.
 *
 * `channelManager` y `verticalIntegrations` guardan credenciales de proveedor.
 * Cada una tiene su propio endpoint, que enmascara; el genérico devolvía el
 * JSONB entero, así que `GET /tenants/:id` entregaba la clave de Hostaway y la
 * de Toast en claro a cualquiera que pudiera leer el tenant. Estar cifradas en
 * la base no alcanza: una respuesta que las devuelve las saca del sobre.
 */
export const RESERVED_TENANT_SETTING_KEYS = [
    'tenantPayments',
    'channelManager',
    'verticalIntegrations',
] as const;

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
