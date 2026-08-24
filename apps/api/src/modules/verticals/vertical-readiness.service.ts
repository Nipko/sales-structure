import { Injectable, Logger } from '@nestjs/common';
import type { VerticalReadinessKey } from '@parallext/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

/**
 * Does this tenant actually have the data its capabilities promise?
 *
 * The manifest has declared readiness keys per subtype since v1, with
 * `enforcement: 'advisory'` and no evaluator behind them — so nothing ever
 * checked. A tenant could enable the catalogue family with zero products, the
 * agent would publish `search_products`, and the customer would be told the
 * business sells nothing. "Enabled" and "has something to answer with" were
 * never the same claim, and only one of them was being made.
 *
 * Each key is a COUNT against the table the capability actually reads, so
 * readiness cannot drift from what the tools query. A missing table counts as
 * zero rather than an error: a tenant that never used a vertical simply has no
 * data for it, which is the honest answer and not a failure.
 */

export interface ReadinessCheck {
    key: VerticalReadinessKey;
    satisfied: boolean;
    /** How many rows back this capability. */
    count: number;
    /** Minimum needed to publish. Always 1 today; a field so it can grow. */
    required: number;
    /** What the tenant has to do, in their words. */
    repair: string;
    /** Where they do it. */
    repairRoute?: string;
}

export interface ReadinessReport {
    checks: ReadinessCheck[];
    unmet: VerticalReadinessKey[];
    evaluatedAt: string;
    /** True when a lookup failed: unknown is not the same as unmet. */
    degraded: boolean;
}

interface ReadinessDefinition {
    /** Tenant table the capability reads. */
    table: string;
    /** Extra predicate — an inactive row cannot answer a customer. */
    where?: string;
    repair: string;
    repairRoute?: string;
}

/**
 * One definition per key, pointing at the SAME table the tools query.
 *
 * `pipeline` is deliberately absent because it is seeded at provisioning.
 * Professional cases reuse CRM opportunities, but the profile still needs at
 * least one open case before it can truthfully publish case-status reads; the
 * tenant can create it from the dedicated Cases register.
 */
/**
 * Exportado para que el contrato de "a dónde manda el CTA de reparación" sea
 * verificable: una ruta que el tenant no puede abrir es un consejo muerto.
 */
export const READINESS: Readonly<Partial<Record<VerticalReadinessKey, ReadinessDefinition>>> = Object.freeze({
    business_identity: {
        table: 'companies',
        where: `name IS NOT NULL AND name <> ''`,
        repair: 'Completá los datos del negocio para que el agente sepa a quién representa.',
        repairRoute: '/admin/settings/business-info',
    },
    faq_content: {
        table: 'faqs',
        where: 'is_active = true',
        repair: 'Cargá al menos una pregunta frecuente.',
        repairRoute: '/admin/knowledge',
    },
    appointment_services: {
        table: 'services',
        where: 'is_active = true',
        repair: 'Creá al menos un servicio agendable con su duración y precio.',
        repairRoute: '/admin/appointments/config',
    },
    catalog_items: {
        table: 'products',
        where: 'is_available = true',
        repair: 'Cargá al menos un producto disponible en el catálogo.',
        repairRoute: '/admin/inventory',
    },
    treatment_catalog: {
        table: 'treatment_plans',
        repair: 'Definí al menos un plan de tratamiento.',
        repairRoute: '/admin/treatment-plans',
    },
    listings: {
        table: 'real_estate_listings',
        where: `status = 'available'`,
        repair: 'Publicá al menos un inmueble disponible.',
        repairRoute: '/admin/listings',
    },
    menu_items: {
        table: 'menu_items',
        where: 'is_available = true',
        repair: 'Cargá el menú: sin platos disponibles el agente no puede tomar pedidos.',
        repairRoute: '/admin/menu',
    },
    vehicle_inventory: {
        table: 'vehicles',
        where: `status = 'available'`,
        repair: 'Cargá al menos un vehículo disponible en el inventario.',
        repairRoute: '/admin/vehicles',
    },
    tour_packages: {
        table: 'tour_packages',
        where: 'is_active = true',
        repair: 'Creá al menos un tour o paquete activo.',
        repairRoute: '/admin/tours',
    },
    properties: {
        table: 'properties',
        where: 'is_active = true',
        repair: 'Cargá al menos un alojamiento activo con su tarifa.',
        repairRoute: '/admin/properties',
    },
    courses: {
        table: 'courses',
        where: 'is_active = true',
        repair: 'Creá al menos un curso activo.',
        repairRoute: '/admin/courses',
    },
    pets: {
        table: 'services',
        where: 'is_active = true',
        repair: 'Definí los servicios que ofrecés para poder agendarlos.',
        repairRoute: '/admin/appointments/config',
    },
    membership_plans: {
        table: 'membership_plans',
        where: 'is_active = true',
        repair: 'Creá al menos un plan de membresía.',
        repairRoute: '/admin/memberships',
    },
    insurance_plans: {
        table: 'insurance_plans',
        where: 'is_active = true',
        repair: 'Cargá al menos un plan de seguro cotizable.',
        repairRoute: '/admin/insurance',
    },
    service_catalog: {
        table: 'services',
        where: 'is_active = true',
        repair: 'Definí los servicios que despachás, con su duración y precio.',
        repairRoute: '/admin/service-catalog',
    },
    professional_cases: {
        table: 'opportunities',
        where: 'won_at IS NULL AND lost_at IS NULL',
        repair: 'Creá al menos un caso activo para poder consultar su estado.',
        repairRoute: '/admin/cases',
    },
    photo_sessions: {
        table: 'services',
        where: 'is_active = true',
        repair: 'Sembrá tus paquetes fotográficos: sin ellos el agente no puede ofrecer nada.',
        // No `/admin/appointments/config`: un estudio de fotos no tiene Agenda
        // en su menú, así que el CTA de reparación llevaba a una pantalla que
        // el dueño no ve.
        repairRoute: '/admin/service-catalog',
    },
    // Boarding needs a service that is BOTH a lodging category and has real
    // concurrency. A daycare service with `max_concurrent` unset would let the
    // agent quote capacity it cannot honour.
    boarding_capacity: {
        table: 'services',
        where: `is_active = true AND category IN ('guarderia', 'hotel') AND COALESCE(max_concurrent, 0) >= 1`,
        repair: 'Configurá el servicio de guardería u hotel con su capacidad simultánea.',
        repairRoute: '/admin/service-catalog',
    },
});

const CACHE_TTL_SECONDS = 120;

@Injectable()
export class VerticalReadinessService {
    private readonly logger = new Logger(VerticalReadinessService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService,
    ) {}

    /**
     * Evaluate the readiness keys a subtype declares.
     *
     * Cached briefly because this runs on every turn that resolves the
     * capability contract; two minutes is short enough that a tenant who just
     * loaded their catalogue sees the agent come alive while they are still
     * looking at the screen.
     */
    async evaluate(
        tenantId: string,
        schemaName: string,
        keys: readonly VerticalReadinessKey[],
    ): Promise<ReadinessReport> {
        if (!keys.length) {
            return { checks: [], unmet: [], evaluatedAt: new Date().toISOString(), degraded: false };
        }

        const cacheKey = `readiness:${tenantId}:${[...keys].sort().join(',')}`;
        try {
            const cached = await this.redis.getJson<ReadinessReport>(cacheKey);
            if (cached) return cached;
        } catch { /* A cache miss is not a failure. */ }

        const checks: ReadinessCheck[] = [];
        let degraded = false;

        for (const key of keys) {
            const definition = READINESS[key];
            // A key with no definition is not a failure: it is a capability
            // whose data requirement has not been modelled yet, and blocking on
            // it would punish the tenant for our gap.
            if (!definition) continue;

            const count = await this.countRows(schemaName, definition);
            if (count === null) {
                degraded = true;
                // Unknown is not unmet. A failed lookup must not switch off a
                // working agent — that is the same "error read as empty" mistake
                // the read contract exists to prevent.
                checks.push({
                    key, satisfied: true, count: 0, required: 1,
                    repair: definition.repair, repairRoute: definition.repairRoute,
                });
                continue;
            }
            checks.push({
                key,
                satisfied: count >= 1,
                count,
                required: 1,
                repair: definition.repair,
                repairRoute: definition.repairRoute,
            });
        }

        const report: ReadinessReport = {
            checks,
            unmet: checks.filter(c => !c.satisfied).map(c => c.key),
            evaluatedAt: new Date().toISOString(),
            degraded,
        };
        try {
            await this.redis.setJson(cacheKey, report, CACHE_TTL_SECONDS);
        } catch { /* Correct but uncached. */ }
        return report;
    }

    async invalidate(tenantId: string): Promise<void> {
        // Keys are per-subtype combination; the short TTL bounds staleness.
        await this.redis.del(`readiness:${tenantId}`).catch(() => undefined);
    }

    /** Row count, or null when the lookup itself failed. */
    private async countRows(schemaName: string, definition: ReadinessDefinition): Promise<number | null> {
        const where = definition.where ? ` WHERE ${definition.where}` : '';
        try {
            // Bounded so a tenant with a million rows does not pay for a full
            // count to answer "is there at least one".
            const rows = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT COUNT(*)::int AS total FROM (
                     SELECT 1 FROM ${definition.table}${where} LIMIT 50
                 ) sample`,
            );
            return Number(rows?.[0]?.total ?? 0);
        } catch (error: any) {
            // A table this tenant never provisioned means zero rows, which is a
            // real answer. Anything else is a degraded lookup.
            if (/does not exist|undefined table|42P01/i.test(String(error?.message || ''))) return 0;
            this.logger.warn(`[Readiness] ${definition.table} lookup failed: ${error?.message}`);
            return null;
        }
    }
}
