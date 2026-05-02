import { Module } from '@nestjs/common';
import { PropertiesService } from './properties.service';
import { IcalSyncService } from './ical-sync.service';
import { VacationRentalController } from './vacation-rental.controller';
import { IcalFeedController } from './ical-feed.controller';
import { EmailTemplatesModule } from '../email-templates/email-templates.module';

@Module({
    imports: [EmailTemplatesModule],
    controllers: [VacationRentalController, IcalFeedController],
    providers: [PropertiesService, IcalSyncService],
    exports: [PropertiesService, IcalSyncService],
})
export class VacationRentalModule {}
