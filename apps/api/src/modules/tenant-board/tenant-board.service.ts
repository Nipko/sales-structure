/**
 * Tablero de tenants (superadmin): para cada negocio, ¿está configurado, está
 * en vivo, funcionan sus canales, llegan las respuestas, están sanas sus tools?
 *
 * Sólo lee. La respuesta entera se guarda en memoria `BOARD_CACHE_TTL_MS` y
 * dos pedidos simultáneos comparten la misma construcción, así que abrir la
 * página varias veces no multiplica las consultas contra la base.
 */
import { Injectable, Logger } from '@nestjs/common';
import {
    CREDENTIAL_TYPE_BY_CHANNEL,
    resolveCredentialHealth,
    type ChannelCredentialRecord,
} from '@parallext/shared';
import {
    TenantBoardRepository,
    iso,
    type BoardTenantRecord,
    type ChannelAccountRow,
    type CredentialRow,
    type Section,
    type TenantSchemaFacts,
    type ToolUsageRow,
} from './tenant-board.repository';
import {
    BOARD_THRESHOLDS,
    BOARD_WINDOW_DAYS,
    computeTenantBoardStatus,
    toolErrorRate,
    type BoardAgents,
    type BoardChannel,
    type BoardDelivery,
    type BoardDispatch,
    type BoardReadiness,
    type BoardTools,
    type BoardVolume,
    type TenantBoardReason,
    type TenantBoardStatus,
} from './tenant-board.status';

/** Vida de la respuesta en memoria. */
export const BOARD_CACHE_TTL_MS = 60_000;
/** Un "refrescar" explícito no reconstruye si la respuesta tiene menos de esto. */
export const BOARD_MIN_REFRESH_MS = 15_000;
/** Esquemas leídos a la vez (el Postgres de producción tiene 2 núcleos). */
export const BOARD_SCHEMA_CONCURRENCY = 4;
/** Réplicas de evaluación: copias de un tenant para el arnés, no negocios. */
const EVAL_REPLICA_RE = /^tenant_eval_/;

export interface TenantBoardRow {
    tenantId: string;
    name: string;
    slug: string | null;
    plan: string;
    subscriptionStatus: string | null;
    industry: string | null;
    subtype: string | null;
    isActive: boolean;
    isInternal: boolean;
    goLiveState: string;
    goLiveAt: string | null;
    createdAt: string | null;
    onboardingCompletedAt: string | null;
    firstChannelConnectedAt: string | null;
    firstMessageAt: string | null;
    status: TenantBoardStatus;
    reasons: TenantBoardReason[];
    readiness: BoardReadiness | null;
    channels: BoardChannel[];
    widgets: number;
    delivery: BoardDelivery | null;
    dispatch: BoardDispatch | null;
    volume: BoardVolume | null;
    tools: BoardTools | null;
    agents: BoardAgents | null;
    sectionErrors: string[];
    error: string | null;
}

export interface TenantBoardResponse {
    generatedAt: string;
    windowDays: number;
    thresholds: typeof BOARD_THRESHOLDS;
    skipped: { evalReplicas: number; missingSchemas: number };
    /** Fuentes públicas que no se pudieron leer (el tablero sale igual, sin ese dato). */
    unavailable: string[];
    summary: {
        total: number;
        byStatus: Record<TenantBoardStatus, number>;
        live: number;
        stuckDeliveries: number;
        reconciliationRequired: number;
        channelErrors: number;
    };
    tenants: TenantBoardRow[];
}

/** Ejecuta `worker` sobre `items` con a lo sumo `limit` en vuelo. Conserva el orden. */
export async function mapWithConcurrency<T, R>(
    items: readonly T[],
    limit: number,
    worker: (item: T) => Promise<R>,
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await worker(items[index]);
        }
    });
    await Promise.all(lanes);
    return results;
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
    const map = new Map<string, T[]>();
    for (const row of rows) {
        const id = key(row).toLowerCase();
        const list = map.get(id) ?? [];
        list.push(row);
        map.set(id, list);
    }
    return map;
}

function settingsSubtype(settings: unknown): string | null {
    if (!settings || typeof settings !== 'object') return null;
    const value = (settings as Record<string, unknown>).subType;
    return typeof value === 'string' ? value : null;
}

/** Salud de cada cuenta con la MISMA regla que la página de Canales y Salud de agentes. */
export function boardChannels(input: {
    accounts: readonly ChannelAccountRow[];
    credentials: readonly CredentialRow[] | null;
    legacyWhatsApp: readonly string[];
    now: number;
}): BoardChannel[] {
    const byType = new Map<string, ChannelCredentialRecord>();
    for (const credential of input.credentials ?? []) {
        if (!byType.has(credential.credential_type)) {
            byType.set(credential.credential_type, { rotationState: credential.rotation_state, expiresAt: credential.expires_at });
        }
    }
    const legacy = new Set(input.legacyWhatsApp);
    return input.accounts.map(account => ({
        type: account.channel_type,
        displayName: account.display_name ?? null,
        health: resolveCredentialHealth({
            channelType: account.channel_type,
            hasAccountToken: account.has_token === true,
            metadata: account.token_expires_at ? { tokenExpiresAt: account.token_expires_at } : null,
            latestCredential: byType.get(CREDENTIAL_TYPE_BY_CHANNEL[account.channel_type]) ?? null,
            lookupAvailable: input.credentials !== null,
            hasLegacyWhatsAppToken: legacy.has(String(account.account_id)),
            now: input.now,
        }),
        connectedAt: iso(account.created_at),
        lastError: account.token_refresh_error ?? null,
        refreshState: account.token_refresh_state ?? null,
    }));
}

@Injectable()
export class TenantBoardService {
    private readonly logger = new Logger(TenantBoardService.name);
    private cache: { at: number; value: TenantBoardResponse } | null = null;
    private inflight: Promise<TenantBoardResponse> | null = null;

    /** Reloj inyectable para las pruebas de la caché. */
    clock: () => number = () => Date.now();

    constructor(private readonly repository: TenantBoardRepository) { }

    async getBoard(options: { refresh?: boolean } = {}): Promise<TenantBoardResponse & { cached: boolean }> {
        const now = this.clock();
        const age = this.cache ? now - this.cache.at : Infinity;
        const fresh = options.refresh ? age < BOARD_MIN_REFRESH_MS : age < BOARD_CACHE_TTL_MS;
        if (this.cache && fresh) return { ...this.cache.value, cached: true };
        if (!this.inflight) {
            this.inflight = this.build()
                .then(value => {
                    this.cache = { at: this.clock(), value };
                    return value;
                })
                .finally(() => { this.inflight = null; });
        }
        return { ...(await this.inflight), cached: false };
    }

    private async build(): Promise<TenantBoardResponse> {
        const now = this.clock();
        const unavailable: string[] = [];
        const optional = async <T>(name: string, read: () => Promise<T>): Promise<T | null> => {
            try {
                return await read();
            } catch (error) {
                unavailable.push(name);
                this.logger.warn(`[TenantBoard] ${name} unreadable: ${error instanceof Error ? error.message : String(error)}`);
                return null;
            }
        };

        const tenants = await this.repository.listTenants();
        const candidates = tenants.filter(tenant => tenant.schemaName && !EVAL_REPLICA_RE.test(tenant.schemaName));
        const existing = await this.repository.existingSchemas(candidates.map(tenant => tenant.schemaName));
        const live = candidates.filter(tenant => existing.has(tenant.schemaName));

        const [accounts, credentials, widgets, usage] = await Promise.all([
            optional('channel_accounts', () => this.repository.channelAccounts()),
            optional('whatsapp_credentials', () => this.repository.latestCredentials()),
            optional('widget_configs', () => this.repository.activeWidgets()),
            optional('platform_tool_usage_daily', () => this.repository.toolUsage()),
        ]);
        const accountsByTenant = groupBy(accounts ?? [], row => row.tenant_id);
        const credentialsByTenant = credentials ? groupBy(credentials, row => row.tenant_id) : null;
        const usageByTenant = new Map((usage ?? []).map(row => [row.tenant_id.toLowerCase(), row]));

        const rows = await mapWithConcurrency(live, BOARD_SCHEMA_CONCURRENCY, async tenant => {
            const key = tenant.id.toLowerCase();
            const tenantAccounts = accountsByTenant.get(key) ?? [];
            try {
                const facts = await this.repository.readTenantSchema(tenant.schemaName, {
                    readLegacyWhatsApp: tenantAccounts.some(account => account.channel_type === 'whatsapp'),
                });
                return this.buildRow({
                    tenant, facts, now,
                    accounts: accounts === null ? null : tenantAccounts,
                    credentials: credentialsByTenant === null ? null : credentialsByTenant.get(key) ?? [],
                    widgets: widgets === null ? null : widgets.get(key) ?? 0,
                    usageAvailable: usage !== null,
                    usage: usageByTenant.get(key) ?? null,
                });
            } catch (error) {
                // Un tenant roto se muestra como `error`; la página sigue.
                const reason = error instanceof Error ? error.message : String(error);
                this.logger.warn(`[TenantBoard] ${tenant.schemaName} unreadable: ${reason}`);
                return this.errorRow(tenant, reason);
            }
        });

        const byStatus: Record<TenantBoardStatus, number> = { ok: 0, atencion: 0, critico: 0, error: 0 };
        for (const row of rows) byStatus[row.status] += 1;
        return {
            generatedAt: new Date(now).toISOString(),
            windowDays: BOARD_WINDOW_DAYS,
            thresholds: BOARD_THRESHOLDS,
            skipped: {
                evalReplicas: tenants.length - candidates.length,
                missingSchemas: candidates.length - live.length,
            },
            unavailable,
            summary: {
                total: rows.length,
                byStatus,
                live: rows.filter(row => row.goLiveState === 'on').length,
                stuckDeliveries: rows.reduce((sum, row) => sum + (row.delivery?.stuck ?? 0), 0),
                reconciliationRequired: rows.reduce((sum, row) => sum + (row.dispatch?.reconciliationRequired ?? 0), 0),
                channelErrors: rows.filter(row => row.reasons.some(reason => reason.code === 'channel_error')).length,
            },
            tenants: rows,
        };
    }

    private baseRow(tenant: BoardTenantRecord) {
        return {
            tenantId: tenant.id,
            name: tenant.name,
            slug: tenant.slug ?? null,
            plan: tenant.plan,
            subscriptionStatus: tenant.subscriptionStatus ?? null,
            industry: tenant.industry ?? null,
            subtype: settingsSubtype(tenant.settings),
            isActive: tenant.isActive !== false,
            isInternal: tenant.isInternal === true,
            goLiveState: tenant.goLiveState === 'on' ? 'on' : 'off',
            goLiveAt: iso(tenant.goLiveAt),
            createdAt: iso(tenant.createdAt),
            onboardingCompletedAt: iso(tenant.onboardingCompletedAt),
            firstChannelConnectedAt: iso(tenant.firstChannelConnectedAt),
            firstMessageAt: iso(tenant.firstMessageAt),
        };
    }

    private errorRow(tenant: BoardTenantRecord, error: string): TenantBoardRow {
        const { status, reasons } = computeTenantBoardStatus({
            isLive: false, onboardingCompleted: true, subscriptionStatus: null, channels: [], widgets: 0,
            readiness: null, delivery: null, dispatch: null, volume: null, tools: null, agents: null,
            sectionErrors: [], error,
        });
        return {
            ...this.baseRow(tenant), status, reasons,
            readiness: null, channels: [], widgets: 0, delivery: null, dispatch: null, volume: null,
            tools: null, agents: null, sectionErrors: [], error,
        };
    }

    private buildRow(input: {
        tenant: BoardTenantRecord;
        facts: TenantSchemaFacts;
        accounts: ChannelAccountRow[] | null;
        credentials: CredentialRow[] | null;
        widgets: number | null;
        usageAvailable: boolean;
        usage: ToolUsageRow | null;
        now: number;
    }): TenantBoardRow {
        const { tenant, facts } = input;
        const sectionErrors: string[] = [];
        const take = <T>(name: string, value: Section<T>): T | null => {
            if (value.error) sectionErrors.push(name);
            return value.value;
        };
        const readiness = take('readiness', facts.readiness) ?? null;
        const agents = take('agents', facts.agents);
        const delivery = take('delivery', facts.delivery);
        const dispatch = take('dispatch', facts.dispatch);
        const volume = take('volume', facts.volume);
        const legacy = take('channels', facts.legacyWhatsApp) ?? [];
        // Sin cuentas o sin widgets legibles no se puede afirmar "no tiene canal".
        if ((input.accounts === null || input.widgets === null) && !sectionErrors.includes('channels')) sectionErrors.push('channels');

        const channels = boardChannels({
            accounts: input.accounts ?? [], credentials: input.credentials, legacyWhatsApp: legacy, now: input.now,
        });
        // Tabla legible y sin fila = el tenant no usó tools en la ventana: es 0, no "sin dato".
        const tools: BoardTools | null = !input.usageAvailable
            ? null
            : {
                calls: input.usage?.calls ?? 0,
                errors: input.usage?.errors ?? 0,
                blocked: input.usage?.blocked ?? 0,
                errorRate: toolErrorRate(input.usage?.calls ?? 0, input.usage?.errors ?? 0),
                lastErrorCode: input.usage?.last_error_code ?? null,
            };
        const base = this.baseRow(tenant);
        const { status, reasons } = computeTenantBoardStatus({
            isLive: base.goLiveState === 'on',
            onboardingCompleted: Boolean(tenant.onboardingCompletedAt),
            subscriptionStatus: base.subscriptionStatus,
            channels,
            widgets: input.widgets ?? 0,
            readiness,
            delivery,
            dispatch,
            volume,
            tools,
            agents,
            sectionErrors,
            error: null,
        });
        return {
            ...base, status, reasons, readiness, channels, widgets: input.widgets ?? 0,
            delivery, dispatch, volume, tools, agents, sectionErrors, error: null,
        };
    }
}
