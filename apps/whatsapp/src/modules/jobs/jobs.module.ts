import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { WebhookProcessor } from './webhook.processor';

@Module({
  imports: [
    HttpModule,
    ConfigModule,
    BullModule.registerQueue(
      { name: 'webhooks' },
      { name: 'sync' },
      { name: 'onboarding' },
      { name: 'ops' },
    ),
  ],
  providers: [WebhookProcessor],
})
export class JobsModule {}

