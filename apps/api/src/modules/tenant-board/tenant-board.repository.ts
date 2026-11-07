/**
 * Lecturas del tablero de tenants. Sólo SELECT, nunca DDL ni escrituras.
 *
 * Carga sobre la base (el Postgres de producción tiene 2 núcleos y los
 * incidentes anteriores vinieron de barridos pesados por tenant):
 *  - Lo público (tenants, canales, credenciales, widgets, uso de tools) se lee
 *    UNA vez para todos los tenants, no una vez por tenant.
 *  - Por tenant hay dos transacciones cortas: `core` (consultas sobre tablas
 *    chicas o con índice: readiness, agentes, entregas no confirmadas por el
 *    índice parcial `idx_agent_turn_ledger_undelivered`, outbox) y `volume`
 *    (los conteos de 7 días de `messages`/`agent_turn_ledger`, que no tienen
 *    índice por fecha). Cada una corre con `statement_timeout`: si el barrido
 *    no termina a tiempo, la sección queda "sin dato" en vez de cargar la base.
 *  - Antes de tocar una tabla se pregunta si existe (`to_regclass`): un tenant
 *    sin migrar muestra la sección vacía, no un error de la página.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { readDispatchBacklog } from '../channels/agent-dispatch-outbox';
import {
    BOARD_WINDOW_DAYS,
    STUCK_DELIVERY_AFTER_SECONDS,
    type BoardAgents,
    type BoardDelivery,
    type BoardDispatch,
    type BoardReadiness,
    type BoardTools,
    type BoardVolume,
} from './tenant-board.status';

/** Tope de cada consulta de la transacción `core` (tablas chicas o con índice). */
export const CORE_STATEMENT_TIMEOUT_MS = 2_000;
/** Tope de los conteos de 7 días sin índice por fecha. */
export const VOLUME_STATEMENT_TIMEOUT_MS = 1_500;
/** Cuántas brechas bloqueantes se muestran por tenant. */
const MAX_BLOCKING_GAPS = 5;
/** Placeholders de token que nunca fueron un token real (ver `hasRealToken`). */
const TOKEN_PLACEHOLDERS_SQL = `('', 'encrypted_ref', 'credential_ref')`;

export type TenantQuery = <R = any[]>(sql: string, params?: any[]) => Promise<R>;

export interface BoardTenantRecord {
    id: string;
    name: string;
    slug: string | null;
    industry: string | null;
    plan: string;
    schemaName: string;
    isActive: boolean;
    isInternal: boolean;
    settings: unknown;
    subscriptionStatus: string | null;
    goLiveState: string | null;
    goLiveAt: Date | null;
    onboardingCompletedAt: Date | null;
    firstChannelConnectedAt: Date | null;
    firstMessageAt: Date | null;
    createdAt: Date;
}

export interface ChannelAccountRow {
    tenant_id: string;
    channel_type: string;
    account_id: string;
    display_name: string | null;
    has_token: boolean;
    token_expires_at: string | null;
    token_refresh_state: string | null;
    token_refresh_error: string | null;
    created_at: Date | string | null;
}

export interface CredentialRow {
    tenant_id: string;
    credential_type: string;
    rotation_state: string | null;
    expires_at: Date | string | null;
}

export interface ToolUsageRow {
    tenant_id: string;
    calls: number;
    errors: number;
    blocked: number;
    last_error_code: string | null;
}

/** Una sección leída: el valor, o `null` y el motivo. */
export interface Section<T> {
    value: T | null;
    error: string | null;
}

export interface TenantSchemaFacts {
    readiness: Section<BoardReadiness | null>;
    agents: Section<BoardAgents>;
    delivery: Section<BoardDelivery | null>;
    dispatch: Section<BoardDispatch>;
    volume: Section<BoardVolume>;
    legacyWhatsApp: Section<string[]>;
}

const num = (value: unknown): number => {
    if (typeof value === 'bigint') return Number(value);
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};
export const iso = (value: unknown): string | null => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
const message = (error: unknown): string => {
    const text = error instanceof Error ? error.message : String(error);
    return text.length > 160 ? `${text.slice(0, 157)}...` : text;
};

/** Ejecuta una sección; un fallo queda en la sección y no tumba las demás. */
async function section<T>(read: () => Promise<T>): Promise<Section<T>> {
    try {
        return { value: await read(), error: null };
    } catch (error) {
        return { value: null, error: message(error) };
    }
}

const TABLES = [
    'readiness_evaluations', 'agent_personas', 'agent_publication_heads', 'agent_turn_ledger',
    'messages', 'conversations', 'whatsapp_channels',
] as const;
type TableName = (typeof TABLES)[number];

@Injectable()
export class TenantBoardRepository {
    constructor(private readonly prisma: PrismaService) { }

    async listTenants(): Promise<BoardTenantRecord[]> {
        return (await this.prisma.tenant.findMany({
            select: {
                id: true, name: true, slug: true, industry: true, plan: true, schemaName: true,
                isActive: true, isInternal: true, settings: true, subscriptionStatus: true,
                goLiveState: true, goLiveAt: true, onboardingCompletedAt: true,
                firstChannelConnectedAt: true, firstMessageAt: true, createdAt: true,
            },
            orderBy: { name: 'asc' },
        })) as BoardTenantRecord[];
    }

    async existingSchemas(names: string[]): Promise<Set<string>> {
        if (names.length === 0) return new Set();
        const rows: Array<{ schema_name: string }> = await this.prisma.$queryRawUnsafe(
            `SELECT schema_name FROM information_schema.schemata WHERE schema_name = ANY($1::text[])`,
            names,
        );
        return new Set(rows.map(row => row.schema_name));
    }

    /**
     * Cuentas de canal activas de todos los tenants. El token nunca sale de la
     * base: sólo si hay uno real (`has_token`).
     */
    async channelAccounts(): Promise<ChannelAccountRow[]> {
        return this.prisma.$queryRawUnsafe<ChannelAccountRow[]>(
            `SELECT tenant_id::text AS tenant_id, channel_type, account_id, display_name,
                    (access_token IS NOT NULL AND btrim(access_token) NOT IN ${TOKEN_PLACEHOLDERS_SQL}) AS has_token,
                    metadata->>'tokenExpiresAt' AS token_expires_at,
                    token_refresh_state, token_refresh_error, created_at
               FROM public.channel_accounts
              WHERE is_active = true`,
        );
    }

    /** La credencial más nueva por (tenant, tipo), como la lee la página de Canales. */
    async latestCredentials(): Promise<CredentialRow[]> {
        return this.prisma.$queryRawUnsafe<CredentialRow[]>(
            `SELECT DISTINCT ON (tenant_id, credential_type)
                    tenant_id::text AS tenant_id, credential_type, rotation_state, expires_at
               FROM public.whatsapp_credentials
              ORDER BY tenant_id, credential_type, created_at DESC`,
        );
    }

    /** Widgets de chat web activos (no demo) por tenant: también son un canal. */
    async activeWidgets(): Promise<Map<string, number>> {
        const rows: Array<{ tenant_id: string; widgets: number | bigint }> = await this.prisma.$queryRawUnsafe(
            `SELECT tenant_id::text AS tenant_id, COUNT(*)::int AS widgets
               FROM public.widget_configs
              WHERE is_active = true AND COALESCE(is_demo, false) = false
              GROUP BY tenant_id`,
        );
        return new Map(rows.map(row => [row.tenant_id, num(row.widgets)]));
    }

    /** Uso `live` de tools en la ventana, por tenant (índice por día). */
    async toolUsage(): Promise<ToolUsageRow[]> {
        const rows: ToolUsageRow[] = await this.prisma.$queryRawUnsafe(
            `SELECT tenant_id::text AS tenant_id,
                    COALESCE(SUM(calls), 0)::int AS calls,
                    COALESCE(SUM(calls) FILTER (WHERE outcome = 'error'), 0)::int AS errors,
                    COALESCE(SUM(calls) FILTER (WHERE outcome = 'blocked'), 0)::int AS blocked,
                    (ARRAY_AGG(last_error_code ORDER BY last_at DESC)
                        FILTER (WHERE outcome = 'error' AND last_error_code IS NOT NULL))[1] AS last_error_code
               FROM public.platform_tool_usage_daily
              WHERE day >= (CURRENT_DATE - ($1::int - 1)) AND mode = 'live'
              GROUP BY tenant_id`,
            BOARD_WINDOW_DAYS,
        );
        return rows.map(row => ({
            tenant_id: row.tenant_id,
            calls: num(row.calls),
            errors: num(row.errors),
            blocked: num(row.blocked),
            last_error_code: row.last_error_code ?? null,
        }));
    }

    /** Hechos del esquema de un tenant. Nunca lanza: cada sección trae su error. */
    async readTenantSchema(schemaName: string, options: { readLegacyWhatsApp: boolean }): Promise<TenantSchemaFacts> {
        this.prisma.assertTenantSchemaName(schemaName);
        const failed = <T>(error: string): Section<T> => ({ value: null, error });

        let core: Omit<TenantSchemaFacts, 'volume'>;
        let tables: Record<TableName, boolean> | null = null;
        try {
            core = await this.prisma.transactionInTenantSchema(schemaName, async query => {
                await query(`SELECT set_config('statement_timeout', $1, true) AS statement_timeout`, [String(CORE_STATEMENT_TIMEOUT_MS)]);
                tables = await this.tablesIn(query, schemaName);
                const present = tables;
                // El orden importa: una consulta que falla aborta la transacción,
                // así que lo más propenso a fallar (el outbox) va al final.
                const readiness = await section(() => this.readReadiness(query, present));
                const agents = await section(() => this.readAgents(query, present));
                const legacyWhatsApp = options.readLegacyWhatsApp
                    ? await section(() => this.readLegacyWhatsApp(query, present))
                    : { value: [], error: null };
                const delivery = await section(() => this.readUndelivered(query, present));
                const dispatch = await section(() => this.readDispatch(query, schemaName));
                return { readiness, agents, legacyWhatsApp, delivery, dispatch };
            }, { timeout: 10_000, maxWait: 5_000 });
        } catch (error) {
            const reason = message(error);
            core = {
                readiness: failed(reason), agents: failed(reason), legacyWhatsApp: failed(reason),
                delivery: failed(reason), dispatch: failed(reason),
            };
        }

        const present = tables as Record<TableName, boolean> | null;
        const volume = present
            ? await this.readVolume(schemaName, present, core.delivery.value)
            : failed<BoardVolume>(core.readiness.error ?? 'schema_unreadable');
        return { ...core, volume };
    }

    private async tablesIn(query: TenantQuery, schemaName: string): Promise<Record<TableName, boolean>> {
        const select = TABLES.map((table, index) => `to_regclass(format('%I.%I', $1::text, $${index + 2}::text)) IS NOT NULL AS "${table}"`).join(', ');
        const [row] = await query<Array<Record<string, boolean>>>(`SELECT ${select}`, [schemaName, ...TABLES]);
        return Object.fromEntries(TABLES.map(table => [table, row?.[table] === true])) as Record<TableName, boolean>;
    }

    /** La última evaluación guardada; no dispara una nueva. */
    private async readReadiness(query: TenantQuery, tables: Record<TableName, boolean>): Promise<BoardReadiness | null> {
        if (!tables.readiness_evaluations) return null;
        const [row] = await query<any[]>(
            `SELECT verdict, counts, result->'blockingGaps' AS blocking_gaps,
                    result->'coverage'->>'r5Pct' AS coverage, created_at
               FROM readiness_evaluations
              ORDER BY created_at DESC, id DESC
              LIMIT 1`,
        );
        if (!row) return null;
        const counts = row.counts && typeof row.counts === 'object' ? row.counts : {};
        const gaps = Array.isArray(row.blocking_gaps) ? row.blocking_gaps.map(String) : [];
        const coverage = row.coverage === null || row.coverage === undefined ? null : Number(row.coverage);
        return {
            verdict: row.verdict ?? null,
            blockingFailing: num(counts.blockingFailing),
            necessaryFailing: num(counts.necessaryFailing),
            coveragePct: coverage !== null && Number.isFinite(coverage) ? coverage : null,
            blockingGaps: gaps.slice(0, MAX_BLOCKING_GAPS),
            evaluatedAt: iso(row.created_at),
        };
    }

    private async readAgents(query: TenantQuery, tables: Record<TableName, boolean>): Promise<BoardAgents> {
        if (!tables.agent_personas) return { active: 0, total: 0, published: null };
        const [row] = await query<any[]>(
            `SELECT COUNT(*) FILTER (WHERE is_active = true)::int AS active, COUNT(*)::int AS total FROM agent_personas`,
        );
        let published: number | null = null;
        if (tables.agent_publication_heads) {
            const [heads] = await query<any[]>(
                `SELECT COUNT(*)::int AS published
                   FROM agent_publication_heads h
                   JOIN agent_personas p ON p.id = h.agent_id
                  WHERE p.is_active = true`,
            );
            published = num(heads?.published);
        }
        return { active: num(row?.active), total: num(row?.total), published };
    }

    /** Números con token propio previo al system user: sí envían (ver `resolveCredentialHealth`). */
    private async readLegacyWhatsApp(query: TenantQuery, tables: Record<TableName, boolean>): Promise<string[]> {
        if (!tables.whatsapp_channels) return [];
        const rows = await query<Array<{ phone_number_id: string }>>(
            `SELECT phone_number_id::text AS phone_number_id
               FROM whatsapp_channels
              WHERE access_token_ref IS NOT NULL AND btrim(access_token_ref) NOT IN ${TOKEN_PLACEHOLDERS_SQL}
              LIMIT 200`,
        );
        return rows.map(row => String(row.phone_number_id));
    }

    /**
     * Respuestas sin confirmar en la ventana. El filtro `delivery_state IN
     * (pending, unknown, failed)` coincide con el índice parcial
     * `idx_agent_turn_ledger_undelivered`, que sólo guarda esas filas.
     */
    private async readUndelivered(query: TenantQuery, tables: Record<TableName, boolean>): Promise<BoardDelivery | null> {
        if (!tables.agent_turn_ledger) return null;
        const [row] = await query<any[]>(
            `SELECT COUNT(*) FILTER (WHERE delivery_state = 'pending')::int AS pending,
                    COUNT(*) FILTER (WHERE delivery_state = 'unknown')::int AS unknown,
                    COUNT(*) FILTER (WHERE delivery_state = 'failed')::int AS failed,
                    COUNT(*) FILTER (WHERE delivery_state = 'pending'
                        AND created_at < NOW() - make_interval(secs => $2::double precision))::int AS stuck
               FROM agent_turn_ledger
              WHERE delivery_state IN ('pending', 'unknown', 'failed')
                AND created_at >= NOW() - make_interval(days => $1::int)`,
            [BOARD_WINDOW_DAYS, STUCK_DELIVERY_AFTER_SECONDS],
        );
        return {
            pending: num(row?.pending), unknown: num(row?.unknown), failed: num(row?.failed), stuck: num(row?.stuck),
            delivered: null, total: null, lastDeliveredAt: null,
        };
    }

    /** El mismo primitivo que el monitor de plataforma (sin DDL; 0 si el outbox no existe). */
    private async readDispatch(query: TenantQuery, schemaName: string): Promise<BoardDispatch> {
        const backlog = await readDispatchBacklog(query, schemaName);
        return { reconciliationRequired: backlog.total, reconciliationOverdue: backlog.breachingSla, stalled: backlog.stalled };
    }

    /**
     * Conteos de 7 días sin índice por fecha (`messages`, entregadas del
     * ledger). Transacción aparte con un tope más corto: si no terminan a
     * tiempo, se pierde sólo esta sección.
     */
    private async readVolume(
        schemaName: string,
        tables: Record<TableName, boolean>,
        delivery: BoardDelivery | null,
    ): Promise<Section<BoardVolume>> {
        return section(() => this.prisma.transactionInTenantSchema(schemaName, async query => {
            await query(`SELECT set_config('statement_timeout', $1, true) AS statement_timeout`, [String(VOLUME_STATEMENT_TIMEOUT_MS)]);
            const volume: BoardVolume = { inbound: 0, outbound: 0, conversations: 0, lastInboundAt: null };
            if (tables.messages) {
                const [row] = await query<any[]>(
                    `SELECT COUNT(*) FILTER (WHERE direction = 'inbound')::int AS inbound,
                            COUNT(*) FILTER (WHERE direction = 'outbound')::int AS outbound,
                            MAX(created_at) FILTER (WHERE direction = 'inbound') AS last_inbound
                       FROM messages
                      WHERE created_at >= NOW() - make_interval(days => $1::int)`,
                    [BOARD_WINDOW_DAYS],
                );
                volume.inbound = num(row?.inbound);
                volume.outbound = num(row?.outbound);
                volume.lastInboundAt = iso(row?.last_inbound);
            }
            if (tables.conversations) {
                // `idx_conversations_created_at`.
                const [row] = await query<any[]>(
                    `SELECT COUNT(*)::int AS conversations FROM conversations
                      WHERE created_at >= NOW() - make_interval(days => $1::int)`,
                    [BOARD_WINDOW_DAYS],
                );
                volume.conversations = num(row?.conversations);
            }
            if (tables.agent_turn_ledger && delivery) {
                const [row] = await query<any[]>(
                    `SELECT COUNT(*)::int AS total,
                            COUNT(*) FILTER (WHERE delivery_state = 'delivered')::int AS delivered,
                            MAX(delivery_updated_at) FILTER (WHERE delivery_state = 'delivered') AS last_delivered
                       FROM agent_turn_ledger
                      WHERE created_at >= NOW() - make_interval(days => $1::int)`,
                    [BOARD_WINDOW_DAYS],
                );
                delivery.total = num(row?.total);
                delivery.delivered = num(row?.delivered);
                delivery.lastDeliveredAt = iso(row?.last_delivered);
            }
            return volume;
        }, { timeout: 8_000, maxWait: 5_000 }));
    }
}
