import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PipelineModule } from '../pipeline/pipeline.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { PublicApiKeyService } from './public-api-key.service';
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
    ],
    controllers: [PublicApiKeyController, PublicApiController],
    providers: [
        PublicApiKeyService,
        PublicApiGuard,
        PublicApiRateLimitGuard,
        ApiScopeGuard,
        WebhookSubscriptionService,
        WebhookEventListenerService,
    ],
    exports: [PublicApiKeyService, WebhookSubscriptionService],
})
export class PublicApiModule {}
