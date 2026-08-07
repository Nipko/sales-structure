import type { PrismaService } from '../../modules/prisma/prisma.service';

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
