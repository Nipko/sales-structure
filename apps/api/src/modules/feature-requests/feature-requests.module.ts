import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FeatureRequestsService } from './feature-requests.service';
import { FeatureRequestsController } from './feature-requests.controller';
import { SettingsModule } from '../settings/settings.module';
import { PlatformNotificationModule } from '../platform-notifications/platform-notification.module';

@Module({
    imports: [PrismaModule, SettingsModule, PlatformNotificationModule],
    controllers: [FeatureRequestsController],
    providers: [FeatureRequestsService],
    exports: [FeatureRequestsService],
})
export class FeatureRequestsModule {}
