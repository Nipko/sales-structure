import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import {
    TOOL_GROUP_PLAN_FEATURE,
    TOOL_GROUP_READINESS,
    TOOL_READINESS,
    VERTICAL_TOOL_GROUPS,
    listVerticalCapabilityConfigurations,
    type VerticalToolGroup,
} from '@parallext/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import { buildToolControlCatalog } from '../verticals/vertical-operation-contract';
import {
    TOOL_FAMILIES,
    TOOL_SUBPERMISSION_RULES,
    enabledToolFamilies,
    procedureAuthorizedToolNames,
} from '../conversations/agent-tool-registry';
import {
    CREATE_PAYMENT_LINK_TOOL,
    GET_PAYMENT_STATUS_TOOL,
    REFUND_PAYMENT_TOOL,
} from '../conversations/tools/payment-tools';
import { toolOrigin } from '../conversations/tool-policy-registry';
import {
    LATENCY_BUCKET_COUNT,
    TOOL_USAGE_MODES,
    percentileFromBuckets,
    type ToolUsageMode,
} from './tool-usage-outcome';

/** Familia sintética de las tools sin familia de configuración (siempre presentes o internas). */
export const CORE_TOOL_FAMILY = 'core';
export const PAYMENTS_TOOL_FAMILY = 'payments';
/** `refund_payment` nunca se publica al modelo: sólo un Procedure escrito por el negocio la invoca. */
const NOT_ADVERTISED_TOOLS: ReadonlySet<string> = new Set([REFUND_PAYMENT_TOOL.name]);

export const TOOL_USAGE_PERIODS = [7, 30, 90] as const;
const TENANT_USAGE_WINDOW_DAYS = 30;
const SCHEMA_CONCURRENCY = 4;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVAL_REPLICA_RE = /^tenant_eval_/;

export interface ToolCatalogEntry {
    tool: string;
    family: string;
    description: string | null;
    origin: string | null;
    effect: string;
    access: 'read' | 'write';
    commitsBusiness: boolean;
    confirmation: string;
    humanApproval: string;
    idempotency: string;
    assurance: string;
    ownership: string;
    externalEffect: string;
    subpermission: { family: string; flag: string } | null;
    gaps: readonly string[];
    /** La familia depende del subtipo del negocio; si es `false`, la ofrece cualquier perfil. */
    verticalScoped: boolean;
    profiles: string[];
    planFeature: string | null;
    readiness: string | null;
    advertised: boolean;
}

export interface ToolFamilySummary {
    family: string;
    tools: number;
    reads: number;
    writes: number;
    verticalScoped: boolean;
    profiles: number;
    planFeature: string | null;
    readiness: string | null;
}

export interface TenantAgentTools {
    id: string;
    name: string | null;
    version: number | null;
    enabledFamilies: string[];
    paymentsEnabled: boolean;
    /** Subpermisos que el dueño apagó explícitamente (`family.flag`) y las tools que retiran. */
    subpermissionDenials: Array<{ family: string; flag: string; tools: string[] }>;
}

export interface TenantToolUsage {
    tool: string;
    calls: number;
    errors: number;
    blocked: number;
    lastAt: string | null;
}

export interface TenantToolRow {
    tenantId: string;
    name: string;
    slug: string | null;
    plan: string;
    industry: string | null;
    subtype: string | null;
    isActive: boolean;
    isInternal: boolean;
    agentsError: string | null;
    agents: TenantAgentTools[];
    planFeatures: Record<string, boolean | null>;
    enabledTools: string[];
    usedTools: string[];
    enabledButUnused: string[];
    usedButNotEnabled: string[];
    /** Tools autorizadas por la configuración pero retiradas por el plan (p. ej. pagos sin `customerPayments`). */
    blockedByPlan: string[];
    usage: TenantToolUsage[];
    nonLiveCalls: number;
}

interface TenantRecord {
    id: string;
    name: string;
    slug?: string | null;
    industry?: string | null;
    plan: string;
    schemaName: string;
    isActive?: boolean | null;
    isInternal?: boolean | null;
    settings?: unknown;
}

interface UsageAggregateRow {
    tenant_id: string;
    tool_name: string;
    mode: string;
    calls: number | bigint;
    errors: number | bigint;
    blocked: number | bigint;
    last_at: Date | string | null;
}

const num = (value: unknown): number => {
    if (typeof value === 'bigint') return Number(value);
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};
const iso = (value: unknown): string | null => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
const isoDay = (value: unknown): string | null => {
    if (!value) return null;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
    return iso(value)?.slice(0, 10) ?? null;
};

/** Identificador SQL entre comillas dobles (equivalente a `quote_ident`). */
export function quoteIdent(name: string): string {
    return `"${String(name).replace(/"/g, '""')}"`;
}

/** Ejecuta `worker` sobre `items` con a lo sumo `limit` en vuelo. Conserva el orden. */
export async function mapWithConcurrency<T, R>(
    items: readonly T[],
    limit: number,
    worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await worker(items[index], index);
        }
    });
    await Promise.all(lanes);
    return results;
}

function profileId(industry: string, subtype: string | null): string {
    return subtype ? `${industry}/${subtype}` : industry;
}

/**
 * Catálogo completo de tools estáticas con su política, familia, perfiles que
 * la incluyen y puertas de plan/readiness. Derivado del código: no hay nada
 * guardado que pueda divergir del runtime.
 */
export function buildToolCatalog(): { entries: ToolCatalogEntry[]; families: ToolFamilySummary[] } {
    const descriptions = new Map<string, string>();
    const familyByTool = new Map<string, string>();
    for (const family of TOOL_FAMILIES) {
        for (const tool of family.tools) {
            descriptions.set(String(tool.name), tool.description);
            familyByTool.set(String(tool.name), String(family.key));
        }
    }
    for (const tool of [CREATE_PAYMENT_LINK_TOOL, GET_PAYMENT_STATUS_TOOL, REFUND_PAYMENT_TOOL]) {
        descriptions.set(tool.name, tool.description);
        familyByTool.set(tool.name, PAYMENTS_TOOL_FAMILY);
    }

    const scopedGroups = new Set<string>(VERTICAL_TOOL_GROUPS);
    const profilesByGroup = new Map<string, string[]>();
    for (const configuration of listVerticalCapabilityConfigurations()) {
        const id = profileId(configuration.industry, configuration.subtype);
        for (const group of configuration.toolGroups) {
            const list = profilesByGroup.get(group) ?? [];
            list.push(id);
            profilesByGroup.set(group, list);
        }
    }

    const entries: ToolCatalogEntry[] = buildToolControlCatalog().entries.map(entry => {
        const family = familyByTool.get(entry.tool) ?? entry.family ?? CORE_TOOL_FAMILY;
        const verticalScoped = scopedGroups.has(family);
        return {
            tool: entry.tool,
            family,
            description: descriptions.get(entry.tool) ?? null,
            origin: toolOrigin(entry.tool) ?? null,
            effect: entry.effect,
            access: entry.effect === 'read' ? 'read' : 'write',
            commitsBusiness: entry.commitsBusiness,
            confirmation: entry.confirmation,
            humanApproval: entry.humanApproval,
            idempotency: entry.idempotency,
            assurance: entry.assurance,
            ownership: entry.ownership,
            externalEffect: entry.externalEffect,
            subpermission: entry.subpermission,
            gaps: [...entry.gaps],
            verticalScoped,
            profiles: verticalScoped ? [...(profilesByGroup.get(family) ?? [])] : [],
            planFeature: TOOL_GROUP_PLAN_FEATURE[family] ?? null,
            readiness: TOOL_READINESS[entry.tool]
                ?? TOOL_GROUP_READINESS[family as VerticalToolGroup]
                ?? null,
            advertised: !NOT_ADVERTISED_TOOLS.has(entry.tool),
        };
    });

    const familyMap = new Map<string, ToolFamilySummary>();
    for (const entry of entries) {
        const summary = familyMap.get(entry.family) ?? {
            family: entry.family,
            tools: 0,
            reads: 0,
            writes: 0,
            verticalScoped: entry.verticalScoped,
            profiles: entry.profiles.length,
            planFeature: entry.planFeature,
            readiness: TOOL_GROUP_READINESS[entry.family as VerticalToolGroup] ?? null,
        };
        summary.tools += 1;
        if (entry.access === 'read') summary.reads += 1; else summary.writes += 1;
        familyMap.set(entry.family, summary);
    }
    const families = [...familyMap.values()].sort((a, b) => b.tools - a.tools || a.family.localeCompare(b.family));
    return { entries, families };
}

/** Lo que una agente activa autoriza, leído de su `config_json.tools`. */
export function describeAgentTools(row: { id?: unknown; name?: unknown; version?: unknown }, cfgTools: unknown): TenantAgentTools {
    const tools = cfgTools && typeof cfgTools === 'object' ? cfgTools as Record<string, any> : {};
    const subpermissionDenials: TenantAgentTools['subpermissionDenials'] = [];
    for (const rule of TOOL_SUBPERMISSION_RULES) {
        const family = tools[rule.family as string];
        if (family?.enabled === true && family[rule.flag] === false) {
            subpermissionDenials.push({ family: String(rule.family), flag: rule.flag, tools: [...rule.tools] });
        }
    }
    const version = Number(row.version);
    return {
        id: String(row.id ?? ''),
        name: typeof row.name === 'string' ? row.name : null,
        version: Number.isFinite(version) ? version : null,
        enabledFamilies: enabledToolFamilies(tools),
        paymentsEnabled: tools.payments?.enabled === true,
        subpermissionDenials,
    };
}

/**
 * La matriz por tenant: qué autoriza la configuración y qué se usó de verdad.
 *
 * `enabledButUnused` y `usedButNotEnabled` se calculan sólo con uso `live`:
 * una corrida de Agent Test o de evaluación no es evidencia de que el cliente
 * real llegue a la tool. Las tools sin familia (núcleo, MCP) no entran en las
 * anomalías: no hay configuración contra la cual compararlas.
 */
export function buildTenantToolRow(input: {
    tenant: TenantRecord;
    agents: Array<{ meta: Record<string, unknown>; tools: unknown }> | null;
    agentsError?: string | null;
    planFeatures: Record<string, boolean | null>;
    usage: UsageAggregateRow[];
    familyByTool: ReadonlyMap<string, string>;
}): TenantToolRow {
    const { tenant, planFeatures, familyByTool } = input;
    const settings = tenant.settings && typeof tenant.settings === 'object' ? tenant.settings as Record<string, unknown> : {};
    const activeAgents = (input.agents ?? []).filter(agent => agent.meta?.is_active !== false);
    const agents = activeAgents.map(agent => describeAgentTools(agent.meta ?? {}, agent.tools));

    const enabled = new Set<string>();
    const blockedByPlan = new Set<string>();
    for (const agent of activeAgents) {
        for (const name of procedureAuthorizedToolNames(agent.tools)) {
            const feature = TOOL_GROUP_PLAN_FEATURE[familyByTool.get(name) ?? ''];
            if (feature && planFeatures[feature] === false) blockedByPlan.add(name);
            else enabled.add(name);
        }
    }

    const byTool = new Map<string, TenantToolUsage>();
    let nonLiveCalls = 0;
    for (const row of input.usage) {
        if (row.mode !== 'live') {
            nonLiveCalls += num(row.calls);
            continue;
        }
        const current = byTool.get(row.tool_name) ?? { tool: row.tool_name, calls: 0, errors: 0, blocked: 0, lastAt: null };
        current.calls += num(row.calls);
        current.errors += num(row.errors);
        current.blocked += num(row.blocked);
        const lastAt = iso(row.last_at);
        if (lastAt && (!current.lastAt || lastAt > current.lastAt)) current.lastAt = lastAt;
        byTool.set(row.tool_name, current);
    }
    const usage = [...byTool.values()].sort((a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool));
    const used = new Set(usage.filter(row => row.calls > 0).map(row => row.tool));
    const configurable = (name: string) => familyByTool.has(name) && !name.startsWith('mcp__');

    return {
        tenantId: tenant.id,
        name: tenant.name,
        slug: tenant.slug ?? null,
        plan: tenant.plan,
        industry: tenant.industry ?? null,
        subtype: typeof settings.subType === 'string' ? settings.subType : null,
        isActive: tenant.isActive !== false,
        isInternal: tenant.isInternal === true,
        agentsError: input.agentsError ?? null,
        agents,
        planFeatures,
        enabledTools: [...enabled].sort(),
        usedTools: [...used].sort(),
        enabledButUnused: [...enabled].filter(name => !used.has(name)).sort(),
        usedButNotEnabled: [...used].filter(name => configurable(name) && !enabled.has(name)).sort(),
        blockedByPlan: [...blockedByPlan].sort(),
        usage,
        nonLiveCalls,
    };
}

export interface UsageQuery {
    days: number;
    tenantId: string | null;
    tool: string | null;
    mode: ToolUsageMode | null;
}

/** Valida los filtros de `GET admin/tools/usage`. `mode=all` quita el filtro; por defecto, `live`. */
export function parseUsageQuery(raw: { days?: unknown; tenantId?: unknown; tool?: unknown; mode?: unknown }): UsageQuery {
    const days = raw.days === undefined || raw.days === '' ? 30 : Number(raw.days);
    if (!(TOOL_USAGE_PERIODS as readonly number[]).includes(days)) {
        throw new BadRequestException({ error: 'invalid_days', allowed: TOOL_USAGE_PERIODS });
    }
    const tenantId = typeof raw.tenantId === 'string' && raw.tenantId ? raw.tenantId : null;
    if (tenantId && !UUID_RE.test(tenantId)) throw new BadRequestException({ error: 'invalid_tenant_id' });
    const tool = typeof raw.tool === 'string' && raw.tool ? raw.tool : null;
    if (tool && (tool.length > 120 || !/^[A-Za-z0-9_:.-]+$/.test(tool))) throw new BadRequestException({ error: 'invalid_tool' });
    const rawMode = typeof raw.mode === 'string' && raw.mode ? raw.mode : 'live';
    if (rawMode !== 'all' && !(TOOL_USAGE_MODES as readonly string[]).includes(rawMode)) {
        throw new BadRequestException({ error: 'invalid_mode', allowed: [...TOOL_USAGE_MODES, 'all'] });
    }
    return { days, tenantId, tool, mode: rawMode === 'all' ? null : rawMode as ToolUsageMode };
}

const BUCKET_COLUMNS = ['lat_lt_100', 'lat_lt_300', 'lat_lt_1000', 'lat_lt_3000', 'lat_lt_10000', 'lat_ge_10000'];
const USAGE_FILTER = `day >= (CURRENT_DATE - ($1::int - 1))
      AND ($2::text IS NULL OR tenant_id = $2::uuid)
      AND ($3::text IS NULL OR tool_name = $3::text)
      AND ($4::text IS NULL OR mode = $4::text)`;

@Injectable()
export class ToolObservabilityService {
    private readonly logger = new Logger(ToolObservabilityService.name);
    private catalogCache: ReturnType<typeof buildToolCatalog> | null = null;

    constructor(
        private readonly prisma: PrismaService,
        @Optional() private readonly throttle?: TenantThrottleService,
    ) { }

    getCatalog() {
        this.catalogCache ??= buildToolCatalog();
        const { entries, families } = this.catalogCache;
        return {
            generatedAt: new Date().toISOString(),
            totals: {
                tools: entries.length,
                reads: entries.filter(entry => entry.access === 'read').length,
                writes: entries.filter(entry => entry.access === 'write').length,
                withGaps: entries.filter(entry => entry.gaps.length > 0).length,
                families: families.length,
            },
            families,
            entries,
        };
    }

    async getTenantMatrix() {
        const catalog = this.getCatalog();
        const familyByTool = new Map(catalog.entries.map(entry => [entry.tool, entry.family]));
        const planFeatureKeys = [...new Set(Object.values(TOOL_GROUP_PLAN_FEATURE))];

        const tenants = (await this.prisma.tenant.findMany({
            select: {
                id: true, name: true, slug: true, industry: true, plan: true,
                schemaName: true, isActive: true, isInternal: true, settings: true,
            },
            orderBy: { name: 'asc' },
        })) as TenantRecord[];
        const candidates = tenants.filter(tenant => tenant.schemaName && !EVAL_REPLICA_RE.test(tenant.schemaName));
        const existing = await this.existingSchemas(candidates.map(tenant => tenant.schemaName));
        const live = candidates.filter(tenant => existing.has(tenant.schemaName));

        const { rows: usageRows, available: usageAvailable } = await this.tenantUsage();
        const usageByTenant = new Map<string, UsageAggregateRow[]>();
        for (const row of usageRows) {
            const list = usageByTenant.get(row.tenant_id) ?? [];
            list.push(row);
            usageByTenant.set(row.tenant_id, list);
        }

        const rows = await mapWithConcurrency(live, SCHEMA_CONCURRENCY, async tenant => {
            const [agentsResult, planFeatures] = await Promise.all([
                this.readAgents(tenant.schemaName),
                this.resolvePlanFeatures(tenant.id, planFeatureKeys),
            ]);
            return buildTenantToolRow({
                tenant,
                agents: agentsResult.agents,
                agentsError: agentsResult.error,
                planFeatures,
                usage: usageByTenant.get(tenant.id) ?? usageByTenant.get(tenant.id.toLowerCase()) ?? [],
                familyByTool,
            });
        });

        return {
            generatedAt: new Date().toISOString(),
            windowDays: TENANT_USAGE_WINDOW_DAYS,
            usageAvailable,
            skippedSchemas: candidates.length - live.length,
            tenants: rows,
        };
    }

    async getUsage(query: UsageQuery) {
        const params = [query.days, query.tenantId, query.tool, query.mode];
        const sums = BUCKET_COLUMNS.map(column => `COALESCE(SUM(${column}), 0)::bigint AS ${column}`).join(', ');
        let available = true;
        const safe = async <T>(sql: string): Promise<T[]> => {
            try {
                return await this.prisma.$queryRawUnsafe<T[]>(sql, ...params);
            } catch (error) {
                available = false;
                this.logger.warn(`[ToolUsage] usage query failed: ${error instanceof Error ? error.message : String(error)}`);
                return [];
            }
        };

        const [toolRows, errorCodeRows, dayRows, topErrorRows] = await Promise.all([
            safe<Record<string, unknown>>(`SELECT tool_name,
                    COALESCE(SUM(calls), 0)::bigint AS calls,
                    COALESCE(SUM(calls) FILTER (WHERE outcome = 'error'), 0)::bigint AS errors,
                    COALESCE(SUM(calls) FILTER (WHERE outcome = 'blocked'), 0)::bigint AS blocked,
                    COALESCE(SUM(calls) FILTER (WHERE outcome = 'pending'), 0)::bigint AS pending,
                    COALESCE(SUM(total_ms), 0)::bigint AS total_ms,
                    COALESCE(MAX(max_ms), 0)::int AS max_ms,
                    ${sums},
                    MAX(last_at) AS last_at,
                    COUNT(DISTINCT tenant_id)::int AS tenants
               FROM public.platform_tool_usage_daily
              WHERE ${USAGE_FILTER}
              GROUP BY tool_name`),
            safe<Record<string, unknown>>(`SELECT DISTINCT ON (tool_name) tool_name, last_error_code, last_at
               FROM public.platform_tool_usage_daily
              WHERE ${USAGE_FILTER} AND outcome = 'error' AND last_error_code IS NOT NULL
              ORDER BY tool_name, last_at DESC`),
            safe<Record<string, unknown>>(`SELECT day,
                    COALESCE(SUM(calls), 0)::bigint AS calls,
                    COALESCE(SUM(calls) FILTER (WHERE outcome = 'error'), 0)::bigint AS errors,
                    COALESCE(SUM(calls) FILTER (WHERE outcome = 'blocked'), 0)::bigint AS blocked
               FROM public.platform_tool_usage_daily
              WHERE ${USAGE_FILTER}
              GROUP BY day
              ORDER BY day`),
            safe<Record<string, unknown>>(`SELECT tool_name, last_error_code,
                    COALESCE(SUM(calls), 0)::bigint AS calls,
                    COUNT(DISTINCT tenant_id)::int AS tenants,
                    MAX(last_at) AS last_at
               FROM public.platform_tool_usage_daily
              WHERE ${USAGE_FILTER} AND outcome = 'error'
              GROUP BY tool_name, last_error_code
              ORDER BY calls DESC
              LIMIT 25`),
        ]);
        return summariseUsage({ query, available, toolRows, errorCodeRows, dayRows, topErrorRows });
    }

    private async existingSchemas(names: string[]): Promise<Set<string>> {
        if (!names.length) return new Set();
        const rows = await this.prisma.$queryRawUnsafe<Array<{ schema_name: string }>>(
            `SELECT schema_name FROM information_schema.schemata WHERE schema_name = ANY($1::text[])`,
            names,
        );
        return new Set(rows.map((row: { schema_name: string }) => row.schema_name));
    }

    private async tenantUsage(): Promise<{ rows: UsageAggregateRow[]; available: boolean }> {
        try {
            const rows = await this.prisma.$queryRawUnsafe<UsageAggregateRow[]>(
                `SELECT tenant_id::text AS tenant_id, tool_name, mode,
                        COALESCE(SUM(calls), 0)::bigint AS calls,
                        COALESCE(SUM(calls) FILTER (WHERE outcome = 'error'), 0)::bigint AS errors,
                        COALESCE(SUM(calls) FILTER (WHERE outcome = 'blocked'), 0)::bigint AS blocked,
                        MAX(last_at) AS last_at
                   FROM public.platform_tool_usage_daily
                  WHERE day >= (CURRENT_DATE - ($1::int - 1))
                  GROUP BY tenant_id, tool_name, mode`,
                TENANT_USAGE_WINDOW_DAYS,
            );
            return { rows, available: true };
        } catch (error) {
            this.logger.warn(`[ToolUsage] tenant usage unavailable: ${error instanceof Error ? error.message : String(error)}`);
            return { rows: [], available: false };
        }
    }

    /**
     * Las agentes del schema, sin asumir columnas: `to_jsonb(p)` tolera un
     * schema viejo al que le falte alguna, y `config_json` se recorta a `tools`
     * para no traer prompts enteros. El nombre del schema viene de
     * `public.tenants`, pero igual va entre comillas: nunca se interpola crudo.
     */
    private async readAgents(schemaName: string): Promise<{ agents: Array<{ meta: Record<string, unknown>; tools: unknown }> | null; error: string | null }> {
        try {
            // Mismo filtro que el resto del código antes de interpolar un schema (`tenant_[a-z0-9_]+`).
            this.prisma.assertTenantSchemaName(schemaName);
            const exists = await this.prisma.$queryRawUnsafe<Array<{ ok: boolean }>>(
                `SELECT to_regclass(format('%I.%I', $1::text, 'agent_personas')) IS NOT NULL AS ok`,
                schemaName,
            );
            if (!exists[0]?.ok) return { agents: [], error: 'agent_personas_missing' };
            const rows = await this.prisma.$queryRawUnsafe<Array<{ meta: Record<string, unknown>; tools: unknown }>>(
                `SELECT to_jsonb(p) - 'config_json' AS meta, to_jsonb(p) -> 'config_json' -> 'tools' AS tools
                   FROM ${quoteIdent(schemaName)}."agent_personas" p`,
            );
            return { agents: rows, error: null };
        } catch (error) {
            this.logger.warn(`[ToolUsage] agents unreadable in ${schemaName}: ${error instanceof Error ? error.message : String(error)}`);
            return { agents: null, error: 'agents_unreadable' };
        }
    }

    /** `null` = no se pudo resolver; la UI lo muestra como desconocido, no como apagado. */
    private async resolvePlanFeatures(tenantId: string, keys: string[]): Promise<Record<string, boolean | null>> {
        const result: Record<string, boolean | null> = {};
        if (!keys.length) return result;
        try {
            if (!this.throttle) throw new Error('throttle_unavailable');
            const features = await this.throttle.getPlanFeatures(tenantId);
            for (const key of keys) result[key] = features?.[key] === true;
        } catch {
            for (const key of keys) result[key] = null;
        }
        return result;
    }
}

/** Arma la respuesta de `usage` desde las filas agregadas. Pura, para poder probarla sin base. */
export function summariseUsage(input: {
    query: UsageQuery;
    available: boolean;
    toolRows: Array<Record<string, unknown>>;
    errorCodeRows: Array<Record<string, unknown>>;
    dayRows: Array<Record<string, unknown>>;
    topErrorRows: Array<Record<string, unknown>>;
}) {
    const lastErrorByTool = new Map(input.errorCodeRows.map(row => [String(row.tool_name), String(row.last_error_code)]));
    const totalBuckets = new Array<number>(LATENCY_BUCKET_COUNT).fill(0);
    let totalCalls = 0;
    let totalErrors = 0;
    let totalBlocked = 0;
    let totalPending = 0;
    let totalMs = 0;
    let maxMs = 0;

    const tools = input.toolRows.map(row => {
        const buckets = BUCKET_COLUMNS.map(column => num(row[column]));
        const calls = num(row.calls);
        const errors = num(row.errors);
        const blocked = num(row.blocked);
        const pending = num(row.pending);
        const rowTotalMs = num(row.total_ms);
        const rowMaxMs = num(row.max_ms);
        buckets.forEach((value, index) => { totalBuckets[index] += value; });
        totalCalls += calls;
        totalErrors += errors;
        totalBlocked += blocked;
        totalPending += pending;
        totalMs += rowTotalMs;
        maxMs = Math.max(maxMs, rowMaxMs);
        return {
            tool: String(row.tool_name),
            calls,
            errors,
            blocked,
            pending,
            errorRate: calls > 0 ? errors / calls : 0,
            avgMs: calls > 0 ? Math.round(rowTotalMs / calls) : null,
            p50Ms: percentileFromBuckets(buckets, 0.5, rowMaxMs),
            p95Ms: percentileFromBuckets(buckets, 0.95, rowMaxMs),
            maxMs: rowMaxMs,
            lastAt: iso(row.last_at),
            lastErrorCode: lastErrorByTool.get(String(row.tool_name)) ?? null,
            tenants: num(row.tenants),
        };
    }).sort((a, b) => b.errors - a.errors || b.calls - a.calls || a.tool.localeCompare(b.tool));

    return {
        generatedAt: new Date().toISOString(),
        available: input.available,
        filters: {
            days: input.query.days,
            tenantId: input.query.tenantId,
            tool: input.query.tool,
            mode: input.query.mode ?? 'all',
        },
        totals: {
            calls: totalCalls,
            errors: totalErrors,
            blocked: totalBlocked,
            pending: totalPending,
            errorRate: totalCalls > 0 ? totalErrors / totalCalls : 0,
            avgMs: totalCalls > 0 ? Math.round(totalMs / totalCalls) : null,
            p50Ms: percentileFromBuckets(totalBuckets, 0.5, maxMs),
            p95Ms: percentileFromBuckets(totalBuckets, 0.95, maxMs),
            maxMs,
            tools: tools.length,
        },
        tools,
        days: input.dayRows.map(row => ({
            day: isoDay(row.day),
            calls: num(row.calls),
            errors: num(row.errors),
            blocked: num(row.blocked),
        })),
        // Atribuido al último código de error de cada fila diaria: una estimación, no un conteo exacto por código.
        topErrors: input.topErrorRows.map(row => ({
            tool: String(row.tool_name),
            errorCode: row.last_error_code === null || row.last_error_code === undefined ? null : String(row.last_error_code),
            calls: num(row.calls),
            tenants: num(row.tenants),
            lastAt: iso(row.last_at),
        })),
    };
}
