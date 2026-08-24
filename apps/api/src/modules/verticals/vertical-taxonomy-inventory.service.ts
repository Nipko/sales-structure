import { Injectable } from '@nestjs/common';
import {
    SUBTYPE_TAXONOMY_MIGRATION_APPLY_SUPPORTED,
    SUBTYPE_TAXONOMY_MIGRATION_CONTRACTS,
    SUBTYPE_TAXONOMY_MIGRATION_VERSION,
    VERTICAL_MANIFEST_INDUSTRIES,
    classifySubtypeTaxonomyMigration,
    listCanonicalSubtypeExperienceProfileIds,
    listSubtypeExperienceProfileIds,
    listVerticalCapabilityConfigurations,
    subtypeTaxonomyMigrationSourceId,
    type LegacySubtypeMigrationId,
    type SubtypeTaxonomyMigrationStatus,
} from '@parallext/shared';
import { PrismaService } from '../prisma/prisma.service';

type JsonRecord = Record<string, unknown>;

export interface VerticalTaxonomyInventoryRow {
    tenantId: string;
    currentProfileId: LegacySubtypeMigrationId;
    status: Extract<SubtypeTaxonomyMigrationStatus, 'candidate' | 'needs_owner' | 'approved'>;
    candidates: readonly string[];
    selectedTargets: readonly string[];
    reasonCodes: readonly string[];
    requiresOwnerConsent: true;
    applySupported: false;
}

function record(value: unknown): JsonRecord {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as JsonRecord
        : {};
}

/**
 * Read-only production inventory for the four ambiguous legacy identities.
 * It returns tenant ids and classification facts only: no name, email, phone,
 * schema name or settings payload leaves this service.
 */
@Injectable()
export class VerticalTaxonomyInventoryService {
    constructor(private readonly prisma: PrismaService) {}

    async inventory() {
        const tenants = await this.prisma.tenant.findMany({
            select: { id: true, industry: true, settings: true },
        });

        const bySource = Object.fromEntries(
            Object.keys(SUBTYPE_TAXONOMY_MIGRATION_CONTRACTS).map((id) => [id, 0]),
        ) as Record<LegacySubtypeMigrationId, number>;
        const byStatus: Record<'candidate' | 'needs_owner' | 'approved', number> = {
            candidate: 0,
            needs_owner: 0,
            approved: 0,
        };
        const rows: VerticalTaxonomyInventoryRow[] = [];

        for (const tenant of tenants) {
            const settings = record(tenant.settings);
            const verticalConfig = record(settings.verticalConfig);
            const migrationDeclaration = record(settings.verticalTaxonomyMigration);
            const subType = verticalConfig.subType ?? settings.subType ?? null;
            const sourceId = subtypeTaxonomyMigrationSourceId(tenant.industry, subType);
            if (!sourceId) continue;

            // Only named, structured fields count as declarations. Do not infer
            // a business model from prompts, FAQs, company descriptions or data.
            const businessModel = migrationDeclaration.businessModel
                ?? verticalConfig.businessModel;
            const ownerConsent = migrationDeclaration.ownerConsent === true;
            const classification = classifySubtypeTaxonomyMigration({
                industry: tenant.industry,
                subType,
                businessModel,
                ownerConsent,
            });
            if (!classification) continue;

            bySource[sourceId] += 1;
            byStatus[classification.status] += 1;
            rows.push({
                tenantId: tenant.id,
                currentProfileId: sourceId,
                status: classification.status,
                candidates: classification.candidates,
                selectedTargets: classification.selectedTargets,
                reasonCodes: classification.reasonCodes,
                requiresOwnerConsent: true,
                applySupported: false,
            });
        }

        return {
            version: SUBTYPE_TAXONOMY_MIGRATION_VERSION,
            generatedAt: new Date().toISOString(),
            applySupported: SUBTYPE_TAXONOMY_MIGRATION_APPLY_SUPPORTED,
            targetCatalog: {
                industryCount: VERTICAL_MANIFEST_INDUSTRIES.length,
                canonicalConfigurationCount: listVerticalCapabilityConfigurations().length,
                canonicalProfileCount: listCanonicalSubtypeExperienceProfileIds().length,
                resolvableProfileCount: listSubtypeExperienceProfileIds().length,
            },
            scanned: tenants.length,
            affected: rows.length,
            bySource,
            byStatus,
            rows,
        };
    }
}
