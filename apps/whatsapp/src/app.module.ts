import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { HttpModule } from '@nestjs/axios';
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import redisConfig from './config/redis.config';
import metaConfig from './config/meta.config';
import { HealthModule } from './modules/health/health.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { MetaGraphModule } from './modules/meta-graph/meta-graph.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { AssetsModule } from './modules/assets/assets.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { AuditModule } from './modules/audit/audit.module';

@Module({
  imports: [
    // Config global — carga variables de entorno
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, redisConfig, metaConfig],
      envFilePath: ['.env.local', '.env'],
    }),

    // BullMQ — colas de jobs
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('redis.host'),
          port: config.get<number>('redis.port'),
          password: config.get<string>('redis.password') || undefined,
        },
        prefix: 'wa', // prefijo para todas las colas: wa:onboarding, wa:webhooks, etc.
      }),
    }),

    // Tareas programadas (reconciliación periódica)
    ScheduleModule.forRoot(),

    // HTTP client global
    HttpModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        timeout: 30000,
        maxRedirects: 3,
        headers: {
          'User-Agent': 'Parallext-WhatsApp-Service/1.0',
        },
      }),
    }),

    // Módulos del servicio
    PrismaModule,
    HealthModule,
    MetaGraphModule,
    OnboardingModule,
    WebhooksModule,
    AssetsModule,
    JobsModule,
    AuditModule,
  ],
})
export class AppModule {}
