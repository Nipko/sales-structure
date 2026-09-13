import { Module } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { InvitationsController } from './invitations.controller';
import { PlatformNotificationModule } from '../platform-notifications/platform-notification.module';

@Module({
    imports: [PlatformNotificationModule],
    controllers: [InvitationsController],
    providers: [InvitationsService],
    exports: [InvitationsService],
})
export class InvitationsModule {}
