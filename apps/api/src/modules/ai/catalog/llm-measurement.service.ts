import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MEASUREMENT_BENCHES, type MeasurementBench, type MeasurementLite } from './promotion-rule';

export interface MeasurementRow {
    id: string;
    model_id: string;
    bench: MeasurementBench;
    n: number;
    pass: number;
    pass_rate: string | number;
    cost_per_case_usd: string | number | null;
    catalog_version: number | null;
    api_commit: string | null;
    run_ref: string | null;
    notes: string | null;
    recorded_by: string | null;
    measured_at: Date;
    created_at: Date;
}

export interface MeasurementInput {
    modelId: string;
    bench: string;
    n: number;
    pass: number;
    costPerCaseUsd?: number | null;
    catalogVersion?: number | null;
    apiCommit?: string | null;
    runRef?: string | null;
    notes?: string | null;
    measuredAt?: string | Date;
}

const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
/** Reloj del runner algo adelantado: se tolera, una fecha futura de verdad no. */
const FUTURE_SKEW_MS = 10 * 60 * 1000;

export function toMeasurementLite(row: MeasurementRow): MeasurementLite {
    return {
        modelId: row.model_id, bench: row.bench, n: Number(row.n), pass: Number(row.pass), passRate: Number(row.pass_rate),
        measuredAt: new Date(row.measured_at), catalogVersion: row.catalog_version == null ? null : Number(row.catalog_version),
    };
}

/**
 * Mediciones QA de modelos (ADR-0030 §5, fase 4). Las escribe el runner de
 * medición (`measure.cjs --record`, `record-measurement.cjs`) o un super admin
 * por el API, y las lee la regla de promoción al validar un borrador. Nada se borra.
 */
@Injectable()
export class LlmMeasurementService {
    private readonly logger = new Logger(LlmMeasurementService.name);

    constructor(private readonly prisma: PrismaService) { }

    async record(input: MeasurementInput, recordedBy?: string | null): Promise<MeasurementRow> {
        const modelId = typeof input.modelId === 'string' ? input.modelId.trim() : '';
        if (!MODEL_ID_RE.test(modelId)) throw new BadRequestException('measurement_bad_model_id');
        if (!(MEASUREMENT_BENCHES as readonly string[]).includes(input.bench)) throw new BadRequestException(`measurement_bad_bench:${input.bench}`);
        const n = Number(input.n), pass = Number(input.pass);
        if (!Number.isInteger(n) || n <= 0) throw new BadRequestException('measurement_bad_n');
        if (!Number.isInteger(pass) || pass < 0 || pass > n) throw new BadRequestException('measurement_bad_pass');
        const cost = input.costPerCaseUsd == null ? null : Number(input.costPerCaseUsd);
        if (cost != null && (!Number.isFinite(cost) || cost < 0)) throw new BadRequestException('measurement_bad_cost');
        const catalogVersion = input.catalogVersion == null ? null : Number(input.catalogVersion);
        if (catalogVersion != null && (!Number.isInteger(catalogVersion) || catalogVersion <= 0)) throw new BadRequestException('measurement_bad_catalog_version');
        const measuredAt = input.measuredAt == null ? new Date() : new Date(input.measuredAt);
        if (Number.isNaN(measuredAt.getTime())) throw new BadRequestException('measurement_bad_measured_at');
        if (measuredAt.getTime() > Date.now() + FUTURE_SKEW_MS) throw new BadRequestException('measurement_in_future');
        const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
        const passRate = Math.round((pass / n) * 10_000) / 10_000;

        const rows = await this.prisma.$queryRaw<MeasurementRow[]>`
            INSERT INTO "public"."llm_model_measurements"
                ("model_id", "bench", "n", "pass", "pass_rate", "cost_per_case_usd", "catalog_version", "api_commit", "run_ref", "notes", "recorded_by", "measured_at")
            VALUES (${modelId}, ${input.bench}, ${n}, ${pass}, ${passRate}::numeric, ${cost}::numeric, ${catalogVersion}::int,
                    ${text(input.apiCommit, 64)}, ${text(input.runRef, 500)}, ${text(input.notes, 2000)}, ${recordedBy ?? null}::uuid, ${measuredAt})
            RETURNING *`;
        this.logger.log(`Measurement ${input.bench} ${modelId}: ${pass}/${n} (${passRate})`);
        return rows[0];
    }

    async list(filter: { modelId?: string; bench?: string; limit?: number } = {}): Promise<MeasurementRow[]> {
        const limit = Math.max(1, Math.min(Math.trunc(filter.limit ?? 100) || 100, 500));
        const modelId = filter.modelId?.trim() || null;
        const bench = filter.bench?.trim() || null;
        return this.prisma.$queryRaw<MeasurementRow[]>`
            SELECT * FROM "public"."llm_model_measurements"
            WHERE (${modelId}::text IS NULL OR "model_id" = ${modelId})
              AND (${bench}::text IS NULL OR "bench" = ${bench})
            ORDER BY "measured_at" DESC LIMIT ${limit}`;
    }

    /** La última medición de cada (modelo, banco) para esos modelos. */
    async latest(modelIds: readonly string[]): Promise<Map<string, MeasurementLite>> {
        const ids = [...new Set(modelIds.filter(Boolean))];
        const out = new Map<string, MeasurementLite>();
        if (!ids.length) return out;
        const rows = await this.prisma.$queryRaw<MeasurementRow[]>`
            SELECT DISTINCT ON ("model_id", "bench") *
            FROM "public"."llm_model_measurements"
            WHERE "model_id" = ANY(${ids}::text[])
            ORDER BY "model_id", "bench", "measured_at" DESC, "created_at" DESC`;
        for (const row of rows) out.set(measurementKey(row.model_id, row.bench), toMeasurementLite(row));
        return out;
    }
}

export const measurementKey = (modelId: string, bench: string) => `${modelId}\u0000${bench}`;
