import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { PlatformMonitorService } from './platform-monitor.service';
import { PlatformStorageService } from './platform-storage.service';
import { MediaCleanupService } from '../media/media-cleanup.service';
import { LLMRouterService } from '../ai/router/llm-router.service';
import * as os from 'os';

@ApiTags('health')
@Controller('health')
export class HealthController {
    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
        private monitor: PlatformMonitorService,
        private storage: PlatformStorageService,
        private mediaCleanup: MediaCleanupService,
        private llmRouter: LLMRouterService,
    ) { }

    @Get()
    @ApiOperation({ summary: 'Health check (used by Docker healthcheck + Uptime Kuma)' })
    async check() {
        const checks: Record<string, string> = {};

        try {
            await this.prisma.$queryRaw`SELECT 1`;
            checks.database = 'ok';
        } catch {
            checks.database = 'error';
        }

        try {
            await this.redis.set('health:check', 'ok', 5);
            checks.redis = 'ok';
        } catch {
            checks.redis = 'error';
        }

        const allHealthy = Object.values(checks).every((v) => v === 'ok');

        return {
            status: allHealthy ? 'healthy' : 'degraded',
            timestamp: new Date().toISOString(),
            uptime: Math.floor(process.uptime()),
            checks,
        };
    }

    @Get('detailed')
    @ApiOperation({ summary: 'Detailed health check (memory, disk, queues, connections)' })
    async detailed() {
        const checks: Record<string, any> = {};

        // Database
        try {
            const start = Date.now();
            await this.prisma.$queryRaw`SELECT 1`;
            checks.database = { status: 'ok', latencyMs: Date.now() - start };
        } catch (e: any) {
            checks.database = { status: 'error', error: e.message };
        }

        // Redis
        try {
            const start = Date.now();
            await this.redis.set('health:check', 'ok', 5);
            const info = await this.redis.get('health:check');
            checks.redis = { status: info === 'ok' ? 'ok' : 'error', latencyMs: Date.now() - start };
        } catch (e: any) {
            checks.redis = { status: 'error', error: e.message };
        }

        // Redis memory
        try {
            const client = (this.redis as any).client;
            if (client?.info) {
                const info: string = await client.info('memory');
                const usedMatch = info.match(/used_memory_human:(\S+)/);
                const maxMatch = info.match(/maxmemory_human:(\S+)/);
                checks.redisMemory = {
                    used: usedMatch?.[1] || 'unknown',
                    max: maxMatch?.[1] || 'unknown',
                };
            }
        } catch { /* non-critical */ }

        // Process memory
        const mem = process.memoryUsage();
        checks.processMemory = {
            rss: `${Math.round(mem.rss / 1048576)}MB`,
            heapUsed: `${Math.round(mem.heapUsed / 1048576)}MB`,
            heapTotal: `${Math.round(mem.heapTotal / 1048576)}MB`,
        };

        // System
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        checks.system = {
            totalMemory: `${Math.round(totalMem / 1048576)}MB`,
            freeMemory: `${Math.round(freeMem / 1048576)}MB`,
            memoryUsage: `${Math.round(((totalMem - freeMem) / totalMem) * 100)}%`,
            cpuCount: os.cpus().length,
            loadAvg: os.loadavg().map(l => Math.round(l * 100) / 100),
        };

        // Queue status
        const monitorStatus = await this.monitor.getStatus();
        checks.queues = monitorStatus.queues;

        const allHealthy = checks.database?.status === 'ok' && checks.redis?.status === 'ok';

        return {
            status: allHealthy ? 'healthy' : 'degraded',
            timestamp: new Date().toISOString(),
            uptime: Math.floor(process.uptime()),
            version: process.env.GIT_SHA || 'dev',
            checks,
            activeAlerts: monitorStatus.activeAlerts,
        };
    }

    @Get('llm-providers')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('super_admin')
    @ApiOperation({ summary: 'LLM provider health status (super_admin only)' })
    async llmProviderHealth() {
        return this.llmRouter.getProviderHealth();
    }

    @Get('storage')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('super_admin')
    @ApiOperation({ summary: 'Media storage report (super_admin only)' })
    async storageReport() {
        return this.mediaCleanup.getStorageReport();
    }

    @Get('storage/overview')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('super_admin')
    @ApiOperation({ summary: 'Platform disk + storage totals (super_admin only)' })
    async storageOverview() {
        return { success: true, data: await this.storage.getDiskOverview() };
    }

    @Get('storage/tenants')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('super_admin')
    @ApiOperation({ summary: 'Per-tenant storage (DB schema + media + quota) (super_admin only)' })
    async storageTenants() {
        return { success: true, data: await this.storage.getPerTenantStorage() };
    }

    @Get('storage/history')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('super_admin')
    @ApiOperation({ summary: 'Storage snapshot history for the trend chart (super_admin only)' })
    async storageHistory(@Query('days') days?: string, @Query('tenantId') tenantId?: string) {
        const d = days ? parseInt(days, 10) : 30;
        return { success: true, data: await this.storage.getHistory(Number.isFinite(d) ? d : 30, tenantId) };
    }

    @Post('media-cleanup')
    @UseGuards(AuthGuard('jwt'), RolesGuard)
    @Roles('super_admin')
    @ApiOperation({ summary: 'Run orphaned media cleanup (super_admin only)' })
    async mediaCleanupRun(@Query('dryRun') dryRun?: string) {
        const isDryRun = dryRun !== 'false';
        const results = await this.mediaCleanup.cleanupAll(isDryRun);
        const totalOrphans = results.reduce((sum, r) => sum + r.orphanedFiles.length, 0);
        const totalFreed = results.reduce((sum, r) => sum + r.freedBytes, 0);
        return {
            success: true,
            data: {
                dryRun: isDryRun,
                tenantsAffected: results.length,
                totalOrphanedFiles: totalOrphans,
                totalFreedBytes: totalFreed,
                totalFreedMB: Math.round(totalFreed / 1048576 * 100) / 100,
                details: results,
            },
        };
    }
}
