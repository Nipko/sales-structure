import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

export interface CleanupResult {
    tenantId: string;
    filesOnDisk: number;
    filesInDb: number;
    orphanedFiles: string[];
    freedBytes: number;
}

@Injectable()
export class MediaCleanupService {
    private readonly logger = new Logger(MediaCleanupService.name);
    private readonly storagePath: string;

    constructor(
        private prisma: PrismaService,
        private config: ConfigService,
    ) {
        this.storagePath = config.get<string>('MEDIA_STORAGE_PATH', '/data/media');
    }

    // Run weekly at 4:30 AM Sunday (after backups at 2 AM)
    @Cron('30 4 * * 0')
    async scheduledCleanup() {
        this.logger.log('Starting scheduled media cleanup...');
        const results = await this.cleanupAll(false);
        const totalOrphans = results.reduce((sum, r) => sum + r.orphanedFiles.length, 0);
        const totalFreed = results.reduce((sum, r) => sum + r.freedBytes, 0);
        this.logger.log(
            `Media cleanup complete: ${totalOrphans} orphaned files removed, ${(totalFreed / 1024).toFixed(0)} KB freed across ${results.length} tenants`,
        );
    }

    async cleanupAll(dryRun: boolean): Promise<CleanupResult[]> {
        const results: CleanupResult[] = [];

        if (!fs.existsSync(this.storagePath)) {
            this.logger.warn(`Media storage not found: ${this.storagePath}`);
            return results;
        }

        const tenants = await this.prisma.tenant.findMany({
            where: { isActive: true },
            select: { id: true, schemaName: true },
        });

        for (const tenant of tenants) {
            try {
                const result = await this.cleanupTenant(tenant.id, tenant.schemaName, dryRun);
                if (result.orphanedFiles.length > 0) {
                    results.push(result);
                }
            } catch (e: any) {
                this.logger.warn(`Cleanup failed for tenant ${tenant.id}: ${e.message}`);
            }
        }

        // Also clean directories for deleted/inactive tenants
        const activeTenantIds = new Set(tenants.map(t => t.id));
        try {
            const dirs = fs.readdirSync(this.storagePath, { withFileTypes: true });
            for (const dir of dirs) {
                if (!dir.isDirectory()) continue;
                if (dir.name.startsWith('.')) continue;
                if (!activeTenantIds.has(dir.name)) {
                    const orphanDir = path.join(this.storagePath, dir.name);
                    const files = fs.readdirSync(orphanDir);
                    if (files.length === 0) {
                        if (!dryRun) fs.rmdirSync(orphanDir);
                        this.logger.log(`Removed empty dir for inactive tenant: ${dir.name}`);
                    } else {
                        this.logger.warn(
                            `Found ${files.length} files for inactive/deleted tenant ${dir.name} — skipping (manual review needed)`,
                        );
                    }
                }
            }
        } catch (e: any) {
            this.logger.warn(`Orphan directory scan failed: ${e.message}`);
        }

        return results;
    }

    async cleanupTenant(tenantId: string, schemaName: string, dryRun: boolean): Promise<CleanupResult> {
        const tenantDir = path.join(this.storagePath, tenantId);
        const result: CleanupResult = {
            tenantId,
            filesOnDisk: 0,
            filesInDb: 0,
            orphanedFiles: [],
            freedBytes: 0,
        };

        if (!fs.existsSync(tenantDir)) return result;

        // Get all files on disk
        const diskFiles = new Set<string>();
        try {
            for (const file of fs.readdirSync(tenantDir)) {
                if (file.startsWith('.')) continue;
                diskFiles.add(file);
            }
        } catch { return result; }

        result.filesOnDisk = diskFiles.size;

        // Get all file references from DB
        const dbFileNames = new Set<string>();
        try {
            const rows = await this.prisma.executeInTenantSchema(
                schemaName,
                `SELECT file_name, thumbnail_name FROM media_files`,
                [],
            ) as any[];

            for (const row of rows) {
                if (row.file_name) dbFileNames.add(row.file_name);
                if (row.thumbnail_name) dbFileNames.add(row.thumbnail_name);
            }
        } catch (e: any) {
            // Table might not exist for new tenants
            if (e.message?.includes('does not exist')) return result;
            throw e;
        }

        result.filesInDb = dbFileNames.size;

        // Find orphans: on disk but not in DB
        for (const diskFile of diskFiles) {
            if (!dbFileNames.has(diskFile)) {
                const filePath = path.join(tenantDir, diskFile);
                try {
                    const stats = fs.statSync(filePath);
                    // Skip files less than 1 hour old (might be in-flight uploads)
                    const ageMs = Date.now() - stats.mtimeMs;
                    if (ageMs < 60 * 60 * 1000) continue;

                    result.orphanedFiles.push(diskFile);
                    result.freedBytes += stats.size;

                    if (!dryRun) {
                        fs.unlinkSync(filePath);
                    }
                } catch { /* file disappeared between readdir and stat */ }
            }
        }

        if (result.orphanedFiles.length > 0) {
            this.logger.log(
                `${dryRun ? '[DRY RUN] ' : ''}Tenant ${tenantId}: ${result.orphanedFiles.length} orphans ` +
                `(${(result.freedBytes / 1024).toFixed(0)} KB) — disk: ${result.filesOnDisk}, db: ${result.filesInDb}`,
            );
        }

        return result;
    }

    async getStorageReport(): Promise<{
        totalFiles: number;
        totalSizeBytes: number;
        tenants: { tenantId: string; files: number; sizeBytes: number }[];
    }> {
        let totalFiles = 0;
        let totalSize = 0;
        const tenants: { tenantId: string; files: number; sizeBytes: number }[] = [];

        if (!fs.existsSync(this.storagePath)) {
            return { totalFiles: 0, totalSizeBytes: 0, tenants: [] };
        }

        try {
            const dirs = fs.readdirSync(this.storagePath, { withFileTypes: true });
            for (const dir of dirs) {
                if (!dir.isDirectory() || dir.name.startsWith('.')) continue;

                const tenantDir = path.join(this.storagePath, dir.name);
                let files = 0;
                let size = 0;

                for (const file of fs.readdirSync(tenantDir)) {
                    try {
                        const stat = fs.statSync(path.join(tenantDir, file));
                        if (stat.isFile()) {
                            files++;
                            size += stat.size;
                        }
                    } catch { /* skip */ }
                }

                if (files > 0) {
                    tenants.push({ tenantId: dir.name, files, sizeBytes: size });
                    totalFiles += files;
                    totalSize += size;
                }
            }
        } catch { /* skip */ }

        tenants.sort((a, b) => b.sizeBytes - a.sizeBytes);

        return { totalFiles, totalSizeBytes: totalSize, tenants };
    }
}
