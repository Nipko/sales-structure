import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { VerticalReadinessKey } from '@parallext/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { persistenceDisabled, type ServiceExecutionContext } from '../../common/types/execution-context';
import { tenantActorDirectory } from '../appointments/tenant-user-scope.util';
import type { EvalNamespaceLease } from '../simulation/isolated-eval-namespace';

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

interface ReadinessQueryContext {
    schemaName: string;
    actors?: { users: string; tenants: string };
}

export interface ReadinessDefinition {
    /** Tenant table the capability reads. */
    table: string;
    /** Exact source when the capability spans more than one table. */
    from?: string | ((context: ReadinessQueryContext) => string);
    /** Extra predicate — an inactive row cannot answer a customer. */
    where?: string;
    /** Values owned by the server for predicates that cross the tenant boundary. */
    params?: (context: ReadinessQueryContext) => unknown[];
    /** Resolve the production/evaluation user directory before building SQL. */
    actorScoped?: boolean;
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
        where: `is_primary = true AND name IS NOT NULL AND name <> ''`,
        repair: 'Completa los datos del negocio para que el agente sepa a quién representa.',
        repairRoute: '/admin/settings/business-info',
    },
    faq_content: {
        table: 'faqs',
        where: 'is_published = true',
        repair: 'Carga al menos una pregunta frecuente.',
        repairRoute: '/admin/knowledge/faqs',
    },
    appointment_services: {
        table: 'availability_slots',
        actorScoped: true,
        from: ({ actors }) => `availability_slots availability
            JOIN ${actors!.users} staff_user
              ON staff_user.id = availability.user_id AND staff_user.is_active = true
            JOIN ${actors!.tenants} tenant_owner
              ON tenant_owner.id = staff_user.tenant_id
             AND tenant_owner.schema_name = $1
             AND tenant_owner.is_active = true`,
        where: `availability.is_active = true
            AND availability.day_of_week BETWEEN 0 AND 6
            AND availability.start_time < availability.end_time
            AND EXISTS (
                SELECT 1 FROM services service
                WHERE service.is_active = true
                  AND COALESCE(service.duration_type, 'fixed') IN ('fixed', 'flexible')
                  AND CASE
                      WHEN service.duration_type = 'flexible'
                        THEN COALESCE(service.duration_minutes_max, service.duration_minutes)
                      ELSE service.duration_minutes
                  END BETWEEN 1 AND 1440
            )`,
        params: ({ schemaName }) => [schemaName],
        repair: 'Crea un servicio agendable válido y al menos un horario para un colaborador activo.',
        repairRoute: '/admin/appointments/config',
    },
    catalog_items: {
        table: 'products',
        where: 'is_available = true',
        repair: 'Carga al menos un producto disponible en el catálogo.',
        repairRoute: '/admin/inventory',
    },
    listings: {
        table: 'real_estate_listings',
        where: `is_active = true AND status = 'available'`,
        repair: 'Agrega al menos un inmueble disponible.',
        repairRoute: '/admin/listings',
    },
    menu_items: {
        table: 'menu_items',
        where: 'is_active = true AND is_available = true',
        repair: 'Carga el menú: sin platos disponibles el agente no puede tomar pedidos.',
        repairRoute: '/admin/menu',
    },
    vehicle_inventory: {
        table: 'vehicles',
        where: `status = 'available'`,
        repair: 'Carga al menos un vehículo disponible en el inventario.',
        repairRoute: '/admin/vehicles',
    },
    tour_packages: {
        table: 'tour_packages',
        where: 'is_active = true',
        repair: 'Crea al menos un tour o paquete activo.',
        repairRoute: '/admin/tours',
    },
    properties: {
        table: 'properties',
        where: 'is_active = true AND night_price IS NOT NULL AND night_price > 0',
        repair: 'Carga al menos un alojamiento activo con su tarifa.',
        repairRoute: '/admin/properties',
    },
    courses: {
        table: 'course_cohorts',
        from: 'course_cohorts cohort JOIN courses course ON course.id = cohort.course_id',
        where: `course.is_active = true
            AND cohort.status IN ('open', 'full')
            AND cohort.starts_at >= CURRENT_DATE
            AND cohort.starts_at <= CURRENT_DATE + INTERVAL '180 days'
            AND cohort.max_capacity >= 1
            AND cohort.available_seats BETWEEN 0 AND cohort.max_capacity`,
        repair: 'Activa un curso con una cohorte abierta o con lista de espera dentro de los próximos 180 días.',
        repairRoute: '/admin/courses',
    },
    pets: {
        table: 'services',
        where: 'is_active = true',
        repair: 'Define los servicios que ofreces para poder agendarlos.',
        repairRoute: '/admin/appointments/config',
    },
    membership_plans: {
        table: 'membership_plans',
        where: 'is_active = true',
        repair: 'Crea al menos un plan de membresía.',
        repairRoute: '/admin/memberships',
    },
    insurance_plans: {
        table: 'insurance_plans',
        where: `is_active = true AND monthly_premium_min IS NOT NULL
            AND monthly_premium_min > 0 AND currency IS NOT NULL AND currency <> ''`,
        repair: 'Carga al menos un plan de seguro cotizable.',
        repairRoute: '/admin/insurance',
    },
    service_catalog: {
        table: 'services',
        where: 'is_active = true',
        repair: 'Define los servicios que despachas, con su duración y precio.',
        repairRoute: '/admin/service-catalog',
    },
    photo_sessions: {
        table: 'services',
        where: 'is_active = true',
        repair: 'Crea tus paquetes fotográficos: sin ellos el agente no puede ofrecer nada.',
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
        where: `is_active = true
            AND translate(lower(category), 'áéíóúü', 'aeiouu') IN ('guarderia', 'hotel')
            AND COALESCE(max_concurrent, 0) >= 1`,
        repair: 'Configura el servicio de guardería u hotel con su capacidad simultánea.',
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
     * capability contract. Owner assessments explicitly refresh so completing
     * configuration is visible immediately, including to the next live turn.
     */
    async evaluate(
        tenantId: string,
        schemaName: string,
        keys: readonly VerticalReadinessKey[],
        executionContext?: ServiceExecutionContext,
        options?: { refresh?: boolean; sandboxNamespace?: EvalNamespaceLease },
    ): Promise<ReadinessReport> {
        if (!keys.length) {
            return { checks: [], unmet: [], evaluatedAt: new Date().toISOString(), degraded: false };
        }

        // Read-only previews must see the selected schema, never a production
        // cache entry. A namespace remains isolated even if an older caller
        // omitted executionContext. No test result may populate live Redis.
        let useCache = !persistenceDisabled(executionContext) && !schemaName.startsWith('tenant_eval_');
        let generation = 'initial';
        if (useCache) {
            try {
                if (options?.refresh) await this.invalidate(tenantId);
                generation = await this.redis.get(`readiness-generation:${tenantId}`) ?? 'initial';
            } catch {
                // An unreadable generation cannot authorize reusing an old
                // report. The database remains usable even when Redis is not.
                useCache = false;
            }
        }
        const cacheKey = `readiness:${tenantId}:${schemaName}:${[...keys].sort().join(',')}:${generation}`;
        try {
            const cached = useCache && !options?.refresh ? await this.redis.getJson<ReadinessReport>(cacheKey) : null;
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

            const count = await this.countRows(schemaName, definition, options?.sandboxNamespace);
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
            if (useCache) await this.redis.setJson(cacheKey, report, CACHE_TTL_SECONDS);
        } catch { /* Correct but uncached. */ }
        return report;
    }

    async invalidate(tenantId: string): Promise<void> {
        // Every schema/key combination shares a generation. Old reports expire
        // by TTL; an in-flight old evaluation can only repopulate its old key.
        // A failed invalidation is observable so a refresh falls back to SQL.
        await this.redis.set(`readiness-generation:${tenantId}`, randomUUID());
    }

    /** Row count, or null when the lookup itself failed. */
    private async countRows(
        schemaName: string,
        definition: ReadinessDefinition,
        sandboxNamespace?: EvalNamespaceLease,
    ): Promise<number | null> {
        const where = definition.where ? ` WHERE ${definition.where}` : '';
        try {
            const context: ReadinessQueryContext = { schemaName };
            if (definition.actorScoped) {
                context.actors = await tenantActorDirectory(this.prisma, schemaName, sandboxNamespace);
            }
            const from = typeof definition.from === 'function'
                ? definition.from(context)
                : definition.from || definition.table;
            const params = definition.params?.(context) ?? [];
            // Bounded so a tenant with a million rows does not pay for a full
            // count to answer "is there at least one".
            const rows = await this.prisma.executeInTenantSchema<any[]>(
                schemaName,
                `SELECT COUNT(*)::int AS total FROM (
                     SELECT 1 FROM ${from}${where} LIMIT 50
                 ) sample`,
                params,
            );
            return Number(rows?.[0]?.total ?? 0);
        } catch (error: any) {
            // A table this tenant never provisioned means zero rows, which is a
            // real answer. Anything else is a degraded lookup.
            if (String(error?.code || '') === '42P01') return 0;
            this.logger.warn(`[Readiness] ${definition.table} lookup failed: ${error?.message}`);
            return null;
        }
    }
}
