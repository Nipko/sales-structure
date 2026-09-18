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
import { OtroRecipeService } from './otro-recipe.service';
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
        @Optional() private readonly otroRecipe?: OtroRecipeService,
    ) {}

    /**
     * La receta del negocio: lo que el dia 0 prellena y de donde sale.
     *
     * Devuelve la receta de la industria compuesta con la capa de su subtipo,
     * ya en el idioma del panel. Para un negocio de "Otro", devuelve la que el
     * modelo escribio a partir de su descripcion (D9) y, si todavia no existe,
     * arranca esa generacion sin esperarla: la pantalla se pinta con lo
     * generico de inmediato y la siguiente lectura trae la propia.
     *
     * `recipe` puede venir vacio. Una industria sin receta escrita no es un
     * error: es el estado en el que estaban las 20 hasta esta ola, y el lint
     * reporta la cobertura en vez de fingir que esta completa.
     */
    @Get(':tenantId/recipe')
    @UseGuards(TenantGuard)
    @ApiOperation({ summary: 'Get the business recipe that pre-fills day 0' })
    async getRecipe(
        @Param('tenantId') tenantId: string,
        @Query('lang') lang?: string,
    ) {
        const config = await this.verticalsService.getVerticalConfig(tenantId);
        const industry = config?.industry;
        if (!industry) {
            return { success: true, data: { industry: null, subType: null, source: 'none', recipe: null } };
        }
        const locale = (lang || 'es').split('-')[0];
        const definition = getVerticalDefinition(industry, config?.subType ?? null);

        // "Otro" no tiene receta de industria porque no es una industria: es la
        // ausencia de una. Por eso es el unico caso donde la escribe el modelo.
        if (industry === 'otro' && this.otroRecipe) {
            const generated = await this.otroRecipe.read(tenantId);
            // Se arranca SIEMPRE, no solo cuando falta. `generate` corta solo
            // si la descripción del negocio no cambió, y el enfriamiento evita
            // repetir una llamada pagada. Con la versión anterior, un dueño que
            // corregía su descripción seguía viendo la receta vieja para
            // siempre — y la ayuda le decía, en cuatro idiomas, que cambiarla
            // la vuelve a escribir.
            this.otroRecipe.kickOff(tenantId, locale);
            if (generated?.recipe) {
                return {
                    success: true,
                    data: {
                        industry, subType: config?.subType ?? null, locale,
                        source: 'generated', generatedAt: generated.generatedAt,
                        recipe: generated.recipe,
                    },
                };
            }
        }

        return {
            success: true,
            data: {
                industry,
                subType: config?.subType ?? null,
                locale,
                source: definition.recipe ? 'registry' : 'none',
                recipe: definition.recipe ?? null,
            },
        };
    }

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
        const definition = getVerticalDefinition(config.industry, config.subType ?? null);
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
