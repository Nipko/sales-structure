import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PipelineModule } from '../pipeline/pipeline.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { PublicApiKeyService } from './public-api-key.service';
import { PublicApiGuard } from './guards/public-api.guard';
import { PublicApiRateLimitGuard } from './guards/public-api-rate-limit.guard';
import { ApiScopeGuard } from './guards/api-scope.guard';
import { PublicApiKeyController } from './public-api-key.controller';
import { PublicApiController } from './public-api.controller';

@Module({
    imports: [
        HttpModule,
        PipelineModule,
        AppointmentsModule,
        WebhooksModule,
    ],
    controllers: [PublicApiKeyController, PublicApiController],
    providers: [
        PublicApiKeyService,
        PublicApiGuard,
        PublicApiRateLimitGuard,
        ApiScopeGuard,
    ],
    exports: [PublicApiKeyService],
})
export class PublicApiModule {}
