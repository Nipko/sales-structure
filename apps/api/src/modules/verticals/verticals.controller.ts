import { Body, Controller, Get, Optional, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { VerticalsService } from './verticals.service';
import { OperatingCurrencyService } from './operating-currency.service';
import { VerticalMigrationService } from './vertical-migration.service';
import { VerticalTaxonomyInventoryService } from './vertical-taxonomy-inventory.service';
import { CurrentUser } from '../../common/decorators/tenant.decorator';
import { VERTICAL_REGISTRY, getVerticalDefinition } from './vertical-definitions';
import { resolveVerticalPipelineStages } from './vertical-pipeline-contract';
import {
    VERTICAL_IDENTIFIER_CONTRACT_VERSION,
    VERTICAL_INDUSTRY_ALIASES,
} from './vertical-identifiers';
import {
    ADMIN_CREATE_AVAILABILITY,
    SIGNUP_AVAILABILITY,
    VERTICAL_CAPABILITY_MANIFEST_VERSION,
    VERTICAL_PRODUCT_POLICY,
    VERTICAL_PRODUCT_POLICY_VERSION,
    SUBTYPE_ALIASES,
    isAliasedSubtype,
    listCanonicalSubtypeExperienceProfileIds,
    listSubtypeExperienceProfileIds,
    listVerticalCapabilityConfigurations,
    listVerticalCertificationSnapshots,
    resolveSubtypeExperienceProfile,
    VERTICAL_MANIFEST_INDUSTRIES,
} from '@parallext/shared';

@ApiTags('verticals')
@Controller('verticals')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@ApiBearerAuth()
export class VerticalsController {
    constructor(
        private readonly verticalsService: VerticalsService,
        private readonly operatingCurrency: OperatingCurrencyService,
        private readonly verticalMigrations: VerticalMigrationService,
        @Optional() private readonly taxonomyInventory?: VerticalTaxonomyInventoryService,
    ) {}

    @Get('definitions/all')
    @ApiOperation({ summary: 'Get all canonical vertical definitions (for subtype selectors)' })
    async getDefinitions() {
        // El catálogo sigue completo a propósito.
        //
        // Sacar del payload lo que ya no se ofrece rompería la pantalla del
        // tenant que HOY está en uno de esos perfiles: su propio subtipo
        // desaparecería del selector y la pantalla no sabría cómo llamarlo. Se
        // devuelve todo, anotado con su disponibilidad, y cada superficie
        // decide qué ofrece. La puerta que cuenta está en el servidor
        // (`resolveVerticalSelection`), no en el filtro del `<select>`.
        const subtypes: Record<string, any[]> = {};
        const availability: Record<string, string> = {};
        for (const [key, def] of Object.entries(VERTICAL_REGISTRY)) {
            subtypes[key] = def.subTypes.map((subType: any) => ({
                ...subType,
                availability: this.availabilityOf(key, subType.key),
            }));
            if (def.subTypes.length === 0) {
                availability[key] = this.availabilityOf(key, null);
            }
            for (const subType of def.subTypes) {
                availability[`${key}/${subType.key}`] = this.availabilityOf(key, subType.key);
            }
        }
        const subtypeCount = Object.values(subtypes)
            .reduce((total, entries) => total + entries.length, 0);
        const configurationCount = Object.values(subtypes)
            .reduce((total, entries) => total + Math.max(1, entries.length), 0);
        return {
            success: true,
            // Keep `data` as the original Record<industry, subtype[]> contract so
            // existing selectors remain backward compatible.
            data: subtypes,
            meta: {
                version: VERTICAL_IDENTIFIER_CONTRACT_VERSION,
                contract: 'vertical-identifiers',
                count: Object.keys(subtypes).length,
                subtypeCount,
                configurationCount,
                canonicalIndustryCount: VERTICAL_MANIFEST_INDUSTRIES.length,
                canonicalConfigurationCount: listVerticalCapabilityConfigurations().length,
                canonicalProfileCount: listCanonicalSubtypeExperienceProfileIds().length,
                resolvableProfileCount: listSubtypeExperienceProfileIds().length,
                aliases: VERTICAL_INDUSTRY_ALIASES,
                subtypeAliases: SUBTYPE_ALIASES,
                availability,
                signupAvailability: SIGNUP_AVAILABILITY,
                adminCreateAvailability: ADMIN_CREATE_AVAILABILITY,
            },
        };
    }

    /** Desconocido no se ofrece: sin perfil no hay evidencia de que se pueda. */
    private availabilityOf(industry: string, subType: string | null): string {
        // An alias remains in the complete catalogue only so an existing
        // tenant can render its historic value. It must never reappear as a
        // selectable signup/admin option after its target became canonical.
        if (isAliasedSubtype(industry, subType)) return 'legacy_only';
        try {
            return resolveSubtypeExperienceProfile(industry, subType).availability;
        } catch {
            return 'legacy_only';
        }
    }

    @Get('capability-manifest')
    @ApiOperation({ summary: 'Get the versioned operational manifest for all vertical configurations' })
    getCapabilityManifest() {
        return {
            success: true,
            data: this.verticalsService.getCapabilityManifest(),
        };
    }

    @Get('product-policy')
    @ApiOperation({ summary: 'Get certification priority and honest product mode for all 20 verticals' })
    getProductPolicy() {
        return {
            success: true,
            data: {
                version: VERTICAL_PRODUCT_POLICY_VERSION,
                entries: VERTICAL_PRODUCT_POLICY,
            },
        };
    }

    @Get('certification-catalog')
    @ApiOperation({ summary: 'Get the shared profile/country/provider certification snapshots' })
    getCertificationCatalog(@Query('country') country?: string) {
        return {
            success: true,
            data: {
                entries: listVerticalCertificationSnapshots({
                    operatingCountry: country || null,
                    includeLegacy: true,
                }),
            },
        };
    }

    @Get('taxonomy-migrations/inventory')
    @Roles('super_admin')
    @ApiOperation({ summary: 'Read-only inventory and dry-run classification of legacy subtype identities' })
    async getTaxonomyMigrationInventory() {
        if (!this.taxonomyInventory) {
            throw new Error('VerticalTaxonomyInventoryService is unavailable');
        }
        return {
            success: true,
            data: await this.taxonomyInventory.inventory(),
        };
    }

    @Get('capability-manifest/:industry')
    @ApiOperation({ summary: 'Resolve the operational manifest for an industry and optional subtype' })
    resolveCapabilityManifest(
        @Param('industry') industry: string,
        @Query('subType') subType?: string,
    ) {
        return {
            success: true,
            data: this.verticalsService.resolveCapabilityManifest(industry, subType || null),
        };
    }

    /**
     * One read for "what is this business and what may it promise".
     *
     * Support, marketing and the migration tooling used to derive that from
     * whichever subsystem they happened to import, and those subsystems did not
     * agree. This is derived on every call, so it can never become another
     * stored opinion that drifts.
     */
    @Get(':tenantId/effective-profile')
    @UseGuards(TenantGuard)
    @ApiOperation({ summary: 'Resolve the effective subtype profile, capability, commercial scope and market' })
    async getEffectiveProfile(@Param('tenantId') tenantId: string) {
        return {
            success: true,
            data: await this.verticalsService.getEffectiveProfile(tenantId),
        };
    }

    @Get(':tenantId')
    @UseGuards(TenantGuard)
    @ApiOperation({ summary: 'Get vertical config for a tenant' })
    async getConfig(@Param('tenantId') tenantId: string) {
        const config = await this.verticalsService.getVerticalConfig(tenantId);
        return { success: true, data: config };
    }

    @Get(':tenantId/stages-presets')
    @UseGuards(TenantGuard)
    @ApiOperation({ summary: 'Get default stages and transition rules for tenant vertical' })
    async getStagesPresets(@Param('tenantId') tenantId: string) {
        const config = await this.verticalsService.getVerticalConfig(tenantId);
        if (!config || !config.industry) {
            return { success: true, data: [] };
        }
        const definition = getVerticalDefinition(config.industry);
        const hasPublishedCurrentManifest = config.manifestVersion === VERTICAL_CAPABILITY_MANIFEST_VERSION
            && Array.isArray(config.effectiveCapabilities);
        return {
            success: true,
            data: hasPublishedCurrentManifest
                ? resolveVerticalPipelineStages(definition, config.subType)
                : definition.pipeline?.stages || [],
        };
    }

    /**
     * Trae al tenant el contenido de su vertical que se escribió DESPUÉS de que
     * lo crearon. El bootstrap corre una sola vez, así que cada FAQ o servicio
     * que se agrega al catálogo se lo pierden todos los que ya están adentro.
     *
     * Solo agrega: los inserts son ON CONFLICT DO NOTHING y no toca embudo,
     * persona ni disponibilidad, que son los seeds que sí pisarían lo que el
     * tenant configuró a mano.
     */
    @Post(':tenantId/reseed-content')
    @UseGuards(TenantGuard)
    @Roles('tenant_admin')
    @ApiOperation({ summary: 'Re-seed vertical FAQs and services (additive only)' })
    async reseedContent(
        @Param('tenantId') tenantId: string,
        @Body() body: { lang?: string },
    ) {
        const data = await this.verticalsService.reseedVerticalContent(tenantId, body?.lang || 'es');
        return { success: true, data };
    }

    @Get(':tenantId/operating-currency')
    @UseGuards(TenantGuard)
    @ApiOperation({ summary: 'Get explicit operating currency and immutable lock state' })
    async getOperatingCurrency(@Param('tenantId') tenantId: string) {
        const data = await this.requireOperatingCurrency().getState(tenantId);
        return { success: true, data };
    }

    @Put(':tenantId/operating-currency')
    @UseGuards(TenantGuard)
    @Roles('tenant_admin')
    @ApiOperation({ summary: 'Configure operating currency before the first transaction' })
    async configureOperatingCurrency(
        @Param('tenantId') tenantId: string,
        @Body() body: { currency: string },
    ) {
        const data = await this.requireOperatingCurrency().configure(tenantId, body?.currency);
        return { success: true, data };
    }

    @Post(':tenantId/migrations/preview')
    @UseGuards(TenantGuard)
    @Roles('tenant_admin')
    @ApiOperation({ summary: 'Create a non-mutating vertical migration inventory and additive diff' })
    async previewMigration(
        @Param('tenantId') tenantId: string,
        @Body() body: { industry: string; subType?: string | null },
        @CurrentUser() user: any,
    ) {
        const data = await this.requireVerticalMigrations().preview(
            tenantId,
            body?.industry,
            body?.subType,
            user.id,
        );
        return { success: true, data };
    }

    @Post(':tenantId/migrations/:migrationId/approve')
    @UseGuards(TenantGuard)
    @Roles('tenant_admin')
    @ApiOperation({ summary: 'Approve the exact immutable migration preview hash' })
    async approveMigration(
        @Param('tenantId') tenantId: string,
        @Param('migrationId') migrationId: string,
        @Body() body: { previewHash: string },
        @CurrentUser() user: any,
    ) {
        const data = await this.requireVerticalMigrations().approve(
            tenantId,
            migrationId,
            body?.previewHash,
            user.id,
        );
        return { success: true, data };
    }

    @Post(':tenantId/migrations/:migrationId/apply')
    @UseGuards(TenantGuard)
    @Roles('tenant_admin')
    @ApiOperation({ summary: 'Evaluate the fail-closed apply gate for an approved migration' })
    async applyMigration(
        @Param('tenantId') tenantId: string,
        @Param('migrationId') migrationId: string,
        @Body() body: { previewHash: string },
        @CurrentUser() user: any,
    ) {
        const data = await this.requireVerticalMigrations().apply(
            tenantId,
            migrationId,
            body?.previewHash,
            user.id,
        );
        return { success: true, data };
    }

    @Post(':tenantId/migrations/:migrationId/rollback')
    @UseGuards(TenantGuard)
    @Roles('tenant_admin')
    @ApiOperation({ summary: 'Rollback an applied migration if inserted rows remain untouched' })
    async rollbackMigration(
        @Param('tenantId') tenantId: string,
        @Param('migrationId') migrationId: string,
        @CurrentUser() user: any,
    ) {
        const data = await this.requireVerticalMigrations().rollback(
            tenantId,
            migrationId,
            user.id,
        );
        return { success: true, data };
    }

    private requireOperatingCurrency(): OperatingCurrencyService {
        if (!this.operatingCurrency) throw new Error('OperatingCurrencyService is not configured');
        return this.operatingCurrency;
    }

    private requireVerticalMigrations(): VerticalMigrationService {
        if (!this.verticalMigrations) throw new Error('VerticalMigrationService is not configured');
        return this.verticalMigrations;
    }

}
