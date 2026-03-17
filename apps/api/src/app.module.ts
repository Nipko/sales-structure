import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';

// Core modules
import { PrismaModule } from './modules/prisma/prisma.module';
import { RedisModule } from './modules/redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { AIModule } from './modules/ai/ai.module';
import { PersonaModule } from './modules/persona/persona.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { HandoffModule } from './modules/handoff/handoff.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { HealthModule } from './modules/health/health.module';
import { AgentConsoleModule } from './modules/agent-console/agent-console.module';
import { PipelineModule } from './modules/pipeline/pipeline.module';
import { AgentAnalyticsModule } from './modules/analytics/agent-analytics.module';
import { SettingsModule } from './modules/settings/settings.module';
import { CopilotModule } from './modules/copilot/copilot.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { OrdersModule } from './modules/orders/orders.module';
import { BroadcastModule } from './modules/broadcast/broadcast.module';
import { IntakeModule } from './modules/intake/intake.module';

// Configuration
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import redisConfig from './config/redis.config';
import authConfig from './config/auth.config';
import llmConfig from './config/llm.config';

@Module({
    imports: [
        // Global config
        ConfigModule.forRoot({
            isGlobal: true,
            load: [appConfig, databaseConfig, redisConfig, authConfig, llmConfig],
            envFilePath: ['.env.local', '.env'],
        }),

        // Scheduled tasks (backups, cleanup)
        ScheduleModule.forRoot(),

        // BullMQ message queue
        BullModule.forRoot({
            connection: {
                host: process.env.REDIS_HOST || 'localhost',
                port: parseInt(process.env.REDIS_PORT || '6379'),
            },
        }),

        // Core infrastructure
        PrismaModule,
        RedisModule,
        HealthModule,

        // Business modules
        AuthModule,
        TenantsModule,
        ChannelsModule,
        ConversationsModule,
        AIModule,
        PersonaModule,
        KnowledgeModule,
        HandoffModule,
        AnalyticsModule,
        AgentConsoleModule,
        PipelineModule,
        AgentAnalyticsModule,
        SettingsModule,
        CopilotModule,
        InventoryModule,
        OrdersModule,
        BroadcastModule,
        IntakeModule,
    ],
})
export class AppModule { }

