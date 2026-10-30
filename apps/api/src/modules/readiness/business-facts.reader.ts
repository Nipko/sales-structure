/**
 * BusinessFactsReader (C0 §2.3 y §5 R3b): lo que el agente lee del negocio — horario, políticas, `not_offered` e
 * identidad — sale de `requirement_values` y, solo si ahí no hay un valor del dueño vigente, del almacenamiento de hoy.
 *
 * La decisión es del paquete (`resolveBusinessHours`, `resolvePolicy`, `resolveNotOffered`, `resolveIdentity`), con la
 * misma regla que la foto del motor: el panel y el agente no pueden decir cosas distintas del mismo dato (ADR 0007 §2 y
 * §11, ADR 0009). Este servicio solo carga las fuentes (lectura; nunca escribe):
 * - `public.tenants` (nombre, `settings`, zona y país de operación);
 * - la fila de identidad de `companies` (`is_primary`, o la más reciente);
 * - las filas activas de `policies`;
 * - las filas de `requirement_values` de los requisitos que lee el agente (`RUNTIME_FACT_IDS`).
 *
 * Una tabla que el tenant aún no tiene cuenta como vacía (el agente sigue leyendo lo de hoy). Las fuentes se guardan 60 s
 * en Redis salvo para las políticas (texto de consentimiento: siempre la versión durable) y en contextos sin persistencia;
 * `business_fact.written` las invalida (BusinessFactsCacheListener).
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import {
    RUNTIME_FACT_IDS, factSnapshot, resolveBusinessHours, resolveIdentity, resolveNotOffered, resolvePolicy,
    type FactSources, type IdentityOverlay, type NotOfferedEntry, type RuntimePolicy,
} from '@parallext/business-spec';
import type { BusinessIdentity } from '@parallext/shared';
import { persistenceDisabled, type ServiceExecutionContext } from '../../common/types/execution-context';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

type Row = Record<string, any>;

export const BUSINESS_FACT_SOURCES_TTL_SECONDS = 60;
export const businessFactSourcesCacheKey = (tenantId: string) => `business-facts:sources:${tenantId}`;

/** Tipos de política que conoce `get_policy` (PoliciesService). `terms` no tiene requisito: siempre se lee de `policies`. */
export const RUNTIME_POLICY_TYPES = ['shipping', 'return', 'warranty', 'cancellation', 'terms', 'privacy'] as const;

const MISSING = new Set(['42P01', '42703']);
const missingRelation = (err: unknown) => MISSING.has(String((err as { code?: string })?.code ?? (err as { meta?: { code?: string } })?.meta?.code ?? ''))
    || /does not exist/i.test(String((err as Error)?.message ?? ''));

@Injectable()
export class BusinessFactsReader {
    private readonly logger = new Logger(BusinessFactsReader.name);

    constructor(
        private readonly prisma: PrismaService,
        @Optional() private readonly redis?: RedisService,
    ) {}

    /** Horario del negocio en la forma de `settings.businessHours` (o null si no hay ninguno). */
    async hours(tenantId: string, executionContext?: ServiceExecutionContext): Promise<Row | null> {
        const src = await this.sources(tenantId, { executionContext });
        return src ? resolveBusinessHours(src).hours ?? null : null;
    }

    /** Política activa de un tipo: el valor del dueño (`policy_terms`) o la fila activa de `policies`. */
    async policy(tenantId: string, type: string, executionContext?: ServiceExecutionContext): Promise<RuntimePolicy | null> {
        const src = await this.sources(tenantId, { fresh: true, executionContext });
        return src ? resolvePolicy(src, type) : null;
    }

    async policies(tenantId: string, executionContext?: ServiceExecutionContext): Promise<RuntimePolicy[]> {
        const src = await this.sources(tenantId, { fresh: true, executionContext });
        if (!src) return [];
        const snap = factSnapshot(src);
        return RUNTIME_POLICY_TYPES.map(type => resolvePolicy(src, type, snap)).filter((p): p is RuntimePolicy => Boolean(p));
    }

    /** Lo que el negocio declaró que NO hace (`CORE.OFFER.NOT_OFFERED`); null si no lo declaró. */
    async notOffered(tenantId: string, executionContext?: ServiceExecutionContext): Promise<NotOfferedEntry[] | null> {
        const src = await this.sources(tenantId, { executionContext });
        return src ? resolveNotOffered(src) : null;
    }

    /** Campos de identidad que declaró el dueño (`CORE.IDENTITY.*`, `LOCATIONS.LIST`, `CONTACT.CHANNELS`). */
    async identityOverlay(tenantId: string, executionContext?: ServiceExecutionContext): Promise<IdentityOverlay> {
        const src = await this.sources(tenantId, { executionContext });
        return src ? resolveIdentity(src).overlay : {};
    }

    /**
     * La identidad que ve el agente: la fila de `companies` (BusinessInfoService) con lo que declaró el dueño encima.
     * Sin valores del dueño devuelve la misma identidad (el agente lee lo de siempre).
     */
    async identity(tenantId: string, base: BusinessIdentity | null, executionContext?: ServiceExecutionContext): Promise<BusinessIdentity | null> {
        let overlay: IdentityOverlay;
        try {
            overlay = await this.identityOverlay(tenantId, executionContext);
        } catch (err) {
            this.logger.warn(`business-facts: identidad sin valores del negocio para ${tenantId}: ${(err as Error).message}`);
            return base;
        }
        return applyIdentityOverlay(base, overlay, tenantId);
    }

    /** Fuentes de un tenant (null si el tenant no existe). `fresh` evita la caché. */
    async sources(tenantId: string, options: { fresh?: boolean; executionContext?: ServiceExecutionContext } = {}): Promise<FactSources | null> {
        const cacheable = !options.fresh && !persistenceDisabled(options.executionContext) && this.redis;
        if (cacheable) {
            const cached = await this.redis!.getJson<FactSources>(businessFactSourcesCacheKey(tenantId)).catch(() => null);
            if (cached) return cached;
        }
        const tenants = await this.prisma.$queryRawUnsafe(
            `SELECT id::text AS ref, slug, name, created_at, settings, operating_country, operating_timezone, schema_name
               FROM public.tenants WHERE id = $1::uuid`, tenantId) as Row[];
        const t = tenants[0];
        if (!t) return null;
        const schema = String(t.schema_name);
        const [companies, policies, values] = await Promise.all([
            this.optional(schema, `SELECT id, name, about, address, city, country, phone, email, website, social_links, is_primary, created_at, updated_at
                FROM companies ORDER BY is_primary DESC NULLS LAST, updated_at DESC NULLS LAST LIMIT 1`, []),
            this.optional(schema, `SELECT id::text AS id, type, title, content, version, is_active, created_at, updated_at
                FROM policies WHERE is_active = true`, []),
            this.optional(schema, `SELECT id::text AS id, requirement_id, scope_key, value, status, origin, confirmed_by::text AS confirmed_by,
                confirmed_at, source_ref, valid_until, spec_version, version, updated_at
                FROM requirement_values WHERE requirement_id = ANY($1::text[])`, [[...RUNTIME_FACT_IDS]]),
        ]);
        const src: FactSources = {
            tenant: {
                ref: t.ref, slug: t.slug, name: t.name, created_at: t.created_at ? new Date(t.created_at).toISOString() : null,
                settings: t.settings ?? {}, operating_country: t.operating_country ?? null, operating_timezone: t.operating_timezone ?? null,
            },
            companies, policies, requirement_values: values,
        };
        if (cacheable) await this.redis!.setJson(businessFactSourcesCacheKey(tenantId), src, BUSINESS_FACT_SOURCES_TTL_SECONDS).catch(() => undefined);
        return src;
    }

    /** Lectura de una tabla del tenant que puede no existir todavía (tenant sin migrar): entonces, sin filas. */
    private async optional(schema: string, sql: string, params: unknown[]): Promise<Row[]> {
        try {
            const rows = await this.prisma.executeInTenantSchema<Row[]>(schema, sql, params as any[]);
            return Array.isArray(rows) ? rows : [];
        } catch (err) {
            if (missingRelation(err)) return [];
            throw err;
        }
    }
}

/** La identidad de `companies` con los campos que declaró el dueño encima (lo no declarado queda igual). */
export function applyIdentityOverlay(base: BusinessIdentity | null, overlay: IdentityOverlay, tenantId: string): BusinessIdentity | null {
    if (!Object.keys(overlay).length) return base;
    const now = new Date();
    const identity: BusinessIdentity = base ? { ...base } : { id: 'business-facts', tenantId, companyName: '', isPrimary: true, createdAt: now, updatedAt: now };
    const set = <K extends keyof BusinessIdentity>(key: K, value: BusinessIdentity[K] | null | undefined) => {
        if (value === undefined) return;
        if (value === null || value === '') delete identity[key];
        else identity[key] = value as BusinessIdentity[K];
    };
    if (overlay.name !== undefined) identity.companyName = overlay.name;
    set('about', overlay.about);
    if (overlay.audience) identity.customerTypes = overlay.audience.map(a => a.toLowerCase());
    if ('address' in overlay) { set('address', overlay.address); set('city', overlay.city); set('country', overlay.country); }
    if ('phone' in overlay) {
        set('phone', overlay.phone ?? overlay.whatsapp ?? null);
        set('email', overlay.email);
        set('website', overlay.website);
        if (overlay.socialLinks) identity.socialLinks = overlay.socialLinks as BusinessIdentity['socialLinks'];
    }
    return identity;
}

/** Una entrada de `not_offered` como la lee el prompt (`<not_offered>`): el ítem y, si la hay, la alternativa. */
export function renderNotOfferedEntry(entry: NotOfferedEntry): string {
    return entry.alternative ? `${entry.item} (alternative: ${entry.alternative})` : entry.item;
}
