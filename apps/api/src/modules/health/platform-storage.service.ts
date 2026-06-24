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
}

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

        const [report, schemaSizes] = await Promise.all([
            this.mediaCleanup.getStorageReport(),
            this.getSchemaSizes(),
        ]);

        let totalDbBytes = 0;
        for (const v of schemaSizes.values()) totalDbBytes += v;

        return {
            disk,
            totalMediaBytes: report.totalSizeBytes,
            totalMediaFiles: report.totalFiles,
            totalDbBytes,
            tenantCount: schemaSizes.size,
        };
    }
}
