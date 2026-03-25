import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import * as IORedis from 'ioredis';

@ApiTags('health')
@Controller('health')
export class HealthController {
  private redis: IORedis.Redis;

  constructor(
    private health: HealthCheckService,
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    this.redis = new IORedis.Redis({
      host: config.get<string>('redis.host'),
      port: config.get<number>('redis.port'),
      password: config.get<string>('redis.password') || undefined,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe — el proceso está vivo' })
  live() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness probe — la BD y Redis están disponibles' })
  async ready() {
    return this.health.check([
      // Check PostgreSQL
      async () => {
        try {
          await this.prisma.$queryRaw`SELECT 1`;
          return { database: { status: 'up' } };
        } catch {
          return { database: { status: 'down', error: 'Cannot connect to PostgreSQL' } };
        }
      },
      // Check Redis
      async () => {
        try {
          await this.redis.ping();
          return { redis: { status: 'up' } };
        } catch {
          return { redis: { status: 'down', error: 'Cannot connect to Redis' } };
        }
      },
    ]);
  }
}
