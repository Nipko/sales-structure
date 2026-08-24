import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PipelineModule } from '../pipeline/pipeline.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { PublicApiKeyModule } from './public-api-key.module';
import { PublicApiGuard } from './guards/public-api.guard';
import { PublicApiRateLimitGuard } from './guards/public-api-rate-limit.guard';
import { ApiScopeGuard } from './guards/api-scope.guard';
import { PublicApiKeyController } from './public-api-key.controller';
import { PublicApiController } from './public-api.controller';
import { WebhookSubscriptionService } from './webhook-subscription.service';
import { WebhookEventListenerService } from './webhook-event-listener.service';

@Module({
    imports: [
        HttpModule.register({ timeout: 10_000 }),
        PipelineModule,
        AppointmentsModule,
        PublicApiKeyModule,
    ],
    controllers: [PublicApiKeyController, PublicApiController],
    providers: [
        PublicApiGuard,
        PublicApiRateLimitGuard,
        ApiScopeGuard,
        WebhookSubscriptionService,
        WebhookEventListenerService,
    ],
    exports: [PublicApiKeyModule, PublicApiGuard, WebhookSubscriptionService],
})
export class PublicApiModule {}
