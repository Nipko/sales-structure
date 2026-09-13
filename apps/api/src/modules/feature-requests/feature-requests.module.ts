import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FeatureRequestsService } from './feature-requests.service';
import { FeatureRequestsController } from './feature-requests.controller';
import { SettingsModule } from '../settings/settings.module';
import { FeatureNotificationOutboxService } from './feature-notification-outbox.service';

@Module({
    imports: [PrismaModule, SettingsModule],
    controllers: [FeatureRequestsController],
    providers: [FeatureRequestsService, FeatureNotificationOutboxService],
    exports: [FeatureRequestsService],
})
export class FeatureRequestsModule {}
