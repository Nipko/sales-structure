import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
    constructor(
        private prisma: PrismaService,
        private redis: RedisService,
    ) { }

    @Get()
    @ApiOperation({ summary: 'Health check' })
    async check() {
        const checks: Record<string, string> = {};

        // Database check
        try {
            await this.prisma.$queryRaw`SELECT 1`;
            checks.database = 'ok';
        } catch {
            checks.database = 'error';
        }

        // Redis check
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
            uptime: process.uptime(),
            checks,
        };
    }
}
