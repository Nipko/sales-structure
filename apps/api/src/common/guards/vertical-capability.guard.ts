import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
    VERTICAL_CAPABILITY_MANIFEST,
    listVerticalCapabilityCompatibilityConfigurations,
    type VerticalCapability,
} from '@parallext/shared';
import { REQUIRE_VERTICAL_CAPABILITY_KEY } from '../decorators/require-vertical-capability.decorator';
import { PrismaService } from '../../modules/prisma/prisma.service';
import { VERTICAL_INDUSTRY_ALIASES } from '../../modules/verticals/vertical-identifiers';

/**
 * Industries whose manifest grants a capability in AT LEAST ONE configuration:
 * every canonical subtype, every legacy subtype still served to persisted
 * tenants, and the subtype-less base profile. This is deliberately the widest
 * reading. The guard exists to stop a tenant of one industry from operating
 * another industry's product; it must never be the thing that locks out a
 * tenant whose own subtype (including a `legacy_only` one) still has the
 * surface in its sidebar, so subtype-level removals are NOT applied here.
 */
let industriesByCapability: Map<VerticalCapability, Set<string>> | null = null;

export function industriesWithCapability(capability: VerticalCapability): ReadonlySet<string> {
    if (!industriesByCapability) {
        industriesByCapability = new Map();
        for (const configuration of listVerticalCapabilityCompatibilityConfigurations()) {
            for (const granted of configuration.capabilities) {
                const set = industriesByCapability.get(granted) ?? new Set<string>();
                set.add(configuration.industry);
                industriesByCapability.set(granted, set);
            }
        }
    }
    return industriesByCapability.get(capability) ?? new Set<string>();
}

export type VerticalCapabilityDecision =
    | { allowed: true; reason: 'industry_grants_capability' | 'declared_effective_capability' | 'industry_unresolved' }
    | { allowed: false; reason: 'industry_lacks_capability'; industry: string };

function normaliseIndustry(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const key = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (!key) return null;
    const canonical = Object.prototype.hasOwnProperty.call(VERTICAL_CAPABILITY_MANIFEST, key)
        ? key
        : VERTICAL_INDUSTRY_ALIASES[key];
    return canonical && Object.prototype.hasOwnProperty.call(VERTICAL_CAPABILITY_MANIFEST, canonical)
        ? canonical
        : null;
}

/**
 * Pure decision, shared by the guard and its specs.
 *
 * The tenant's industry is `settings.verticalConfig.industry` when published
 * (it is what the dashboard resolves navigation from) and `tenants.industry`
 * otherwise. Fail-open cases, each deliberate:
 *   - the industry string is not a known vertical at all (an old free-form
 *     value): we cannot say it belongs to ANOTHER vertical, so the pre-existing
 *     behaviour is kept rather than breaking a live tenant;
 *   - the tenant's published `effectiveCapabilities` already include one of the
 *     required capabilities (a generic `otro` tenant that composed a recipe).
 */
export function decideVerticalCapabilityAccess(input: {
    tenantIndustry: unknown;
    settings: unknown;
    required: readonly VerticalCapability[];
}): VerticalCapabilityDecision {
    const verticalConfig = (input.settings as { verticalConfig?: Record<string, unknown> } | null)?.verticalConfig;
    const industry = normaliseIndustry(verticalConfig?.industry) ?? normaliseIndustry(input.tenantIndustry);
    if (!industry) return { allowed: true, reason: 'industry_unresolved' };

    if (input.required.some((capability) => industriesWithCapability(capability).has(industry))) {
        return { allowed: true, reason: 'industry_grants_capability' };
    }

    const declared = verticalConfig?.effectiveCapabilities;
    if (Array.isArray(declared) && input.required.some((capability) => declared.includes(capability))) {
        return { allowed: true, reason: 'declared_effective_capability' };
    }
    return { allowed: false, reason: 'industry_lacks_capability', industry };
}

/**
 * Enforces `@RequireVerticalCapability` server-side. Runs after the JWT and
 * tenant guards (`request.tenantId` is resolved). super_admin passes, as with
 * the plan-feature guard; routes without the decorator pass through.
 */
@Injectable()
export class VerticalCapabilityGuard implements CanActivate {
    private readonly logger = new Logger(VerticalCapabilityGuard.name);
    /** Tenants already reported as having an unrecognised industry (warn once, not per request). */
    private readonly warnedTenants = new Set<string>();
    /** Short-lived tenant lookup cache: vertical pages fire several calls in a row. */
    private readonly tenantCache = new Map<string, { at: number; value: { industry: string; settings: unknown } | null }>();
    static readonly TENANT_CACHE_TTL_MS = 60_000;

    constructor(
        private readonly reflector: Reflector,
        private readonly prisma: PrismaService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        if (context.getType() !== 'http') return true;

        const required = this.reflector.getAllAndOverride<VerticalCapability[] | undefined>(
            REQUIRE_VERTICAL_CAPABILITY_KEY,
            [context.getHandler(), context.getClass()],
        );
        if (!required?.length) return true;

        const request = context.switchToHttp().getRequest();
        const user = request.user;
        if (user?.role === 'super_admin') return true;

        const tenantId = request.tenantId || user?.tenantId || request.params?.tenantId;
        if (!tenantId) {
            throw new ForbiddenException({
                error: 'vertical_not_available',
                message: 'No se pudo resolver el tenant para esta funcionalidad.',
            });
        }

        const tenant = await this.loadTenant(tenantId);
        // No row: nothing to compare against. The handler's own tenant lookup
        // reports the missing tenant; this guard only rules on industries.
        if (!tenant) return true;

        const decision = decideVerticalCapabilityAccess({
            tenantIndustry: tenant.industry,
            settings: tenant.settings,
            required,
        });
        if (decision.allowed) {
            if (decision.reason === 'industry_unresolved' && !this.warnedTenants.has(tenantId)) {
                this.warnedTenants.add(tenantId);
                this.logger.warn(`Tenant ${tenantId} has an unrecognised industry; allowing ${required.join('|')} (legacy behaviour)`);
            }
            return true;
        }
        throw new ForbiddenException({
            error: 'vertical_not_available',
            capability: required,
            industry: decision.industry,
            message: 'Esta funcionalidad no está disponible para el rubro de tu negocio.',
        });
    }

    private async loadTenant(tenantId: string): Promise<{ industry: string; settings: unknown } | null> {
        const now = Date.now();
        const hit = this.tenantCache.get(tenantId);
        if (hit && now - hit.at < VerticalCapabilityGuard.TENANT_CACHE_TTL_MS) return hit.value;
        const value = await this.prisma.tenant.findUnique({
            where: { id: tenantId },
            select: { industry: true, settings: true },
        });
        if (this.tenantCache.size > 500) this.tenantCache.clear();
        this.tenantCache.set(tenantId, { at: now, value });
        return value;
    }
}
