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

export interface MediaStorageReport {
    totalFiles: number;
    totalSizeBytes: number;
    tenants: { tenantId: string; files: number; sizeBytes: number }[];
    /** Files below reserved/invalid roots (for example `system/`), never assigned to a tenant. */
    unattributedFiles: number;
    unattributedSizeBytes: number;
    /** False when a permission/read error or traversal budget prevented a complete measurement. */
    complete: boolean;
    /** Bounded, non-fatal diagnostics. The report never follows symbolic links. */
    warnings: string[];
}

const STORAGE_REPORT_MAX_DEPTH = 8;
const STORAGE_REPORT_MAX_DIRECTORIES = 50_000;
const STORAGE_REPORT_MAX_FILES = 250_000;
const STORAGE_REPORT_MAX_WARNINGS = 20;
const TENANT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface StorageTraversalBudget {
    directories: number;
    files: number;
    exhausted: boolean;
}

interface MeasuredTree {
    files: number;
    sizeBytes: number;
    complete: boolean;
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
        const activeTenantIds = new Set(tenants.map((t: { id: string }) => t.id));
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

    async getStorageReport(): Promise<MediaStorageReport> {
        const empty = (): MediaStorageReport => ({
            totalFiles: 0,
            totalSizeBytes: 0,
            tenants: [],
            unattributedFiles: 0,
            unattributedSizeBytes: 0,
            complete: true,
            warnings: [],
        });
        if (!fs.existsSync(this.storagePath)) return empty();

        const report = empty();
        const byTenant = new Map<string, { files: number; sizeBytes: number }>();
        const budget: StorageTraversalBudget = { directories: 0, files: 0, exhausted: false };

        const warn = (message: string) => {
            report.complete = false;
            if (report.warnings.length < STORAGE_REPORT_MAX_WARNINGS) report.warnings.push(message);
        };
        const addMeasurement = (tenantId: string | null, measured: MeasuredTree) => {
            report.totalFiles += measured.files;
            report.totalSizeBytes += measured.sizeBytes;
            if (!measured.complete) report.complete = false;
            if (!tenantId) {
                report.unattributedFiles += measured.files;
                report.unattributedSizeBytes += measured.sizeBytes;
                return;
            }
            const current = byTenant.get(tenantId) || { files: 0, sizeBytes: 0 };
            current.files += measured.files;
            current.sizeBytes += measured.sizeBytes;
            byTenant.set(tenantId, current);
        };
        const measureFile = (filePath: string): MeasuredTree => {
            if (budget.files >= STORAGE_REPORT_MAX_FILES) {
                budget.exhausted = true;
                warn(`file traversal limit reached (${STORAGE_REPORT_MAX_FILES})`);
                return { files: 0, sizeBytes: 0, complete: false };
            }
            try {
                const stat = fs.lstatSync(filePath);
                if (stat.isSymbolicLink()) {
                    warn(`symbolic link skipped: ${path.basename(filePath)}`);
                    return { files: 0, sizeBytes: 0, complete: false };
                }
                if (!stat.isFile()) return { files: 0, sizeBytes: 0, complete: true };
                budget.files++;
                return { files: 1, sizeBytes: stat.size, complete: true };
            } catch (error: any) {
                warn(`could not inspect ${path.basename(filePath)}: ${error?.code || 'read_error'}`);
                return { files: 0, sizeBytes: 0, complete: false };
            }
        };
        const measureTree = (root: string): MeasuredTree => {
            const measured: MeasuredTree = { files: 0, sizeBytes: 0, complete: true };
            const stack: Array<{ directory: string; depth: number }> = [{ directory: root, depth: 0 }];
            while (stack.length && !budget.exhausted) {
                const current = stack.pop()!;
                if (budget.directories >= STORAGE_REPORT_MAX_DIRECTORIES) {
                    budget.exhausted = true;
                    measured.complete = false;
                    warn(`directory traversal limit reached (${STORAGE_REPORT_MAX_DIRECTORIES})`);
                    break;
                }
                budget.directories++;
                let entries: fs.Dirent[];
                try {
                    entries = fs.readdirSync(current.directory, { withFileTypes: true });
                } catch (error: any) {
                    measured.complete = false;
                    warn(`could not read ${path.basename(current.directory)}: ${error?.code || 'read_error'}`);
                    continue;
                }
                for (const entry of entries) {
                    if (budget.exhausted) break;
                    const entryPath = path.join(current.directory, entry.name);
                    if (entry.isSymbolicLink()) {
                        measured.complete = false;
                        warn(`symbolic link skipped: ${entry.name}`);
                        continue;
                    }
                    if (entry.isDirectory()) {
                        if (current.depth >= STORAGE_REPORT_MAX_DEPTH) {
                            measured.complete = false;
                            warn(`directory depth limit reached below ${path.basename(root)}`);
                        } else {
                            stack.push({ directory: entryPath, depth: current.depth + 1 });
                        }
                        continue;
                    }
                    if (!entry.isFile()) continue;
                    const file = measureFile(entryPath);
                    measured.files += file.files;
                    measured.sizeBytes += file.sizeBytes;
                    measured.complete = measured.complete && file.complete;
                }
            }
            if (budget.exhausted) measured.complete = false;
            return measured;
        };

        let rootEntries: fs.Dirent[];
        try {
            rootEntries = fs.readdirSync(this.storagePath, { withFileTypes: true });
        } catch (error: any) {
            warn(`could not read media storage root: ${error?.code || 'read_error'}`);
            this.logger.warn(`Storage report incomplete: ${report.warnings.join('; ')}`);
            return report;
        }

        for (const entry of rootEntries) {
            if (budget.exhausted) break;
            const entryPath = path.join(this.storagePath, entry.name);
            if (entry.isSymbolicLink()) {
                warn(`symbolic link skipped: ${entry.name}`);
                continue;
            }
            if (entry.isFile()) {
                addMeasurement(null, measureFile(entryPath));
                continue;
            }
            if (!entry.isDirectory()) continue;

            if (entry.name !== 'archives') {
                addMeasurement(TENANT_ID_PATTERN.test(entry.name) ? entry.name : null, measureTree(entryPath));
                continue;
            }

            // Cold storage is laid out as archives/{tenantId}/... and must be
            // merged into the same tenant row as /{tenantId}/ hot media.
            let archiveEntries: fs.Dirent[];
            try {
                archiveEntries = fs.readdirSync(entryPath, { withFileTypes: true });
            } catch (error: any) {
                warn(`could not read archives root: ${error?.code || 'read_error'}`);
                continue;
            }
            for (const archiveEntry of archiveEntries) {
                if (budget.exhausted) break;
                const archivePath = path.join(entryPath, archiveEntry.name);
                if (archiveEntry.isSymbolicLink()) {
                    warn(`symbolic link skipped: ${archiveEntry.name}`);
                    continue;
                }
                if (archiveEntry.isFile()) {
                    addMeasurement(null, measureFile(archivePath));
                } else if (archiveEntry.isDirectory()) {
                    addMeasurement(
                        TENANT_ID_PATTERN.test(archiveEntry.name) ? archiveEntry.name : null,
                        measureTree(archivePath),
                    );
                }
            }
        }

        report.tenants = [...byTenant.entries()]
            .map(([tenantId, usage]) => ({ tenantId, ...usage }))
            .filter(usage => usage.files > 0)
            .sort((a, b) => b.sizeBytes - a.sizeBytes);
        if (!report.complete) {
            this.logger.warn(`Storage report incomplete: ${report.warnings.join('; ') || 'traversal budget exhausted'}`);
        }
        return report;
    }
}
