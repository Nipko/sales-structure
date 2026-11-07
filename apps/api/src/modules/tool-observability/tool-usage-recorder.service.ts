import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
    LATENCY_BUCKET_COUNT,
    TOOL_USAGE_ERROR_CODE_MAX,
    latencyBucketIndex,
    type ToolUsageMode,
    type ToolUsageOutcome,
} from './tool-usage-outcome';

/** Una llamada observada. Todo lo que trae lo arma el servidor, nunca el modelo. */
export interface ToolUsageSample {
    tenantId: string;
    toolName: string;
    mode: ToolUsageMode;
    channel: string;
    outcome: ToolUsageOutcome;
    errorCode: string | null;
    durationMs: number;
    /** Momento de fin de la llamada; por defecto, ahora. */
    at?: Date;
}

interface UsageAggregate {
    day: string;
    tenantId: string;
    toolName: string;
    mode: ToolUsageMode;
    channel: string;
    outcome: ToolUsageOutcome;
    calls: number;
    totalMs: number;
    maxMs: number;
    buckets: number[];
    lastAt: number;
    lastErrorCode: string | null;
}

/** Cada cuánto se vacía el agregado en memoria. */
export const TOOL_USAGE_FLUSH_INTERVAL_MS = 60_000;
/** Claves distintas en memoria antes de vaciar sin esperar al intervalo. */
export const TOOL_USAGE_MAX_KEYS = 5_000;
/** Filas por sentencia: un único upsert aditivo por lote. */
export const TOOL_USAGE_FLUSH_BATCH = 1_000;
/** Días que se conservan en `platform_tool_usage_daily`. */
export const TOOL_USAGE_RETENTION_DAYS = 400;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WARN_INTERVAL_MS = 5 * 60_000;

/**
 * Upsert aditivo: varias réplicas (API y worker) escriben la misma clave y cada
 * una SUMA lo suyo. Una columna por arreglo, así que el número de parámetros no
 * crece con el lote.
 */
export const TOOL_USAGE_UPSERT_SQL = `INSERT INTO public.platform_tool_usage_daily AS t
    (day, tenant_id, tool_name, mode, channel, outcome, calls, total_ms, max_ms,
     lat_lt_100, lat_lt_300, lat_lt_1000, lat_lt_3000, lat_lt_10000, lat_ge_10000,
     last_at, last_error_code)
SELECT * FROM unnest(
    $1::text[]::date[], $2::text[]::uuid[], $3::text[], $4::text[], $5::text[], $6::text[],
    $7::text[]::integer[], $8::text[]::bigint[], $9::text[]::integer[],
    $10::text[]::integer[], $11::text[]::integer[], $12::text[]::integer[],
    $13::text[]::integer[], $14::text[]::integer[], $15::text[]::integer[],
    $16::text[]::timestamptz[], $17::text[])
ON CONFLICT (day, tenant_id, tool_name, mode, channel, outcome) DO UPDATE SET
    calls = t.calls + EXCLUDED.calls,
    total_ms = t.total_ms + EXCLUDED.total_ms,
    max_ms = GREATEST(t.max_ms, EXCLUDED.max_ms),
    lat_lt_100 = t.lat_lt_100 + EXCLUDED.lat_lt_100,
    lat_lt_300 = t.lat_lt_300 + EXCLUDED.lat_lt_300,
    lat_lt_1000 = t.lat_lt_1000 + EXCLUDED.lat_lt_1000,
    lat_lt_3000 = t.lat_lt_3000 + EXCLUDED.lat_lt_3000,
    lat_lt_10000 = t.lat_lt_10000 + EXCLUDED.lat_lt_10000,
    lat_ge_10000 = t.lat_ge_10000 + EXCLUDED.lat_ge_10000,
    last_at = GREATEST(t.last_at, EXCLUDED.last_at),
    last_error_code = COALESCE(EXCLUDED.last_error_code, t.last_error_code)`;

export const TOOL_USAGE_RETENTION_SQL = `DELETE FROM public.platform_tool_usage_daily
    WHERE day < (CURRENT_DATE - ${TOOL_USAGE_RETENTION_DAYS})`;

function clip(value: unknown, max: number, fallback: string): string {
    const text = typeof value === 'string' ? value.trim() : '';
    return (text || fallback).slice(0, max);
}

/**
 * Cuenta cada llamada a una tool del agente, agregada por día (UTC), tenant,
 * tool, modo, canal y resultado, y la vuelca a `public.platform_tool_usage_daily`.
 *
 * Contrato con el camino de la tool, que es lo único que importa acá:
 * `record()` es síncrono, O(1), no hace I/O y NUNCA lanza. Todo el I/O ocurre
 * en `flush()`, fuera de la llamada, con un temporizador `unref` que no retiene
 * el proceso. Si la base falla, se pierde a lo sumo un minuto de conteos y se
 * avisa con un warn limitado, nunca un error que llegue al cliente.
 */
@Injectable()
export class ToolUsageRecorder implements OnModuleDestroy {
    private readonly logger = new Logger(ToolUsageRecorder.name);
    private pending = new Map<string, UsageAggregate>();
    private timer: ReturnType<typeof setInterval> | null = null;
    private flushing: Promise<void> | null = null;
    private lastWarnAt = 0;
    private lastRetentionDay: string | null = null;
    private destroyed = false;

    constructor(@Optional() private readonly prisma?: PrismaService) { }

    /** Claves pendientes de volcar (para diagnósticos y tests). */
    get pendingKeys(): number {
        return this.pending.size;
    }

    record(sample: ToolUsageSample): void {
        try {
            if (this.destroyed || !this.prisma) return;
            if (!sample || typeof sample.tenantId !== 'string' || !UUID_RE.test(sample.tenantId)) return;
            const tenantId = sample.tenantId.toLowerCase();
            const toolName = clip(sample.toolName, 120, '');
            if (!toolName) return;
            const at = sample.at instanceof Date && Number.isFinite(sample.at.getTime()) ? sample.at : new Date();
            const day = at.toISOString().slice(0, 10);
            const channel = clip(sample.channel, 32, 'unknown');
            const durationMs = Number.isFinite(sample.durationMs) && sample.durationMs > 0
                ? Math.round(sample.durationMs) : 0;
            const errorCode = sample.errorCode
                ? String(sample.errorCode).slice(0, TOOL_USAGE_ERROR_CODE_MAX) : null;
            const key = `${day}|${tenantId}|${toolName}|${sample.mode}|${channel}|${sample.outcome}`;
            let entry = this.pending.get(key);
            if (!entry) {
                entry = {
                    day,
                    tenantId,
                    toolName,
                    mode: sample.mode,
                    channel,
                    outcome: sample.outcome,
                    calls: 0,
                    totalMs: 0,
                    maxMs: 0,
                    buckets: new Array(LATENCY_BUCKET_COUNT).fill(0),
                    lastAt: 0,
                    lastErrorCode: null,
                };
                this.pending.set(key, entry);
            }
            entry.calls += 1;
            entry.totalMs += durationMs;
            entry.maxMs = Math.max(entry.maxMs, durationMs);
            entry.buckets[latencyBucketIndex(durationMs)] += 1;
            entry.lastAt = Math.max(entry.lastAt, at.getTime());
            if (errorCode) entry.lastErrorCode = errorCode;

            this.ensureTimer();
            if (this.pending.size >= TOOL_USAGE_MAX_KEYS) void this.flush();
        } catch (error) {
            this.warn('record', error);
        }
    }

    /**
     * Vuelca lo acumulado. Nunca rechaza. Si ya hay un volcado en curso, espera
     * a ése en lugar de abrir otro: dos volcados simultáneos sumarían bien en la
     * base, pero duplicarían conexiones sin necesidad.
     */
    async flush(): Promise<void> {
        if (this.flushing) return this.flushing;
        if (this.pending.size === 0 || !this.prisma) return;
        const drained = this.pending;
        this.pending = new Map();
        this.flushing = this.write(drained)
            .catch(error => {
                this.restore(drained);
                this.warn('flush', error);
            })
            .finally(() => { this.flushing = null; });
        return this.flushing;
    }

    async onModuleDestroy(): Promise<void> {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        try {
            if (this.flushing) await this.flushing;
            await this.flush();
        } finally {
            this.destroyed = true;
        }
    }

    private ensureTimer(): void {
        if (this.timer) return;
        this.timer = setInterval(() => { void this.flush(); }, TOOL_USAGE_FLUSH_INTERVAL_MS);
        (this.timer as { unref?: () => void }).unref?.();
    }

    private async write(drained: Map<string, UsageAggregate>): Promise<void> {
        const rows = [...drained.values()];
        for (let start = 0; start < rows.length; start += TOOL_USAGE_FLUSH_BATCH) {
            const batch = rows.slice(start, start + TOOL_USAGE_FLUSH_BATCH);
            await this.prisma!.$executeRawUnsafe(TOOL_USAGE_UPSERT_SQL, ...toolUsageUpsertParams(batch));
            // Lo ya escrito no se reintenta si falla un lote posterior.
            for (const row of batch) {
                drained.delete(`${row.day}|${row.tenantId}|${row.toolName}|${row.mode}|${row.channel}|${row.outcome}`);
            }
        }
        await this.applyRetention();
    }

    /** Borra lo que pasó la retención, a lo sumo una vez por día y por proceso. */
    private async applyRetention(): Promise<void> {
        const today = new Date().toISOString().slice(0, 10);
        if (this.lastRetentionDay === today) return;
        this.lastRetentionDay = today;
        try {
            await this.prisma!.$executeRawUnsafe(TOOL_USAGE_RETENTION_SQL);
        } catch (error) {
            this.warn('retention', error);
        }
    }

    /**
     * Devuelve a memoria lo que no se pudo escribir, para el próximo intento,
     * sin pasar del tope: si la base sigue caída, se descarta en vez de crecer.
     */
    private restore(drained: Map<string, UsageAggregate>): void {
        for (const [key, row] of drained) {
            const current = this.pending.get(key);
            if (current) {
                current.calls += row.calls;
                current.totalMs += row.totalMs;
                current.maxMs = Math.max(current.maxMs, row.maxMs);
                for (let i = 0; i < current.buckets.length; i++) current.buckets[i] += row.buckets[i] || 0;
                current.lastAt = Math.max(current.lastAt, row.lastAt);
                current.lastErrorCode = current.lastErrorCode ?? row.lastErrorCode;
            } else if (this.pending.size < TOOL_USAGE_MAX_KEYS) {
                this.pending.set(key, row);
            }
        }
    }

    private warn(stage: string, error: unknown): void {
        const now = Date.now();
        const message = error instanceof Error ? error.message : String(error);
        if (now - this.lastWarnAt < WARN_INTERVAL_MS) {
            this.logger.debug(`[ToolUsage] ${stage} failed: ${message}`);
            return;
        }
        this.lastWarnAt = now;
        this.logger.warn(`[ToolUsage] ${stage} failed (silenced for 5 min): ${message}`);
    }
}

/** Parámetros posicionales del upsert: un arreglo de texto por columna. */
export function toolUsageUpsertParams(rows: readonly UsageAggregate[]): string[][] {
    const column = (pick: (row: UsageAggregate) => string | number | null): string[] =>
        rows.map(row => {
            const value = pick(row);
            return value === null ? (null as unknown as string) : String(value);
        });
    return [
        column(row => row.day),
        column(row => row.tenantId),
        column(row => row.toolName),
        column(row => row.mode),
        column(row => row.channel),
        column(row => row.outcome),
        column(row => row.calls),
        column(row => row.totalMs),
        column(row => row.maxMs),
        ...Array.from({ length: LATENCY_BUCKET_COUNT }, (_, index) => column(row => row.buckets[index] || 0)),
        column(row => new Date(row.lastAt).toISOString()),
        column(row => row.lastErrorCode),
    ];
}
