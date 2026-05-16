import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import * as os from 'os';

@ApiTags('health')
@Controller('health')
export class HealthController {
    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
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
    @ApiOperation({ summary: 'Detailed health check (memory, disk, connections)' })
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

        const allHealthy = checks.database?.status === 'ok' && checks.redis?.status === 'ok';

        return {
            status: allHealthy ? 'healthy' : 'degraded',
            timestamp: new Date().toISOString(),
            uptime: Math.floor(process.uptime()),
            version: process.env.GIT_SHA || 'dev',
            checks,
        };
    }
}
