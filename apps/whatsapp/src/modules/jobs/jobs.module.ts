import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WebhookProcessor } from './webhook.processor';

@Module({
  imports: [
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
