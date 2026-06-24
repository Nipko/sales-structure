import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MediaCleanupService } from '../media/media-cleanup.service';
import { TenantThrottleService } from '../throttle/tenant-throttle.service';
import * as fs from 'fs';

export interface TenantStorageRow {
    tenantId: string;
    tenantName: string;
    plan: string;
    dbBytes: number;
    mediaBytes: number;
    mediaFiles: number;
    totalBytes: number;
    /** Plan media quota in MB. -1 = unlimited, 0 = not configured. */
    mediaLimitMb: number;
    mediaUsedMb: number;
    /** % of media quota used (0 when unlimited/unconfigured). */
    mediaPct: number;
}

export interface DiskProjection {
    /** Estimated days until the disk reaches 100%, from linear regression. */
    daysUntilFull: number;
    /** Growth rate in disk-% points per day. */
    slopePctPerDay: number;
    /** Most recent disk usage %. */
    currentPct: number;
}

export interface DiskOverview {
    disk: {
        totalBytes: number;
        freeBytes: number;
        usedBytes: number;
        usedPct: number;
    } | null;
    totalMediaBytes: number;
    totalMediaFiles: number;
    totalDbBytes: number;
    tenantCount: number;
    /** Disk-fill projection from snapshot history; null until ≥3 daily snapshots exist. */
    projection: DiskProjection | null;
}

export interface StorageHistoryPoint {
    date: string;
    dbBytes: number;
    mediaBytes: number;
    diskUsedPct: number | null;
}

/** tenant_id value used for the platform-wide snapshot row. */
const PLATFORM_ROW = 'platform';

/**
 * Per-tenant storage observability for super_admin.
 *
 * Combines two signals nobody surfaced before:
 *   - PostgreSQL schema size per tenant (pg_total_relation_size over the
 *     tenant_* schemas) — the biggest unbounded blind spot (messages,
 *     conversations, pgvector embeddings).
 *   - Media files on disk per tenant (reuses MediaCleanupService report).
 *
 * Read-only; the daily snapshot/projection + quota alerts land in Phase 3.
 */
@Injectable()
export class PlatformStorageService {
    private readonly logger = new Logger(PlatformStorageService.name);
    private readonly storagePath: string;

    constructor(
        private readonly prisma: PrismaService,
        private readonly config: ConfigService,
        private readonly mediaCleanup: MediaCleanupService,
        private readonly throttle: TenantThrottleService,
    ) {
        this.storagePath = this.config.get<string>('MEDIA_STORAGE_PATH', '/data/media');
    }

    /**
     * Total on-disk size (tables + indexes + toast) of every tenant_* schema,
     * keyed by schema name. One round-trip for all tenants.
     *
     * relkind filter ('r','m','p') avoids double counting — pg_total_relation_size
     * on a table already includes its indexes and TOAST.
     */
    async getSchemaSizes(): Promise<Map<string, number>> {
        const map = new Map<string, number>();
        try {
            const rows = await this.prisma.$queryRawUnsafe(`
                SELECT n.nspname AS schema,
                       COALESCE(SUM(pg_total_relation_size(c.oid)), 0)::float8 AS bytes
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname LIKE 'tenant_%'
                  AND c.relkind IN ('r', 'm', 'p')
                GROUP BY n.nspname
            `) as Array<{ schema: string; bytes: number }>;
            for (const r of rows) {
                map.set(r.schema, Number(r.bytes) || 0);
            }
        } catch (e: any) {
            this.logger.warn(`getSchemaSizes failed: ${e.message}`);
        }
        return map;
    }

    /** Combined per-tenant storage table: DB schema + media disk + quota. */
    async getPerTenantStorage(): Promise<TenantStorageRow[]> {
        const [schemaSizes, mediaReport, tenants] = await Promise.all([
            this.getSchemaSizes(),
            this.mediaCleanup.getStorageReport(),
            this.prisma.tenant.findMany({
                where: { isActive: true },
                select: { id: true, name: true, schemaName: true, plan: true },
            }),
        ]);

        const mediaByTenant = new Map<string, { files: number; sizeBytes: number }>();
        for (const t of mediaReport.tenants) {
            mediaByTenant.set(t.tenantId, { files: t.files, sizeBytes: t.sizeBytes });
        }

        const rows = await Promise.all(tenants.map(async (t: { id: string; name: string; schemaName: string; plan: string }) => {
            const dbBytes = schemaSizes.get(t.schemaName) ?? 0;
            const media = mediaByTenant.get(t.id) ?? { files: 0, sizeBytes: 0 };
            const mediaBytes = media.sizeBytes;
            const mediaUsedMb = mediaBytes / (1024 * 1024);

            // Resolve effective media quota (plan + per-tenant overrides).
            // getPlanLimit returns Infinity for -1 (unlimited) and 0 when unset.
            const limitRaw = await this.throttle.getPlanLimit(t.id, 'mediaStorageMb');
            const mediaLimitMb = Number.isFinite(limitRaw) ? (limitRaw as number) : -1;
            const mediaPct = mediaLimitMb > 0
                ? Math.min(100, Math.round((mediaUsedMb / mediaLimitMb) * 100))
                : 0;

            return {
                tenantId: t.id,
                tenantName: t.name,
                plan: t.plan,
                dbBytes,
                mediaBytes,
                mediaFiles: media.files,
                totalBytes: dbBytes + mediaBytes,
                mediaLimitMb,
                mediaUsedMb: Math.round(mediaUsedMb * 100) / 100,
                mediaPct,
            };
        }));

        return rows.sort((a, b) => b.totalBytes - a.totalBytes);
    }

    /** Platform-wide disk + aggregate storage totals. */
    async getDiskOverview(): Promise<DiskOverview> {
        let disk: DiskOverview['disk'] = null;
        try {
            const stats = fs.statfsSync(this.storagePath);
            const totalBytes = stats.blocks * stats.bsize;
            const freeBytes = stats.bfree * stats.bsize;
            const usedBytes = totalBytes - freeBytes;
            disk = {
                totalBytes,
                freeBytes,
                usedBytes,
                usedPct: totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0,
            };
        } catch (e: any) {
            // statfs not available on this platform (e.g. dev Windows) — non-fatal.
            this.logger.debug(`Disk overview skipped: ${e.message}`);
        }

        const [report, schemaSizes, projection] = await Promise.all([
            this.mediaCleanup.getStorageReport(),
            this.getSchemaSizes(),
            this.getDiskProjection(),
        ]);

        let totalDbBytes = 0;
        for (const v of schemaSizes.values()) totalDbBytes += v;

        return {
            disk,
            totalMediaBytes: report.totalSizeBytes,
            totalMediaFiles: report.totalFiles,
            totalDbBytes,
            tenantCount: schemaSizes.size,
            projection,
        };
    }

    // ── Phase 3: daily snapshots, projection, history ──────────────

    /**
     * Write one snapshot row per active tenant (db + media bytes) plus a
     * platform-wide row (tenant_id = 'platform') carrying disk %. Idempotent:
     * replaces today's rows. Prunes rows older than 90 days. Called daily by
     * the storage cron in PlatformMonitorService.
     */
    async captureSnapshot(): Promise<void> {
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);

        const [perTenant, overview] = await Promise.all([
            this.getPerTenantStorage(),
            this.getDiskOverview(),
        ]);

        const rows = perTenant.map((t) => ({
            snapshotDate: today,
            tenantId: t.tenantId,
            dbBytes: BigInt(Math.max(0, Math.round(t.dbBytes))),
            mediaBytes: BigInt(Math.max(0, Math.round(t.mediaBytes))),
            diskUsedPct: null as number | null,
        }));
        rows.push({
            snapshotDate: today,
            tenantId: PLATFORM_ROW,
            dbBytes: BigInt(Math.max(0, Math.round(overview.totalDbBytes))),
            mediaBytes: BigInt(Math.max(0, Math.round(overview.totalMediaBytes))),
            diskUsedPct: overview.disk?.usedPct ?? null,
        });

        // Replace today's rows so a re-run is idempotent.
        await this.prisma.storageSnapshot.deleteMany({ where: { snapshotDate: today } });
        await this.prisma.storageSnapshot.createMany({ data: rows });

        const cutoff = new Date(today);
        cutoff.setUTCDate(cutoff.getUTCDate() - 90);
        await this.prisma.storageSnapshot.deleteMany({ where: { snapshotDate: { lt: cutoff } } });
    }

    /**
     * Linear-regression projection of when the disk reaches 100%, from the
     * platform-row snapshot history. Returns null until ≥3 snapshots exist or
     * when disk usage is not meaningfully growing.
     */
    async getDiskProjection(): Promise<DiskProjection | null> {
        try {
            const snaps = await this.prisma.storageSnapshot.findMany({
                where: { tenantId: PLATFORM_ROW, diskUsedPct: { not: null } },
                orderBy: { snapshotDate: 'desc' },
                take: 30,
                select: { snapshotDate: true, diskUsedPct: true },
            });
            // Fetched newest-first to get the MOST RECENT 30; flip back to
            // ascending so the regression slope and currentPct reflect recent data.
            snaps.reverse();
            const points = snaps
                .filter((s: { diskUsedPct: number | null }) => s.diskUsedPct != null)
                .map((s: { snapshotDate: Date; diskUsedPct: number | null }) => ({
                    x: s.snapshotDate.getTime(),
                    y: s.diskUsedPct as number,
                }));
            if (points.length < 3) return null;

            const x0 = points[0].x;
            const xs = points.map((p) => (p.x - x0) / 86400000); // days from first point
            const ys = points.map((p) => p.y);
            const n = xs.length;
            const sx = xs.reduce((a, b) => a + b, 0);
            const sy = ys.reduce((a, b) => a + b, 0);
            const sxx = xs.reduce((a, b) => a + b * b, 0);
            const sxy = xs.reduce((a, b, i) => a + b * ys[i], 0);
            const denom = n * sxx - sx * sx;
            if (denom === 0) return null;

            const slope = (n * sxy - sx * sy) / denom; // % points per day
            if (slope <= 0.01) return null; // not meaningfully growing

            const currentPct = ys[ys.length - 1];
            const daysUntilFull = (100 - currentPct) / slope;
            if (!Number.isFinite(daysUntilFull) || daysUntilFull < 0) return null;

            return {
                daysUntilFull: Math.round(daysUntilFull),
                slopePctPerDay: Math.round(slope * 100) / 100,
                currentPct,
            };
        } catch (e: any) {
            this.logger.debug(`getDiskProjection skipped: ${e.message}`);
            return null;
        }
    }

    /** Snapshot history for the trend chart. Defaults to the platform-wide row. */
    async getHistory(days = 30, tenantId?: string): Promise<StorageHistoryPoint[]> {
        const span = Math.max(1, Math.min(365, Number(days) || 30));
        const cutoff = new Date();
        cutoff.setUTCHours(0, 0, 0, 0);
        cutoff.setUTCDate(cutoff.getUTCDate() - span);

        const snaps = await this.prisma.storageSnapshot.findMany({
            where: { tenantId: tenantId || PLATFORM_ROW, snapshotDate: { gte: cutoff } },
            orderBy: { snapshotDate: 'asc' },
            select: { snapshotDate: true, dbBytes: true, mediaBytes: true, diskUsedPct: true },
        });

        return snaps.map((s: { snapshotDate: Date; dbBytes: bigint; mediaBytes: bigint; diskUsedPct: number | null }) => ({
            date: s.snapshotDate.toISOString().slice(0, 10),
            dbBytes: Number(s.dbBytes),
            mediaBytes: Number(s.mediaBytes),
            diskUsedPct: s.diskUsedPct,
        }));
    }
}
