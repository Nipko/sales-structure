import { Injectable, Logger } from '@nestjs/common';
import {
    ACTIVE_OBJECT_CONTEXT_MAX_ITEMS,
    ACTIVE_OBJECT_CONTEXT_VERSION,
} from '@parallext/shared';
import type {
    ActiveObjectContextItemV1,
    ActiveObjectSource,
    ActiveObjectStatusClass,
    ActiveObjectSubject,
    ActiveObjectsContextV1,
    TenantConfig,
    TurnContext,
    VerticalCapability,
} from '@parallext/shared';
import { PrismaService } from '../prisma/prisma.service';
import { filterActiveObjectsForPrompt } from './active-object-policy';

export type ActiveOperationsLoaderName =
    | 'appointments'
    | 'property_bookings'
    | 'tour_bookings'
    | 'orders'
    | 'food_orders'
    // Cinco cargadores para veintidós tipos declarados: el resto de los
    // writers escribía filas que el turno siguiente no podía ver. Un socio
    // preguntaba "¿cuántas clases me quedan?" y el agente, que acababa de
    // reservarle una, no tenía dónde mirar. Estos cinco cubren los tipos que
    // la política de exposición permite meter en el turno; los demás son
    // `tool_only` a propósito y NO se cargan.
    | 'memberships'
    | 'class_bookings'
    | 'enrollments'
    | 'photo_sessions'
    | 'resource_rentals'
    | 'crm_opportunities';

export interface ActiveOperationsContextInput {
    tenantId: string;
    schemaName: string;
    contactId: string | null | undefined;
    config: Partial<TenantConfig> & Record<string, any>;
    timezone?: string;
    now?: Date;
    maxItems?: number;
}

export interface ActiveOperationsLoaderFailure {
    loader: ActiveOperationsLoaderName;
    message: string;
}

export interface ActiveOperationsContextResult {
    activeObjects?: ActiveObjectsContextV1;
    activeBookings?: TurnContext['activeBookings'];
    recentOrders?: TurnContext['recentOrders'];
    failures: ActiveOperationsLoaderFailure[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_WITH_ZONE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

// Los estados que la propia plataforma escribe. Uno que cae en `unknown` no es
// un dato faltante: es el agente sin saber si la membresía está congelada o la
// clase en lista de espera, con la fila delante.
const STATUS_MAP: Readonly<Record<ActiveObjectStatusClass, ReadonlySet<string>>> = {
    pending: new Set([
        'pending', 'received', 'requested', 'new', 'draft', 'created',
        'waitlist', 'enrolled', 'scheduled',
    ]),
    active: new Set([
        'active', 'confirmed', 'processing', 'preparing', 'ready', 'reserved',
        'approved', 'in_progress', 'checked_in', 'shipped', 'picked_up',
    ]),
    paused: new Set(['paused', 'on_hold', 'frozen']),
    completed: new Set([
        'completed', 'delivered', 'fulfilled', 'closed', 'checked_out',
        'attended', 'returned', 'expired',
    ]),
    cancelled: new Set(['cancelled', 'canceled', 'refunded', 'rejected', 'voided', 'dropped']),
    failed: new Set(['failed', 'payment_failed', 'no_show']),
    unknown: new Set(),
};

/** Cross-domain status mapping owned by the context loader, not by the prompt. */
export function classifyActiveObjectStatus(
    _source: ActiveObjectSource,
    status: unknown,
): ActiveObjectStatusClass {
    const normalized = String(status ?? '')
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_');
    for (const statusClass of [
        'pending', 'active', 'paused', 'completed', 'cancelled', 'failed',
    ] as const) {
        if (STATUS_MAP[statusClass].has(normalized)) return statusClass;
    }
    return 'unknown';
}

function isRecord(value: unknown): value is Record<string, any> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function firstStringArray(...values: unknown[]): string[] {
    const match = values.find(Array.isArray);
    return Array.isArray(match)
        ? match.filter((value): value is string => typeof value === 'string')
        : [];
}

function hasOwn(record: Record<string, any>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(record, key);
}

function activeObjectPolicyContext(config: ActiveOperationsContextInput['config']) {
    const verticalConfig = isRecord(config.verticalConfig) ? config.verticalConfig : {};
    const capabilityManifest = isRecord(config.capabilityManifest) ? config.capabilityManifest : {};
    return {
        industry: config.industry || verticalConfig.industry || capabilityManifest.industry,
        subtype: config.subType || config.subtype || verticalConfig.subType
            || verticalConfig.subtype || capabilityManifest.subType || capabilityManifest.subtype,
    };
}

/**
 * Loader activation is capability/tool based. An explicit tool configuration
 * wins over inherited manifest metadata, including `enabled: false`.
 */
export function resolveActiveOperationsLoaders(
    config: Partial<TenantConfig> & Record<string, any>,
): ActiveOperationsLoaderName[] {
    const capabilityManifest = isRecord(config.capabilityManifest)
        ? config.capabilityManifest
        : {};
    const capabilities = new Set(firstStringArray(
        config.effectiveCapabilities,
        config.capabilities,
        capabilityManifest.effectiveCapabilities,
        capabilityManifest.capabilities,
    ) as VerticalCapability[]);
    const declaredToolGroups = new Set(firstStringArray(
        config.effectiveToolGroups,
        config.toolGroups,
        capabilityManifest.effectiveToolGroups,
        capabilityManifest.toolGroups,
    ));
    const tools: Record<string, any> = isRecord(config.tools) ? config.tools : {};

    const enabled = (
        toolKeys: string[],
        capability?: VerticalCapability,
        manifestToolGroup?: string,
    ): boolean => {
        const explicit = toolKeys.filter((key) => hasOwn(tools, key));
        if (explicit.length > 0) {
            return explicit.some((key) => isRecord(tools[key]) && tools[key].enabled === true);
        }
        return (!!capability && capabilities.has(capability))
            || (!!manifestToolGroup && declaredToolGroups.has(manifestToolGroup));
    };

    const loaders: ActiveOperationsLoaderName[] = [];
    if (enabled(['appointments'], 'appointment_booking', 'appointments')) loaders.push('appointments');
    if (enabled(['properties'], 'nightly_booking', 'properties')) loaders.push('property_bookings');
    if (enabled(['tours'], 'tour_booking', 'tours')) loaders.push('tour_bookings');
    // Generic orders/ecommerce are current config tool groups but do not yet
    // have their own manifest capability. Preserve the existing activation.
    if (enabled(['orders', 'ecommerce'])) loaders.push('orders');
    if (enabled(['restaurants'], 'restaurant_ordering', 'restaurants')) loaders.push('food_orders');
    if (enabled(['gyms'], 'membership_management', 'gyms')) {
        loaders.push('memberships');
        loaders.push('class_bookings');
    }
    if (enabled(['education'], 'course_enrollment', 'education')) loaders.push('enrollments');
    if (enabled(['photography'], 'photo_sessions', 'photography')) loaders.push('photo_sessions');
    if (enabled(['vehicleRentals'], 'vehicle_rentals', 'vehicleRentals')
        || enabled(['petBoarding'], 'pet_boarding', 'petBoarding')) {
        loaders.push('resource_rentals');
    }
    if (enabled(['crm'], 'crm_pipeline')) loaders.push('crm_opportunities');
    return loaders;
}

function boundedLimit(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return ACTIVE_OBJECT_CONTEXT_MAX_ITEMS;
    }
    return Math.max(1, Math.min(ACTIVE_OBJECT_CONTEXT_MAX_ITEMS, Math.floor(value)));
}

function safeTimezone(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) return 'UTC';
    try {
        new Intl.DateTimeFormat('en', { timeZone: value }).format(new Date(0));
        return value;
    } catch {
        return 'UTC';
    }
}

function asIso(value: unknown): string | undefined {
    if (value === null || value === undefined || value === '') return undefined;
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
    }
    const raw = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00:00.000Z`;
    const candidate = ISO_WITH_ZONE_RE.test(raw)
        ? raw
        : `${raw.replace(' ', 'T')}Z`;
    const parsed = new Date(candidate);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function nullableNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
}

function currency(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim().toUpperCase();
    return /^[A-Z]{3}$/.test(normalized) ? normalized : undefined;
}

function safeText(value: unknown, max = 500): string | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim();
    return normalized ? normalized.slice(0, max) : undefined;
}

@Injectable()
export class ActiveOperationsContextService {
    private readonly logger = new Logger(ActiveOperationsContextService.name);

    constructor(private readonly prisma: PrismaService) {}

    private async resolvePolicyContext(input: ActiveOperationsContextInput) {
        const configured = activeObjectPolicyContext(input.config);
        if (configured.industry) return configured;
        try {
            const tenant = await (this.prisma as any).tenant?.findUnique?.({
                where: { id: input.tenantId },
                select: { industry: true, settings: true },
            });
            const verticalConfig = isRecord(tenant?.settings?.verticalConfig)
                ? tenant.settings.verticalConfig : {};
            return {
                industry: verticalConfig.industry || tenant?.industry,
                subtype: verticalConfig.subType || verticalConfig.subtype,
            };
        } catch (error: any) {
            this.logger.warn(`[ActiveOperations] vertical policy unavailable for tenant ${input.tenantId}: ${error?.message || 'lookup_failed'}`);
            // Empty context intentionally makes appointments tool-only.
            return configured;
        }
    }

    /** Populate the exact same TurnContext contract in production and Agent Test. */
    async populateTurnContext(
        turnContext: TurnContext,
        input: ActiveOperationsContextInput,
    ): Promise<ActiveOperationsContextResult> {
        const result = await this.load(input);
        if (result.activeObjects) turnContext.activeObjects = result.activeObjects;
        if (result.activeBookings?.length) turnContext.activeBookings = result.activeBookings;
        if (result.recentOrders?.length) turnContext.recentOrders = result.recentOrders;
        return result;
    }

    async load(input: ActiveOperationsContextInput): Promise<ActiveOperationsContextResult> {
        const contactId = input.contactId;
        if (!contactId || !UUID_RE.test(contactId)) return { failures: [] };

        const maxItems = boundedLimit(input.maxItems);
        const timezone = safeTimezone(input.timezone);
        const loaderNames = resolveActiveOperationsLoaders(input.config);
        const loaderPromises = loaderNames.map((loader) => this.runLoader(
            loader,
            input.schemaName,
            contactId,
            timezone,
            maxItems,
            this.detailsToolFor(loader, input.config),
        ));
        const settled = await Promise.allSettled(loaderPromises);
        const failures: ActiveOperationsLoaderFailure[] = [];
        const items: ActiveObjectContextItemV1[] = [];

        settled.forEach((result, index) => {
            const loader = loaderNames[index];
            if (result.status === 'fulfilled') {
                items.push(...result.value);
                return;
            }
            const message = safeText(result.reason?.message || result.reason, 240) || 'loader_unavailable';
            failures.push({ loader, message });
            this.logger.warn(
                `[ActiveOperations] ${loader} unavailable for tenant ${input.tenantId}: ${message}`,
            );
        });

        // DEC-06: sensitive kinds are never pre-injected, even when a future
        // loader accidentally returns them. They remain available only through
        // reviewed tools at the assurance level declared by the kind policy.
        const policyContext = await this.resolvePolicyContext(input);
        const boundedItems = filterActiveObjectsForPrompt(
            items,
            policyContext,
        ).slice(0, maxItems);
        if (boundedItems.length === 0) return { failures };

        const activeObjects: ActiveObjectsContextV1 = {
            version: ACTIVE_OBJECT_CONTEXT_VERSION,
            asOf: (input.now || new Date()).toISOString(),
            items: boundedItems,
        };
        return {
            activeObjects,
            activeBookings: this.deriveActiveBookings(boundedItems),
            recentOrders: this.deriveRecentOrders(boundedItems),
            failures,
        };
    }

    private runLoader(
        loader: ActiveOperationsLoaderName,
        schemaName: string,
        contactId: string,
        timezone: string,
        maxItems: number,
        detailsTool: string | undefined,
    ): Promise<ActiveObjectContextItemV1[]> {
        switch (loader) {
            case 'appointments':
                return this.loadAppointments(schemaName, contactId, timezone, Math.min(5, maxItems), detailsTool);
            case 'property_bookings':
                return this.loadPropertyBookings(schemaName, contactId, timezone, Math.min(5, maxItems), detailsTool);
            case 'tour_bookings':
                return this.loadTourBookings(schemaName, contactId, timezone, Math.min(5, maxItems), detailsTool);
            case 'orders':
                return this.loadOrders(schemaName, contactId, Math.min(3, maxItems), detailsTool);
            case 'food_orders':
                return this.loadFoodOrders(schemaName, contactId, Math.min(3, maxItems), detailsTool);
            case 'memberships':
                return this.loadMemberships(schemaName, contactId, Math.min(2, maxItems), detailsTool);
            case 'class_bookings':
                return this.loadClassBookings(schemaName, contactId, Math.min(4, maxItems), detailsTool);
            case 'enrollments':
                return this.loadEnrollments(schemaName, contactId, Math.min(3, maxItems), detailsTool);
            case 'photo_sessions':
                return this.loadPhotoSessions(schemaName, contactId, Math.min(3, maxItems), detailsTool);
            case 'resource_rentals':
                return this.loadResourceRentals(schemaName, contactId, Math.min(3, maxItems), detailsTool);
            case 'crm_opportunities':
                return this.loadCrmOpportunities(schemaName, contactId, Math.min(3, maxItems), detailsTool);
        }
    }

    private detailsToolFor(
        loader: ActiveOperationsLoaderName,
        config: ActiveOperationsContextInput['config'],
    ): string | undefined {
        const tools: Record<string, any> = isRecord(config.tools) ? config.tools : {};
        switch (loader) {
            case 'appointments':
                return tools.appointments?.enabled === true ? 'list_customer_appointments' : undefined;
            case 'property_bookings':
                return tools.properties?.enabled === true ? 'list_my_property_bookings' : undefined;
            case 'tour_bookings':
                return tools.tours?.enabled === true ? 'list_my_tour_bookings' : undefined;
            case 'orders':
                if (tools.ecommerce?.enabled === true) return 'get_order_status';
                return tools.orders?.enabled === true ? 'list_customer_orders' : undefined;
            case 'food_orders':
                return tools.restaurants?.enabled === true ? 'list_my_orders' : undefined;
            case 'memberships':
                return tools.gyms?.enabled === true ? 'get_my_membership' : undefined;
            case 'class_bookings':
                return tools.gyms?.enabled === true ? 'list_my_classes' : undefined;
            case 'enrollments':
                return tools.education?.enabled === true ? 'list_my_enrollments' : undefined;
            case 'photo_sessions':
                return tools.photography?.enabled === true ? 'list_my_photo_sessions' : undefined;
            case 'resource_rentals':
                if (tools.vehicleRentals?.enabled === true) return 'list_my_vehicle_rentals';
                return tools.petBoarding?.enabled === true ? 'list_my_pet_boardings' : undefined;
            case 'crm_opportunities':
                return tools.crm?.enabled === true ? 'get_customer_context' : undefined;
        }
    }

    private async loadCrmOpportunities(
        schemaName: string,
        contactId: string,
        limit: number,
        detailsTool: string | undefined,
    ): Promise<ActiveObjectContextItemV1[]> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT o.id, o.stage, o.estimated_value, o.currency,
                    o.metadata->>'title' AS title, o.won_at, o.lost_at,
                    to_char(o.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at_iso
               FROM opportunities o
               JOIN leads l ON l.id = o.lead_id
              WHERE l.contact_id = $1::uuid
                AND o.won_at IS NULL AND o.lost_at IS NULL
              ORDER BY o.updated_at DESC LIMIT ${limit}`,
            [contactId],
        );
        return (rows || []).map((row: any) => ({
            kind: 'crm_opportunity',
            id: String(row.id),
            source: 'opportunities',
            status: safeText(row.stage, 80) || 'unknown',
            // The open-row predicate is authoritative even when a tenant uses
            // custom stage slugs that cannot appear in the global status map.
            statusClass: 'active',
            label: safeText(row.title),
            amount: nullableNumber(row.estimated_value),
            currency: currency(row.currency),
            updatedAt: asIso(row.updated_at_iso ?? row.updated_at),
            detailsTool,
        }));
    }

    /**
     * La membresía del socio: estado, período y créditos que le quedan.
     *
     * Sin esto, el agente le acababa de reservar una clase y no podía contestar
     * "¿cuántas me quedan?" — el dato estaba en la fila que él mismo escribió.
     */
    private async loadMemberships(
        schemaName: string,
        contactId: string,
        limit: number,
        detailsTool: string | undefined,
    ): Promise<ActiveObjectContextItemV1[]> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, status, class_credits_remaining,
                    to_char(current_period_start, 'YYYY-MM-DD') AS starts_at_iso,
                    to_char(current_period_end, 'YYYY-MM-DD') AS ends_at_iso,
                    to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at_iso
             FROM members
             WHERE contact_id = $1::uuid
             ORDER BY updated_at DESC LIMIT ${limit}`,
            [contactId],
        );
        return (rows || []).map((row: any) => ({
            kind: 'membership',
            id: String(row.id),
            source: 'members',
            status: safeText(row.status, 80) || 'unknown',
            statusClass: classifyActiveObjectStatus('members', row.status),
            startsAt: asIso(row.starts_at_iso),
            endsAt: asIso(row.ends_at_iso),
            updatedAt: asIso(row.updated_at_iso ?? row.updated_at),
            quantity: nullableNumber(row.class_credits_remaining),
            detailsTool,
        }));
    }

    /** Las clases que el socio tiene reservadas y todavía no pasaron. */
    private async loadClassBookings(
        schemaName: string,
        contactId: string,
        limit: number,
        detailsTool: string | undefined,
    ): Promise<ActiveObjectContextItemV1[]> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, status,
                    to_char(booked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS starts_at_iso
             FROM class_bookings
             WHERE contact_id = $1::uuid
               AND status IN ('confirmed', 'waitlist')
             ORDER BY booked_at DESC LIMIT ${limit}`,
            [contactId],
        );
        return (rows || []).map((row: any) => ({
            kind: 'class_booking',
            id: String(row.id),
            source: 'class_bookings',
            status: safeText(row.status, 80) || 'unknown',
            statusClass: classifyActiveObjectStatus('class_bookings', row.status),
            startsAt: asIso(row.starts_at_iso ?? row.booked_at),
            detailsTool,
        }));
    }

    /** Las inscripciones del alumno, con su avance. */
    private async loadEnrollments(
        schemaName: string,
        contactId: string,
        limit: number,
        detailsTool: string | undefined,
    ): Promise<ActiveObjectContextItemV1[]> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT e.id, e.status, e.completion_percent, e.course_id, c.name AS course_name,
                    to_char(e.enrolled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS starts_at_iso,
                    to_char(e.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at_iso
             FROM enrollments e
             LEFT JOIN courses c ON c.id = e.course_id
             WHERE e.contact_id = $1::uuid
             ORDER BY e.enrolled_at DESC LIMIT ${limit}`,
            [contactId],
        );
        return (rows || []).map((row: any) => ({
            kind: 'enrollment',
            id: String(row.id),
            source: 'enrollments',
            status: safeText(row.status, 80) || 'unknown',
            statusClass: classifyActiveObjectStatus('enrollments', row.status),
            label: safeText(row.course_name),
            startsAt: asIso(row.starts_at_iso ?? row.enrolled_at),
            updatedAt: asIso(row.updated_at_iso ?? row.updated_at),
            quantity: nullableNumber(row.completion_percent),
            // De QUÉ curso es la inscripción, por el mismo motivo.
            subject: row.course_id
                ? {
                    kind: 'course' as const,
                    id: String(row.course_id),
                    label: safeText(row.course_name, 120),
                }
                : undefined,
            detailsTool,
        }));
    }

    /** Las sesiones de foto del cliente: cuándo son y si ya se entregaron. */
    private async loadPhotoSessions(
        schemaName: string,
        contactId: string,
        limit: number,
        detailsTool: string | undefined,
    ): Promise<ActiveObjectContextItemV1[]> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, status, price, currency,
                    to_char(scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS starts_at_iso,
                    to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at_iso
             FROM photo_sessions
             WHERE contact_id = $1::uuid
             ORDER BY scheduled_at DESC NULLS LAST LIMIT ${limit}`,
            [contactId],
        );
        return (rows || []).map((row: any) => ({
            kind: 'photo_session',
            id: String(row.id),
            source: 'photo_sessions',
            status: safeText(row.status, 80) || 'unknown',
            statusClass: classifyActiveObjectStatus('photo_sessions', row.status),
            startsAt: asIso(row.starts_at_iso ?? row.scheduled_at),
            updatedAt: asIso(row.updated_at_iso ?? row.updated_at),
            amount: nullableNumber(row.price),
            currency: currency(row.currency),
            detailsTool,
        }));
    }

    /**
     * Alquileres de recurso: un auto o una estadía de mascota.
     *
     * `create_vehicle_rental` y `create_pet_boarding` escribían una fila que no
     * tenía NINGÚN tipo declarado, así que el turno siguiente no la veía: el
     * cliente preguntaba "¿hasta cuándo lo tengo?" y el agente, que acababa de
     * crearla, no tenía dónde mirar. Una fila y dos tipos, porque el objeto
     * que el cliente tiene en la cabeza es el auto o la mascota, no "el
     * alquiler".
     */
    private async loadResourceRentals(
        schemaName: string,
        contactId: string,
        limit: number,
        detailsTool: string | undefined,
    ): Promise<ActiveObjectContextItemV1[]> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, rental_type, status,
                    to_char(start_date, 'YYYY-MM-DD') AS starts_at_iso,
                    to_char(end_date, 'YYYY-MM-DD') AS ends_at_iso,
                    to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at_iso
             FROM resource_rentals
             WHERE contact_id = $1::uuid
             ORDER BY start_date DESC LIMIT ${limit}`,
            [contactId],
        );
        return (rows || []).map((row: any) => ({
            kind: String(row.rental_type) === 'pet_boarding' ? 'pet_boarding' : 'vehicle_rental',
            id: String(row.id),
            source: 'resource_rentals',
            status: safeText(row.status, 80) || 'unknown',
            statusClass: classifyActiveObjectStatus('resource_rentals', row.status),
            startsAt: asIso(row.starts_at_iso),
            endsAt: asIso(row.ends_at_iso),
            updatedAt: asIso(row.updated_at_iso ?? row.updated_at),
            detailsTool,
        }));
    }

    private async loadAppointments(
        schemaName: string,
        contactId: string,
        timezone: string,
        limit: number,
        detailsTool: string | undefined,
    ): Promise<ActiveObjectContextItemV1[]> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, service_name, service_id, status,
                    to_char((start_at AT TIME ZONE $2) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS starts_at_iso,
                    to_char((end_at AT TIME ZONE $2) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ends_at_iso,
                    to_char((updated_at AT TIME ZONE $2) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at_iso,
                    COALESCE(metadata->>'listingId', metadata->>'listing_id') AS listing_id,
                    COALESCE(metadata->>'vehicleId', metadata->>'vehicle_id') AS vehicle_id,
                    COALESCE(metadata->>'petId', metadata->>'pet_id') AS pet_id
             FROM appointments
             WHERE contact_id = $1::uuid
               AND start_at >= (NOW() AT TIME ZONE $2)
               AND LOWER(COALESCE(status, '')) NOT IN ('cancelled', 'canceled', 'expired')
             ORDER BY start_at ASC LIMIT ${limit}`,
            [contactId, timezone],
        );

        return Promise.all((rows || []).map(async (row: any) => ({
            kind: 'appointment' as const,
            id: String(row.id),
            source: 'appointments' as const,
            status: safeText(row.status, 80) || 'unknown',
            statusClass: classifyActiveObjectStatus('appointments', row.status),
            label: safeText(row.service_name),
            startsAt: asIso(row.starts_at_iso ?? row.start_at),
            endsAt: asIso(row.ends_at_iso ?? row.end_at),
            updatedAt: asIso(row.updated_at_iso ?? row.updated_at),
            subject: await this.resolveAppointmentSubject(schemaName, contactId, row),
            detailsTool,
        })));
    }

    private async resolveAppointmentSubject(
        schemaName: string,
        contactId: string,
        row: Record<string, any>,
    ): Promise<ActiveObjectSubject | undefined> {
        const candidates: Array<{
            id: unknown;
            kind: ActiveObjectSubject['kind'];
            sql: string;
            params: any[];
        }> = [
            {
                id: row.listing_id,
                kind: 'real_estate_listing',
                sql: 'SELECT id, name AS label FROM real_estate_listings WHERE id = $1::uuid LIMIT 1',
                params: [row.listing_id],
            },
            {
                id: row.vehicle_id,
                kind: 'vehicle',
                sql: `SELECT id, CONCAT_WS(' ', make, model, year::text) AS label
                      FROM vehicles WHERE id = $1::uuid LIMIT 1`,
                params: [row.vehicle_id],
            },
            {
                id: row.pet_id,
                kind: 'pet',
                sql: `SELECT id, CONCAT_WS(' ', name, NULLIF(CONCAT('(', species, ')'), '()')) AS label
                      FROM pets WHERE id = $1::uuid AND contact_id = $2::uuid LIMIT 1`,
                params: [row.pet_id, contactId],
            },
        ];

        for (const candidate of candidates) {
            if (typeof candidate.id !== 'string' || !UUID_RE.test(candidate.id)) continue;
            try {
                const found = await this.prisma.executeInTenantSchema<any[]>(
                    schemaName,
                    candidate.sql,
                    candidate.params,
                );
                if (found?.[0]?.id) {
                    return {
                        kind: candidate.kind,
                        id: String(found[0].id),
                        label: safeText(found[0].label),
                    };
                }
            } catch {
                // Subject enrichment is optional. A lazy/missing vertical table
                // must not discard the already-owned appointment itself.
            }
        }
        return undefined;
    }

    private async loadPropertyBookings(
        schemaName: string,
        contactId: string,
        timezone: string,
        limit: number,
        detailsTool: string | undefined,
    ): Promise<ActiveObjectContextItemV1[]> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT b.id, b.status, b.total_price, b.currency, p.name AS property_name, b.property_id,
                    to_char(b.check_in::timestamp, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS starts_at_iso,
                    to_char(b.check_out::timestamp, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ends_at_iso,
                    to_char((b.updated_at AT TIME ZONE $2) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at_iso
             FROM property_bookings b
             JOIN properties p ON p.id = b.property_id
             WHERE b.contact_id = $1::uuid
               AND b.check_out >= (NOW() AT TIME ZONE $2)::date
               AND LOWER(COALESCE(b.status, '')) NOT IN ('cancelled', 'canceled', 'expired')
             ORDER BY b.check_in ASC LIMIT ${limit}`,
            [contactId, timezone],
        );
        return (rows || []).map((row: any) => ({
            kind: 'property_booking',
            id: String(row.id),
            source: 'property_bookings',
            status: safeText(row.status, 80) || 'unknown',
            statusClass: classifyActiveObjectStatus('property_bookings', row.status),
            label: safeText(row.property_name),
            startsAt: asIso(row.starts_at_iso ?? row.check_in),
            endsAt: asIso(row.ends_at_iso ?? row.check_out),
            updatedAt: asIso(row.updated_at_iso ?? row.updated_at),
            amount: nullableNumber(row.total_price),
            currency: currency(row.currency),
            // De QUE alojamiento es la reserva. Antes solo viajaba el id de la
            // reserva y el nombre del apartamento, asi que cuando el contrato le
            // pedia al modelo reusar un identificador, el unico que tenia a mano
            // era el de la reserva — y lo pasaba como propertyId. La escritura
            // fallaba con "Property not found" DESPUES del "si" del cliente.
            subject: row.property_id
                ? { kind: 'property' as const, id: String(row.property_id), label: safeText(row.property_name, 120) }
                : undefined,
            detailsTool,
        }));
    }

    private async loadTourBookings(
        schemaName: string,
        contactId: string,
        timezone: string,
        limit: number,
        detailsTool: string | undefined,
    ): Promise<ActiveObjectContextItemV1[]> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT b.id, b.status, b.total_price, b.currency, p.name AS package_name, b.package_id,
                    to_char(((b.departure_date + COALESCE(b.departure_time, TIME '00:00')) AT TIME ZONE $2) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS starts_at_iso,
                    to_char((b.updated_at AT TIME ZONE $2) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at_iso
             FROM tour_bookings b
             JOIN tour_packages p ON p.id = b.package_id
             WHERE b.contact_id = $1::uuid
               AND b.departure_date >= (NOW() AT TIME ZONE $2)::date
               AND LOWER(COALESCE(b.status, '')) NOT IN ('cancelled', 'canceled', 'expired')
             ORDER BY b.departure_date ASC, b.departure_time ASC NULLS FIRST LIMIT ${limit}`,
            [contactId, timezone],
        );
        return (rows || []).map((row: any) => ({
            kind: 'tour_booking',
            id: String(row.id),
            source: 'tour_bookings',
            status: safeText(row.status, 80) || 'unknown',
            statusClass: classifyActiveObjectStatus('tour_bookings', row.status),
            label: safeText(row.package_name),
            startsAt: asIso(row.starts_at_iso ?? row.departure_at ?? row.departure_date),
            updatedAt: asIso(row.updated_at_iso ?? row.updated_at),
            amount: nullableNumber(row.total_price),
            currency: currency(row.currency),
            // De QUÉ paquete es la salida. Es el mismo defecto que ya se había
            // arreglado en alojamiento: sin el sujeto, el único identificador
            // que el modelo tenía a mano era el de la reserva, y lo pasaba
            // como `packageId` — la escritura fallaba DESPUÉS del "sí" del
            // cliente.
            subject: row.package_id
                ? {
                    kind: 'tour_package' as const,
                    id: String(row.package_id),
                    label: safeText(row.package_name, 120),
                }
                : undefined,
            detailsTool,
        }));
    }

    private async loadOrders(
        schemaName: string,
        contactId: string,
        limit: number,
        detailsTool: string | undefined,
    ): Promise<ActiveObjectContextItemV1[]> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, status, total_amount, currency,
                    to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS starts_at_iso,
                    to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at_iso
             FROM orders
             WHERE contact_id = $1::uuid
             ORDER BY created_at DESC LIMIT ${limit}`,
            [contactId],
        );
        return (rows || []).map((row: any) => ({
            kind: 'order',
            id: String(row.id),
            source: 'orders',
            status: safeText(row.status, 80) || 'unknown',
            statusClass: classifyActiveObjectStatus('orders', row.status),
            startsAt: asIso(row.starts_at_iso ?? row.created_at),
            updatedAt: asIso(row.updated_at_iso ?? row.updated_at),
            amount: nullableNumber(row.total_amount),
            currency: currency(row.currency),
            detailsTool,
        }));
    }

    private async loadFoodOrders(
        schemaName: string,
        contactId: string,
        limit: number,
        detailsTool: string | undefined,
    ): Promise<ActiveObjectContextItemV1[]> {
        const rows = await this.prisma.executeInTenantSchema<any[]>(
            schemaName,
            `SELECT id, status, total, currency,
                    to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS starts_at_iso,
                    to_char(estimated_delivery_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ends_at_iso,
                    to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at_iso
             FROM food_orders
             WHERE contact_id = $1::uuid
             ORDER BY created_at DESC LIMIT ${limit}`,
            [contactId],
        );
        return (rows || []).map((row: any) => ({
            kind: 'food_order',
            id: String(row.id),
            source: 'food_orders',
            status: safeText(row.status, 80) || 'unknown',
            statusClass: classifyActiveObjectStatus('food_orders', row.status),
            startsAt: asIso(row.starts_at_iso ?? row.created_at),
            endsAt: asIso(row.ends_at_iso ?? row.estimated_delivery_at),
            updatedAt: asIso(row.updated_at_iso ?? row.updated_at),
            amount: nullableNumber(row.total),
            currency: currency(row.currency),
            detailsTool,
        }));
    }

    private deriveActiveBookings(items: ActiveObjectContextItemV1[]): TurnContext['activeBookings'] {
        const typeByKind = {
            appointment: 'appointment',
            property_booking: 'property',
            tour_booking: 'tour',
        } as const;
        return items.flatMap((item) => {
            const type = typeByKind[item.kind as keyof typeof typeByKind];
            if (!type) return [];
            return [{
                id: item.id,
                type,
                name: item.label || item.reference || item.id,
                status: item.status,
                dateLabel: item.endsAt
                    ? `${item.startsAt || ''}/${item.endsAt}`
                    : (item.startsAt || ''),
                priceLabel: item.amount !== null && item.amount !== undefined
                    ? `${item.amount}${item.currency ? ` ${item.currency}` : ''}`
                    : undefined,
                details: item.subject?.label,
            }];
        });
    }

    private deriveRecentOrders(items: ActiveObjectContextItemV1[]): TurnContext['recentOrders'] {
        // Preserve the legacy generic-orders semantics; food orders are exposed
        // through their canonical active object and are not duplicated here.
        return items.flatMap((item) => item.kind === 'order' ? [{
            id: item.id,
            status: item.status,
            total: item.amount === null ? undefined : item.amount,
            currency: item.currency,
            date: item.startsAt,
        }] : []);
    }
}
